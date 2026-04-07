import { createOpenAI } from "@ai-sdk/openai";
import { openai as defaultOpenAI } from "@ai-sdk/openai";

/**
 * Returns an OpenAI provider bound to the given API key.
 * Falls back to the default env-based provider when no key is supplied.
 */
export function getOpenAI(apiKey?: string) {
  if (apiKey) return createOpenAI({ apiKey });
  return defaultOpenAI;
}
