import { setTimeout as sleep } from "node:timers/promises";
import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import { chromium } from "playwright";
import type { SiteAnalysis } from "../server/testsStore.js";

export interface AnalyzeSiteOptions {
  url: string;
  headless?: boolean;
  model?: string;
  apiKey?: string;
  onLog?: (message: string) => void;
}

export async function analyzeSite(options: AnalyzeSiteOptions): Promise<SiteAnalysis> {
  const { url, headless = true, model = "gpt-4o-mini", apiKey, onLog } = options;

  onLog?.("Launching browser to deep-scrape site...");
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(25_000);

  let scrapedContent: string;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await sleep(3000);

    onLog?.("Extracting page metadata, navigation, headings, services...");

    // String-based evaluate to avoid tsx/esbuild __name injection
    const meta = await page.evaluate(`(() => {
      var g = function(sel, attr) {
        var el = document.querySelector(sel);
        return attr ? (el && el.getAttribute(attr) || "").trim() : (el && el.innerText || "").trim();
      };

      var title = document.title || "";
      var metaDesc = g('meta[name="description"]', "content");
      var metaKeywords = g('meta[name="keywords"]', "content");
      var ogTitle = g('meta[property="og:title"]', "content");
      var ogDesc = g('meta[property="og:description"]', "content");
      var ogSiteName = g('meta[property="og:site_name"]', "content");

      var allH1 = Array.from(document.querySelectorAll("h1")).map(function(e) { return (e.textContent || "").trim(); }).filter(Boolean).slice(0, 5);
      var allH2 = Array.from(document.querySelectorAll("h2")).map(function(e) { return (e.textContent || "").trim(); }).filter(Boolean).slice(0, 12);
      var allH3 = Array.from(document.querySelectorAll("h3")).map(function(e) { return (e.textContent || "").trim(); }).filter(Boolean).slice(0, 15);

      var navLinks = Array.from(document.querySelectorAll("nav a, header a")).slice(0, 30).map(function(a) {
        var text = (a.textContent || "").trim();
        var href = a.getAttribute("href") || "";
        return text ? text + " (" + href + ")" : "";
      }).filter(Boolean);

      var footerLinks = Array.from(document.querySelectorAll("footer a")).slice(0, 25).map(function(a) { return (a.textContent || "").trim(); }).filter(Boolean);
      var footerEl = document.querySelector("footer");
      var footerText = footerEl ? (footerEl.innerText || "").slice(0, 800) : "";

      var listItems = Array.from(document.querySelectorAll("main li, article li, section li")).slice(0, 20).map(function(li) { return (li.textContent || "").trim(); }).filter(function(t) { return t && t.length > 5 && t.length < 200; });

      var paragraphs = Array.from(document.querySelectorAll("main p, article p, section p")).slice(0, 15).map(function(p) { return (p.textContent || "").trim(); }).filter(function(t) { return t && t.length > 20; }).slice(0, 10);

      var ctaButtons = Array.from(document.querySelectorAll('a[class*="btn"], button[class*="btn"], a[class*="cta"], .cta, [role="button"]')).slice(0, 10).map(function(el) { return (el.textContent || "").trim(); }).filter(Boolean);

      return {
        title: title, metaDesc: metaDesc, metaKeywords: metaKeywords,
        ogTitle: ogTitle, ogDesc: ogDesc, ogSiteName: ogSiteName,
        allH1: allH1, allH2: allH2, allH3: allH3,
        navLinks: navLinks, footerLinks: footerLinks, footerText: footerText,
        listItems: listItems, paragraphs: paragraphs, ctaButtons: ctaButtons
      };
    })()`) as Record<string, unknown>;

    const str = (v: unknown) => String(v ?? "");
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

    scrapedContent = [
      `URL: ${url}`,
      `Page title: ${str(meta.title)}`,
      `OG site name: ${str(meta.ogSiteName)}`,
      `OG title: ${str(meta.ogTitle)}`,
      `Meta description: ${str(meta.metaDesc)}`,
      `OG description: ${str(meta.ogDesc)}`,
      `Meta keywords: ${str(meta.metaKeywords)}`,
      `\nH1 headings: ${arr(meta.allH1).join(" | ")}`,
      `H2 headings: ${arr(meta.allH2).join(" | ")}`,
      `H3 headings: ${arr(meta.allH3).join(" | ")}`,
      `\nNavigation links:\n${arr(meta.navLinks).join("\n")}`,
      `\nFooter links: ${arr(meta.footerLinks).join(", ")}`,
      `Footer text: ${str(meta.footerText)}`,
      `\nKey list items:\n${arr(meta.listItems).join("\n")}`,
      `\nKey paragraphs:\n${arr(meta.paragraphs).join("\n\n")}`,
      `\nCTA buttons: ${arr(meta.ctaButtons).join(", ")}`,
    ].join("\n");

    onLog?.(`Scraped ${scrapedContent.length} chars of structured content.`);
  } finally {
    await browser.close();
  }

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    onLog?.("No OpenAI key — returning basic analysis from page metadata.");
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return {
      domain: "Unknown",
      subDomain: "",
      summary: scrapedContent.slice(0, 500),
      siteName: hostname,
      targetAudience: [],
      services: [],
      keywords: [],
      commonUserNeeds: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  onLog?.("Sending scraped content to OpenAI for deep analysis...");
  const { text } = await generateText({
    model: getOpenAI(apiKey)(model),
    system: `You are a website analyst. Given detailed scraped content from a website, produce a thorough JSON analysis.

Return a JSON object with EXACTLY these fields:
- "domain": primary industry sector (e.g. "Healthcare", "Higher Education", "E-commerce", "Financial Services", "Government", "Technology", "Hospitality")
- "subDomain": more specific niche (e.g. "Academic Medical Center", "Online Banking", "Community College", "Insurance Provider")
- "summary": 3-5 sentence detailed description — what the organization does, who they serve, what makes them distinctive, their scale/reach
- "siteName": the organization or brand name
- "targetAudience": array of 5-8 specific visitor types who would come to this site (e.g. "Patients seeking specialist appointments", "Medical professionals looking to refer patients", "Job seekers in healthcare", "Insurance verification visitors")
- "services": array of 8-12 key services or features the site offers (be specific, e.g. "Specialist appointment scheduling", "Virtual visit platform", "Health library with conditions database", not just generic terms)
- "keywords": array of 8-12 important topics, medical specialties, product categories, or domain terms that appear on the site
- "commonUserNeeds": array of 8-10 things a typical visitor might need help with or ask a support chatbot about (e.g. "How to schedule an appointment", "Finding a specific specialist", "Insurance and billing questions", "Getting directions to a location")

Be thorough and specific to THIS site. Do not give generic answers.
Return ONLY valid JSON, no markdown fences, no explanation.`,
    prompt: scrapedContent,
    maxOutputTokens: 800,
    temperature: 0.15,
  });

  try {
    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    onLog?.(`Analysis complete — domain: ${parsed.domain}, sub: ${parsed.subDomain}`);
    return {
      domain: String(parsed.domain || "Unknown"),
      subDomain: String(parsed.subDomain || ""),
      summary: String(parsed.summary || ""),
      siteName: String(parsed.siteName || new URL(url).hostname),
      targetAudience: Array.isArray(parsed.targetAudience) ? parsed.targetAudience.map(String) : [],
      services: Array.isArray(parsed.services) ? parsed.services.map(String) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      commonUserNeeds: Array.isArray(parsed.commonUserNeeds) ? parsed.commonUserNeeds.map(String) : [],
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    onLog?.("Failed to parse OpenAI response, returning raw.");
    return {
      domain: "Unknown",
      subDomain: "",
      summary: text.slice(0, 500),
      siteName: new URL(url).hostname,
      targetAudience: [],
      services: [],
      keywords: [],
      commonUserNeeds: [],
      analyzedAt: new Date().toISOString(),
    };
  }
}
