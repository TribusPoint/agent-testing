import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";

export interface UtteranceResult {
  answered: boolean;
  utterance: string;
}

export async function getInspiredUtterance(opts: {
  question: string;
  persona: { name: string; persona: string; personality: string; knowledgeLevel: string };
  conversation: Array<{ role: "user" | "bot"; text: string }>;
  model?: string;
  apiKey?: string;
}): Promise<UtteranceResult> {
  const { question, persona, conversation, model = "gpt-4o-mini", apiKey } = opts;

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    return { answered: true, utterance: "" };
  }

  const transcript = conversation
    .map((m) => `${m.role === "user" ? "USER" : "AGENT"}: ${m.text}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: getOpenAI(apiKey)(model),
      system: `You are simulating a user testing a chatbot. Given a conversation, decide:
1. Was the user's original question fully answered by the agent?
2. If NOT answered, generate a natural follow-up message the user would send.

The tester:
- Name: ${persona.name}
- Persona: ${persona.persona}
- Personality: ${persona.personality}
- Knowledge: ${persona.knowledgeLevel}

Rules:
- If the agent gave a complete, helpful answer → answered = true
- If the agent was vague, asked for clarification, gave partial info, or deflected → answered = false, and write a follow-up
- The follow-up should be in-character (matching the tester's personality and knowledge level)
- Keep follow-ups to 1-2 sentences
- Do NOT repeat the original question verbatim; rephrase or dig deeper

Return ONLY JSON: {"answered": true/false, "utterance": "follow-up message or empty string"}`,
      prompt: `ORIGINAL QUESTION: "${question}"\n\nCONVERSATION:\n${transcript}`,
      maxOutputTokens: 150,
      temperature: 0.4,
    });

    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      answered: Boolean(parsed.answered),
      utterance: String(parsed.utterance || ""),
    };
  } catch {
    return { answered: true, utterance: "" };
  }
}
