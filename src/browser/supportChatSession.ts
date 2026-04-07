import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type Frame, type Locator, type Page } from "playwright";

export type SupportChatGreetOptions = {
  url: string;
  message?: string;
  headless?: boolean;
  launcherSelector?: string;
  messageInputSelector?: string;
  navigationTimeoutMs?: number;
  keepOpenMs?: number;
};

export type SessionHooks = {
  onLog?: (message: string) => void;
  onTranscript?: (role: "user" | "bot", text: string, partial?: boolean) => void;
};

export type RunSupportChatSessionOptions = SupportChatGreetOptions & {
  hooks?: SessionHooks;
  /** How long to watch for bot text after send (default 45000). Ignored if skipReplyCapture. */
  replyWatchMs?: number;
  /** CLI mode: only wait keepOpenMs after send, no DOM reply capture. */
  skipReplyCapture?: boolean;
};

const LAUNCHER_NAME_PATTERNS = [
  /chat with/i,
  /live chat/i,
  /message us/i,
  /contact us/i,
  /need help/i,
  /^chat$/i,
  /^support$/i,
  /^help$/i,
];

const KNOWN_LAUNCHER_SELECTORS = [
  '[data-testid="chat-launcher"]',
  ".intercom-launcher",
  ".intercom-lightweight-app-launcher",
  "#intercom-container .intercom-launcher-button",
  '[aria-label*="open messaging" i]',
  '[aria-label*="chat" i]',
  '[title*="chat" i]',
];

const OMNICHANNEL_FRAME_NAME = "Microsoft_Omnichannel_LCWidget_Chat_Iframe_Window";

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanOmnichannelBotText(text: string): string {
  let out = text;

  // Remove known Cleveland Clinic AI disclaimer tail.
  out = out.replace(
    /This AI-generated response summarizes information from our website\.[\s\S]*?Was this information helpful\??/gi,
    "",
  );

  // Remove evidence footer variants if still present.
  out = out.replace(/(?:Show More Evidence|Evidence)\b[\s\S]*$/gi, "");

  return normalizeSpaces(out);
}

function allContexts(page: Page): (Page | Frame)[] {
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  return [page, ...frames];
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

  const omnichannelFrame = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omnichannelFrame) {
    const omniButton = omnichannelFrame.getByRole("button", { name: /let'?s chat/i });
    if (await tryClickVisible(omniButton)) return true;
  }

  for (const ctx of allContexts(page)) {
    for (const pattern of LAUNCHER_NAME_PATTERNS) {
      const btn = ctx.getByRole("button", { name: pattern });
      if (await tryClickVisible(btn)) return true;
    }
    for (const pattern of LAUNCHER_NAME_PATTERNS) {
      const link = ctx.getByRole("link", { name: pattern });
      if (await tryClickVisible(link)) return true;
    }
    for (const sel of KNOWN_LAUNCHER_SELECTORS) {
      if (await tryClickVisible(ctx.locator(sel))) return true;
    }
  }
  return false;
}

const DEFAULT_INPUT_SELECTORS = [
  '[data-testid="send box text area"]',
  'textarea[placeholder*="message" i]',
  'textarea[placeholder*="type" i]',
  'input[placeholder*="message" i]',
  'input[placeholder*="type" i]',
  'textarea[name="message"]',
  '[data-testid="message-input"]',
  'div[contenteditable="true"]',
  '[role="textbox"]',
];

async function findMessageInput(page: Page, customSelector?: string): Promise<Locator | null> {
  const selectors = customSelector ? [customSelector] : DEFAULT_INPUT_SELECTORS;

  if (!customSelector) {
    const omnichannelFrame = page.frame({ name: OMNICHANNEL_FRAME_NAME });
    if (omnichannelFrame) {
      const omniInput = omnichannelFrame.getByTestId("send box text area");
      try {
        if (await omniInput.first().isVisible()) return omniInput.first();
      } catch {
        /* continue */
      }
    }
  }

  for (const ctx of allContexts(page)) {
    for (const sel of selectors) {
      const loc = ctx.locator(sel).first();
      try {
        if (await loc.isVisible()) return loc;
      } catch {
        continue;
      }
    }
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

async function waitForMessageInput(
  page: Page,
  customSelector?: string,
  timeoutMs = 15_000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const input = await findMessageInput(page, customSelector);
    if (input) return input;
    await sleep(350);
  }
  return null;
}

async function tryClickSend(page: Page): Promise<boolean> {
  for (const ctx of allContexts(page)) {
    const send = ctx.getByRole("button", { name: /^(send|submit)$/i });
    if (await tryClickVisible(send)) return true;
  }
  return false;
}

async function collectVisibleChatMessages(page: Page): Promise<string[]> {
  const seen = new Set<string>();

  const omnichannelFrame = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omnichannelFrame) {
    try {
      const omniTexts = await omnichannelFrame.evaluate(`(() => {
        var out = [];
        function push(text) { var t = (text || "").trim(); if (t && t.length > 2) out.push(t); }
        document.querySelectorAll('.webchat__stacked-layout__message, .webchat__basic-transcript [role="group"], [aria-label*="Chat history"] [role="group"]')
          .forEach(function(el) { push(el.innerText || el.textContent); });
        document.querySelectorAll('.webchat__bubble, .webchat__text-content, [data-testid*="message"]')
          .forEach(function(el) { push(el.innerText || el.textContent); });
        return out;
      })()`) as string[];
      for (const t of omniTexts) seen.add(t);
    } catch {
      /* continue with generic extraction */
    }
  }

  for (const ctx of allContexts(page)) {
    try {
      const texts = await ctx.evaluate(`(() => {
        var out = [];
        function add(sel) { document.querySelectorAll(sel).forEach(function(el) { var t = (el.innerText || el.textContent || "").trim(); if (t.length > 2) out.push(t); }); }
        add('[class*="message"]');
        add('[class*="Message"]');
        add('[class*="bubble"]');
        add('[class*="Bubble"]');
        add(".intercom-block-text");
        add('[data-testid*="message"]');
        add('[role="article"]');
        add('[role="log"] li');
        add('[role="log"] [role="listitem"]');
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
  baselineOmnichannelBot: Set<string>,
  hooks: SessionHooks | undefined,
  maxMs: number,
): Promise<string | null> {
  const omnichannelFrame = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omnichannelFrame) {
    const deadline = Date.now() + maxMs;
    let last = "";
    let stableTicks = 0;
    while (Date.now() < deadline) {
      await sleep(450);
      try {
        const sequence = await omnichannelFrame.evaluate(`(() => {
          return Array.from(document.querySelectorAll(".webchat__bubble")).map(function(el) {
            return {
              text: (el.innerText || el.textContent || "").trim(),
              isUser: el.classList.contains("webchat__bubble--from-user")
            };
          });
        })()`) as Array<{ text: string; isUser: boolean }>;

        const normalizedUser = userMessage.trim();
        let latestUserIdx = -1;
        for (let i = sequence.length - 1; i >= 0; i -= 1) {
          if (sequence[i].isUser && sequence[i].text === normalizedUser) {
            latestUserIdx = i;
            break;
          }
        }

        const afterUser =
          latestUserIdx >= 0
            ? sequence.slice(latestUserIdx + 1)
            : sequence;

        const candidateTexts = afterUser
          .filter((m) => !m.isUser)
          .map((m) => cleanOmnichannelBotText(m.text))
          .filter((t) => t.length > 2 && t !== normalizedUser && !baselineOmnichannelBot.has(t));

        const newest = candidateTexts[candidateTexts.length - 1] ?? "";
        if (!newest) continue;

        if (newest !== last) {
          last = newest;
          hooks?.onTranscript?.("bot", newest, true);
          stableTicks = 0;
          continue;
        }
        if (newest === last) {
          stableTicks += 1;
          if (stableTicks >= 3) {
            hooks?.onTranscript?.("bot", newest, false);
            return newest;
          }
        }
      } catch {
        /* fall through to generic scraper below */
        break;
      }
    }
    if (last) {
      hooks?.onTranscript?.("bot", last, false);
      return last;
    }
  }

  const deadline = Date.now() + maxMs;
  let lastEmitted = "";
  let stableTicks = 0;
  const um = userMessage.trim();

  while (Date.now() < deadline) {
    await sleep(400);
    const snippets = await collectVisibleChatMessages(page);
    const fresh = snippets.filter((t) => !baseline.has(t) && t.trim() !== um);
    const candidate = fresh.sort((a, b) => b.length - a.length)[0] ?? "";

    if (candidate.length > 0 && candidate !== lastEmitted) {
      lastEmitted = candidate;
      hooks?.onTranscript?.("bot", candidate, true);
      stableTicks = 0;
    } else if (candidate.length > 0 && candidate === lastEmitted) {
      stableTicks += 1;
      if (stableTicks >= 3) {
        hooks?.onTranscript?.("bot", candidate, false);
        return candidate;
      }
    }
  }
  if (lastEmitted) {
    hooks?.onTranscript?.("bot", lastEmitted, false);
    return lastEmitted;
  }
  return null;
}

export async function runSupportChatSession(options: RunSupportChatSessionOptions): Promise<void> {
  const {
    url,
    message = "hi",
    headless = false,
    launcherSelector,
    messageInputSelector,
    navigationTimeoutMs = 45_000,
    keepOpenMs = 0,
    hooks,
    replyWatchMs = 45_000,
    skipReplyCapture = false,
  } = options;

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(20_000);

  try {
    hooks?.onLog?.(`Opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    await sleep(2500);

    hooks?.onLog?.("Looking for chat launcher…");
    const launched = await openLauncher(page, launcherSelector);
    if (!launched) {
      throw new Error(
        "No chat launcher found. Add a launcher CSS selector on the agent or in the run form.",
      );
    }

    await sleep(1500);
    hooks?.onLog?.("Looking for message field…");

    const input = await waitForMessageInput(page, messageInputSelector, 15_000);
    if (!input) {
      throw new Error(
        "No message field found. Set an input CSS selector (try Playwright codegen on the site).",
      );
    }

    const baselineArr = await collectVisibleChatMessages(page);
    const baseline = new Set(baselineArr);
    const baselineOmniBot = new Set<string>();
    const omnichannelFrame = page.frame({ name: OMNICHANNEL_FRAME_NAME });
    if (omnichannelFrame) {
      try {
        const texts = await omnichannelFrame
          .locator(".webchat__bubble:not(.webchat__bubble--from-user)")
          .allInnerTexts();
        for (const t of texts.map((x) => x.trim()).filter((x) => x.length > 2)) {
          baselineOmniBot.add(t);
        }
      } catch {
        /* ignore */
      }
    }

    await input.click();
    await setInputText(input, message);
    hooks?.onLog?.(`Sent: “${message}”`);
    hooks?.onTranscript?.("user", message, false);

    const sentViaButton = await tryClickSend(page);
    if (!sentViaButton) await input.press("Enter");

    if (!skipReplyCapture) {
      hooks?.onLog?.("Waiting for site bot reply in the page…");
      const reply = await waitForBotReply(
        page,
        message,
        baseline,
        baselineOmniBot,
        hooks,
        replyWatchMs,
      );
      if (!reply) {
        hooks?.onLog?.(
          "No new bot text detected (iframe/cross-origin or different widget markup).",
        );
      }
    } else if (keepOpenMs > 0) {
      hooks?.onLog?.(`Waiting ${keepOpenMs}ms…`);
      await sleep(keepOpenMs);
    }
  } finally {
    await browser.close();
  }
}

/** CLI: open chat, send greeting, optional idle wait — no bot capture. */
export async function openSupportChatAndGreet(options: SupportChatGreetOptions): Promise<void> {
  await runSupportChatSession({
    ...options,
    skipReplyCapture: true,
    keepOpenMs: options.keepOpenMs ?? 12_000,
    replyWatchMs: 0,
  });
}
