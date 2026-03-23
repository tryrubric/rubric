import type { ChatMessage, ScoringResult, QualityFlags } from "./types.js";

// Patterns that indicate the model refused or couldn't answer
const REFUSAL_PATTERNS = [
  /i (cannot|can't|am unable to|won't|will not) (help|assist|provide|generate|create)/i,
  /as an (ai|language model|llm)/i,
  /i don't have (access|the ability|real-time)/i,
  /i'm (sorry|afraid),? (but )?i (can't|cannot)/i,
];

// Patterns that indicate repetition (naive but fast)
function isRepetitive(text: string): boolean {
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.length > 20);
  if (sentences.length < 4) return false;
  const seen = new Set<string>();
  for (const s of sentences) {
    const normalized = s.toLowerCase().trim().slice(0, 60);
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

// Check if output looks like it matches expected format from the prompt
function hasFormatMismatch(prompt: string, output: string): boolean {
  const promptLower = prompt.toLowerCase();
  const outputTrimmed = output.trim();

  if (
    (promptLower.includes("json") || promptLower.includes("return a json")) &&
    !outputTrimmed.startsWith("{") &&
    !outputTrimmed.startsWith("[")
  ) {
    return true;
  }
  if (
    (promptLower.includes("markdown") || promptLower.includes("bullet")) &&
    !outputTrimmed.includes("- ") &&
    !outputTrimmed.includes("* ") &&
    !outputTrimmed.includes("#")
  ) {
    return true;
  }
  return false;
}

// Rough relevance: check if output shares key nouns with the last user message
function hasLowRelevance(userContent: string, output: string): boolean {
  const words = userContent
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 5);

  if (words.length === 0) return false;

  const outputLower = output.toLowerCase();
  const matchCount = words.filter((w) => outputLower.includes(w)).length;
  const ratio = matchCount / words.length;
  return ratio < 0.1; // less than 10% of key words appear in output
}

export function scoreOutput(
  messages: ChatMessage[],
  output: string
): ScoringResult {
  const flags: QualityFlags = {
    too_short: false,
    repetitive: false,
    refusal: false,
    format_mismatch: false,
    low_relevance: false,
  };

  // 1. Too short
  if (output.trim().length < 20) {
    flags.too_short = true;
  }

  // 2. Repetition
  if (isRepetitive(output)) {
    flags.repetitive = true;
  }

  // 3. Refusal detection
  if (REFUSAL_PATTERNS.some((p) => p.test(output))) {
    flags.refusal = true;
  }

  // 4. Format mismatch — compare against last system or user message
  const promptText = messages
    .filter((m) => m.role === "system" || m.role === "user")
    .map((m) => m.content ?? "")
    .join(" ");

  if (hasFormatMismatch(promptText, output)) {
    flags.format_mismatch = true;
  }

  // 5. Low relevance — compare against last user message
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser?.content && hasLowRelevance(lastUser.content, output)) {
    flags.low_relevance = true;
  }

  // Scoring: start at 1.0, penalise each flag
  const penalties: Record<keyof QualityFlags, number> = {
    too_short: 0.4,
    refusal: 0.3,
    repetitive: 0.2,
    format_mismatch: 0.15,
    low_relevance: 0.25,
  };

  let score = 1.0;
  for (const [flag, penalty] of Object.entries(penalties) as [keyof QualityFlags, number][]) {
    if (flags[flag]) score -= penalty;
  }

  return { score: Math.max(0, Math.min(1, score)), flags };
}

// --- LLM-as-Judge (optional, sampled) ---

const JUDGE_API_KEY = process.env.JUDGE_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-haiku-4-5-20251001";
const JUDGE_SAMPLE_RATE = parseFloat(process.env.JUDGE_SAMPLE_RATE ?? "0.1");

export async function maybeJudgeAsync(
  traceId: string,
  messages: ChatMessage[],
  output: string,
  onScore: (score: number) => void
): Promise<void> {
  if (!JUDGE_API_KEY || Math.random() > JUDGE_SAMPLE_RATE) return;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content) return;

  const judgePrompt = `You are an AI output quality evaluator. Rate the following AI response on a scale from 0.0 to 1.0.

USER MESSAGE:
${lastUser.content.slice(0, 500)}

AI RESPONSE:
${output.slice(0, 1000)}

Respond with ONLY a single decimal number between 0.0 and 1.0. No explanation.
- 0.0 = completely wrong, hallucinated, or refused inappropriately
- 0.5 = partially correct or relevant but has issues
- 1.0 = excellent, accurate, helpful response`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": JUDGE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 10,
        messages: [{ role: "user", content: judgePrompt }],
      }),
    });

    if (!res.ok) return;

    const data = (await res.json()) as { content: Array<{ text: string }> };
    const text = data.content?.[0]?.text?.trim();
    const parsed = parseFloat(text);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      onScore(parsed);
    }
  } catch {
    // Non-fatal: judge errors don't affect the proxy
  }
}
