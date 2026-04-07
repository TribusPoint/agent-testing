import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import type { SiteAnalysis, Persona, Dimension, PersonalityProfile, Question } from "../server/testsStore.js";

function attachPersonaIds(personas: Persona[], rows: Array<Record<string, string>>, onLog?: (msg: string) => void): Question[] {
  const byName = new Map(personas.map((p) => [p.name.trim().toLowerCase(), p] as const));
  const out: Question[] = [];
  for (const q of rows) {
    const nameRaw = String(q.persona || "").trim();
    const p = byName.get(nameRaw.toLowerCase());
    if (!p) {
      onLog?.(`Skipping question — unknown tester name "${nameRaw}" (use exact Name from TESTERS list).`);
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      text: String(q.text || "").trim(),
      type: "structured",
      personaId: p.id,
      persona: p.name,
      dimension: String(q.dimension || "").trim(),
      dimensionValue: String(q.dimensionValue || "").trim(),
      personalityProfile: String(q.personalityProfile || "").trim(),
    });
  }
  return out;
}

export async function generateQuestions(opts: {
  analysis: SiteAnalysis;
  personas: Persona[];
  dimensions: Dimension[];
  profiles: PersonalityProfile[];
  count?: number;
  model?: string;
  apiKey?: string;
  onLog?: (msg: string) => void;
}): Promise<Question[]> {
  const { analysis, personas, dimensions, profiles, count = 30, model = "gpt-4o-mini", apiKey, onLog } = opts;

  if (!personas.length) {
    onLog?.("No testers — cannot generate questions.");
    return [];
  }

  if (!process.env.OPENAI_API_KEY) {
    onLog?.("No OpenAI key — generating placeholder questions.");
    const p = personas[0];
    return [
      {
        id: crypto.randomUUID(),
        text: `What can you help me with regarding ${analysis.services[0] || "your services"}?`,
        type: "structured" as const,
        personaId: p.id,
        persona: p.name,
        dimension: dimensions[0]?.name,
        dimensionValue: dimensions[0]?.values[0]?.value,
        personalityProfile: profiles[0]?.name,
      },
    ];
  }

  onLog?.(`Generating ${count} questions across testers, dimensions, and profiles...`);

  const testerLines = personas.map((p) => `- Name: "${p.name}" | archetype: ${p.persona} | personality: ${p.personality} | goal: ${p.goal}`).join("\n");
  const dimList = dimensions.map((d) => `- ${d.name}: ${d.values.map((v) => v.value).join(", ")}`).join("\n");
  const profileList = profiles.map((p) => `- ${p.name} (${p.tone}, ${p.style})`).join("\n");

  const ctx = [
    `Site: ${analysis.siteName} (${analysis.domain})`,
    `Services: ${analysis.services.join(", ")}`,
    `Common needs: ${analysis.commonUserNeeds.join(", ")}`,
    `\nTESTERS (the "persona" field in JSON MUST be exactly one of the Name values in quotes):\n${testerLines}`,
    `\nDIMENSIONS:\n${dimList}`,
    `\nPROFILES:\n${profileList}`,
  ].join("\n");

  const allQuestions: Question[] = [];
  /** Per LLM call — large batches exceed output token limits and get truncated. */
  const QUESTIONS_PER_CALL = 22;
  const maxRounds = Math.ceil(count / QUESTIONS_PER_CALL) + 8;
  const seenTexts = new Set<string>();

  for (let round = 0; round < maxRounds && allQuestions.length < count; round++) {
    const remaining = count - allQuestions.length;
    const batchSize = Math.min(remaining, QUESTIONS_PER_CALL);

    if (round > 0) onLog?.(`Got ${allQuestions.length}/${count} so far — requesting ${batchSize} more (round ${round + 1})...`);

    const approxTokens = Math.min(32000, 1400 + batchSize * 520);
    const { text } = await generateText({
      model: getOpenAI(apiKey)(model),
      system: `Generate EXACTLY ${batchSize} test questions for chatbot testing. Each question MUST be tagged with:
- "persona": the tester's Name string EXACTLY as given under TESTERS (the quoted Name after "Name: ")
- "dimension": exact dimension name from DIMENSIONS
- "dimensionValue": exact value from that dimension's list
- "personalityProfile": exact profile name from PROFILES

CRITICAL: You MUST return exactly ${batchSize} questions in the JSON array. Count them before returning.

Rules:
- Questions must be specific to this site's domain and services
- Distribute evenly across testers, dimensions, and profiles
- Vary complexity across dimension values
- Match the personality profile's tone and style
- No greetings or pleasantries — direct questions only
${seenTexts.size ? `- Do NOT repeat any of these existing questions:\n${[...seenTexts].slice(0, 40).map((t) => `  • ${t}`).join("\n")}` : ""}

Return a JSON array of exactly ${batchSize} objects:
[{"text": "the question", "persona": "Exact Tester Name", "dimension": "Dimension Name", "dimensionValue": "Value", "personalityProfile": "Profile Name"}]

Return ONLY valid JSON. No markdown.`,
      prompt: ctx,
      maxOutputTokens: approxTokens,
      temperature: 0.68 + (round % 5) * 0.04,
    });

    try {
      const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<Record<string, string>>;
      if (!Array.isArray(parsed)) throw new Error("not an array");
      const addedThisRound: string[] = [];
      for (const row of parsed) {
        if (allQuestions.length >= count) break;
        const qText = String(row.text || "").trim();
        if (!qText || seenTexts.has(qText.toLowerCase())) continue;
        seenTexts.add(qText.toLowerCase());
        const withIds = attachPersonaIds(personas, [{ ...row, text: qText }], onLog);
        for (const q of withIds) {
          if (allQuestions.length >= count) break;
          allQuestions.push(q);
          addedThisRound.push(qText.slice(0, 60));
        }
      }
      if (addedThisRound.length < batchSize * 0.4 && remaining > 0) {
        onLog?.(`Round ${round + 1}: only ${addedThisRound.length} new questions (expected ~${batchSize}); will retry if needed.`);
      }
    } catch {
      onLog?.(`Round ${round + 1}: failed to parse LLM response.`);
    }
  }

  if (!allQuestions.length) {
    onLog?.("All attempts failed, returning a default question.");
    const p = personas[0];
    return [
      {
        id: crypto.randomUUID(),
        text: "What services do you offer?",
        type: "structured" as const,
        personaId: p.id,
        persona: p.name,
        dimension: dimensions[0]?.name,
        dimensionValue: dimensions[0]?.values[0]?.value,
        personalityProfile: profiles[0]?.name,
      },
    ];
  }

  onLog?.(`Generated ${allQuestions.length} questions.`);
  return allQuestions;
}
