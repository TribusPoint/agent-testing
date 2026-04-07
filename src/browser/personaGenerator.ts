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

  const allPersonas: Persona[] = [];
  const seenNames = new Set<string>();
  const BATCH = 10;
  const maxRounds = Math.ceil(count / BATCH) + 3;

  for (let round = 0; round < maxRounds && allPersonas.length < count; round++) {
    const remaining = count - allPersonas.length;
    const batchSize = Math.min(remaining, BATCH);
    const approxTokens = Math.min(16000, 300 + batchSize * 120);

    if (round > 0) onLog?.(`Got ${allPersonas.length}/${count} testers so far — requesting ${batchSize} more...`);

    const existingNames = allPersonas.map((p) => p.name);
    const avoidClause = existingNames.length
      ? `\nDo NOT reuse any of these names or archetypes already created:\n${existingNames.map((n) => `  - ${n}`).join("\n")}`
      : "";

    try {
      const { text } = await generateText({
        model: getOpenAI(apiKey)(model),
        system: `You generate DIVERSE test personas (testers) for chatbot testing on a specific website.

CRITICAL RULES:
1. Every tester MUST be completely different — different persona, different goal, different personality, different knowledge level.
2. Draw from the site's target audience, services, and common user needs to make testers realistic.
3. Return EXACTLY ${batchSize} testers. Count them before returning.

DIVERSITY REQUIREMENTS — assign from these pools, making sure NO TWO testers share the same combination:

Personalities (pick different ones): "Formal and professional", "Casual and friendly", "Confused and uncertain", "Impatient and direct", "Skeptical and questioning", "Anxious and worried", "Cheerful and curious", "Blunt and no-nonsense"

Knowledge levels (spread across): "Beginner", "Moderate", "Expert"

Personas: pick from the site's target audience list, each tester a DIFFERENT audience type.
${avoidClause}

Return a JSON array of EXACTLY ${batchSize} testers. Each object:
{"name": "a realistic full name", "persona": "specific persona drawn from site's audience", "goal": "one clear sentence about what they want to accomplish", "personality": "communication style from the personality pool above", "knowledgeLevel": "Beginner or Moderate or Expert"}

Return ONLY valid JSON array. No markdown. No explanation.`,
        prompt: analysisContext,
        maxOutputTokens: approxTokens,
        temperature: 0.85 + round * 0.03,
      });

      const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<Record<string, unknown>>;
      if (!Array.isArray(parsed)) continue;

      for (const p of parsed) {
        if (allPersonas.length >= count) break;
        const name = String(p.name || "").trim();
        if (!name || seenNames.has(name.toLowerCase())) continue;
        seenNames.add(name.toLowerCase());
        allPersonas.push({
          id: crypto.randomUUID(),
          name,
          persona: String(p.persona || "Visitor"),
          goal: String(p.goal || "General inquiry"),
          personality: String(p.personality || "Neutral"),
          knowledgeLevel: String(p.knowledgeLevel || "Beginner"),
          questions: [],
        });
      }
    } catch {
      onLog?.(`Round ${round + 1}: failed to parse testers from LLM.`);
    }
  }

  if (!allPersonas.length) {
    onLog?.("All attempts failed, returning defaults.");
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

  onLog?.(`Generated ${allPersonas.length} testers.`);
  return allPersonas;
}
