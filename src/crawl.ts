import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { chromium } from "playwright";

import { getOrigin, normalizeSlug, normalizeText } from "./utils";

export type CrawledPage = {
  key: string;
  url: string;
  status: number;
  text: string;
  sourceUrl?: string;
  discoveryReason?: string;
};

const PAGE_GROUPS: Array<{ key: string; paths: string[] }> = [
  { key: "home", paths: ["/"] },
  { key: "services", paths: ["/services", "/leistungen"] },
  { key: "about", paths: ["/about", "/ueber-uns"] },
  { key: "contact", paths: ["/contact", "/kontakt"] },
  { key: "impressum", paths: ["/impressum"] },
];

const DISCOVERY_MAX_PAGES = 4;
const MIN_TEXT_LENGTH = 600;
const DISCOVERY_KEYWORDS = [
  "services",
  "service",
  "leistungen",
  "angebot",
  "about",
  "ueber-uns",
  "unternehmen",
  "company",
  "team",
  "kontakt",
  "contact",
  "impressum",
  "privacy",
  "datenschutz",
  "legal",
  "case-study",
  "case-studies",
];

const BLOCKED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".pdf",
  ".zip",
  ".rar",
  ".7z",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".mp4",
  ".mp3",
  ".webm",
  ".ogg",
];

type DiscoveryLink = {
  href: string;
  text: string;
};

type DiscoveryCandidate = {
  url: string;
  reason: string;
  sourceUrl: string;
  score: number;
  depth: number;
};

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

const extractVisibleLinks = async (page: { evaluate: <T>(fn: () => T) => Promise<T> }) =>
  page.evaluate(() => {
    const isVisible = (el: Element) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }
      if ((el as HTMLElement).offsetParent === null && style.position !== "fixed") {
        return false;
      }
      return true;
    };

    const links = Array.from(document.querySelectorAll("a[href]"))
      .filter((link) => isVisible(link))
      .map((link) => {
        const href = link.getAttribute("href") ?? "";
        const textParts = [
          link.textContent?.trim(),
          link.getAttribute("aria-label")?.trim(),
          link.getAttribute("title")?.trim(),
        ].filter(Boolean);
        return {
          href,
          text: textParts.join(" "),
        };
      })
      .filter((link) => link.href.length > 0);

    return links;
  });

const normalizeCandidateUrl = (href: string, origin: string): string | null => {
  try {
    if (href.startsWith("mailto:") || href.startsWith("tel:")) {
      return null;
    }
    const url = new URL(href, origin);
    if (url.origin !== origin) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    url.search = "";
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    if (BLOCKED_EXTENSIONS.some((ext) => normalizedPath.toLowerCase().endsWith(ext))) {
      return null;
    }
    url.pathname = normalizedPath;
    return url.toString();
  } catch {
    return null;
  }
};

const findDiscoveryReason = (value: string): string | undefined => {
  const lower = value.toLowerCase();
  return DISCOVERY_KEYWORDS.find((keyword) => lower.includes(keyword));
};

const scoreCandidate = (url: string, text: string, reason: string): { score: number; depth: number } => {
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();
  const depth = new URL(url).pathname.split("/").filter(Boolean).length;
  let score = 0;
  if (lowerUrl.includes(reason)) {
    score += 3;
  }
  if (lowerText.includes(reason)) {
    score += 2;
  }
  score += Math.max(0, 3 - depth);
  return { score, depth };
};

const collectDiscoveryCandidates = (
  links: DiscoveryLink[],
  origin: string,
  sourceUrl: string,
): DiscoveryCandidate[] => {
  const candidates: DiscoveryCandidate[] = [];
  for (const link of links) {
    const normalized = normalizeCandidateUrl(link.href, origin);
    if (!normalized) {
      continue;
    }
    const reason = findDiscoveryReason(`${normalized} ${link.text}`);
    if (!reason) {
      continue;
    }
    const { score, depth } = scoreCandidate(normalized, link.text, reason);
    candidates.push({
      url: normalized,
      reason,
      sourceUrl,
      score,
      depth,
    });
  }
  return candidates;
};

const selectDiscoveryTargets = (
  candidates: DiscoveryCandidate[],
  visitedUrls: Set<string>,
  maxTargets: number,
): DiscoveryCandidate[] => {
  const unique = new Map<string, DiscoveryCandidate>();
  for (const candidate of candidates) {
    if (visitedUrls.has(candidate.url)) {
      continue;
    }
    const current = unique.get(candidate.url);
    if (!current || candidate.score > current.score) {
      unique.set(candidate.url, candidate);
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return a.url.localeCompare(b.url);
    })
    .slice(0, maxTargets);
};

export const crawlSeed = async (seedUrl: string, outDir: string): Promise<CrawledPage[]> => {
  const slug = normalizeSlug(seedUrl);
  const origin = getOrigin(seedUrl);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "de-DE",
  });
  const page = await context.newPage();
  const results: CrawledPage[] = [];
  const standardPages: CrawledPage[] = [];
  const discoveryCandidates: DiscoveryCandidate[] = [];
  const visitedUrls = new Set<string>();

  for (const group of PAGE_GROUPS) {
    let captured = false;
    for (const candidatePath of group.paths) {
      const targetUrl = new URL(candidatePath, seedUrl).toString();
      visitedUrls.add(targetUrl);
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
        standardPages.push(record);
        const filename = path.join(outDir, `${slug}-${group.key}.json`);
        await writeFile(filename, JSON.stringify(record, null, 2), "utf8");
        const links = await extractVisibleLinks(page);
        const candidates = collectDiscoveryCandidates(links, origin, targetUrl);
        discoveryCandidates.push(...candidates);
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

  const needsSpaFallback =
    standardPages.length === 0 || standardPages.every((page) => page.text.length < MIN_TEXT_LENGTH);
  if (needsSpaFallback) {
    try {
      const response = await page.goto(seedUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      const status = response?.status() ?? 0;
      if (status < 400) {
        const fallbackLinks = await extractVisibleLinks(page);
        const fallbackCandidates = collectDiscoveryCandidates(fallbackLinks, origin, seedUrl);
        discoveryCandidates.push(...fallbackCandidates);
      }
    } catch (error) {
      console.warn(`SPA fallback failed for ${slug}.`);
    }
  }

  const discoveryTargets = selectDiscoveryTargets(
    discoveryCandidates,
    visitedUrls,
    DISCOVERY_MAX_PAGES,
  );
  if (discoveryTargets.length > 0) {
    console.log(
      `Discovery targets for ${slug}: ${discoveryTargets.map((target) => target.url).join(", ")}`,
    );
  }

  let discoveredIndex = 0;
  for (const target of discoveryTargets) {
    visitedUrls.add(target.url);
    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const status = response?.status() ?? 0;
      if (status >= 400) {
        continue;
      }
      const rawText = await extractVisibleText(page);
      const text = normalizeText(rawText);
      discoveredIndex += 1;
      const key = `discovered-${discoveredIndex}`;
      const record: CrawledPage = {
        key,
        url: target.url,
        status,
        text,
        sourceUrl: target.sourceUrl,
        discoveryReason: target.reason,
      };
      results.push(record);
      const filename = path.join(outDir, `${slug}-${key}.json`);
      await writeFile(filename, JSON.stringify(record, null, 2), "utf8");
      if (discoveredIndex >= DISCOVERY_MAX_PAGES) {
        break;
      }
    } catch (error) {
      continue;
    }
  }

  await context.close();
  await browser.close();
  return results;
};
