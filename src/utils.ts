import { createHash } from "crypto";

export const normalizeSlug = (seedUrl: string): string => {
  const { hostname } = new URL(seedUrl);
  return hostname
    .replace(/^www\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export const normalizeText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

export const hashText = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

export const getOrigin = (url: string): string => new URL(url).origin;

export const joinComma = (values?: string[]): string =>
  values && values.length > 0 ? values.join(",") : "";

export const toBooleanString = (value: boolean | undefined): string =>
  value ? "true" : "false";

export const dedupe = <T>(values: T[]): T[] => Array.from(new Set(values));
