import { ProviderFrontmatterSchema, PROVIDER_SCHEMA_VERSION } from "./schema";
import { ALLOWED_SERVICES } from "./services";

const run = () => {
  if (Number(ALLOWED_SERVICES.length) === 0) {
    throw new Error("ALLOWED_SERVICES is empty");
  }

  const minimal = {
    schema_version: PROVIDER_SCHEMA_VERSION,
    name: "Smoke Test Provider",
    slug: "smoke-test-provider",
    website: "https://example.com",
    regions: ["GLOBAL"],
    services: [ALLOWED_SERVICES[0]],
    primary_services: [ALLOWED_SERVICES[0]],
    short_description:
      "This is a smoke test provider description for schema validation.",
    languages: ["en"],
    delivery_modes: ["remote"],
    company_size_band: "2-10",
    response_time_band: "unknown",
    founded_year: 2014,
    differentiator: "Specialized in regulated SaaS incident response playbooks.",
    notable_references: ["ACME Corp"],
    proof_source_urls: ["https://example.com/case-studies/acme"],
    lead_contact: {
      type: "form",
      value: "https://example.com/contact",
    },
  };

  const parsed = ProviderFrontmatterSchema.safeParse(minimal);
  if (!parsed.success) {
    throw new Error("Schema validation failed");
  }

  console.log("Smoke test passed.");
};

run();
