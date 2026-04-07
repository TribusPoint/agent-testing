import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";
import type { SiteAnalysis, Dimension, PersonalityProfile } from "../server/testsStore.js";

export async function generateDimensions(opts: {
  analysis: SiteAnalysis;
  model?: string;
  apiKey?: string;
  onLog?: (msg: string) => void;
}): Promise<Dimension[]> {
  const { analysis, model = "gpt-4o-mini", apiKey, onLog } = opts;

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    onLog?.("No OpenAI key — generating placeholder dimensions.");
    return [
      { id: crypto.randomUUID(), name: "Complexity", values: [{ id: crypto.randomUUID(), value: "Simple" }, { id: crypto.randomUUID(), value: "Moderate" }, { id: crypto.randomUUID(), value: "Complex" }] },
      { id: crypto.randomUUID(), name: "Intent", values: [{ id: crypto.randomUUID(), value: "Informational" }, { id: crypto.randomUUID(), value: "Transactional" }, { id: crypto.randomUUID(), value: "Support" }] },
    ];
  }

  onLog?.("Generating test dimensions from site analysis...");

  const ctx = `Site: ${analysis.siteName}\nDomain: ${analysis.domain}\nServices: ${analysis.services.join(", ")}\nAudience: ${analysis.targetAudience.join(", ")}\nNeeds: ${analysis.commonUserNeeds.join(", ")}`;

  const { text } = await generateText({
    model: getOpenAI(apiKey)(model),
    system: `You generate test DIMENSIONS for chatbot testing. Dimensions are categories that vary how questions are asked.

Generate 4-6 dimensions relevant to this specific site. Each dimension has 3-5 values.

Common dimension types (adapt to the site):
- Complexity (Simple, Moderate, Complex)
- User Intent (Informational, Transactional, Support, Complaint)
- Topic Area (site-specific service categories)
- Urgency (Low, Medium, High, Emergency)
- Channel Context (First visit, Returning user, Mobile user)

Return a JSON array:
[{"name": "Dimension Name", "values": ["Value 1", "Value 2", "Value 3"]}]

Return ONLY valid JSON. No markdown.`,
    prompt: ctx,
    maxOutputTokens: 600,
    temperature: 0.7,
  });

  try {
    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Array<{ name: string; values: string[] }>;
    const dims: Dimension[] = parsed.map((d) => ({
      id: crypto.randomUUID(),
      name: String(d.name),
      values: (d.values || []).map((v) => ({ id: crypto.randomUUID(), value: String(v) })),
    }));
    onLog?.(`Generated ${dims.length} dimensions.`);
    return dims;
  } catch {
    onLog?.("Failed to parse dimensions, returning defaults.");
    return [
      { id: crypto.randomUUID(), name: "Complexity", values: [{ id: crypto.randomUUID(), value: "Simple" }, { id: crypto.randomUUID(), value: "Complex" }] },
    ];
  }
}

export async function generateProfiles(opts: {
  model?: string;
  apiKey?: string;
  onLog?: (msg: string) => void;
}): Promise<PersonalityProfile[]> {
  const { model = "gpt-4o-mini", apiKey, onLog } = opts;

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    onLog?.("No OpenAI key — generating placeholder profiles.");
    return [
      { id: crypto.randomUUID(), name: "Polite Professional", description: "Formal and patient", tone: "Professional", style: "Detailed" },
      { id: crypto.randomUUID(), name: "Frustrated User", description: "Impatient, wants quick answers", tone: "Impatient", style: "Terse" },
    ];
  }

  onLog?.("Generating personality profiles...");

  const { text } = await generateText({
    model: getOpenAI(apiKey)(model),
    system: `Generate 6-8 distinct personality profiles for chatbot testers. Each profile represents a different communication style.

Return JSON array:
[{"name": "Profile Name", "description": "one sentence", "tone": "communication tone", "style": "writing style"}]

Cover a range: polite, impatient, confused, technical, elderly, non-native speaker, angry, cheerful.
Return ONLY valid JSON.`,
    prompt: "Generate diverse tester personality profiles.",
    maxOutputTokens: 500,
    temperature: 0.8,
  });

  try {
    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Array<Record<string, string>>;
    const profiles: PersonalityProfile[] = parsed.map((p) => ({
      id: crypto.randomUUID(),
      name: String(p.name),
      description: String(p.description || ""),
      tone: String(p.tone || ""),
      style: String(p.style || ""),
    }));
    onLog?.(`Generated ${profiles.length} profiles.`);
    return profiles;
  } catch {
    onLog?.("Failed to parse profiles, returning defaults.");
    return [
      { id: crypto.randomUUID(), name: "Default", description: "Standard user", tone: "Neutral", style: "Normal" },
    ];
  }
}
