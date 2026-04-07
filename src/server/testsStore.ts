import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Persona {
  id: string;
  name: string;
  persona: string;
  goal: string;
  personality: string;
  knowledgeLevel: string;
  questions: string[];
}

export interface SiteAnalysis {
  domain: string;
  subDomain: string;
  summary: string;
  siteName: string;
  targetAudience: string[];
  services: string[];
  keywords: string[];
  commonUserNeeds: string[];
  analyzedAt: string;
}

export interface Dimension {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

export interface PersonalityProfile {
  id: string;
  name: string;
  description: string;
  tone: string;
  style: string;
}

/** Unified test questions: always use type "structured" with personaId + dimension tags (legacy "persona" type is deprecated). */
export interface Question {
  id: string;
  text: string;
  expectedAnswer?: string;
  type: "persona" | "structured";
  personaId?: string;
  persona?: string;
  dimension?: string;
  dimensionValue?: string;
  personalityProfile?: string;
}

export interface RunResult {
  questionId?: string;
  questionText: string;
  responseText: string;
  followUps: Array<{ utterance: string; response: string }>;
  latencyMs: number;
  answered: boolean;
  score: number | null;
  evaluationNotes: string | null;
  humanScore: number | null;
  humanNotes: string | null;
}

export interface RunReport {
  totalQuestions: number;
  passCount: number;
  passRate: number;
  avgScore: number;
  avgLatencyMs: number;
}

export interface TestRun {
  id: string;
  personaId: string;
  personaName: string;
  turns: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "ok" | "error";
  error?: string;
  events: Array<{ ts: string; message: string }>;
  transcript: Array<{ ts: string; role: "user" | "bot"; text: string }>;
  results?: RunResult[];
  report?: RunReport;
}

export interface ManualChat {
  id: string;
  startedAt: string;
  endedAt?: string;
  transcript: Array<{ ts: string; role: "user" | "bot"; text: string }>;
}

export interface Test {
  id: string;
  url: string;
  name: string;
  createdAt: string;
  analysis?: SiteAnalysis;
  personas: Persona[];
  runs: TestRun[];
  manualChats: ManualChat[];
  launcherSelector?: string;
  inputSelector?: string;
  dimensions?: Dimension[];
  personalityProfiles?: PersonalityProfile[];
  questions?: Question[];
}

interface FileData {
  tests: Test[];
}

const MAX_TESTS = 100;

export class TestsStore {
  constructor(private readonly filePath: string) {}

  private read(): FileData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const data = JSON.parse(raw) as FileData;
      if (Array.isArray(data?.tests)) return data;
    } catch {
      /* empty */
    }
    return { tests: [] };
  }

  private write(data: FileData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  list(): Test[] {
    return [...this.read().tests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  get(id: string): Test | undefined {
    const data = this.read();
    const t = data.tests.find((t) => t.id === id);
    if (t && this.migrateTest(t)) this.write(data);
    return t;
  }

  private migrateTest(test: Test): boolean {
    let changed = false;
    if (!test.questions) test.questions = [];

    const hasPersonaTypeQs = test.questions.some((q) => q.type === "persona");
    if (!hasPersonaTypeQs) {
      for (const persona of test.personas) {
        if (persona.questions?.length) {
          for (const qText of persona.questions) {
            test.questions.push({
              id: crypto.randomUUID(),
              text: qText,
              type: "persona",
              personaId: persona.id,
              persona: persona.name,
            });
          }
          persona.questions = [];
          changed = true;
        }
      }
    }

    for (const q of test.questions) {
      if (!q.type) {
        (q as Question).type = "structured";
        changed = true;
      }
    }
    return changed;
  }

  create(url: string, name?: string): Test {
    const data = this.read();
    const test: Test = {
      id: crypto.randomUUID(),
      url,
      name: name || new URL(url).hostname,
      createdAt: new Date().toISOString(),
      personas: [],
      runs: [],
      manualChats: [],
    };
    data.tests.unshift(test);
    data.tests = data.tests.slice(0, MAX_TESTS);
    this.write(data);
    return test;
  }

  update(id: string, patch: Partial<Pick<Test, "name" | "url" | "analysis" | "launcherSelector" | "inputSelector">>): Test | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === id);
    if (!test) return null;
    if (patch.name !== undefined) test.name = patch.name;
    if (patch.url !== undefined) test.url = patch.url;
    if (patch.analysis !== undefined) test.analysis = patch.analysis;
    if (patch.launcherSelector !== undefined) test.launcherSelector = patch.launcherSelector;
    if (patch.inputSelector !== undefined) test.inputSelector = patch.inputSelector;
    this.write(data);
    return test;
  }

  delete(id: string): boolean {
    const data = this.read();
    const n = data.tests.length;
    data.tests = data.tests.filter((t) => t.id !== id);
    if (data.tests.length === n) return false;
    this.write(data);
    return true;
  }

  setPersonas(testId: string, personas: Persona[]): Test | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    test.personas = personas;
    this.write(data);
    return test;
  }

  updatePersona(testId: string, personaId: string, patch: Partial<Omit<Persona, "id">>): Persona | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    const p = test.personas.find((x) => x.id === personaId);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.persona !== undefined) p.persona = patch.persona;
    if (patch.goal !== undefined) p.goal = patch.goal;
    if (patch.personality !== undefined) p.personality = patch.personality;
    if (patch.knowledgeLevel !== undefined) p.knowledgeLevel = patch.knowledgeLevel;
    if (patch.questions !== undefined) p.questions = patch.questions;
    this.write(data);
    return p;
  }

  deletePersona(testId: string, personaId: string): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    const n = test.personas.length;
    test.personas = test.personas.filter((p) => p.id !== personaId);
    if (test.personas.length === n) return false;
    if (test.questions?.length) {
      test.questions = test.questions.filter((q) => q.personaId !== personaId);
    }
    this.write(data);
    return true;
  }

  clearPersonas(testId: string): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    test.personas = [];
    test.questions = [];
    this.write(data);
    return true;
  }

  addPersona(testId: string, persona: Persona): Persona | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    test.personas.push(persona);
    this.write(data);
    return persona;
  }

  addQuestion(testId: string, question: Question): Question | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    if (!test.questions) test.questions = [];
    test.questions.push(question);
    this.write(data);
    return question;
  }

  /** Replace the entire question list (e.g. after LLM generation). */
  setGeneratedQuestions(testId: string, questions: Question[]): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    test.questions = questions;
    this.write(data);
    return true;
  }

  startRun(testId: string, run: TestRun): TestRun | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    test.runs.unshift(run);
    test.runs = test.runs.slice(0, 200);
    this.write(data);
    return run;
  }

  appendRunEvent(testId: string, runId: string, message: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    if (!run) return;
    run.events.push({ ts: new Date().toISOString(), message });
    this.write(data);
  }

  appendRunTranscript(testId: string, runId: string, role: "user" | "bot", text: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    if (!run) return;
    run.transcript.push({ ts: new Date().toISOString(), role, text });
    this.write(data);
  }

  finishRun(testId: string, runId: string, status: "ok" | "error", error?: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    if (!run) return;
    run.status = status;
    run.endedAt = new Date().toISOString();
    run.error = error;
    this.write(data);
  }

  startManualChat(testId: string): ManualChat | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return null;
    const chat: ManualChat = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      transcript: [],
    };
    test.manualChats.unshift(chat);
    test.manualChats = test.manualChats.slice(0, 50);
    this.write(data);
    return chat;
  }

  appendManualTranscript(testId: string, chatId: string, role: "user" | "bot", text: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const chat = test?.manualChats.find((c) => c.id === chatId);
    if (!chat) return;
    chat.transcript.push({ ts: new Date().toISOString(), role, text });
    this.write(data);
  }

  endManualChat(testId: string, chatId: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const chat = test?.manualChats.find((c) => c.id === chatId);
    if (!chat) return;
    chat.endedAt = new Date().toISOString();
    this.write(data);
  }

  /* ── Dimensions ── */

  setDimensions(testId: string, dims: Dimension[]): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    test.dimensions = dims;
    this.write(data);
    return true;
  }

  deleteDimension(testId: string, dimId: string): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test?.dimensions) return false;
    const n = test.dimensions.length;
    test.dimensions = test.dimensions.filter((d) => d.id !== dimId);
    if (test.dimensions.length === n) return false;
    this.write(data);
    return true;
  }

  /* ── Personality Profiles ── */

  setProfiles(testId: string, profiles: PersonalityProfile[]): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    test.personalityProfiles = profiles;
    this.write(data);
    return true;
  }

  deleteProfile(testId: string, profileId: string): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test?.personalityProfiles) return false;
    const n = test.personalityProfiles.length;
    test.personalityProfiles = test.personalityProfiles.filter((p) => p.id !== profileId);
    if (test.personalityProfiles.length === n) return false;
    this.write(data);
    return true;
  }

  /* ── Structured Questions ── */

  setQuestions(testId: string, questions: Question[]): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test) return false;
    test.questions = questions;
    this.write(data);
    return true;
  }

  updateQuestion(testId: string, questionId: string, patch: Partial<Omit<Question, "id">>): Question | null {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const q = test?.questions?.find((x) => x.id === questionId);
    if (!q) return null;
    if (patch.text !== undefined) q.text = patch.text;
    if (patch.expectedAnswer !== undefined) q.expectedAnswer = patch.expectedAnswer;
    if (patch.type !== undefined) q.type = patch.type;
    if (patch.personaId !== undefined) q.personaId = patch.personaId;
    if (patch.persona !== undefined) q.persona = patch.persona;
    if (patch.dimension !== undefined) q.dimension = patch.dimension;
    if (patch.dimensionValue !== undefined) q.dimensionValue = patch.dimensionValue;
    if (patch.personalityProfile !== undefined) q.personalityProfile = patch.personalityProfile;
    this.write(data);
    return q;
  }

  /** Sync tester display name on all questions for that tester (after rename). */
  syncQuestionTesterNames(testId: string, personaId: string, name: string): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test?.questions) return;
    for (const q of test.questions) {
      if (q.personaId === personaId) q.persona = name;
    }
    this.write(data);
  }

  deleteQuestion(testId: string, questionId: string): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    if (!test?.questions) return false;
    const n = test.questions.length;
    test.questions = test.questions.filter((q) => q.id !== questionId);
    if (test.questions.length === n) return false;
    this.write(data);
    return true;
  }

  /* ── Run Results & Reports ── */

  appendRunResult(testId: string, runId: string, result: RunResult): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    if (!run) return;
    if (!run.results) run.results = [];
    run.results.push(result);
    this.write(data);
  }

  setRunReport(testId: string, runId: string, report: RunReport): void {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    if (!run) return;
    run.report = report;
    this.write(data);
  }

  annotateResult(testId: string, runId: string, resultIdx: number, patch: { humanScore?: number | null; humanNotes?: string }): boolean {
    const data = this.read();
    const test = data.tests.find((t) => t.id === testId);
    const run = test?.runs.find((r) => r.id === runId);
    const result = run?.results?.[resultIdx];
    if (!result) return false;
    if (patch.humanScore !== undefined) result.humanScore = patch.humanScore;
    if (patch.humanNotes !== undefined) result.humanNotes = patch.humanNotes;
    this.write(data);
    return true;
  }
}
