import { z } from "zod";

import { ALLOWED_SERVICES } from "./services";

export const PROVIDER_SCHEMA_VERSION = 1 as const;

const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const RegionSchema = z.enum(["DACH", "DE", "AT", "CH", "EU", "GLOBAL"]);
const LanguageSchema = z.enum(["de", "en"]);
const DeliveryModeSchema = z.enum(["remote", "on_site", "hybrid"]);
const CompanySizeBandSchema = z.enum(["solo", "2-10", "11-50", "51-200", "200+"]);
const ResponseTimeBandSchema = z.enum(["<4h", "<1d", "2-3d", "1w+", "unknown"]);
const EngagementModelSchema = z.enum([
  "fixed_scope",
  "retainer",
  "project",
  "emergency",
]);
const MinimumProjectSizeBandSchema = z.enum(["<5k", "5-20k", "20-50k", "50k+"]);
const AvailabilitySchema = z.enum(["yes", "limited", "no"]);
const DataOriginSchema = z.enum(["seed", "provider_submitted", "researched"]);
const EvidenceLevelSchema = z.enum(["none", "basic", "verified"]);

const ServiceSchema = z.enum(ALLOWED_SERVICES);

const LeadContactEmailSchema = z
  .object({
    type: z.literal("email"),
    value: z.string().email(),
    notes: z.string().max(120).optional(),
  })
  .strict();

const LeadContactFormSchema = z
  .object({
    type: z.literal("form"),
    value: z.string().url(),
    notes: z.string().max(120).optional(),
  })
  .strict();

const LeadContactPhoneSchema = z
  .object({
    type: z.literal("phone"),
    value: z.string().min(5),
    notes: z.string().max(120).optional(),
  })
  .strict();

const LeadContactSchema = z.discriminatedUnion("type", [
  LeadContactEmailSchema,
  LeadContactFormSchema,
  LeadContactPhoneSchema,
]);

export const ProviderFrontmatterSchema = z
  .object({
    schema_version: z.literal(PROVIDER_SCHEMA_VERSION),
    name: z.string().min(2),
    slug: z.string().min(3).regex(KEBAB_CASE_REGEX),
    website: z.string().url(),
    regions: z.array(RegionSchema).min(1),
    services: z.array(ServiceSchema).min(1),
    primary_services: z.array(ServiceSchema).min(1).max(3),
    short_description: z.string().min(30).max(200),
    languages: z.array(LanguageSchema).min(1),
    delivery_modes: z.array(DeliveryModeSchema).min(1),
    company_size_band: CompanySizeBandSchema,
    response_time_band: ResponseTimeBandSchema,
    lead_contact: LeadContactSchema,
    industries: z.array(z.string().max(40)).max(8).optional(),
    certifications: z.array(z.string().max(60)).max(15).optional(),
    case_studies: z.array(z.string().url()).max(3).optional(),
    engagement_models: z.array(EngagementModelSchema).optional(),
    minimum_project_size_band: MinimumProjectSizeBandSchema.optional(),
    availability: AvailabilitySchema.optional(),
    emergency_24_7: z.boolean().optional(),
    is_fictional: z.boolean().optional().default(false),
    data_origin: DataOriginSchema.optional().default("seed"),
    evidence_level: EvidenceLevelSchema.optional().default("none"),
    notes: z.string().max(240).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const invalidPrimary = data.primary_services.filter(
      (service) => !data.services.includes(service),
    );

    if (invalidPrimary.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primary_services"],
        message: `primary_services must be a subset of services: ${invalidPrimary.join(", ")}`,
      });
    }
  });

export type ProviderFrontmatter = z.infer<typeof ProviderFrontmatterSchema>;
export type LeadContact = z.infer<typeof LeadContactSchema>;
