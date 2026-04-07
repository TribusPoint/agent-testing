import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const EventSchema = z.object({ ts: z.string(), message: z.string() });
const TranscriptSchema = z.object({
  ts: z.string(),
  role: z.enum(["user", "bot"]),
  text: z.string(),
});

const RunSchema = z.object({
  id: z.string(),
  agentId: z.string().optional(),
  url: z.string(),
  message: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["running", "ok", "error"]),
  error: z.string().optional(),
  events: z.array(EventSchema),
  transcript: z.array(TranscriptSchema),
});

export type RunRecord = z.infer<typeof RunSchema>;

const FileSchema = z.object({ runs: z.array(RunSchema) });

const MAX_RUNS = 200;

export class RunsStore {
  constructor(private readonly filePath: string) {}

  private read(): z.infer<typeof FileSchema> {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = FileSchema.safeParse(JSON.parse(raw) as unknown);
      if (parsed.success) return parsed.data;
    } catch {
      /* */
    }
    return { runs: [] };
  }

  private write(data: z.infer<typeof FileSchema>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  list(): RunRecord[] {
    return [...this.read().runs].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  get(id: string): RunRecord | undefined {
    return this.read().runs.find((r) => r.id === id);
  }

  startRun(partial: {
    id: string;
    agentId?: string;
    url: string;
    message: string;
  }): RunRecord {
    const data = this.read();
    const run: RunRecord = {
      id: partial.id,
      agentId: partial.agentId,
      url: partial.url,
      message: partial.message,
      startedAt: new Date().toISOString(),
      status: "running",
      events: [],
      transcript: [],
    };
    data.runs.unshift(run);
    data.runs = data.runs.slice(0, MAX_RUNS);
    this.write(data);
    return run;
  }

  appendEvent(runId: string, message: string): void {
    const ts = new Date().toISOString();
    const data = this.read();
    const run = data.runs.find((r) => r.id === runId);
    if (!run) return;
    run.events.push({ ts, message });
    this.write(data);
  }

  appendTranscript(runId: string, role: "user" | "bot", text: string): void {
    const ts = new Date().toISOString();
    const data = this.read();
    const run = data.runs.find((r) => r.id === runId);
    if (!run) return;
    run.transcript.push({ ts, role, text });
    this.write(data);
  }

  finishRun(runId: string, status: "ok" | "error", error?: string): void {
    const data = this.read();
    const run = data.runs.find((r) => r.id === runId);
    if (!run) return;
    run.status = status;
    run.endedAt = new Date().toISOString();
    run.error = error;
    this.write(data);
  }
}
