import { readFile } from "fs/promises";
import OpenAI from "openai";

import { ALLOWED_SERVICES, AllowedService, isAllowedService } from "./services";
import {
  ProviderFrontmatter,
  ProviderFrontmatterSchema,
  PROVIDER_SCHEMA_VERSION,
} from "./schema";
import { CrawledPage } from "./crawl";
import { dedupe, getOrigin, normalizeSlug, normalizeText } from "./utils";

type PartialProvider = Partial<ProviderFrontmatter> & {
  lead_contact?: {
    type?: string;
    value?: string;
    notes?: string;
  };
  notes?: string;
};

type DescriptionResult = {
  description: string;
  blockedReason?: string;
};

const SERVICE_KEYWORDS: Array<{ service: (typeof ALLOWED_SERVICES)[number]; terms: string[] }> = [
  { service: "Pentest", terms: ["pentest", "penetration test", "penetration-testing"] },
  { service: "Web App Pentest", terms: ["web app pentest", "web application pentest"] },
  { service: "Cloud Security", terms: ["cloud security", "aws", "azure", "gcp"] },
  { service: "Incident Response", terms: ["incident response", "forensics", "breach"] },
  { service: "ISO 27001 Consulting", terms: ["iso 27001", "iso27001"] },
  { service: "NIS2 Consulting", terms: ["nis2"] },
  { service: "SOC / MDR", terms: ["soc", "mdr", "managed detection", "xdr"] },
  { service: "Vulnerability Management", terms: ["vulnerability management", "vuln management"] },
];

const BSI_APT_RESPONSE_URL =
  "https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Cyber-Sicherheit/Themen/Dienstleister_APT-Response-Liste.pdf?__blob=publicationFile&v=42";
const BSI_APT_RESPONSE_LIST_PATH = "seeds/bsi-apt-response.txt";
const BSI_APT_QUALIFICATION = "BSI Qualified APT Response";
let bsiAptResponseSlugsPromise: Promise<Set<string>> | null = null;

const loadBsiAptResponseSlugs = async (): Promise<Set<string>> => {
  if (!bsiAptResponseSlugsPromise) {
    bsiAptResponseSlugsPromise = readFile(BSI_APT_RESPONSE_LIST_PATH, "utf8")
      .then((content) =>
        content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"))
          .map((entry) => {
            try {
              return normalizeSlug(entry);
            } catch {
              return "";
            }
          })
          .filter((entry) => entry.length > 0),
      )
      .then((slugs) => new Set(slugs))
      .catch(() => new Set());
  }
  return bsiAptResponseSlugsPromise;
};

const isFullServiceList = (values: AllowedService[]): boolean => {
  if (values.length !== ALLOWED_SERVICES.length) {
    return false;
  }
  return ALLOWED_SERVICES.every((service) => values.includes(service));
};

const LANGUAGE_HINTS: Array<{ lang: "de" | "en"; terms: string[] }> = [
  { lang: "de", terms: ["kontakt", "impressum", "leistungen", "datenschutz", "über uns", "ueber uns"] },
  { lang: "en", terms: ["contact", "about", "services", "privacy", "case study"] },
];

const REGION_HINTS: Array<{ region: "DACH" | "DE" | "AT" | "CH" | "EU" | "GLOBAL"; terms: string[] }> = [
  { region: "DACH", terms: ["dach"] },
  { region: "DE", terms: ["germany", "deutschland", "berlin", "munich", "muenchen"] },
  { region: "AT", terms: ["austria", "österreich", "oesterreich", "vienna", "wien"] },
  { region: "CH", terms: ["switzerland", "schweiz", "zurich", "zürich"] },
  { region: "EU", terms: ["europe", "eu"] },
  { region: "GLOBAL", terms: ["global", "worldwide", "international"] },
];

const parseJson = (payload: string): PartialProvider => {
  try {
    return JSON.parse(payload) as PartialProvider;
  } catch (error) {
    const start = payload.indexOf("{");
    const end = payload.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(payload.slice(start, end + 1)) as PartialProvider;
    }
    throw error;
  }
};

const inferServices = (text: string): AllowedService[] => {
  const lower = text.toLowerCase();
  const matches = SERVICE_KEYWORDS.filter((entry) =>
    entry.terms.some((term) => lower.includes(term)),
  ).map((entry) => entry.service);
  return dedupe(matches);
};

const inferLanguages = (text: string): Array<"de" | "en"> => {
  const lower = text.toLowerCase();
  const matches = LANGUAGE_HINTS.filter((entry) =>
    entry.terms.some((term) => lower.includes(term)),
  ).map((entry) => entry.lang);
  return dedupe(matches);
};

const inferRegions = (text: string): Array<"DACH" | "DE" | "AT" | "CH" | "EU" | "GLOBAL"> => {
  const lower = text.toLowerCase();
  const matches = REGION_HINTS.filter((entry) =>
    entry.terms.some((term) => lower.includes(term)),
  ).map((entry) => entry.region);
  return dedupe(matches);
};

const normalizeLeadContact = (
  leadContact: PartialProvider["lead_contact"],
  seedUrl: string,
  contactUrl: string | undefined,
  notes: string[],
) => {
  if (leadContact?.type && leadContact?.value) {
    if (leadContact.type === "email" || leadContact.type === "form" || leadContact.type === "phone") {
      return {
        type: leadContact.type,
        value: leadContact.value,
        notes: leadContact.notes,
      } as ProviderFrontmatter["lead_contact"];
    }
  }

  notes.push("Lead contact not stated; defaulted to contact form.");
  return {
    type: "form",
    value: contactUrl ?? `${getOrigin(seedUrl)}/contact`,
    notes: undefined,
  } as ProviderFrontmatter["lead_contact"];
};

const DESCRIPTION_BLACKLIST = [
  "details are not clearly stated",
  "details were not clearly stated",
  "public sources",
  "limited information",
  "insufficient information",
  "not clearly described",
  "details are limited",
  "details are scarce",
  "begrenz",
  "begrenzte information",
  "nicht klar beschrieben",
  "öffentlich",
  "kaum beschrieben",
  "nicht ausreichend beschrieben",
  "maßgeschneidert",
  "maßgeschneiderte",
  "tailored",
  "tailor-made",
  "best in class",
  "cutting edge",
  "state of the art",
  "innovative",
  "modernste",
  "führend",
  "leading",
  "proaktiv",
];

const DIFFERENTIATOR_BLACKLIST = [
  "tailored solutions",
  "customized solutions",
  "best in class",
  "cutting edge",
  "state of the art",
  "innovative solutions",
  "führend",
  "führender anbieter",
  "maßgeschneiderte lösungen",
  "innovative",
  "modernste",
];

const DIFFERENTIATOR_HINTS = [
  "specializ",
  "specialis",
  "focus",
  "fokus",
  "schwerpunkt",
  "spezialisiert",
  "spezialisier",
  "public sector",
  "government",
  "critical infrastructure",
  "kritische infrastruktur",
  "regulated",
  "kritis",
  "24/7",
  "response",
  "incident response",
  "soc",
  "mdr",
  "forensics",
  "iso 27001",
  "nis2",
];

const SECURITY_KEYWORDS = [
  "cybersecurity",
  "information security",
  "it security",
  "it-sicherheit",
  "it sicherheit",
  "informationssicherheit",
  "penetration",
  "pentest",
  "penetration test",
  "penetrationstest",
  "vulnerability",
  "schwachstellen",
  "incident response",
  "forensics",
  "soc",
  "mdr",
  "xdr",
  "siem",
  "iso 27001",
  "iso27001",
  "nis2",
  "security operations",
];

const EMERGENCY_KEYWORDS = [
  "24/7",
  "24x7",
  "24 x 7",
  "notfall",
  "emergency",
  "incident response",
  "hotline",
];

const normalizeDescription = (text: string | undefined): DescriptionResult => {
  if (!text) {
    return { description: "", blockedReason: "Missing short description." };
  }

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const isBlocked = DESCRIPTION_BLACKLIST.some((phrase) => lower.includes(phrase));
  const hasSecondPerson = /\b(du|dein|deine|deinen|deinem|you|your)\b/i.test(trimmed);

  if (isBlocked || hasSecondPerson) {
    return {
      description: "",
      blockedReason: "Short description contains marketing language or second-person phrasing.",
    };
  }

  if (trimmed.length < 30) {
    return { description: "", blockedReason: "Short description too short." };
  }

  return { description: trimmed.slice(0, 200) };
};

const joinHumanList = (values: string[]): string => {
  if (values.length <= 1) {
    return values.join("");
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const formatRegions = (regions: ProviderFrontmatter["regions"]): string => {
  if (regions.includes("GLOBAL")) {
    return "global";
  }
  return regions.slice(0, 3).join(", ");
};

const buildNeutralDescription = (input: {
  name: string;
  services: AllowedService[];
  regions: ProviderFrontmatter["regions"];
}): string => {
  if (input.services.length === 0) {
    return "";
  }
  const services = joinHumanList(input.services.slice(0, 3));
  const regionLabel = input.regions.length > 0 ? ` in ${formatRegions(input.regions)}` : "";
  return `${input.name} provides ${services} cybersecurity services${regionLabel}.`;
};

const normalizeDifferentiator = (text: string | undefined): DescriptionResult => {
  if (!text) {
    return { description: "", blockedReason: "Missing differentiator." };
  }

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const isBlocked = DIFFERENTIATOR_BLACKLIST.some((phrase) => lower.includes(phrase));

  if (isBlocked) {
    return { description: "", blockedReason: "Differentiator contains vague or disallowed phrasing." };
  }

  if (trimmed.length < 10) {
    return { description: "", blockedReason: "Differentiator too short." };
  }

  return { description: trimmed.slice(0, 120) };
};

const normalizeFoundedYear = (value: unknown): { year?: number; blockedReason?: string } => {
  if (value === undefined || value === null) {
    return { year: undefined };
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return { year: undefined, blockedReason: "Founded year invalid." };
  }

  if (parsed < 1980 || parsed > new Date().getFullYear()) {
    return { year: undefined, blockedReason: "Founded year out of range." };
  }

  return { year: parsed };
};

const normalizeLegalName = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  if (trimmed.length < 2) {
    return undefined;
  }

  return trimmed.slice(0, 120);
};

const normalizeStringList = (value: unknown, maxItems: number): string[] => {
  if (!value) {
    return [];
  }

  const items = Array.isArray(value) ? value : String(value).split(",");
  const normalized = items
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);

  return dedupe(normalized).slice(0, maxItems);
};

const normalizeUrlList = (value: unknown, maxItems: number): string[] => {
  const items = normalizeStringList(value, maxItems * 2);
  const valid = items.filter((item) => {
    try {
      return Boolean(new URL(item));
    } catch {
      return false;
    }
  });

  return valid.slice(0, maxItems);
};

const extractDifferentiatorFromText = (text: string): string | undefined => {
  if (!text) {
    return undefined;
  }

  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim());
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (DIFFERENTIATOR_HINTS.some((hint) => lower.includes(hint))) {
      if (sentence.length >= 30 && sentence.length <= 160) {
        return sentence;
      }
    }
  }

  return undefined;
};

const hasSecurityKeyword = (value: string): boolean => {
  const lower = value.toLowerCase();
  return SECURITY_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const inferEmergencyAvailability = (value: string): boolean => {
  const lower = value.toLowerCase();
  return EMERGENCY_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const countRelevanceSignals = (input: {
  rawText: string;
  shortDescription: string;
  differentiator: string;
  servicesDefaulted: boolean;
}): number => {
  let signals = 0;
  if (!input.servicesDefaulted) {
    signals += 1;
  }
  if (input.shortDescription && hasSecurityKeyword(input.shortDescription)) {
    signals += 1;
  }
  if (input.differentiator && hasSecurityKeyword(input.differentiator)) {
    signals += 1;
  }
  if (input.rawText && hasSecurityKeyword(input.rawText)) {
    signals += 1;
  }
  return signals;
};

const countNonDefaultFacts = (flags: {
  servicesDefaulted: boolean;
  regionsDefaulted: boolean;
  languagesDefaulted: boolean;
  deliveryModesDefaulted: boolean;
  companySizeDefaulted: boolean;
  responseTimeDefaulted: boolean;
  foundedYear?: number;
  legalName?: string;
  differentiator?: string;
  notableReferencesCount: number;
  proofSourceUrlsCount: number;
  industriesCount: number;
  certificationsCount: number;
  qualificationsCount: number;
  caseStudiesCount: number;
  engagementModelsCount: number;
}): number => {
  let count = 0;
  if (!flags.servicesDefaulted) count += 1;
  if (!flags.regionsDefaulted) count += 1;
  if (!flags.languagesDefaulted) count += 1;
  if (!flags.deliveryModesDefaulted) count += 1;
  if (!flags.companySizeDefaulted) count += 1;
  if (!flags.responseTimeDefaulted) count += 1;
  if (flags.foundedYear) count += 1;
  if (flags.legalName && flags.legalName.trim().length > 0) count += 1;
  if (flags.differentiator && flags.differentiator.trim().length > 0) count += 1;
  if (flags.notableReferencesCount > 0) count += 1;
  if (flags.proofSourceUrlsCount > 0) count += 1;
  if (flags.industriesCount > 0) count += 1;
  if (flags.certificationsCount > 0) count += 1;
  if (flags.qualificationsCount > 0) count += 1;
  if (flags.caseStudiesCount > 0) count += 1;
  if (flags.engagementModelsCount > 0) count += 1;
  return count;
};

const normalizeProvider = (
  candidate: PartialProvider,
  seedUrl: string,
  pages: CrawledPage[],
  bsiAptResponseSlugs: Set<string>,
): { provider: ProviderFrontmatter; lowConfidence: boolean } => {
  const officialText = pages
    .filter((page) => page.discoveryReason !== "external-proof")
    .map((page) => page.text)
    .join(" ");
  const text = officialText.length > 0 ? officialText : pages.map((page) => page.text).join(" ");
  const notes: string[] = [];
  let lowConfidence = false;
  const publishReasons: string[] = [];

  const slug = normalizeSlug(seedUrl);
  const name = candidate.name ?? slug.replace(/-/g, " ");
  const website = (() => {
    if (candidate.website) {
      try {
        return new URL(candidate.website).toString();
      } catch {
        notes.push("Website URL invalid; defaulted to seed origin.");
        lowConfidence = true;
      }
    }
    return getOrigin(seedUrl);
  })();
  const candidateSlug =
    candidate.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.slug)
      ? candidate.slug
      : slug;

  const regions = dedupe(
    (candidate.regions ?? []).filter((region) =>
      ["DACH", "DE", "AT", "CH", "EU", "GLOBAL"].includes(region),
    ),
  ) as ProviderFrontmatter["regions"];
  let regionsDefaulted = false;
  if (regions.length === 0) {
    const inferred = inferRegions(text);
    if (inferred.length > 0) {
      regions.push(...inferred);
    }
  }
  if (regions.length === 0) {
    regions.push("GLOBAL");
    notes.push("Regions not stated; defaulted to GLOBAL.");
    lowConfidence = true;
    regionsDefaulted = true;
  }

  const candidateServices = dedupe(
    (candidate.services ?? []).filter((service) => isAllowedService(service)),
  );
  if (isFullServiceList(candidateServices)) {
    notes.push("Services list looked defaulted (all services); inferred from text.");
  }
  const services = isFullServiceList(candidateServices) ? [] : candidateServices;
  let servicesDefaulted = false;
  if (services.length === 0) {
    services.push(...inferServices(text));
  }
  if (services.length === 0) {
    services.push("Vulnerability Management");
    notes.push("Services not clearly stated; defaulted to Vulnerability Management.");
    lowConfidence = true;
    servicesDefaulted = true;
  }

  const primaryServices = dedupe(
    (candidate.primary_services ?? []).filter((service) => services.includes(service)),
  );
  if (primaryServices.length === 0) {
    primaryServices.push(services[0]);
  }

  const languages = dedupe(
    (candidate.languages ?? []).filter((lang) => lang === "de" || lang === "en"),
  );
  let languagesDefaulted = false;
  if (languages.length === 0) {
    languages.push(...inferLanguages(text));
  }
  if (languages.length === 0) {
    languages.push("en");
    notes.push("Languages not stated; defaulted to en.");
    lowConfidence = true;
    languagesDefaulted = true;
  }

  const deliveryModes = dedupe(
    (candidate.delivery_modes ?? []).filter((mode) =>
      ["remote", "on_site", "hybrid"].includes(mode),
    ),
  ) as ProviderFrontmatter["delivery_modes"];
  let deliveryModesDefaulted = false;
  if (deliveryModes.length === 0) {
    deliveryModes.push("remote");
    notes.push("Delivery modes not stated; defaulted to remote.");
    lowConfidence = true;
    deliveryModesDefaulted = true;
  }

  const companySize =
    candidate.company_size_band &&
    ["solo", "2-10", "11-50", "51-200", "200+"].includes(candidate.company_size_band)
      ? candidate.company_size_band
      : "2-10";
  const companySizeDefaulted = !candidate.company_size_band;
  if (!candidate.company_size_band) {
    notes.push("Company size not stated; defaulted to 2-10.");
    lowConfidence = true;
  }

  const responseTime =
    candidate.response_time_band &&
    ["<4h", "<1d", "2-3d", "1w+", "unknown"].includes(candidate.response_time_band)
      ? candidate.response_time_band
      : "unknown";
  const responseTimeDefaulted = !candidate.response_time_band;

  const legalName = normalizeLegalName(candidate.legal_name);

  const foundedYearResult = normalizeFoundedYear(candidate.founded_year);
  if (foundedYearResult.blockedReason) {
    notes.push(foundedYearResult.blockedReason);
    lowConfidence = true;
  }
  const foundedYear = foundedYearResult.year;

  const notableReferences = normalizeStringList(candidate.notable_references, 3);
  const proofSourceUrls = normalizeUrlList(candidate.proof_source_urls, 3);
  const qualifications = normalizeStringList(candidate.qualifications, 5);
  if (bsiAptResponseSlugs.has(candidateSlug)) {
    if (!qualifications.includes(BSI_APT_QUALIFICATION)) {
      qualifications.push(BSI_APT_QUALIFICATION);
    }
    if (!proofSourceUrls.includes(BSI_APT_RESPONSE_URL)) {
      if (proofSourceUrls.length < 3) {
        proofSourceUrls.push(BSI_APT_RESPONSE_URL);
      } else {
        notes.push("BSI proof URL omitted (limit reached).");
      }
    }
  }

  const differentiatorResult = normalizeDifferentiator(candidate.differentiator);
  const differentiatorCandidate =
    differentiatorResult.description || extractDifferentiatorFromText(text) || "";
  const differentiatorFinal = normalizeDifferentiator(differentiatorCandidate);
  const differentiator = differentiatorFinal.description;
  if (differentiatorFinal.blockedReason) {
    notes.push(differentiatorFinal.blockedReason);
  }

  const industries = candidate.industries?.filter(Boolean) ?? [];
  const certifications = candidate.certifications?.filter(Boolean) ?? [];
  const caseStudies = candidate.case_studies?.filter(Boolean) ?? [];
  const engagementModels = candidate.engagement_models?.filter(Boolean) ?? [];

  const contactPage = pages.find((page) => page.key === "contact")?.url;
  const leadContact = normalizeLeadContact(candidate.lead_contact, seedUrl, contactPage, notes);

  const emergency24x7 =
    candidate.emergency_24_7 ?? (inferEmergencyAvailability(text) ? true : undefined);
  if (candidate.emergency_24_7 === undefined && emergency24x7) {
    notes.push("Emergency 24/7 inferred from site text.");
  }

  const descriptionResult = normalizeDescription(candidate.short_description);
  let description = descriptionResult.description;
  if (!description) {
    const neutral = buildNeutralDescription({ name, services, regions });
    if (neutral) {
      description = neutral;
      if (descriptionResult.blockedReason) {
        notes.push(`Short description replaced with neutral summary. ${descriptionResult.blockedReason}`);
      } else {
        notes.push("Short description replaced with neutral summary.");
      }
    }
  }
  if (!description && descriptionResult.blockedReason) {
    publishReasons.push(descriptionResult.blockedReason);
  }

  const factsCount = countNonDefaultFacts({
    servicesDefaulted,
    regionsDefaulted,
    languagesDefaulted,
    deliveryModesDefaulted,
    companySizeDefaulted,
    responseTimeDefaulted,
    foundedYear,
    legalName,
    differentiator,
    notableReferencesCount: notableReferences.length,
    proofSourceUrlsCount: proofSourceUrls.length,
    industriesCount: industries.length,
    certificationsCount: certifications.length,
    qualificationsCount: qualifications.length,
    caseStudiesCount: caseStudies.length,
    engagementModelsCount: engagementModels.length,
  });

  if (factsCount < 2) {
    publishReasons.push("Insufficient non-default facts for publication.");
  }

  const relevanceSignals = countRelevanceSignals({
    rawText: text,
    shortDescription: description,
    differentiator,
    servicesDefaulted,
  });

  if (relevanceSignals < 2) {
    publishReasons.push("Insufficient security relevance signals.");
  }

  const publishStatus = publishReasons.length === 0 ? "published" : "hidden";
  if (publishStatus === "hidden") {
    notes.push(`Publish status hidden: ${publishReasons.join(" ")}`);
  }

  const provider: ProviderFrontmatter = {
    schema_version: PROVIDER_SCHEMA_VERSION,
    name,
    slug: candidateSlug,
    website,
    regions,
    services,
    primary_services: primaryServices.slice(0, 3),
    short_description: description,
    languages,
    delivery_modes: deliveryModes,
    company_size_band: companySize,
    response_time_band: responseTime,
    lead_contact: leadContact,
    legal_name: legalName,
    founded_year: foundedYear,
    differentiator: differentiator || undefined,
    notable_references: notableReferences.length > 0 ? notableReferences : undefined,
    proof_source_urls: proofSourceUrls.length > 0 ? proofSourceUrls : undefined,
    industries: industries.length > 0 ? industries : undefined,
    certifications: certifications.length > 0 ? certifications : undefined,
    qualifications: qualifications.length > 0 ? qualifications : undefined,
    case_studies: caseStudies.length > 0 ? caseStudies : undefined,
    engagement_models: engagementModels.length > 0 ? engagementModels : undefined,
    minimum_project_size_band: candidate.minimum_project_size_band,
    availability: candidate.availability,
    emergency_24_7: emergency24x7 ?? false,
    is_fictional: candidate.is_fictional ?? false,
    data_origin: "researched",
    evidence_level: lowConfidence ? "basic" : candidate.evidence_level ?? "basic",
    publish_status: publishStatus,
    notes: normalizeText([candidate.notes, ...notes].filter(Boolean).join(" | ")).slice(0, 240) ||
      undefined,
  };

  return { provider, lowConfidence };
};

export const extractProvider = async (seedUrl: string, pages: CrawledPage[]) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const seedSlug = normalizeSlug(seedUrl);
  const bsiAptResponseSlugs = await loadBsiAptResponseSlugs();
  const officialPages = pages.filter((page) => page.discoveryReason !== "external-proof");
  const externalPages = pages.filter((page) => page.discoveryReason === "external-proof");
  const officialText = officialPages
    .map((page) => `# ${page.key}\n${page.text}`)
    .join("\n\n");
  const externalText = externalPages
    .map((page) => `# ${page.key}\n${page.text}`)
    .join("\n\n");
  const sourceText = [
    "## Official pages (use for descriptions/differentiators)",
    officialText,
    "## External sources (use only for proof/facts)",
    externalText,
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");

  const prompt = `You are a strict data extraction tool. Use ONLY the provided text.\n\nReturn JSON only with these fields:\n- schema_version (number)\n- name (string)\n- legal_name? (string, official legal entity name)\n- slug (kebab-case)\n- website (url)\n- regions (array of: DACH, DE, AT, CH, EU, GLOBAL)\n- services (array of: ${ALLOWED_SERVICES.join(", ")})\n- primary_services (subset of services, 1-3 items)\n- short_description (30-200 chars, or empty if no specific facts)\n- languages (array of: de, en)\n- delivery_modes (array of: remote, on_site, hybrid)\n- company_size_band (solo, 2-10, 11-50, 51-200, 200+)\n- response_time_band (<4h, <1d, 2-3d, 1w+, unknown)\n- lead_contact (object: {type: email|form|phone, value: string, notes?: string})\n- founded_year? (number, 4-digit year)\n- differentiator? (string, concrete and specific)\n- notable_references? (array of strings, 1-3 items)\n- proof_source_urls? (array of urls, 1-3 items)\n- industries? (array of strings)\n- certifications? (array of strings)\n- case_studies? (array of urls)\n- engagement_models? (array of: fixed_scope, retainer, project, emergency)\n- minimum_project_size_band? (<5k, 5-20k, 20-50k, 50k+)\n- availability? (yes, limited, no)\n- emergency_24_7? (boolean)\n- is_fictional? (boolean)\n- data_origin? (seed, provider_submitted, researched)\n- evidence_level? (none, basic, verified)\n- notes? (string, max 240 chars)\n\nRules:\n- Never invent certifications, services, response times, company size, or founded year.\n- Do not use vague filler phrases in short_description or differentiator; leave them empty if specifics are missing.\n- Use external sources ONLY for proof/facts (founded_year, proof_source_urls, notable_references).\n- Use official pages for short_description, differentiator, and legal_name.\n- Only include notable_references and proof_source_urls when explicitly stated.\n- Prefer empty/unknown over guessing for optional fields.\n- If a required field is missing, set a conservative value and mention uncertainty in notes.\n- Return JSON only.\n\nSeed slug: ${seedSlug}\n\nText:\n${sourceText}`;

  const promptLines = [
    "You are a strict data extraction tool. Use ONLY the provided text.",
    "",
    "Return JSON only with these fields:",
    "- schema_version (number)",
    "- name (string)",
    "- legal_name? (string, official legal entity name)",
    "- slug (kebab-case)",
    "- website (url)",
    "- regions (array of: DACH, DE, AT, CH, EU, GLOBAL)",
    `- services (array of: ${ALLOWED_SERVICES.join(", ")})`,
    "- primary_services (subset of services, 1-3 items)",
    "- short_description (30-200 chars, neutral and customer-centered, no marketing language, no second-person phrasing)",
    "- languages (array of: de, en)",
    "- delivery_modes (array of: remote, on_site, hybrid)",
    "- company_size_band (solo, 2-10, 11-50, 51-200, 200+)",
    "- response_time_band (<4h, <1d, 2-3d, 1w+, unknown)",
    "- lead_contact (object: {type: email|form|phone, value: string, notes?: string})",
    "- founded_year? (number, 4-digit year)",
    "- differentiator? (string, concrete and specific)",
    "- notable_references? (array of strings, 1-3 items)",
    "- proof_source_urls? (array of urls, 1-3 items)",
    "- industries? (array of strings)",
    "- certifications? (array of strings)",
    "- case_studies? (array of urls)",
    "- engagement_models? (array of: fixed_scope, retainer, project, emergency)",
    "- minimum_project_size_band? (<5k, 5-20k, 20-50k, 50k+)",
    "- availability? (yes, limited, no)",
    "- emergency_24_7? (boolean)",
    "- is_fictional? (boolean)",
    "- data_origin? (seed, provider_submitted, researched)",
    "- evidence_level? (none, basic, verified)",
    "- qualifications? (array of strings)",
    "- notes? (string, max 240 chars)",
    "",
    "Rules:",
    "- Never invent certifications, services, response times, company size, or founded year.",
    "- Do not use marketing language or second-person phrasing in short_description; leave it empty if specifics are missing.",
    "- Use external sources ONLY for proof/facts (founded_year, proof_source_urls, notable_references).",
    "- Use official pages for short_description, differentiator, and legal_name.",
    "- Only include notable_references and proof_source_urls when explicitly stated.",
    "- Prefer empty/unknown over guessing for optional fields.",
    "- If a required field is missing, set a conservative default and add uncertainty to notes.",
  ];
  const promptOverride = `${promptLines.join("\n")}\n\n${sourceText}`;

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract structured data from website text." },
      { role: "user", content: promptOverride },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const candidate = parseJson(content);
  const normalized = normalizeProvider(candidate, seedUrl, pages, bsiAptResponseSlugs);
  const parsed = ProviderFrontmatterSchema.safeParse(normalized.provider);

  if (!parsed.success) {
    const fallback = normalizeProvider({}, seedUrl, pages, bsiAptResponseSlugs);
    return {
      provider: fallback.provider,
      lowConfidence: true,
    };
  }

  return {
    provider: parsed.data,
    lowConfidence: normalized.lowConfidence,
  };
};
