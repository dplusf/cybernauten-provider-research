import OpenAI from "openai";

import { ALLOWED_SERVICES, isAllowedService } from "./services";
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

const inferServices = (text: string): string[] => {
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

const normalizeDescription = (name: string, text: string | undefined): string => {
  if (text && text.trim().length >= 30) {
    return text.trim().slice(0, 200);
  }
  const fallback = `${name} provides cybersecurity services focused on compliance and security outcomes. Details were not clearly stated in public sources.`;
  return fallback.slice(0, 200);
};

const normalizeProvider = (
  candidate: PartialProvider,
  seedUrl: string,
  pages: CrawledPage[],
): { provider: ProviderFrontmatter; lowConfidence: boolean } => {
  const text = pages.map((page) => page.text).join(" ");
  const notes: string[] = [];
  let lowConfidence = false;

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
  }

  const services = dedupe(
    (candidate.services ?? []).filter((service) => isAllowedService(service)),
  );
  if (services.length === 0) {
    services.push(...inferServices(text));
  }
  if (services.length === 0) {
    services.push("Vulnerability Management");
    notes.push("Services not clearly stated; defaulted to Vulnerability Management.");
    lowConfidence = true;
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
  if (languages.length === 0) {
    languages.push(...inferLanguages(text));
  }
  if (languages.length === 0) {
    languages.push("en");
    notes.push("Languages not stated; defaulted to en.");
    lowConfidence = true;
  }

  const deliveryModes = dedupe(
    (candidate.delivery_modes ?? []).filter((mode) =>
      ["remote", "on_site", "hybrid"].includes(mode),
    ),
  ) as ProviderFrontmatter["delivery_modes"];
  if (deliveryModes.length === 0) {
    deliveryModes.push("remote");
    notes.push("Delivery modes not stated; defaulted to remote.");
    lowConfidence = true;
  }

  const companySize =
    candidate.company_size_band &&
    ["solo", "2-10", "11-50", "51-200", "200+"].includes(candidate.company_size_band)
      ? candidate.company_size_band
      : "2-10";
  if (!candidate.company_size_band) {
    notes.push("Company size not stated; defaulted to 2-10.");
    lowConfidence = true;
  }

  const responseTime =
    candidate.response_time_band &&
    ["<4h", "<1d", "2-3d", "1w+", "unknown"].includes(candidate.response_time_band)
      ? candidate.response_time_band
      : "unknown";

  const contactPage = pages.find((page) => page.key === "contact")?.url;
  const leadContact = normalizeLeadContact(candidate.lead_contact, seedUrl, contactPage, notes);

  const description = normalizeDescription(name, candidate.short_description);

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
    industries: candidate.industries?.filter(Boolean),
    certifications: candidate.certifications?.filter(Boolean),
    case_studies: candidate.case_studies?.filter(Boolean),
    engagement_models: candidate.engagement_models?.filter(Boolean),
    minimum_project_size_band: candidate.minimum_project_size_band,
    availability: candidate.availability,
    emergency_24_7: candidate.emergency_24_7 ?? false,
    is_fictional: candidate.is_fictional ?? false,
    data_origin: "researched",
    evidence_level: lowConfidence ? "basic" : candidate.evidence_level ?? "basic",
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
  const sourceText = pages
    .map((page) => `# ${page.key}\n${page.text}`)
    .join("\n\n");

  const prompt = `You are a strict data extraction tool. Use ONLY the provided text.\n\nReturn JSON only with these fields:\n- schema_version (number)\n- name (string)\n- slug (kebab-case)\n- website (url)\n- regions (array of: DACH, DE, AT, CH, EU, GLOBAL)\n- services (array of: ${ALLOWED_SERVICES.join(", ")})\n- primary_services (subset of services, 1-3 items)\n- short_description (30-200 chars)\n- languages (array of: de, en)\n- delivery_modes (array of: remote, on_site, hybrid)\n- company_size_band (solo, 2-10, 11-50, 51-200, 200+)\n- response_time_band (<4h, <1d, 2-3d, 1w+, unknown)\n- lead_contact (object: {type: email|form|phone, value: string, notes?: string})\n- industries? (array of strings)\n- certifications? (array of strings)\n- case_studies? (array of urls)\n- engagement_models? (array of: fixed_scope, retainer, project, emergency)\n- minimum_project_size_band? (<5k, 5-20k, 20-50k, 50k+)\n- availability? (yes, limited, no)\n- emergency_24_7? (boolean)\n- is_fictional? (boolean)\n- data_origin? (seed, provider_submitted, researched)\n- evidence_level? (none, basic, verified)\n- notes? (string, max 240 chars)\n\nRules:\n- Never invent certifications, services, response times, or company size.\n- Prefer empty/unknown over guessing for optional fields.\n- If a required field is missing, set a conservative value and mention uncertainty in notes.\n- Return JSON only.\n\nSeed slug: ${seedSlug}\n\nText:\n${sourceText}`;

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You extract structured data from website text." },
      { role: "user", content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const candidate = parseJson(content);
  const normalized = normalizeProvider(candidate, seedUrl, pages);
  const parsed = ProviderFrontmatterSchema.safeParse(normalized.provider);

  if (!parsed.success) {
    const fallback = normalizeProvider({}, seedUrl, pages);
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
