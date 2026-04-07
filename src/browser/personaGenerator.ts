import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import type { SiteAnalysis, Persona } from "../server/testsStore.js";

export interface GeneratePersonasOptions {
  analysis: SiteAnalysis;
  count: number;
  model?: string;
  apiKey?: string;
  onLog?: (message: string) => void;
}

export async function generatePersonas(options: GeneratePersonasOptions): Promise<Persona[]> {
  const { analysis, count, model = "gpt-4o-mini", apiKey, onLog } = options;

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    onLog?.("No OpenAI key — generating placeholder testers.");
    return Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Tester ${i + 1}`,
      persona: "General visitor",
      goal: "Get information about services",
      personality: "Neutral",
      knowledgeLevel: "Beginner",
      questions: [],
    }));
  }

  onLog?.(`Generating ${count} diverse testers for ${analysis.domain} site "${analysis.siteName}"...`);

  const analysisContext = [
    `Site: ${analysis.siteName}`,
    `Domain: ${analysis.domain} — ${analysis.subDomain}`,
    `Summary: ${analysis.summary}`,
    `Target audience: ${analysis.targetAudience.join(", ")}`,
    `Services: ${analysis.services.join(", ")}`,
    `Keywords: ${analysis.keywords.join(", ")}`,
    `Common user needs: ${analysis.commonUserNeeds.join(", ")}`,
  ].join("\n");

  const { text } = await generateText({
    model: getOpenAI(apiKey)(model),
    system: `You generate DIVERSE test personas (testers) for chatbot testing on a specific website.

CRITICAL RULES:
1. Every tester MUST be completely different from the others — different persona, different goal, different personality, different knowledge level.
2. Draw from the site's target audience, services, and common user needs to make testers realistic.

DIVERSITY REQUIREMENTS — assign from these pools, making sure NO TWO testers share the same combination:

Personalities (pick different ones): "Formal and professional", "Casual and friendly", "Confused and uncertain", "Impatient and direct", "Skeptical and questioning", "Anxious and worried", "Cheerful and curious", "Blunt and no-nonsense"

Knowledge levels (spread across): "Beginner", "Moderate", "Expert"

Personas: pick from the site's target audience list, each tester a DIFFERENT audience type.

Return a JSON array of ${count} testers. Each object:
{
  "name": "a realistic full name",
  "persona": "specific persona drawn from site's audience",
  "goal": "one clear sentence about what they want to accomplish",
  "personality": "communication style from the personality pool above",
  "knowledgeLevel": "Beginner or Moderate or Expert"
}

Return ONLY valid JSON array. No markdown. No explanation.`,
    prompt: analysisContext,
    maxOutputTokens: 1500,
    temperature: 0.85,
  });

  try {
    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) throw new Error("Not an array");

    const personas: Persona[] = parsed.slice(0, count).map((p) => ({
      id: crypto.randomUUID(),
      name: String(p.name || "Unnamed"),
      persona: String(p.persona || "Visitor"),
      goal: String(p.goal || "General inquiry"),
      personality: String(p.personality || "Neutral"),
      knowledgeLevel: String(p.knowledgeLevel || "Beginner"),
      questions: [],
    }));

    onLog?.(`Generated ${personas.length} testers.`);
    return personas;
  } catch {
    onLog?.("Failed to parse testers from OpenAI, returning defaults.");
    return Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `Tester ${i + 1}`,
      persona: "Visitor",
      goal: "Get information",
      personality: "Neutral",
      knowledgeLevel: "Beginner",
      questions: [],
    }));
  }
}
