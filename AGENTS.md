# Agent Guide

This repository is a minimal research tool that crawls a curated list of provider URLs, extracts structured data with an LLM, validates it with Zod, and writes rows into a Google Sheet.

Use this guide when making changes in this codebase.

## Quick Commands

- Run the pipeline: `yarn run run`
- Dry run (no Sheets writes): `yarn run run --dry-run`
- Single provider: `yarn run run --only <slug>`
- Smoke test (single-test analog): `yarn run smoke`
- Typecheck: `yarn run typecheck`

Notes:
- There is no lint/test runner configured yet (no ESLint/Jest). Use `smoke` and `typecheck` instead.

## Project Layout

- `src/run.ts`: CLI entrypoint and orchestration
- `src/crawl.ts`: Playwright crawler and raw text capture
- `src/extract.ts`: LLM prompt and normalization logic
- `src/sheet.ts`: Google Sheets upsert and header enforcement
- `src/schema.ts`: Provider schema (Zod)
- `src/services.ts`: `ALLOWED_SERVICES` list
- `src/utils.ts`: Slug/text helpers and small utilities
- `seeds/providers.txt`: One seed URL per line
- `out/raw/`: Raw page text JSON for debugging

## Core Workflow

1. Load seed URLs from `seeds/providers.txt`.
2. Crawl a fixed set of pages per seed (home, services, about, contact, impressum).
3. Extract visible text and store `out/raw/<slug>-<page>.json`.
4. Send text to LLM for JSON extraction.
5. Normalize and validate against `ProviderFrontmatterSchema`.
6. Upsert into Google Sheet by `slug`.

## Coding Style

### Imports

- Group imports in this order, separated by blank lines:
  1) Node built-ins
  2) Third-party packages
  3) Local modules
- Prefer named imports over default when available.

### Formatting

- Use double quotes for strings.
- Use semicolons consistently.
- Use trailing commas where present in existing files.
- Prefer one statement per line; no compacted chains.

### Naming

- `camelCase` for variables and functions.
- `PascalCase` for types and exported schema constants.
- `SCREAMING_SNAKE_CASE` for top-level constant arrays and configuration.
- File names are `kebab-case` only where needed by the project; otherwise keep current names.

### Types

- Prefer `type` aliases for small shapes and unions.
- Keep Zod schema definitions and TypeScript types in `src/schema.ts`.
- Use `ProviderFrontmatterSchema.safeParse` for runtime validation.

### Error Handling

- Fail fast for missing env vars with `throw new Error`.
- Prefer explicit fallbacks with a `notes` explanation.
- Avoid silent `catch` blocks; when needed, keep scope narrow.

## Data Integrity Rules

- Do not invent certifications, services, response times, or company size.
- Map services strictly to `ALLOWED_SERVICES` from `src/services.ts`.
- Required fields must be present; if missing, use conservative defaults and add a `notes` entry.
- Keep LLM temperature at 0 for determinism.
- Use `notes` for uncertainty; do not hide uncertainty in other fields.

## Crawling Rules

- Crawl only the curated paths: `/`, `/services` or `/leistungen`, `/about` or `/ueber-uns`, `/contact` or `/kontakt`, `/impressum`.
- Extract visible text only; remove `nav`, `footer`, `script`, `style`, `noscript`, and hidden elements.
- Store raw text in `out/raw/` as JSON for debugging.

## LLM Extraction Rules

- The LLM is a parser, not a source of truth.
- Return JSON only from the LLM.
- Prefer empty/unknown values over guessing.
- If a required field is missing, add uncertainty to `notes`.

## Google Sheets Rules

- The header order is enforced in `src/sheet.ts` via `EXPECTED_HEADERS`.
- `notes` is a dedicated column (after `lead_contact_notes`).
- Upsert by `slug`: overwrite if slug exists, otherwise append.
- Always write values for all columns in the expected order.

## Environment Variables

Required in `.env`:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_TAB` (default: `providers`)
- `GOOGLE_SA_KEY_B64` (base64 of service account JSON)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `OPENAI_BASE_URL` (optional for non-OpenAI endpoints)

## When Making Changes

- Keep the pipeline deterministic and explainable.
- Favor small, explicit helpers rather than clever abstractions.
- Preserve schema and sheet column compatibility.
- Update `README.md` if user-facing behavior changes.
