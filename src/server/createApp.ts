import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { chromium, type Browser, type Page, type Frame, type Locator } from "playwright";
import { generateText } from "ai";
import { getOpenAI } from "../browser/aiProvider.js";
import { runSupportChatSession } from "../browser/supportChatSession.js";
import { runAutonomousSupportChatSession } from "../browser/supportChatAutonomous.js";
import { analyzeSite } from "../browser/siteAnalyzer.js";
import { generatePersonas } from "../browser/personaGenerator.js";
import { evaluateConversation } from "../browser/evaluator.js";
import { getInspiredUtterance } from "../browser/inspiredUtterance.js";
import { generateDimensions, generateProfiles } from "../browser/dimensionGenerator.js";
import { generateQuestions } from "../browser/questionGenerator.js";
import { AgentsStore, parseCreateAgent } from "./agentsStore.js";
import type { RunsStore } from "./runsStore.js";
import { TestsStore, type TestRun, type RunResult, type RunReport } from "./testsStore.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..");
const ui3Root = join(projectRoot, "ui3");
const ui4Root = join(projectRoot, "ui4");
const ui5Root = join(projectRoot, "ui5");

/* ── UI1 WS schemas ── */
const WsRunSchema = z.object({
  type: z.literal("run"),
  payload: z.object({
    agentId: z.string().optional(),
    url: z.string().url(),
    message: z.string().min(1),
    launcherSelector: z.string().optional(),
    inputSelector: z.string().optional(),
    headless: z.boolean().optional(),
  }),
});
const WsRunAutoSchema = z.object({
  type: z.literal("run_auto"),
  payload: z.object({
    agentId: z.string(),
    url: z.string().url(),
    turns: z.number().int().min(1).max(6).default(3),
    launcherSelector: z.string().optional(),
    inputSelector: z.string().optional(),
    headless: z.boolean().optional(),
  }),
});

/* ── UI2 WS schemas ── */
const WsAnalyzeSchema = z.object({ type: z.literal("analyze"), testId: z.string() });
const WsGenerateSchema = z.object({ type: z.literal("generate_personas"), testId: z.string(), count: z.number().int().min(1).max(20).default(4) });
const WsManualStartSchema = z.object({ type: z.literal("manual_start"), testId: z.string(), launcherSelector: z.string().optional(), inputSelector: z.string().optional(), headless: z.boolean().optional() });
const WsManualSendSchema = z.object({ type: z.literal("manual_send"), text: z.string().min(1) });
const WsManualStopSchema = z.object({ type: z.literal("manual_stop") });

/* ── UI3 WS schemas ── */
const WsGenerateDimsSchema = z.object({ type: z.literal("generate_dimensions"), testId: z.string() });
const WsGenerateProfilesSchema = z.object({ type: z.literal("generate_profiles"), testId: z.string() });
const WsGenerateQuestionsSchema = z.object({ type: z.literal("generate_questions"), testId: z.string(), count: z.number().int().min(1).default(30) });
const WsMatrixRunSchema = z.object({
  type: z.literal("matrix_run"),
  testId: z.string(),
  questionIds: z.array(z.string()).optional(),
  /** If set, only questions for this tester (persona id). */
  testerId: z.string().optional(),
  dimension: z.string().optional(),
  dimensionValue: z.string().optional(),
  personalityProfile: z.string().optional(),
  headless: z.boolean().optional(),
});

function runnableMatrixQuestions(test: import("./testsStore.js").Test): import("./testsStore.js").Question[] {
  return (test.questions || []).filter((q) => q.type === "structured" && q.personaId && String(q.text || "").trim());
}

function selectMatrixQuestions(
  test: import("./testsStore.js").Test,
  data: z.infer<typeof WsMatrixRunSchema>,
): import("./testsStore.js").Question[] {
  let list = runnableMatrixQuestions(test);
  if (data.questionIds?.length) {
    const idSet = new Set(data.questionIds);
    list = list.filter((q) => idSet.has(q.id));
  } else {
    if (data.testerId) list = list.filter((q) => q.personaId === data.testerId);
    if (data.dimension) list = list.filter((q) => q.dimension === data.dimension);
    if (data.dimensionValue) list = list.filter((q) => q.dimensionValue === data.dimensionValue);
    if (data.personalityProfile) list = list.filter((q) => q.personalityProfile === data.personalityProfile);
  }
  return list;
}

function sendJson(socket: Pick<WebSocket, "send">, obj: unknown): void {
  socket.send(JSON.stringify(obj));
}

let runLock = false;

/* ═══════════════════════════════════════════════════
   Playwright helpers — Omnichannel-aware, no double-send
   ═══════════════════════════════════════════════════ */

const OMNICHANNEL_FRAME_NAME = "Microsoft_Omnichannel_LCWidget_Chat_Iframe_Window";
const LAUNCHER_PATTERNS = [/chat with/i, /live chat/i, /message us/i, /contact us/i, /^chat$/i, /need help/i, /let'?s chat/i];
const INPUT_SELECTORS = [
  '[data-testid="send box text area"]',
  'textarea[placeholder*="message" i]',
  'input[placeholder*="message" i]',
  '[role="textbox"]',
  'div[contenteditable="true"]',
];

function allCtx(page: Page): (Page | Frame)[] {
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function tryClick(loc: Locator): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: "visible", timeout: 2500 });
    await loc.first().click();
    return true;
  } catch {
    return false;
  }
}

async function openLauncher(page: Page, sel?: string): Promise<boolean> {
  if (sel) for (const ctx of allCtx(page)) if (await tryClick(ctx.locator(sel))) return true;
  const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (omni && await tryClick(omni.getByRole("button", { name: /let'?s chat/i }))) return true;
  for (const ctx of allCtx(page)) {
    for (const p of LAUNCHER_PATTERNS) {
      if (await tryClick(ctx.getByRole("button", { name: p }))) return true;
      if (await tryClick(ctx.getByRole("link", { name: p }))) return true;
    }
  }
  return false;
}

async function findInput(page: Page, sel?: string): Promise<Locator | null> {
  if (!sel) {
    const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
    if (omni) {
      const l = omni.getByTestId("send box text area").first();
      try { if (await l.isVisible()) return l; } catch { /* */ }
    }
  }
  const sels = sel ? [sel] : INPUT_SELECTORS;
  for (const ctx of allCtx(page)) for (const s of sels) {
    const l = ctx.locator(s).first();
    try { if (await l.isVisible()) return l; } catch { /* */ }
  }
  return null;
}

async function waitInput(page: Page, sel?: string): Promise<Locator | null> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const i = await findInput(page, sel);
    if (i) return i;
    await sleep(350);
  }
  return null;
}

/**
 * Safe input: click, select-all, delete, then type character-by-character.
 * Avoids Playwright fill() which fires bulk input events that can auto-submit.
 */
async function safeTypeIntoInput(input: Locator, text: string): Promise<void> {
  await input.click();
  await sleep(150);
  await input.press("Control+a");
  await input.press("Backspace");
  await sleep(100);
  await input.pressSequentially(text, { delay: 25 });
  await sleep(300);
}

/**
 * Send the message using ONLY the send button.
 * Falls back to Enter ONLY if no send button is found.
 * Never does both.
 */
async function sendMessage(page: Page, input: Locator): Promise<void> {
  for (const ctx of allCtx(page)) {
    const btn = ctx.getByRole("button", { name: /^(send|submit)$/i });
    try {
      await btn.first().waitFor({ state: "visible", timeout: 1500 });
      await btn.first().click();
      await sleep(500);
      return;
    } catch {
      continue;
    }
  }
  await input.press("Enter");
  await sleep(500);
}

/* ── Omnichannel-specific ordered bubble reader ── */
interface BubbleEntry { text: string; isUser: boolean; }

async function cleanBotTextWithLLM(raw: string, apiKey?: string): Promise<string> {
  if (!raw || raw.length < 10) return raw;
  if (!apiKey && !process.env.OPENAI_API_KEY) return raw;

  try {
    const { text } = await generateText({
      model: getOpenAI(apiKey)(process.env.OPENAI_MODEL || "gpt-4o-mini"),
      system: `You extract the actual chatbot response from raw scraped text. The raw text may contain:
- The bot's real answer
- AI disclaimers (e.g. "This AI-generated response...", "not a substitute for...")
- Source/reference link titles (numbered lists of page titles)
- Feedback prompts ("Was this helpful?", thumbs up/down text)
- Privacy policy mentions
- "Powered by" footers
- "Agent is typing" status text
- Cookie/consent notices
- Navigation menu text that leaked in

Return ONLY the bot's actual response to the user's question. Remove all boilerplate, disclaimers, source links, feedback prompts, and UI artifacts. Preserve the bot's exact wording — do not rephrase, summarize, or add anything.

If the entire text is boilerplate with no real response, return an empty string.
Return the cleaned text only. No quotes, no explanation.`,
      prompt: raw,
      maxOutputTokens: 500,
      temperature: 0,
    });
    return text.trim() || raw;
  } catch {
    return raw;
  }
}

async function readOmnichannelBubbles(page: Page): Promise<BubbleEntry[] | null> {
  const omni = page.frame({ name: OMNICHANNEL_FRAME_NAME });
  if (!omni) return null;
  try {
    return await omni.evaluate(`(() => {
      return Array.from(document.querySelectorAll(".webchat__bubble")).map(function(el) {
        return {
          text: (el.innerText || el.textContent || "").trim(),
          isUser: el.classList.contains("webchat__bubble--from-user")
        };
      });
    })()`) as BubbleEntry[];
  } catch {
    return null;
  }
}

/**
 * Wait for bot reply using Omnichannel bubble-sequence when available.
 * Finds the latest user bubble matching our message, then looks for
 * bot bubbles that appear AFTER it. This works reliably for every turn
 * because it doesn't depend on a baseline set.
 */
async function waitBotReply(
  page: Page,
  userMsg: string,
  maxMs: number,
  cb?: (text: string, partial: boolean) => void,
  apiKey?: string,
): Promise<string | null> {
  const deadline = Date.now() + maxMs;
  let last = "";
  let stable = 0;
  const normalizedUser = userMsg.trim();

  while (Date.now() < deadline) {
    await sleep(500);

    const bubbles = await readOmnichannelBubbles(page);
    if (bubbles) {
      let lastUserIdx = -1;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        if (bubbles[i].isUser && bubbles[i].text.trim() === normalizedUser) {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) continue;

      const botAfter = bubbles
        .slice(lastUserIdx + 1)
        .filter((b) => !b.isUser && b.text.length > 2);

      const candidate = botAfter[botAfter.length - 1]?.text ?? "";
      if (!candidate) continue;

      if (candidate !== last) {
        last = candidate;
        stable = 0;
        cb?.(candidate, true);
        continue;
      }
      stable++;
      if (stable >= 3) {
        const cleaned = await cleanBotTextWithLLM(candidate, apiKey);
        cb?.(cleaned, false);
        return cleaned;
      }
      continue;
    }

    /* Generic fallback for non-Omnichannel widgets */
    const seen = new Set<string>();
    for (const ctx of allCtx(page)) {
      try {
        const texts = await ctx.evaluate(`(() => {
          var out = [];
          document.querySelectorAll('[class*="message"], [class*="bubble"], [role="article"], [role="log"] li')
            .forEach(function(e) { var t = (e.innerText || "").trim(); if (t.length > 2) out.push(t); });
          return out;
        })()`) as string[];
        for (const t of texts) seen.add(t);
      } catch { /* cross-origin */ }
    }
    const all = [...seen].filter((t) => t && t !== normalizedUser);
    const candidate = all[all.length - 1] ?? "";
    if (!candidate) continue;

    if (candidate !== last) {
      last = candidate;
      stable = 0;
      cb?.(candidate, true);
      continue;
    }
    stable++;
    if (stable >= 3) {
      const cleaned = await cleanBotTextWithLLM(candidate, apiKey);
      cb?.(cleaned, false);
      return cleaned;
    }
  }

  if (last) {
    const cleaned = await cleanBotTextWithLLM(last, apiKey);
    cb?.(cleaned, false);
    return cleaned;
  }
  return null;
}

/* ═══════════════════════════════════════════════════
   App factory
   ═══════════════════════════════════════════════════ */

export async function createApp(
  agents: AgentsStore,
  runs: RunsStore,
  tests: TestsStore,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(process.env.NODE_ENV !== "production"
        ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" } } }
        : {}),
    },
  });

  /* ── Health / Settings ── */
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/settings", async () => ({ openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) }));

  /* ── Agents (UI1) ── */
  app.get("/api/agents", async () => ({ agents: agents.list() }));
  app.post("/api/agents", async (req, reply) => {
    try { return { agent: agents.create(parseCreateAgent(req.body)) }; }
    catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : "Invalid body" }; }
  });
  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    if (!agents.delete(req.params.id)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── Runs (UI1) ── */
  app.get("/api/runs", async () => ({ runs: runs.list() }));
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const run = runs.get(req.params.id);
    if (!run) { reply.code(404); return { error: "Not found" }; }
    return { run };
  });

  /* ── Tests (UI2) ── */
  app.get("/api/tests", async () => ({ tests: tests.list() }));
  app.get<{ Params: { id: string } }>("/api/tests/:id", async (req, reply) => {
    const t = tests.get(req.params.id);
    if (!t) { reply.code(404); return { error: "Not found" }; }
    return { test: t };
  });
  app.post("/api/tests", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>;
      let rawUrl = String(body?.url || "").trim();
      if (!rawUrl) { reply.code(400); return { error: "url is required" }; }
      if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl}`;
      new URL(rawUrl);
      const name = String(body?.name || "").trim() || undefined;
      const launcherSelector = String(body?.launcherSelector || "").trim() || undefined;
      const inputSelector = String(body?.inputSelector || "").trim() || undefined;
      const t = tests.create(rawUrl, name);
      if (launcherSelector || inputSelector) tests.update(t.id, { launcherSelector, inputSelector });
      return { test: tests.get(t.id)! };
    } catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : "Invalid body" }; }
  });
  app.patch<{ Params: { id: string } }>("/api/tests/:id", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const t = tests.update(req.params.id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      url: body.url !== undefined ? String(body.url) : undefined,
      launcherSelector: body.launcherSelector !== undefined ? String(body.launcherSelector) : undefined,
      inputSelector: body.inputSelector !== undefined ? String(body.inputSelector) : undefined,
    });
    if (!t) { reply.code(404); return { error: "Not found" }; }
    return { test: t };
  });
  app.delete<{ Params: { id: string } }>("/api/tests/:id", async (req, reply) => {
    if (!tests.delete(req.params.id)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* Persona CRUD (REST) */
  app.post<{ Params: { testId: string } }>("/api/tests/:testId/personas", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = String(body.name || "").trim();
    if (!name) { reply.code(400); return { error: "name is required" }; }
    const persona = tests.addPersona(req.params.testId, {
      id: crypto.randomUUID(),
      name,
      persona: String(body.persona || "Visitor").trim(),
      goal: String(body.goal || "General inquiry").trim(),
      personality: String(body.personality || "Neutral").trim(),
      knowledgeLevel: String(body.knowledgeLevel || "Beginner").trim(),
      questions: [],
    });
    if (!persona) { reply.code(404); return { error: "Test not found" }; }
    return { persona };
  });

  app.put<{ Params: { testId: string; personaId: string } }>("/api/tests/:testId/personas/:personaId", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const p = tests.updatePersona(req.params.testId, req.params.personaId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      persona: body.persona !== undefined ? String(body.persona) : undefined,
      goal: body.goal !== undefined ? String(body.goal) : undefined,
      personality: body.personality !== undefined ? String(body.personality) : undefined,
      knowledgeLevel: body.knowledgeLevel !== undefined ? String(body.knowledgeLevel) : undefined,
    });
    if (!p) { reply.code(404); return { error: "Not found" }; }

    tests.syncQuestionTesterNames(req.params.testId, req.params.personaId, p.name);

    return { persona: p };
  });
  app.delete<{ Params: { testId: string; personaId: string } }>("/api/tests/:testId/personas/:personaId", async (req, reply) => {
    if (!tests.deletePersona(req.params.testId, req.params.personaId)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });
  app.delete<{ Params: { testId: string } }>("/api/tests/:testId/personas", async (req, reply) => {
    if (!tests.clearPersonas(req.params.testId)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── Dimensions CRUD ── */
  app.delete<{ Params: { testId: string; dimId: string } }>("/api/tests/:testId/dimensions/:dimId", async (req, reply) => {
    if (!tests.deleteDimension(req.params.testId, req.params.dimId)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── Profiles CRUD ── */
  app.delete<{ Params: { testId: string; profileId: string } }>("/api/tests/:testId/profiles/:profileId", async (req, reply) => {
    if (!tests.deleteProfile(req.params.testId, req.params.profileId)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── Questions CRUD ── */
  app.post<{ Params: { testId: string } }>("/api/tests/:testId/questions", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const text = String(body.text || "").trim();
    if (!text) { reply.code(400); return { error: "text is required" }; }
    const personaId = body.personaId ? String(body.personaId) : "";
    if (!personaId) { reply.code(400); return { error: "personaId (tester id) is required" }; }
    const test = tests.get(req.params.testId);
    const tester = test?.personas.find((x) => x.id === personaId);
    if (!tester) { reply.code(400); return { error: "personaId does not match a tester on this test" }; }
    const q = tests.addQuestion(req.params.testId, {
      id: crypto.randomUUID(),
      text,
      type: "structured",
      personaId,
      persona: body.persona ? String(body.persona) : tester.name,
      dimension: body.dimension ? String(body.dimension) : undefined,
      dimensionValue: body.dimensionValue ? String(body.dimensionValue) : undefined,
      personalityProfile: body.personalityProfile ? String(body.personalityProfile) : undefined,
      expectedAnswer: body.expectedAnswer ? String(body.expectedAnswer) : undefined,
    });
    if (!q) { reply.code(404); return { error: "Test not found" }; }
    return { question: q };
  });

  app.patch<{ Params: { testId: string; questionId: string } }>("/api/tests/:testId/questions/:questionId", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const q = tests.updateQuestion(req.params.testId, req.params.questionId, {
      expectedAnswer: body.expectedAnswer !== undefined ? String(body.expectedAnswer) : undefined,
    });
    if (!q) { reply.code(404); return { error: "Not found" }; }
    return { question: q };
  });
  app.delete<{ Params: { testId: string; questionId: string } }>("/api/tests/:testId/questions/:questionId", async (req, reply) => {
    if (!tests.deleteQuestion(req.params.testId, req.params.questionId)) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── Reports ── */
  app.get<{ Params: { testId: string; runId: string } }>("/api/tests/:testId/report/:runId", async (req, reply) => {
    const test = tests.get(req.params.testId);
    const run = test?.runs.find((r) => r.id === req.params.runId);
    if (!run) { reply.code(404); return { error: "Not found" }; }
    return { run, report: run.report || null };
  });

  app.get<{ Params: { testId: string }; Querystring: { runA: string; runB: string } }>("/api/tests/:testId/compare", async (req, reply) => {
    const test = tests.get(req.params.testId);
    if (!test) { reply.code(404); return { error: "Not found" }; }
    const runA = test.runs.find((r) => r.id === req.query.runA);
    const runB = test.runs.find((r) => r.id === req.query.runB);
    if (!runA || !runB) { reply.code(404); return { error: "Run not found" }; }

    const resultsA = runA.results || [];
    const resultsB = runB.results || [];
    const questions: Array<{ questionText: string; scoreA: number | null; scoreB: number | null; delta: number | null }> = [];
    const allTexts = new Set([...resultsA.map((r) => r.questionText), ...resultsB.map((r) => r.questionText)]);
    for (const qt of allTexts) {
      const a = resultsA.find((r) => r.questionText === qt);
      const b = resultsB.find((r) => r.questionText === qt);
      questions.push({
        questionText: qt,
        scoreA: a?.score ?? null,
        scoreB: b?.score ?? null,
        delta: a?.score != null && b?.score != null ? b.score - a.score : null,
      });
    }
    const avgA = resultsA.filter((r) => r.score != null).reduce((s, r) => s + r.score!, 0) / (resultsA.filter((r) => r.score != null).length || 1);
    const avgB = resultsB.filter((r) => r.score != null).reduce((s, r) => s + r.score!, 0) / (resultsB.filter((r) => r.score != null).length || 1);
    return { runA: req.query.runA, runB: req.query.runB, avgScoreA: avgA, avgScoreB: avgB, avgDelta: avgB - avgA, questions };
  });

  app.get<{ Params: { testId: string; runId: string } }>("/api/tests/:testId/export/:runId", async (req, reply) => {
    const test = tests.get(req.params.testId);
    const run = test?.runs.find((r) => r.id === req.params.runId);
    if (!run?.results) { reply.code(404); return { error: "No results" }; }
    const header = "question,response,score,latency_ms,answered,evaluation_notes,human_score,human_notes\n";
    const rows = run.results.map((r) => {
      const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
      return [esc(r.questionText), esc(r.responseText), r.score ?? "", r.latencyMs, r.answered, esc(r.evaluationNotes || ""), r.humanScore ?? "", esc(r.humanNotes || "")].join(",");
    }).join("\n");
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="run_${req.params.runId.slice(0, 8)}.csv"`);
    return header + rows;
  });

  /* ── Annotations ── */
  app.patch<{ Params: { testId: string; runId: string; idx: string } }>("/api/tests/:testId/runs/:runId/results/:idx", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const idx = parseInt(req.params.idx, 10);
    if (isNaN(idx)) { reply.code(400); return { error: "Invalid index" }; }
    const ok = tests.annotateResult(req.params.testId, req.params.runId, idx, {
      humanScore: body.humanScore !== undefined ? (body.humanScore === null ? null : Number(body.humanScore)) : undefined,
      humanNotes: body.humanNotes !== undefined ? String(body.humanNotes) : undefined,
    });
    if (!ok) { reply.code(404); return { error: "Not found" }; }
    return { ok: true };
  });

  /* ── WebSocket ── */
  await app.register(async (f) => {
    await f.register(fastifyWebsocket);

    f.get("/ws", { websocket: true }, (socket) => {
      let connApiKey: string | undefined;
      let manualBrowser: Browser | null = null;
      let manualPage: Page | null = null;
      let manualTestId: string | null = null;
      let manualChatId: string | null = null;
      let manualInputSel: string | undefined;

      socket.on("close", async () => {
        if (manualBrowser) { try { await manualBrowser.close(); } catch { /* */ } manualBrowser = null; }
      });

      async function autoRegenerateStructured(sock: WebSocket, test: import("./testsStore.js").Test, apiKey?: string) {
        const prevCount = runnableMatrixQuestions(test).length || 30;
        const count = Math.max(prevCount, 30);
        sendJson(sock, { type: "event", ts: new Date().toISOString(), message: "Auto-regenerating questions to stay in sync..." });
        const questions = await generateQuestions({
          analysis: test.analysis!,
          personas: test.personas,
          dimensions: test.dimensions!,
          profiles: test.personalityProfiles!,
          count,
          apiKey,
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          onLog: (m) => sendJson(sock, { type: "event", ts: new Date().toISOString(), message: m }),
        });
        tests.setGeneratedQuestions(test.id, questions);
        const allQs = tests.get(test.id)?.questions || [];
        sendJson(sock, { type: "questions_done", testId: test.id, questions: allQs });
      }

      socket.on("message", (raw) => {
        void (async () => {
          let parsed: unknown;
          try { parsed = JSON.parse(String(raw)); } catch { sendJson(socket, { type: "error", message: "Invalid JSON" }); return; }
          const msgType = (parsed as Record<string, unknown>)?.type;

          /* ── set_api_key ── */
          if (msgType === "set_api_key") {
            const key = String((parsed as Record<string, unknown>).apiKey || "").trim();
            connApiKey = key || undefined;
            sendJson(socket, { type: "api_key_ack", ok: Boolean(connApiKey) });
            return;
          }

          /* ── UI1: run ── */
          if (msgType === "run") {
            const r = WsRunSchema.safeParse(parsed);
            if (!r.success) { sendJson(socket, { type: "error", message: "Invalid run payload" }); return; }
            if (runLock) { sendJson(socket, { type: "error", message: "Another run is in progress." }); return; }
            runLock = true;
            const runId = crypto.randomUUID();
            try {
              const pl = r.data.payload;
              let launcher = pl.launcherSelector?.trim() || undefined;
              let inputSel = pl.inputSelector?.trim() || undefined;
              if (pl.agentId) { const agent = agents.get(pl.agentId); if (!agent) { sendJson(socket, { type: "error", message: "Agent not found." }); return; } launcher = launcher ?? agent.launcherSelector; inputSel = inputSel ?? agent.inputSelector; }
              runs.startRun({ id: runId, agentId: pl.agentId, url: pl.url, message: pl.message });
              await runSupportChatSession({
                url: pl.url, message: pl.message, headless: pl.headless ?? true,
                launcherSelector: launcher, messageInputSelector: inputSel, replyWatchMs: 50_000, keepOpenMs: 0,
                hooks: {
                  onLog: (m) => { runs.appendEvent(runId, m); sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }); },
                  onTranscript: (role, text, partial) => { sendJson(socket, { type: "transcript", role, text, partial: Boolean(partial) }); if (role === "user" || !partial) runs.appendTranscript(runId, role, text); },
                },
              });
              runs.finishRun(runId, "ok"); sendJson(socket, { type: "done", runId });
            } catch (e) { const msg = e instanceof Error ? e.message : String(e); runs.appendEvent(runId, `Error: ${msg}`); runs.finishRun(runId, "error", msg); sendJson(socket, { type: "error", message: msg }); }
            finally { runLock = false; }
            return;
          }

          /* ── UI1: run_auto ── */
          if (msgType === "run_auto") {
            const a = WsRunAutoSchema.safeParse(parsed);
            if (!a.success) { sendJson(socket, { type: "error", message: "Invalid run_auto payload" }); return; }
            if (runLock) { sendJson(socket, { type: "error", message: "Another run is in progress." }); return; }
            runLock = true;
            const runId = crypto.randomUUID();
            try {
              const pl = a.data.payload;
              const agent = agents.get(pl.agentId);
              if (!agent) { sendJson(socket, { type: "error", message: "Agent not found." }); return; }
              runs.startRun({ id: runId, agentId: pl.agentId, url: pl.url, message: `AUTO_${pl.turns ?? 3}` });
              await runAutonomousSupportChatSession({
                url: pl.url, turns: pl.turns ?? 3, headless: pl.headless ?? true,
                launcherSelector: pl.launcherSelector?.trim() || agent.launcherSelector,
                messageInputSelector: pl.inputSelector?.trim() || agent.inputSelector,
                model: agent.openaiModel || "gpt-4o-mini", apiKey: connApiKey,
                hooks: {
                  onLog: (m) => { runs.appendEvent(runId, m); sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }); },
                  onTranscript: (role, text, partial) => { sendJson(socket, { type: "transcript", role, text, partial: Boolean(partial) }); if (role === "user" || !partial) runs.appendTranscript(runId, role, text); },
                },
              });
              runs.finishRun(runId, "ok"); sendJson(socket, { type: "done", runId });
            } catch (e) { const msg = e instanceof Error ? e.message : String(e); runs.appendEvent(runId, `Error: ${msg}`); runs.finishRun(runId, "error", msg); sendJson(socket, { type: "error", message: msg }); }
            finally { runLock = false; }
            return;
          }

          /* ── UI2: analyze site ── */
          if (msgType === "analyze") {
            const a = WsAnalyzeSchema.safeParse(parsed);
            if (!a.success) { sendJson(socket, { type: "error", message: "Invalid analyze payload" }); return; }
            const test = tests.get(a.data.testId);
            if (!test) { sendJson(socket, { type: "error", message: "Test not found" }); return; }
            app.log.info(`[analyze] Starting site analysis for ${test.url}`);
            try {
              const analysis = await analyzeSite({
                url: test.url,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini", apiKey: connApiKey,
                onLog: (m) => {
                  app.log.info(`[analyze] ${m}`);
                  sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m });
                },
              });
              tests.update(test.id, { analysis, name: analysis.siteName || test.name });
              sendJson(socket, { type: "analysis_done", testId: test.id, analysis });
              app.log.info(`[analyze] Done — domain: ${analysis.domain}`);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              app.log.error(`[analyze] Error: ${msg}`);
              sendJson(socket, { type: "error", message: msg });
            }
            return;
          }

          /* ── UI2: generate personas ── */
          if (msgType === "generate_personas") {
            const g = WsGenerateSchema.safeParse(parsed);
            if (!g.success) { sendJson(socket, { type: "error", message: "Invalid generate payload" }); return; }
            const test = tests.get(g.data.testId);
            if (!test?.analysis) { sendJson(socket, { type: "error", message: "Analyze site first" }); return; }
            app.log.info(`[personas] Generating ${g.data.count} personas for ${test.name}`);
            try {
              const personas = await generatePersonas({
                analysis: test.analysis,
                count: g.data.count,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini", apiKey: connApiKey,
                onLog: (m) => {
                  app.log.info(`[personas] ${m}`);
                  sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m });
                },
              });
              tests.setPersonas(test.id, personas);
              // Clear all old questions (both persona and structured reference old personas)
              tests.setQuestions(test.id, []);
              const freshTest = tests.get(test.id)!;
              sendJson(socket, { type: "personas_done", testId: test.id, personas, questions: [] });
              sendJson(socket, { type: "structured_questions_cleared", testId: test.id });
              app.log.info(`[personas] Done — ${personas.length} personas created`);

              // Auto-regenerate structured questions if dimensions + profiles exist
              if (freshTest.dimensions?.length && freshTest.personalityProfiles?.length && freshTest.analysis) {
                await autoRegenerateStructured(socket, freshTest, connApiKey);
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              app.log.error(`[personas] Error: ${msg}`);
              sendJson(socket, { type: "error", message: msg });
            }
            return;
          }

          /* ── UI3/UI4: test run (all matching questions, one browser session) ── */
          if (msgType === "matrix_run") {
            const r = WsMatrixRunSchema.safeParse(parsed);
            if (!r.success) { sendJson(socket, { type: "error", message: "Invalid matrix_run payload" }); return; }
            if (runLock) { sendJson(socket, { type: "error", message: "Another run is in progress." }); return; }
            const test = tests.get(r.data.testId);
            if (!test) { sendJson(socket, { type: "error", message: "Test not found" }); return; }
            const structuredQuestions = selectMatrixQuestions(test, r.data);
            if (!runnableMatrixQuestions(test).length) {
              sendJson(socket, { type: "error", message: "No questions yet. Generate questions from the Questions tab (needs testers, dimensions, and profiles)." });
              return;
            }
            if (!structuredQuestions.length) { sendJson(socket, { type: "error", message: "No questions matched the filters. Adjust filters or generate more questions." }); return; }

            runLock = true;
            const runId = crypto.randomUUID();
            const launcher = test.launcherSelector;
            const inputSel = test.inputSelector;
            const maxFollowUps = 3;
            const llmModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

            const testRun: TestRun = {
              id: runId, personaId: "test_suite", personaName: `Test run (${structuredQuestions.length} questions)`,
              turns: structuredQuestions.length, startedAt: new Date().toISOString(), status: "running",
              events: [], transcript: [], results: [],
            };
            tests.startRun(test.id, testRun);

            const log = (m: string) => { tests.appendRunEvent(test.id, runId, m); sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }); };
            const transcript = (role: "user" | "bot", text: string, partial: boolean) => {
              sendJson(socket, { type: "transcript", role, text, partial });
              if (role === "user" || !partial) tests.appendRunTranscript(test.id, runId, role, text);
            };

            try {
              log(`Starting test run: ${structuredQuestions.length} question(s)`);

              const browser = await chromium.launch({ headless: r.data.headless ?? true });
              const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
              page.setDefaultTimeout(20_000);

              try {
                log(`Opening ${test.url}`);
                await page.goto(test.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
                await sleep(3000);

                log("Looking for chat launcher...");
                if (!await openLauncher(page, launcher)) throw new Error("No chat launcher found.");
                await sleep(1500);

                const conversationHistory: Array<{ role: "user" | "bot"; text: string }> = [];

                for (let qi = 0; qi < structuredQuestions.length; qi++) {
                  const sq = structuredQuestions[qi];
                  const qLabel = `[${qi + 1}/${structuredQuestions.length}]`;
                  const metaParts = [sq.persona, sq.dimension, sq.dimensionValue, sq.personalityProfile].filter(Boolean);
                  log(`${qLabel} Question: "${sq.text}"${metaParts.length ? ` (${metaParts.join(" / ")})` : ""}`);

                  const input = await waitInput(page, inputSel);
                  if (!input) throw new Error("No message field found.");

                  const turnStart = Date.now();
                  await safeTypeIntoInput(input, sq.text);
                  transcript("user", sq.text, false);
                  conversationHistory.push({ role: "user", text: sq.text });
                  await sendMessage(page, input);

                  log(`${qLabel} Waiting for bot reply...`);
                  const reply = await waitBotReply(page, sq.text, 55_000, (text, partial) => transcript("bot", text, partial), connApiKey);
                  const latencyMs = Date.now() - turnStart;

                  if (!reply) {
                    log(`${qLabel} No bot reply.`);
                    const noReplyResult: RunResult = { questionId: sq.id, questionText: sq.text, responseText: "", followUps: [], latencyMs, answered: false, score: null, evaluationNotes: "No bot reply", humanScore: null, humanNotes: null };
                    tests.appendRunResult(test.id, runId, noReplyResult);
                    sendJson(socket, { type: "result_update", result: noReplyResult });
                    await sleep(500);
                    continue;
                  }

                  conversationHistory.push({ role: "bot", text: reply });
                  log(`${qLabel} Bot replied (${reply.length} chars, ${latencyMs}ms).`);

                  const turnConversation = [{ role: "user" as const, text: sq.text }, { role: "bot" as const, text: reply }];
                  const followUps: Array<{ utterance: string; response: string }> = [];

                  const pers = sq.personaId ? test.personas.find((p) => p.id === sq.personaId) : undefined;
                  const utterancePersona = pers ?? {
                    name: sq.persona || "Tester",
                    persona: "Visitor",
                    personality: "Neutral",
                    knowledgeLevel: "Moderate",
                  };

                  for (let fu = 0; fu < maxFollowUps; fu++) {
                    const uResult = await getInspiredUtterance({ question: sq.text, persona: utterancePersona, conversation: turnConversation, model: llmModel, apiKey: connApiKey });
                    if (uResult.answered || !uResult.utterance) {
                      log(`${qLabel} ${uResult.answered ? `Answered after ${fu} follow-up(s).` : "No follow-up needed."}`);
                      break;
                    }

                    log(`${qLabel} Follow-up ${fu + 1}: "${uResult.utterance}"`);
                    const fuInput = await waitInput(page, inputSel);
                    if (!fuInput) break;
                    await safeTypeIntoInput(fuInput, uResult.utterance);
                    transcript("user", uResult.utterance, false);
                    conversationHistory.push({ role: "user", text: uResult.utterance });
                    await sendMessage(page, fuInput);

                    const fuReply = await waitBotReply(page, uResult.utterance, 55_000, (text, partial) => transcript("bot", text, partial), connApiKey);
                    if (fuReply) {
                      conversationHistory.push({ role: "bot", text: fuReply });
                      turnConversation.push({ role: "user", text: uResult.utterance }, { role: "bot", text: fuReply });
                      followUps.push({ utterance: uResult.utterance, response: fuReply });
                      log(`${qLabel} Follow-up reply (${fuReply.length} chars).`);
                    } else {
                      followUps.push({ utterance: uResult.utterance, response: "" });
                      break;
                    }
                    await sleep(500);
                  }

                  log(`${qLabel} Evaluating...`);
                  const evalResult = await evaluateConversation({ question: sq.text, conversation: turnConversation, expectedAnswer: sq.expectedAnswer, model: llmModel, apiKey: connApiKey });
                  const result: RunResult = {
                    questionId: sq.id, questionText: sq.text, responseText: reply, followUps, latencyMs,
                    answered: followUps.length === 0 || followUps.length < maxFollowUps,
                    score: evalResult.score, evaluationNotes: evalResult.notes,
                    humanScore: null, humanNotes: null,
                  };
                  tests.appendRunResult(test.id, runId, result);
                  sendJson(socket, { type: "result_update", result });
                  log(`${qLabel} Score: ${evalResult.score ?? "N/A"}/100 — ${evalResult.notes ?? ""}`);

                  await sleep(800);
                }

                const freshTest = tests.get(test.id);
                const freshRun = freshTest?.runs.find((rr) => rr.id === runId);
                const allResults = freshRun?.results || [];
                const scored = allResults.filter((rr) => rr.score != null);
                if (scored.length > 0) {
                  const report: RunReport = {
                    totalQuestions: allResults.length,
                    passCount: scored.filter((rr) => rr.score! >= 70).length,
                    passRate: scored.filter((rr) => rr.score! >= 70).length / scored.length,
                    avgScore: scored.reduce((s, rr) => s + rr.score!, 0) / scored.length,
                    avgLatencyMs: allResults.reduce((s, rr) => s + rr.latencyMs, 0) / allResults.length,
                  };
                  tests.setRunReport(test.id, runId, report);
                  sendJson(socket, { type: "report", report });
                  log(`Test run report: avg ${report.avgScore.toFixed(1)}/100, pass rate ${(report.passRate * 100).toFixed(0)}%`);
                }
              } finally {
                await browser.close();
              }

              tests.finishRun(test.id, runId, "ok");
              sendJson(socket, { type: "done", runId, testId: test.id });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log(`Error: ${msg}`);
              tests.finishRun(test.id, runId, "error", msg);
              sendJson(socket, { type: "error", message: msg });
            } finally {
              runLock = false;
            }
            return;
          }

          /* ── UI3: generate dimensions ── */
          if (msgType === "generate_dimensions") {
            const g = WsGenerateDimsSchema.safeParse(parsed);
            if (!g.success) { sendJson(socket, { type: "error", message: "Invalid payload" }); return; }
            const test = tests.get(g.data.testId);
            if (!test?.analysis) { sendJson(socket, { type: "error", message: "Analyze site first" }); return; }
            try {
              const dims = await generateDimensions({
                analysis: test.analysis,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini", apiKey: connApiKey,
                onLog: (m) => sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }),
              });
              tests.setDimensions(test.id, dims);
              tests.setGeneratedQuestions(test.id, []);
              sendJson(socket, { type: "dimensions_done", testId: test.id, dimensions: dims });
              sendJson(socket, { type: "structured_questions_cleared", testId: test.id });

              const refreshed = tests.get(test.id)!;
              if (refreshed.personalityProfiles?.length && refreshed.personas.length) {
                await autoRegenerateStructured(socket, refreshed, connApiKey);
              }
            } catch (e) { sendJson(socket, { type: "error", message: e instanceof Error ? e.message : String(e) }); }
            return;
          }

          /* ── UI3: generate profiles ── */
          if (msgType === "generate_profiles") {
            const g = WsGenerateProfilesSchema.safeParse(parsed);
            if (!g.success) { sendJson(socket, { type: "error", message: "Invalid payload" }); return; }
            const test = tests.get(g.data.testId);
            if (!test) { sendJson(socket, { type: "error", message: "Test not found" }); return; }
            try {
              const profiles = await generateProfiles({
                apiKey: connApiKey,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                onLog: (m) => sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }),
              });
              tests.setProfiles(test.id, profiles);
              tests.setGeneratedQuestions(test.id, []);
              sendJson(socket, { type: "profiles_done", testId: test.id, profiles });
              sendJson(socket, { type: "structured_questions_cleared", testId: test.id });

              const refreshed = tests.get(test.id)!;
              if (refreshed.dimensions?.length && refreshed.personas.length && refreshed.analysis) {
                await autoRegenerateStructured(socket, refreshed, connApiKey);
              }
            } catch (e) { sendJson(socket, { type: "error", message: e instanceof Error ? e.message : String(e) }); }
            return;
          }

          /* ── UI3: generate structured questions ── */
          if (msgType === "generate_questions") {
            const g = WsGenerateQuestionsSchema.safeParse(parsed);
            if (!g.success) { sendJson(socket, { type: "error", message: "Invalid payload" }); return; }
            const test = tests.get(g.data.testId);
            if (!test?.analysis) { sendJson(socket, { type: "error", message: "Analyze site first" }); return; }
            if (!test.personas.length) { sendJson(socket, { type: "error", message: "Generate personas first" }); return; }
            if (!test.dimensions?.length) { sendJson(socket, { type: "error", message: "Generate dimensions first" }); return; }
            if (!test.personalityProfiles?.length) { sendJson(socket, { type: "error", message: "Generate profiles first" }); return; }
            try {
              const questions = await generateQuestions({
                analysis: test.analysis,
                personas: test.personas,
                dimensions: test.dimensions,
                profiles: test.personalityProfiles,
                count: g.data.count,
                model: process.env.OPENAI_MODEL || "gpt-4o-mini", apiKey: connApiKey,
                onLog: (m) => sendJson(socket, { type: "event", ts: new Date().toISOString(), message: m }),
              });
              tests.setGeneratedQuestions(test.id, questions);
              const allQs = tests.get(test.id)?.questions || [];
              sendJson(socket, { type: "questions_done", testId: test.id, questions: allQs });
            } catch (e) { sendJson(socket, { type: "error", message: e instanceof Error ? e.message : String(e) }); }
            return;
          }

          /* ── UI2: manual chat start ── */
          if (msgType === "manual_start") {
            const m = WsManualStartSchema.safeParse(parsed);
            if (!m.success) { sendJson(socket, { type: "error", message: "Invalid manual_start payload" }); return; }
            if (manualBrowser) { sendJson(socket, { type: "error", message: "Manual session already open. Stop it first." }); return; }

            const test = tests.get(m.data.testId);
            if (!test) { sendJson(socket, { type: "error", message: "Test not found" }); return; }

            manualTestId = test.id;
            manualInputSel = m.data.inputSelector?.trim() || test.inputSelector;
            const launcherSel = m.data.launcherSelector?.trim() || test.launcherSelector;

            try {
              sendJson(socket, { type: "manual_status", status: "connecting" });
              manualBrowser = await chromium.launch({ headless: m.data.headless ?? true });
              manualPage = await manualBrowser.newPage({ viewport: { width: 1280, height: 720 } });
              manualPage.setDefaultTimeout(20_000);

              sendJson(socket, { type: "event", ts: new Date().toISOString(), message: `Opening ${test.url}` });
              await manualPage.goto(test.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
              await sleep(3000);

              sendJson(socket, { type: "event", ts: new Date().toISOString(), message: "Looking for chat launcher..." });
              if (!await openLauncher(manualPage, launcherSel)) throw new Error("No chat launcher found.");
              await sleep(1500);

              const chat = tests.startManualChat(test.id);
              manualChatId = chat!.id;

              sendJson(socket, { type: "manual_status", status: "connected", chatId: manualChatId });
              sendJson(socket, { type: "event", ts: new Date().toISOString(), message: "Connected — ready to chat." });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              sendJson(socket, { type: "manual_status", status: "error", error: msg });
              if (manualBrowser) { try { await manualBrowser.close(); } catch { /* */ } }
              manualBrowser = null; manualPage = null; manualTestId = null; manualChatId = null;
            }
            return;
          }

          /* ── UI2: manual chat send ── */
          if (msgType === "manual_send") {
            const m = WsManualSendSchema.safeParse(parsed);
            if (!m.success) { sendJson(socket, { type: "error", message: "Invalid manual_send payload" }); return; }
            if (!manualPage || !manualTestId || !manualChatId) { sendJson(socket, { type: "error", message: "No manual session open." }); return; }

            try {
              const input = await waitInput(manualPage, manualInputSel);
              if (!input) throw new Error("Cannot find message input on the page.");

              await safeTypeIntoInput(input, m.data.text);
              tests.appendManualTranscript(manualTestId, manualChatId, "user", m.data.text);
              sendJson(socket, { type: "manual_transcript", role: "user", text: m.data.text });

              await sendMessage(manualPage, input);

              const reply = await waitBotReply(manualPage, m.data.text, 55_000, (text, partial) => {
                sendJson(socket, { type: "manual_transcript", role: "bot", text, partial });
              }, connApiKey);
              if (reply) tests.appendManualTranscript(manualTestId, manualChatId, "bot", reply);
            } catch (e) {
              sendJson(socket, { type: "error", message: e instanceof Error ? e.message : String(e) });
            }
            return;
          }

          /* ── UI2: manual chat stop ── */
          if (msgType === "manual_stop") {
            if (manualTestId && manualChatId) tests.endManualChat(manualTestId, manualChatId);
            if (manualBrowser) { try { await manualBrowser.close(); } catch { /* */ } }
            manualBrowser = null; manualPage = null; manualTestId = null; manualChatId = null;
            manualInputSel = undefined;
            sendJson(socket, { type: "manual_status", status: "disconnected" });
            return;
          }

          sendJson(socket, { type: "error", message: "Unknown message type" });
        })();
      });
    });
  });

  /* ── Static files ── */
  await app.register(fastifyStatic, { root: ui3Root, prefix: "/ui3/", index: "index.html" });
  await app.register(fastifyStatic, { root: ui4Root, prefix: "/ui4/", index: "index.html", decorateReply: false });
  await app.register(fastifyStatic, { root: ui5Root, prefix: "/ui5/", index: "index.html", decorateReply: false });

  app.get("/", async (_req, reply) => { reply.redirect("/ui5/index.html"); });
  app.get("/choose-ui.html", async (_req, reply) => {
    const html = readFileSync(join(projectRoot, "choose-ui.html"), "utf8");
    reply.type("text/html").send(html);
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/ws")) { reply.code(404).send({ error: "Not found" }); return; }
    try { const html = readFileSync(join(ui3Root, "index.html"), "utf8"); reply.type("text/html").send(html); }
    catch { reply.code(404).send({ error: "Not found" }); }
  });

  return app;
}
