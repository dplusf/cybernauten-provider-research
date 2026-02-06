# Cybernauten — todo.md

## Current Focus
- Define authoritative sources for providers beyond the seed list.
- Track formal qualifications for providers (non-service signals).

## Active Tasks
- Add BSI APT-Response source mapping file at `seeds/bsi-apt-response.txt`.
- Import providers from the BSI APT-Response PDF and merge into `seeds/providers.txt` (dedupe by slug).
- Add `qualifications` field to schema and sheet output.
- Enrich providers in BSI list with qualification label and proof URL.
- Document source maintenance cadence (how often the BSI list is re-checked).

## Source Definitions
- Seed list: `seeds/providers.txt` (manual curation).
- BSI: Qualified APT-Response Service Providers list (PDF)
  https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Cyber-Sicherheit/Themen/Dienstleister_APT-Response-Liste.pdf?__blob=publicationFile&v=42

## Qualification Labels
- BSI Qualified APT Response

## Validation
- Dry-run 1-2 providers from the BSI list and verify:
  - `qualifications` is set
  - `proof_source_urls` includes the BSI PDF link
  - No service list changes are required

## NOT NOW
- New UI/dashboard work.
- Automated discovery beyond approved source lists.
- Additional enrichment that cannot be sourced explicitly.
