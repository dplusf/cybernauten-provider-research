# Cybernauten — todo.md

## Current Focus
- Stabilize the core pipeline (crawl → extract → validate → write) so it runs reliably end-to-end.
  Why critical: this is the foundation for all data output and must be predictable.
- Keep runtime and compute cost low per provider.
  Why critical: costs and performance determine whether this can scale.

## Active Tasks
- Run the pipeline on a small seed set and confirm it completes without crashes.
- Verify Playwright extraction returns meaningful text for core pages.
- Reduce validation fallbacks by adjusting prompts or normalization if needed.

## Parked / Later
- None yet — TBD once core pipeline is stable.

## NOT NOW (Important)
- New UI/dashboard work.
- Automated discovery of new providers.
- Additional data enrichment layers or external integrations.

## Done Criteria
- 3–5 real providers run end-to-end with zero manual fixes.
- Runtime and compute cost thresholds defined and met (TBD).
- Rows written to Sheets are valid and consistent across runs.
