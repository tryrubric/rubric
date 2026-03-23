import type { ChatMessage, ScoringResult, QualityFlags } from "./types.js";

// ─── Refusal detection ────────────────────────────────────────────────────────

const REFUSAL_PATTERNS = [
  /i (cannot|can't|am unable to|won't|will not) (help|assist|provide|generate|create)/i,
  /as an (ai|language model|llm)/i,
  /i don't have (access|the ability|real-time)/i,
  /i'm (sorry|afraid),? (but )?i (can't|cannot)/i,
];

// ─── Repetition detection ─────────────────────────────────────────────────────

function isRepetitive(text: string): boolean {
  // Check 1: exact sentence duplication
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.length > 20);
  if (sentences.length >= 4) {
    const seen = new Set<string>();
    for (const s of sentences) {
      const key = s.toLowerCase().trim().slice(0, 60);
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }

  // Check 2: trigram repetition (catches rephrased repetition)
  if (text.length > 200) {
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length >= 6) {
      const trigrams = words.slice(0, -2).map((_, i) => `${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      const counts = new Map<string, number>();
      for (const tg of trigrams) counts.set(tg, (counts.get(tg) ?? 0) + 1);
      if (Math.max(...counts.values()) > 3) return true;
    }
  }

  // Check 3: dominant stem overuse (catches "innovative/innovativen/innovatives" filler)
  // Groups words by 7-char pseudo-stem; flags if any stem > 20% of content words
  const contentWords = text.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  if (contentWords.length >= 20) {
    const stemFreq = new Map<string, number>();
    for (const w of contentWords) {
      const stem = w.slice(0, 7);
      stemFreq.set(stem, (stemFreq.get(stem) ?? 0) + 1);
    }
    const topCount = Math.max(...stemFreq.values());
    if (topCount / contentWords.length > 0.20) return true;
  }

  return false;
}

// ─── Format mismatch ──────────────────────────────────────────────────────────

function hasFormatMismatch(prompt: string, output: string): boolean {
  const p = prompt.toLowerCase();
  const out = output.trim();
  if ((p.includes("json") || p.includes("return a json") || p.includes("as json")) &&
      !out.startsWith("{") && !out.startsWith("[") && !out.includes("```json")) {
    return true;
  }
  if ((p.includes("bullet") || p.includes("list") || p.includes("markdown")) &&
      !out.includes("- ") && !out.includes("* ") && !out.includes("#") && !out.includes("1.")) {
    return true;
  }
  if (p.includes("table") && !out.includes("|") && !out.includes("\t")) {
    return true;
  }
  return false;
}

// ─── Low relevance ────────────────────────────────────────────────────────────

function hasLowRelevance(userContent: string, output: string): boolean {
  // Extract meaningful content words (not stop words)
  const STOP = new Set(["what", "which", "when", "where", "that", "this", "with", "from",
    "have", "should", "could", "would", "there", "their", "about", "between", "unterschied",
    "between", "explain", "please", "describe", "write", "create", "give"]);

  const words = userContent.toLowerCase().split(/\W+/)
    .filter((w) => w.length > 5 && !STOP.has(w));

  if (words.length < 4) return false;

  const outputLower = output.toLowerCase();
  // Check exact match OR prefix match (database ↔ databases)
  const matchCount = words.filter((w) =>
    outputLower.includes(w) || outputLower.includes(w.slice(0, -1))
  ).length;

  // Require at least 2 matches AND 15% overlap (stricter than before)
  return matchCount < 2 || matchCount / words.length < 0.15;
}

// ─── Language mismatch ────────────────────────────────────────────────────────

const DE_MARKERS = new Set(["ich", "du", "wir", "sie", "ist", "sind", "hat", "haben",
  "wird", "werden", "der", "die", "das", "ein", "eine", "und", "oder", "aber",
  "mit", "für", "von", "bei", "nach", "über", "unter", "wie", "was", "wer",
  "bitte", "danke", "auch", "noch", "schon", "sehr", "mehr", "kann", "muss",
  "soll", "darf", "würde", "erkläre", "schreib", "gib", "zeig", "nicht", "beim",
  "wenn", "dann", "dass", "diese", "diesem", "einen", "einem", "einer", "kein",
  "keine", "wird", "wurde", "wurden", "sei", "sind", "waren"]);

const EN_MARKERS = new Set(["the", "and", "you", "are", "this", "that", "with",
  "from", "your", "they", "what", "how", "why", "when", "please", "write", "give",
  "show", "explain", "describe", "create", "while", "instead", "allows", "both",
  "either", "using", "through", "where", "which", "these", "those", "can", "will",
  "being", "have", "their", "into", "than", "been", "were", "there", "here"]);

function detectLanguage(text: string): "de" | "en" | "unknown" {
  const words = text.toLowerCase().replace(/[^a-zäöüß\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 10) return "unknown";
  const deHits = words.filter((w) => DE_MARKERS.has(w)).length;
  const enHits = words.filter((w) => EN_MARKERS.has(w)).length;
  const total = words.length;
  if (deHits / total > 0.05 && deHits > enHits * 1.3) return "de";
  if (enHits / total > 0.05 && enHits > deHits * 1.3) return "en";
  return "unknown";
}

function hasLanguageMismatch(promptText: string, output: string): boolean {
  if (output.length < 80) return false;
  const promptLang = detectLanguage(promptText);
  const outputLang = detectLanguage(output);
  if (promptLang === "unknown" || outputLang === "unknown") return false;
  return promptLang !== outputLang;
}

// ─── Verbose padding ──────────────────────────────────────────────────────────

const FILLER_PHRASES = [
  /it('s| is) important to note that/gi,
  /it('s| is) worth (noting|mentioning) that/gi,
  /as (i|we) (mentioned|stated|noted) (earlier|above|before)/gi,
  /in (conclusion|summary|closing)/gi,
  /to (summarize|sum up|recap)/gi,
  /needless to say/gi,
  /it goes without saying/gi,
  /at the end of the day/gi,
  /wie (bereits|oben|zuvor) (erwähnt|genannt)/gi,
  /zusammenfassend lässt sich sagen/gi,
  /abschließend (möchte ich|lässt sich)/gi,
];

function hasVerbosePadding(output: string): boolean {
  if (output.length < 300) return false;

  // High filler phrase density
  const fillerCount = FILLER_PHRASES.filter((p) => p.test(output)).length;
  if (fillerCount >= 3) return true;

  // Dominant word repetition: top content word > 20% of all content words
  const words = output.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  if (words.length >= 30) {
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    const topCount = Math.max(...freq.values());
    if (topCount / words.length > 0.20) return true;
  }

  return false;
}

// ─── Hallucination risk ───────────────────────────────────────────────────────

// Questions about history/facts/dates legitimately produce specific numbers
const FACTUAL_QUESTION_PATTERNS = [
  /wann (wurde|war|ist|hat|kam)/i,
  /when (was|did|were|is)/i,
  /wie (viel|viele|alt|groß|lang)/i,
  /how (many|much|old|long|far)/i,
  /in welchem jahr/i,
  /founded|invented|released|born|died|established/i,
  /gründ|erfund|veröffentlicht|geboren|gestorben/i,
];

const SPECIFIC_CLAIM_PATTERNS = [
  /\b\d{1,3}[.,]\d+\s*%/g,   // "97.3%"
  /\$\s*\d+[\d,.]*\s*(billion|million|mrd|mio)/gi,
  /\baccording to [A-Z][a-z]+ (study|report|research)/g,
  /\bstudies show that\b/gi,
  /\bforschungen zeigen\b/gi,
  /\blaut (einer )?studie\b/gi,
];

function hasHallucinationRisk(promptText: string, output: string): boolean {
  if (output.length < 100) return false;

  // Exempt factual/historical questions — they're expected to contain specific data
  if (FACTUAL_QUESTION_PATTERNS.some((p) => p.test(promptText))) return false;

  const promptLower = promptText.toLowerCase();
  let riskScore = 0;

  for (const pattern of SPECIFIC_CLAIM_PATTERNS) {
    const matches = [...output.matchAll(pattern)];
    for (const match of matches) {
      if (!promptLower.includes(match[0].toLowerCase())) riskScore++;
    }
  }

  return riskScore >= 2;
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreOutput(messages: ChatMessage[], output: string): ScoringResult {
  const flags: QualityFlags = {
    too_short: false,
    repetitive: false,
    refusal: false,
    format_mismatch: false,
    low_relevance: false,
    language_mismatch: false,
    verbose_padding: false,
    hallucination_risk: false,
  };

  const promptText = messages
    .filter((m) => m.role === "system" || m.role === "user")
    .map((m) => m.content ?? "")
    .join(" ");

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserContent = lastUser?.content ?? "";

  // 1. Too short — threshold scales with prompt complexity
  const promptWordCount = promptText.split(/\s+/).length;
  const minLength = promptWordCount > 15 ? 60 : promptWordCount > 8 ? 10 : 5;
  if (output.trim().length < minLength) flags.too_short = true;

  // 2. Repetition (sentence dedup + trigrams + word dominance)
  if (isRepetitive(output)) flags.repetitive = true;

  // 3. Refusal
  if (REFUSAL_PATTERNS.some((p) => p.test(output))) flags.refusal = true;

  // 4. Format mismatch
  if (hasFormatMismatch(promptText, output)) flags.format_mismatch = true;

  // 5. Low relevance
  if (hasLowRelevance(lastUserContent, output)) flags.low_relevance = true;

  // 6. Language mismatch
  if (hasLanguageMismatch(promptText, output)) flags.language_mismatch = true;

  // 7. Verbose padding
  if (hasVerbosePadding(output)) flags.verbose_padding = true;

  // 8. Hallucination risk
  if (hasHallucinationRisk(promptText, output)) flags.hallucination_risk = true;

  const penalties: Record<keyof QualityFlags, number> = {
    too_short:          0.40,
    refusal:            0.30,
    low_relevance:      0.25,
    hallucination_risk: 0.20,
    format_mismatch:    0.15,
    language_mismatch:  0.15,
    repetitive:         0.15,
    verbose_padding:    0.10,
  };

  let score = 1.0;
  for (const [flag, penalty] of Object.entries(penalties) as [keyof QualityFlags, number][]) {
    if (flags[flag]) score -= penalty;
  }

  return { score: Math.max(0, Math.min(1, score)), flags };
}

// ─── LLM-as-Judge (optional, sampled) ────────────────────────────────────────

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
        messages: [{
          role: "user",
          content: `Rate this AI response 0.0-1.0 (only output the number).\n\nUSER: ${lastUser.content.slice(0, 500)}\n\nAI: ${output.slice(0, 1000)}\n\n0.0=wrong/refused, 0.5=partial, 1.0=excellent`,
        }],
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { content: Array<{ text: string }> };
    const parsed = parseFloat(data.content?.[0]?.text?.trim());
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) onScore(parsed);
  } catch { /* non-fatal */ }
}
