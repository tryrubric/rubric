// Cost per 1M tokens in USD (input / output)
// Sources: public pricing pages as of early 2026
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o":                  { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":             { input: 0.15,  output: 0.60  },
  "gpt-4o-2024-11-20":       { input: 2.50,  output: 10.00 },
  "gpt-4-turbo":             { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo":           { input: 0.50,  output: 1.50  },
  "o1":                      { input: 15.00, output: 60.00 },
  "o1-mini":                 { input: 3.00,  output: 12.00 },
  "o3-mini":                 { input: 1.10,  output: 4.40  },
  // Anthropic
  "claude-opus-4-6":         { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":       { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  // Google
  "gemini-1.5-pro":          { input: 3.50,  output: 10.50 },
  "gemini-1.5-flash":        { input: 0.075, output: 0.30  },
  "gemini-2.0-flash":        { input: 0.10,  output: 0.40  },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number | null {
  const pricing = COST_TABLE[model];
  if (!pricing) return null;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
