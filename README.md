# Cybernauten Provider Research

Minimal research tool that crawls a curated list of provider URLs, extracts structured data with an LLM, validates it against the provider schema, and upserts rows into a Google Sheet.

## Setup

1. Install dependencies:

```bash
yarn install
```

2. Install Playwright Chromium:

```bash
npx playwright install chromium
```

3. Create your `.env` file (see `.env.example`):

- `GOOGLE_SHEET_ID`: target Google Sheet ID
- `GOOGLE_SHEET_TAB`: tab name (default: `providers`)
- `GOOGLE_SA_KEY_B64`: base64-encoded service account JSON
- `OPENAI_API_KEY`: API key for OpenAI-compatible LLM
- `OPENAI_MODEL`: model name (default `gpt-4o-mini`)
- `OPENAI_BASE_URL`: optional base URL for compatible providers
- `SERPER_API_KEY`: optional key for Serper search (external proof sources)

4. Add provider URLs to `seeds/providers.txt` (one URL per line).

## Run

```bash
yarn run run
```

Optional flags:

- `--dry-run` prints JSON instead of writing to Sheets
- `--only <slug>` runs a single provider by slug

## Smoke Test

```bash
yarn run smoke
```

## Flow

1. Crawls a fixed set of pages per seed (home, services, about, references, certifications, partners, contact, impressum) and discovers up to 12 additional internal pages by keyword.
2. Optionally fetches up to 3 trusted external sources (Wikipedia and whitelisted news) for proof/facts.
2. Extracts visible text only and stores raw text in `out/raw/`.
3. Sends text to the LLM for structured extraction.
4. Validates output against `ProviderFrontmatterSchema`.
5. Upserts the row into the Google Sheet (overwrites by slug).

## Notes

- This tool prefers deterministic, explainable output. It discovers internal pages by keyword and can fetch trusted external proof sources.
- If quality gates fail (vague description or insufficient security relevance), the row is still written but marked `publish_status=hidden`.
- Quality signals are captured via `founded_year`, `notable_references`, and `proof_source_urls` when present in sources.
- Trusted external sources (e.g. Wikipedia) are used only for proof/facts, not descriptions.
