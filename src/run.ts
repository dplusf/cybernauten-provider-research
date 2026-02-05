import { readFile } from "fs/promises";
import path from "path";
import { config } from "dotenv";

import { crawlSeed } from "./crawl";
import { extractProvider } from "./extract";
import { upsertProviderRow } from "./sheet";
import { normalizeSlug } from "./utils";

config();

type CliOptions = {
  dryRun: boolean;
  onlySlug?: string;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    }
    if (arg === "--only") {
      options.onlySlug = argv[i + 1];
      i += 1;
    }
  }
  return options;
};

const loadSeeds = async (filePath: string) => {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  const seedsFile = path.join(process.cwd(), "seeds", "providers.txt");
  const outDir = path.join(process.cwd(), "out", "raw");

  const seeds = await loadSeeds(seedsFile);
  if (seeds.length === 0) {
    throw new Error("No provider seeds found in seeds/providers.txt");
  }

  const filtered = options.onlySlug
    ? seeds.filter((seed) => normalizeSlug(seed) === options.onlySlug)
    : seeds;

  if (filtered.length === 0) {
    throw new Error("No seeds matched --only slug.");
  }

  for (const seedUrl of filtered) {
    const slug = normalizeSlug(seedUrl);
    console.log(`Processing ${slug}...`);
    const pages = await crawlSeed(seedUrl, outDir);
    const { provider } = await extractProvider(seedUrl, pages);

    if (options.dryRun) {
      console.log(JSON.stringify(provider, null, 2));
      continue;
    }

    await upsertProviderRow(provider);
    console.log(`Upserted ${slug}.`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
