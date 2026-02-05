export const ALLOWED_SERVICES = [
  "Pentest",
  "Web App Pentest",
  "Cloud Security",
  "Incident Response",
  "ISO 27001 Consulting",
  "NIS2 Consulting",
  "SOC / MDR",
  "Vulnerability Management",
] as const;

export type AllowedService = (typeof ALLOWED_SERVICES)[number];

export const isAllowedService = (service: string): service is AllowedService =>
  (ALLOWED_SERVICES as readonly string[]).includes(service);
