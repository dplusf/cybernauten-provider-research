# Agent Guide

This repository is a minimal research tool that crawls a curated list of provider URLs, extracts structured data with an LLM, validates it with Zod, and writes rows into a Google Sheet.

Use this guide when making changes in this codebase.

## Build / Lint / Test Commands

- Run the pipeline: `yarn run run`
- Dry run (no Sheets writes): `yarn run run --dry-run`
- Single provider dry run (recommended for spot checks): `yarn run run --dry-run --only <slug>`
- Single provider full run: `yarn run run --only <slug>`
- Smoke test (single-test analog): `yarn run smoke`
- Typecheck: `yarn run typecheck`

Notes:
- There is no lint runner configured yet (no ESLint). Use `smoke` and `typecheck` instead.
- There is no dedicated unit test runner; `smoke` is the closest single-test analog.

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
- Keep derived publish rules in normalization logic, not in the crawler.

### Error Handling

- Fail fast for missing env vars with `throw new Error`.
- Prefer explicit fallbacks with a `notes` explanation.
- Avoid silent `catch` blocks; when needed, keep scope narrow.
- Prefer returning empty/unknown values over invented data.

## Data Integrity Rules

- Do not invent certifications, services, response times, or company size.
- Do not invent founded year, references, or proof URLs.
- Do not invent legal names; only use explicit legal entity names.
- Map services strictly to `ALLOWED_SERVICES` from `src/services.ts`.
- Required fields must be present; if missing, use conservative defaults and add a `notes` entry.
- Keep LLM temperature at 0 for determinism.
- Use `notes` for uncertainty; do not hide uncertainty in other fields.
- Do not use vague filler phrases in `short_description` or `differentiator`.

## Crawling Rules

- Crawl the curated paths and discovery targets (keyword-based) on the same origin.
- Discovery is capped (12 internal pages) and excludes blocked extensions.
- Trusted external sources (e.g. Wikipedia) are allowed only for proof/facts, not descriptions.
- Extract visible text only; remove `nav`, `footer`, `script`, `style`, `noscript`, and hidden elements.
- Store raw text in `out/raw/` as JSON for debugging.

## LLM Extraction Rules

- The LLM is a parser, not a source of truth.
- Return JSON only from the LLM.
- Prefer empty/unknown values over guessing.
- If a required field is missing, add uncertainty to `notes`.
- Only include references/proof URLs when explicitly stated in sources.

## Google Sheets Rules

- The header order is enforced in `src/sheet.ts` via `EXPECTED_HEADERS`.
- `notes` is a dedicated column (after `lead_contact_notes`).
- Upsert by `slug`: overwrite if slug exists, otherwise append.
- Always write values for all columns in the expected order.
- Headers are auto-rewritten if they do not match; this can overwrite manual header formatting.

## Publish Gating

- Profiles are published only when they meet quality gates.
- `publish_status` is set to `hidden` when gates fail; rows are still written to Sheets.
- Minimum publish requirements:
  - `short_description` is meaningful and not vague.
  - `differentiator` is present and specific.
  - At least two security relevance signals are present (services, description, differentiator, or raw crawl text).
  - At least two non-default facts are present.
- Hidden profiles should not appear in user-facing lists.

## Environment Variables

Required in `.env`:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SHEET_TAB` (default: `providers`)
- `GOOGLE_SA_KEY_B64` (base64 of service account JSON)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `OPENAI_BASE_URL` (optional for non-OpenAI endpoints)
- `SERPER_API_KEY` (optional for external proof search)

## Cursor / Copilot Rules

- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## When Making Changes

- Keep the pipeline deterministic and explainable.
- Favor small, explicit helpers rather than clever abstractions.
- Preserve schema and sheet column compatibility.
- Update `README.md` if user-facing behavior changes.
