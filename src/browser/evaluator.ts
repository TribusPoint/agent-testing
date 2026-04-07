import { generateText } from "ai";
import { getOpenAI } from "./aiProvider.js";

export interface EvalResult {
  score: number | null;
  notes: string | null;
}

export async function evaluateConversation(opts: {
  question: string;
  conversation: Array<{ role: "user" | "bot"; text: string }>;
  expectedAnswer?: string;
  model?: string;
  apiKey?: string;
}): Promise<EvalResult> {
  const { question, conversation, expectedAnswer, model = "gpt-4o-mini", apiKey } = opts;

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    return { score: null, notes: "No OpenAI key configured" };
  }

  const transcript = conversation
    .map((m) => `${m.role === "user" ? "USER" : "AGENT"}: ${m.text}`)
    .join("\n");

  const expectedClause = expectedAnswer
    ? `\n\nEXPECTED ANSWER (ground truth): "${expectedAnswer}"\nIf the agent's response contradicts or fails to cover the expected answer, score harshly.`
    : "";

  try {
    const { text } = await generateText({
      model: getOpenAI(apiKey)(model),
      system: `You are an expert QA evaluator for customer-facing chatbots. You judge the AGENT's responses in a conversation.

Score from 0 to 100 using this rubric:
- **Relevance (0-25)**: Did the agent address the user's actual question?
- **Completeness (0-25)**: Was the answer thorough? Did it cover all aspects?
- **Accuracy (0-25)**: Was the information correct and not misleading?
- **Helpfulness (0-25)**: Did the agent guide the user toward a resolution?

Deductions:
- Generic/boilerplate responses that don't address the specific question: -20
- Redirecting to a phone number without attempting to help: -15
- Misunderstanding the question: -20
- Hallucinated or incorrect information: -30
- Refusing to answer when the question is reasonable: -15${expectedClause}

Return ONLY a JSON object: {"score": <0-100>, "notes": "<one sentence explanation>"}
No markdown. No extra text.`,
      prompt: `INITIATING QUESTION: "${question}"\n\nCONVERSATION:\n${transcript}`,
      maxOutputTokens: 150,
      temperature: 0.1,
    });

    const cleaned = text.replace(/```json?\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : null,
      notes: String(parsed.notes || ""),
    };
  } catch {
    return { score: null, notes: "Evaluation failed" };
  }
}
