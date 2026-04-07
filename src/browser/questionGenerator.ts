import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import type { SiteAnalysis, Persona, Dimension, PersonalityProfile, Question } from "../server/testsStore.js";

function closestMatch(input: string, valid: string[]): string {
  if (!input || !valid.length) return valid[0] || "";
  const lower = input.trim().toLowerCase();
  const exact = valid.find((v) => v.toLowerCase() === lower);
  if (exact) return exact;
  const partial = valid.find((v) => lower.includes(v.toLowerCase()) || v.toLowerCase().includes(lower));
  if (partial) return partial;
  return valid[Math.floor(Math.random() * valid.length)];
}

function attachPersonaIds(
  personas: Persona[],
  rows: Array<Record<string, string>>,
  dimensions: Dimension[],
  profiles: PersonalityProfile[],
  onLog?: (msg: string) => void,
): Question[] {
  const byName = new Map(personas.map((p) => [p.name.trim().toLowerCase(), p] as const));
  const dimNames = dimensions.map((d) => d.name);
  const dimValueMap = new Map(dimensions.map((d) => [d.name.toLowerCase(), d.values.map((v) => v.value)] as const));
  const profileNames = profiles.map((p) => p.name);

  const out: Question[] = [];
  for (const q of rows) {
    const nameRaw = String(q.persona || "").trim();
    const p = byName.get(nameRaw.toLowerCase());
    if (!p) {
      onLog?.(`Skipping question — unknown tester name "${nameRaw}" (use exact Name from TESTERS list).`);
      continue;
    }
    const dim = closestMatch(String(q.dimension || ""), dimNames);
    const dimVals = dimValueMap.get(dim.toLowerCase()) || [];
    const dimVal = closestMatch(String(q.dimensionValue || ""), dimVals);
    const profile = closestMatch(String(q.personalityProfile || ""), profileNames);

    out.push({
      id: crypto.randomUUID(),
      text: String(q.text || "").trim(),
      type: "structured",
      personaId: p.id,
      persona: p.name,
      dimension: dim,
      dimensionValue: dimVal,
      personalityProfile: profile,
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

  if (!apiKey && !process.env.OPENAI_API_KEY) {
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

  const testerNames = personas.map((p) => p.name);
  const testerDetails = personas.map((p) => `  "${p.name}" — ${p.persona}, ${p.personality}, goal: ${p.goal}`).join("\n");
  const dimDetails = dimensions.map((d) => `  "${d.name}": [${d.values.map((v) => `"${v.value}"`).join(", ")}]`).join("\n");
  const profileNamesList = profiles.map((p) => `"${p.name}"`).join(", ");
  const profileDetails = profiles.map((p) => `  "${p.name}" — tone: ${p.tone}, style: ${p.style}`).join("\n");

  const ctx = [
    `=== SITE CONTEXT ===`,
    `Site: ${analysis.siteName} (${analysis.domain})`,
    `Services: ${analysis.services.join(", ")}`,
    `Audience: ${analysis.targetAudience.join(", ")}`,
    `Common needs: ${analysis.commonUserNeeds.join(", ")}`,
    ``,
    `=== ALLOWED PERSONA VALUES (pick ONLY from these) ===`,
    testerDetails,
    ``,
    `=== ALLOWED DIMENSION VALUES (pick ONLY from these) ===`,
    dimDetails,
    ``,
    `=== ALLOWED PROFILE VALUES (pick ONLY from these) ===`,
    profileDetails,
  ].join("\n");

  const allQuestions: Question[] = [];
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
      system: `You are a creative QA engineer generating diverse test questions for a chatbot.

TASK: Generate EXACTLY ${batchSize} test questions as a JSON array.

STRICT METADATA RULES — every question must use ONLY these allowed values:
• "persona" must be EXACTLY one of: ${testerNames.map((n) => `"${n}"`).join(", ")}
• "dimension" must be EXACTLY one of the dimension names listed in the context
• "dimensionValue" must be EXACTLY one of the values belonging to the chosen dimension
• "personalityProfile" must be EXACTLY one of: ${profileNamesList}

DO NOT invent, rephrase, abbreviate, or modify any metadata value. Copy-paste from the lists above.

CREATIVE QUESTION RULES — make the "text" field rich and diverse:
• Ground every question in the site's real services, audience, and domain
• Vary question styles: direct asks, scenario-based ("I'm a patient who…"), comparative ("What's the difference between…"), troubleshooting ("I tried to … but …"), edge cases, multi-part questions
• Match the persona's background and knowledge level — a medical professional asks differently than a first-time patient
• Match the personality profile's tone — a frustrated user is terse and demanding, a confused user is uncertain and rambling, a polite professional is structured
• Cover the full breadth of services, audiences, and user needs — don't cluster around one topic
• Distribute evenly across all personas, dimensions, and profiles
${seenTexts.size ? `• Do NOT repeat or closely rephrase any of these existing questions:\n${[...seenTexts].slice(0, 50).map((t) => `  - ${t}`).join("\n")}` : ""}

OUTPUT FORMAT — return ONLY a valid JSON array, no markdown:
[{"text": "the question", "persona": "Exact Name", "dimension": "Exact Dimension", "dimensionValue": "Exact Value", "personalityProfile": "Exact Profile"}]`,
      prompt: ctx,
      maxOutputTokens: approxTokens,
      temperature: 0.72 + (round % 4) * 0.03,
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
        const withIds = attachPersonaIds(personas, [{ ...row, text: qText }], dimensions, profiles, onLog);
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
