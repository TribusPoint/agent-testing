import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const AgentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  greeting: z.string().default("hi"),
  launcherSelector: z.string().optional(),
  inputSelector: z.string().optional(),
  defaultUrl: z.string().url().optional(),
  openaiModel: z.string().optional(),
  createdAt: z.string(),
});

export type Agent = z.infer<typeof AgentSchema>;

const FileSchema = z.object({ agents: z.array(AgentSchema) });

const CreateSchema = z.object({
  name: z.string().min(1),
  greeting: z.string().default("hi"),
  launcherSelector: z.string().optional(),
  inputSelector: z.string().optional(),
  defaultUrl: z.string().url().optional(),
  openaiModel: z.string().optional(),
});

export type CreateAgentInput = z.infer<typeof CreateSchema>;

export function parseCreateAgent(body: unknown): CreateAgentInput {
  return CreateSchema.parse(body);
}

export class AgentsStore {
  constructor(private readonly filePath: string) {}

  private read(): z.infer<typeof FileSchema> {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = FileSchema.safeParse(JSON.parse(raw) as unknown);
      if (parsed.success) return parsed.data;
    } catch {
      /* empty */
    }
    return { agents: [] };
  }

  private write(data: z.infer<typeof FileSchema>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  list(): Agent[] {
    return this.read().agents;
  }

  create(input: CreateAgentInput): Agent {
    const data = this.read();
    const agent: Agent = {
      id: crypto.randomUUID(),
      name: input.name,
      greeting: input.greeting,
      launcherSelector: input.launcherSelector?.trim() || undefined,
      inputSelector: input.inputSelector?.trim() || undefined,
      defaultUrl: input.defaultUrl,
      openaiModel: input.openaiModel?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    data.agents.push(agent);
    this.write(data);
    return agent;
  }

  delete(id: string): boolean {
    const data = this.read();
    const n = data.agents.length;
    data.agents = data.agents.filter((a) => a.id !== id);
    if (data.agents.length === n) return false;
    this.write(data);
    return true;
  }

  get(id: string): Agent | undefined {
    return this.read().agents.find((a) => a.id === id);
  }
}
