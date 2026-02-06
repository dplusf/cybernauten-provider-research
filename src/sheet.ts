import { google } from "googleapis";

import { ProviderFrontmatter } from "./schema";
import { joinComma, toBooleanString } from "./utils";

export const EXPECTED_HEADERS = [
  "schema_version",
  "name",
  "legal_name",
  "slug",
  "website",
  "regions",
  "services",
  "primary_services",
  "short_description",
  "languages",
  "delivery_modes",
  "company_size_band",
  "response_time_band",
  "lead_contact_type",
  "lead_contact_value",
  "lead_contact_notes",
  "notes",
  "founded_year",
  "differentiator",
  "notable_references",
  "proof_source_urls",
  "industries",
  "certifications",
  "qualifications",
  "case_studies",
  "engagement_models",
  "minimum_project_size_band",
  "availability",
  "emergency_24_7",
  "is_fictional",
  "data_origin",
  "evidence_level",
  "publish_status",
] as const;

const getServiceAccountCredentials = () => {
  const key = process.env.GOOGLE_SA_KEY_B64;
  if (!key) {
    throw new Error("GOOGLE_SA_KEY_B64 is missing");
  }
  const json = Buffer.from(key, "base64").toString("utf8");
  return JSON.parse(json) as {
    client_email: string;
    private_key: string;
  };
};

const columnToLetter = (column: number): string => {
  let result = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
};

const providerToRow = (provider: ProviderFrontmatter): string[] => {
  const map: Record<string, string> = {
    schema_version: provider.schema_version.toString(),
    name: provider.name,
    legal_name: provider.legal_name ?? "",
    slug: provider.slug,
    website: provider.website,
    regions: joinComma(provider.regions),
    services: joinComma(provider.services),
    primary_services: joinComma(provider.primary_services),
    short_description: provider.short_description,
    languages: joinComma(provider.languages),
    delivery_modes: joinComma(provider.delivery_modes),
    company_size_band: provider.company_size_band,
    response_time_band: provider.response_time_band,
    lead_contact_type: provider.lead_contact.type,
    lead_contact_value: provider.lead_contact.value,
    lead_contact_notes: provider.lead_contact.notes ?? "",
    notes: provider.notes ?? "",
    founded_year: provider.founded_year ? provider.founded_year.toString() : "",
    differentiator: provider.differentiator ?? "",
    notable_references: joinComma(provider.notable_references),
    proof_source_urls: joinComma(provider.proof_source_urls),
    industries: joinComma(provider.industries),
    certifications: joinComma(provider.certifications),
    qualifications: joinComma(provider.qualifications),
    case_studies: joinComma(provider.case_studies),
    engagement_models: joinComma(provider.engagement_models),
    minimum_project_size_band: provider.minimum_project_size_band ?? "",
    availability: provider.availability ?? "",
    emergency_24_7: toBooleanString(provider.emergency_24_7),
    is_fictional: toBooleanString(provider.is_fictional),
    data_origin: provider.data_origin ?? "seed",
    evidence_level: provider.evidence_level ?? "none",
    publish_status: provider.publish_status ?? "published",
  };

  return EXPECTED_HEADERS.map((header) => map[header] ?? "");
};

export const upsertProviderRow = async (provider: ProviderFrontmatter) => {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetTab = process.env.GOOGLE_SHEET_TAB || "providers";
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing");
  }

  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const lastColumn = columnToLetter(EXPECTED_HEADERS.length);
  const headerValues = Array.from(EXPECTED_HEADERS);

  const headerRange = `${sheetTab}!A1:${lastColumn}1`;
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: headerRange,
  });

  const existingHeaders = headerResponse.data.values?.[0] ?? [];
  const headersMatch =
    existingHeaders.length === EXPECTED_HEADERS.length &&
    existingHeaders.every((value, index) => value === EXPECTED_HEADERS[index]);

  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [headerValues],
      },
    });
  }

  const dataRange = `${sheetTab}!A2:${lastColumn}`;
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: dataRange,
  });

  const rows = dataResponse.data.values ?? [];
  const slugIndex = EXPECTED_HEADERS.indexOf("slug");
  const rowValues = providerToRow(provider);
  const existingIndex = rows.findIndex((row) => row[slugIndex] === provider.slug);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    const updateRange = `${sheetTab}!A${rowNumber}:${lastColumn}${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: updateRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [rowValues],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: dataRange,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [rowValues],
      },
    });
  }
};
