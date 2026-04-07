import { setTimeout as sleep } from "node:timers/promises";
import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import { chromium, type Frame, type Locator, type Page } from "playwright";

export type AutonomousRunOptions = {
  url: string;
  turns?: number;
  headless?: boolean;
  launcherSelector?: string;
  messageInputSelector?: string;
  model?: string;
  apiKey?: string;
  navigationTimeoutMs?: number;
  hooks?: {
    onLog?: (message: string) => void;
    onTranscript?: (role: "user" | "bot", text: string, partial?: boolean) => void;
  };
};

const OMNICHANNEL_FRAME_NAME = "Microsoft_Omnichannel_LCWidget_Chat_Iframe_Window";
const LAUNCHER_NAME_PATTERNS = [/chat with/i, /live chat/i, /message us/i, /contact us/i, /^chat$/i];
const DEFAULT_INPUT_SELECTORS = [
  '[data-testid="send box text area"]',
  'textarea[placeholder*="message" i]',
  'input[placeholder*="message" i]',
  '[role="textbox"]',
  'div[contenteditable="true"]',
];

function allContexts(page: Page): (Page | Frame)[] {
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function tryClickVisible(locator: Locator): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 2500 });
    await locator.first().click();
    return true;
  } catch {
    return false;
  }
}

async function openLauncher(page: Page, customSelector?: string): Promise<boolean> {
  if (customSelector) {
    for (const ctx of allContexts(page)) {
      if (await tryClickVisible(ctx.locator(customSelector))) return true;
    }
  }
  const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omni && (await tryClickVisible(omni.getByRole("button", { name: /let'?s chat/i })))) return true;
  for (const ctx of allContexts(page)) {
    for (const pattern of LAUNCHER_NAME_PATTERNS) {
      if (await tryClickVisible(ctx.getByRole("button", { name: pattern }))) return true;
      if (await tryClickVisible(ctx.getByRole("link", { name: pattern }))) return true;
    }
  }
  return false;
}

async function findMessageInput(page: Page, customSelector?: string): Promise<Locator | null> {
  if (!customSelector) {
    const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
    if (omni) {
      const loc = omni.getByTestId("send box text area").first();
      try {
        if (await loc.isVisible()) return loc;
      } catch {
        /* continue */
      }
    }
  }
  const selectors = customSelector ? [customSelector] : DEFAULT_INPUT_SELECTORS;
  for (const ctx of allContexts(page)) {
    for (const sel of selectors) {
      const loc = ctx.locator(sel).first();
      try {
        if (await loc.isVisible()) return loc;
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

async function waitForMessageInput(page: Page, customSelector?: string): Promise<Locator | null> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const input = await findMessageInput(page, customSelector);
    if (input) return input;
    await sleep(350);
  }
  return null;
}

async function setInputText(input: Locator, text: string): Promise<void> {
  try {
    await input.fill(text);
  } catch {
    await input.click();
    await input.pressSequentially(text);
  }
}

async function tryClickSend(page: Page): Promise<boolean> {
  for (const ctx of allContexts(page)) {
    if (await tryClickVisible(ctx.getByRole("button", { name: /^(send|submit)$/i }))) return true;
  }
  return false;
}

async function collectVisibleChatMessages(page: Page): Promise<string[]> {
  const seen = new Set<string>();
  const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omni) {
    try {
      const texts = await omni
        .locator(".webchat__bubble")
        .allInnerTexts();
      for (const t of texts.map((x) => x.trim()).filter((x) => x.length > 2)) seen.add(t);
    } catch {
      /* continue */
    }
  }
  for (const ctx of allContexts(page)) {
    try {
      const texts = await ctx.evaluate(`(() => {
        var out = [];
        document.querySelectorAll('[class*="message"], [class*="bubble"], [role="article"]').forEach(function(el) {
          var t = (el.innerText || "").trim();
          if (t.length > 2) out.push(t);
        });
        return out;
      })()`) as string[];
      for (const t of texts) seen.add(t);
    } catch {
      /* cross-origin */
    }
  }
  return [...seen];
}

async function waitForBotReply(
  page: Page,
  userMessage: string,
  baseline: Set<string>,
  maxMs: number,
  hooks: AutonomousRunOptions["hooks"],
): Promise<string | null> {
  const deadline = Date.now() + maxMs;
  let last = "";
  let stable = 0;

  while (Date.now() < deadline) {
    await sleep(450);
    const snippets = await collectVisibleChatMessages(page);
    const fresh = snippets.filter((t) => !baseline.has(t) && t.trim() !== userMessage.trim());
    const candidate = fresh[fresh.length - 1] ?? "";
    if (!candidate) continue;
    if (candidate !== last) {
      last = candidate;
      stable = 0;
      hooks?.onTranscript?.("bot", candidate, true);
      continue;
    }
    stable += 1;
    if (stable >= 3) {
      hooks?.onTranscript?.("bot", candidate, false);
      return candidate;
    }
  }
  if (last) {
    hooks?.onTranscript?.("bot", last, false);
    return last;
  }
  return null;
}

async function inferSiteContext(page: Page, url: string): Promise<string> {
  const meta = await page.evaluate(`(() => {
    var title = document.title || "";
    var descEl = document.querySelector('meta[name="description"]');
    var desc = descEl ? descEl.getAttribute("content") || "" : "";
    var h1El = document.querySelector("h1");
    var h1 = h1El ? h1El.textContent || "" : "";
    return { title: title, desc: desc, h1: h1 };
  })()`) as { title: string; desc: string; h1: string };
  return `URL: ${url}\nTitle: ${meta.title}\nDescription: ${meta.desc}\nTop heading: ${meta.h1}`;
}

async function nextMessageFromModel(args: {
  model: string;
  apiKey?: string;
  siteContext: string;
  transcript: Array<{ role: "user" | "bot"; text: string }>;
  turn: number;
}): Promise<string> {
  if (!args.apiKey && !process.env.OPENAI_API_KEY) {
    return args.turn === 1
      ? "Hi, I am evaluating your support assistant. Can you help me with this site?"
      : "Can you provide more details on that, with next steps?";
  }

  const transcriptText = args.transcript.map((m) => `${m.role.toUpperCase()}: ${m.text}`).join("\n");
  const { text } = await generateText({
    model: getOpenAI(args.apiKey)(args.model),
    system:
      "You are a concise support QA tester. Generate one short user message only. No lists, no markdown, no explanation.",
    prompt:
      `Site context:\n${args.siteContext}\n\nConversation so far:\n${transcriptText || "(empty)"}\n\n` +
      `Generate the next user message for turn ${args.turn}.`,
    maxOutputTokens: 80,
    temperature: 0.3,
  });
  const cleaned = text.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  return cleaned || "Can you help me with this?";
}

export async function runAutonomousSupportChatSession(options: AutonomousRunOptions): Promise<void> {
  const {
    url,
    turns = 3,
    headless = true,
    launcherSelector,
    messageInputSelector,
    model = "gpt-4o-mini",
    apiKey,
    navigationTimeoutMs = 45_000,
    hooks,
  } = options;

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(20_000);

  const transcript: Array<{ role: "user" | "bot"; text: string }> = [];

  try {
    hooks?.onLog?.(`Opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    await sleep(2500);

    const siteContext = await inferSiteContext(page, url);
    hooks?.onLog?.("Analyzed site context for autonomous prompting.");

    hooks?.onLog?.("Looking for chat launcher…");
    const launched = await openLauncher(page, launcherSelector);
    if (!launched) throw new Error("No chat launcher found.");
    await sleep(1200);

    for (let turn = 1; turn <= Math.max(1, turns); turn += 1) {
      hooks?.onLog?.(`Planning turn ${turn}/${turns}…`);
      const message = await nextMessageFromModel({ model, apiKey, siteContext, transcript, turn });
      const input = await waitForMessageInput(page, messageInputSelector);
      if (!input) throw new Error("No message field found.");

      const baseline = new Set(await collectVisibleChatMessages(page));
      await input.click();
      await setInputText(input, message);
      hooks?.onTranscript?.("user", message, false);
      transcript.push({ role: "user", text: message });
      hooks?.onLog?.(`Sent turn ${turn}: "${message}"`);
      const sentViaButton = await tryClickSend(page);
      if (!sentViaButton) await input.press("Enter");

      hooks?.onLog?.(`Waiting for bot reply (turn ${turn})…`);
      const reply = await waitForBotReply(page, message, baseline, 50_000, hooks);
      if (reply) {
        transcript.push({ role: "bot", text: reply });
      } else {
        hooks?.onLog?.("No bot reply detected for this turn.");
        break;
      }
      await sleep(700);
    }
  } finally {
    await browser.close();
  }
}

