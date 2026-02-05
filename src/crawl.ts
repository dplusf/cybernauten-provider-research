import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { chromium } from "playwright";

import { normalizeSlug, normalizeText } from "./utils";

export type CrawledPage = {
  key: string;
  url: string;
  status: number;
  text: string;
};

const PAGE_GROUPS: Array<{ key: string; paths: string[] }> = [
  { key: "home", paths: ["/"] },
  { key: "services", paths: ["/services", "/leistungen"] },
  { key: "about", paths: ["/about", "/ueber-uns"] },
  { key: "contact", paths: ["/contact", "/kontakt"] },
  { key: "impressum", paths: ["/impressum"] },
];

const extractVisibleText = async (page: { evaluate: <T>(fn: () => T) => Promise<T> }) =>
  page.evaluate(() => {
    const removeSelectors = [
      "script",
      "style",
      "noscript",
      "nav",
      "footer",
      "header",
      "aside",
      "svg",
      "iframe",
    ];

    removeSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });

    document
      .querySelectorAll("[aria-hidden='true'], [hidden]")
      .forEach((el) => el.remove());

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chunks: string[] = [];
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (parent) {
        const style = window.getComputedStyle(parent);
        if (style.display !== "none" && style.visibility !== "hidden") {
          const value = node.textContent?.trim();
          if (value) {
            chunks.push(value);
          }
        }
      }
      node = walker.nextNode();
    }

    return chunks.join("\n").replace(/\n{2,}/g, "\n").trim();
  });

export const crawlSeed = async (seedUrl: string, outDir: string): Promise<CrawledPage[]> => {
  const slug = normalizeSlug(seedUrl);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results: CrawledPage[] = [];

  for (const group of PAGE_GROUPS) {
    let captured = false;
    for (const candidatePath of group.paths) {
      const targetUrl = new URL(candidatePath, seedUrl).toString();
      try {
        const response = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          continue;
        }

        const rawText = await extractVisibleText(page);
        const text = normalizeText(rawText);
        const record: CrawledPage = {
          key: group.key,
          url: targetUrl,
          status,
          text,
        };
        results.push(record);
        const filename = path.join(outDir, `${slug}-${group.key}.json`);
        await writeFile(filename, JSON.stringify(record, null, 2), "utf8");
        captured = true;
        break;
      } catch (error) {
        if (candidatePath === group.paths[group.paths.length - 1]) {
          captured = true;
        }
        continue;
      }
    }
    if (!captured) {
      continue;
    }
  }

  await context.close();
  await browser.close();
  return results;
};
