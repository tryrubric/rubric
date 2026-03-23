/**
 * Mini-App 10: Language Drift Detector
 * Sends German prompts expecting German output — tests if the model
 * switches to English unexpectedly. Stress-tests language_mismatch detection.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... GUARD_KEY=gk-... npx tsx examples/language-drift.ts
 */

import OpenAI from "openai";

const GUARD_KEY = process.env.GUARD_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:3000";

if (!GUARD_KEY || !GROQ_KEY) { console.error("Missing GUARD_KEY or GROQ_API_KEY"); process.exit(1); }

const client = new OpenAI({
  apiKey: GROQ_KEY,
  baseURL: `${GUARD_URL}/v1`,
  defaultHeaders: { "x-guard-key": GUARD_KEY, "x-provider": "groq" },
});

const CASES = [
  {
    label: "DE prompt, DE system → should stay German",
    system: "Du bist ein hilfreicher Assistent. Antworte immer auf Deutsch.",
    prompt: "Erkläre mir wie ein Transformer-Modell funktioniert.",
    expectedLang: "de",
  },
  {
    label: "DE prompt, EN system → drift likely",
    system: "You are a helpful assistant. Be concise.",
    prompt: "Erkläre mir wie ein Transformer-Modell funktioniert.",
    expectedLang: "de",
  },
  {
    label: "Technical terms might trigger EN drift",
    system: "Du bist ein Tech-Experte.",
    prompt: "Was ist der Unterschied zwischen fine-tuning und RAG?",
    expectedLang: "de",
  },
  {
    label: "Code request in German",
    system: "Du bist ein erfahrener Entwickler. Antworte auf Deutsch.",
    prompt: "Zeig mir ein Beispiel für einen React useEffect Hook mit cleanup.",
    expectedLang: "de",
  },
  {
    label: "EN prompt, EN system → should stay English (no mismatch)",
    system: "You are a helpful assistant.",
    prompt: "What is the difference between precision and recall?",
    expectedLang: "en",
  },
];

async function testDrift(item: typeof CASES[0]) {
  console.log(`\n🌍 [${item.label}]`);

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: item.system },
      { role: "user", content: item.prompt },
    ],
  });

  const output = response.choices[0].message.content ?? "";

  // Rough local language check for display
  const deMarkers = ["der", "die", "das", "und", "ich", "ein", "ist", "von", "zu", "auf"].filter(w =>
    output.toLowerCase().split(/\s+/).includes(w)
  ).length;
  const enMarkers = ["the", "and", "for", "you", "this", "with", "that", "are", "from"].filter(w =>
    output.toLowerCase().split(/\s+/).includes(w)
  ).length;
  const detectedLang = deMarkers > enMarkers ? "de" : "en";
  const mismatch = detectedLang !== item.expectedLang ? " ⚠ MISMATCH" : " ✓";

  console.log(`  Expected: ${item.expectedLang} | Detected: ${detectedLang}${mismatch}`);
  console.log(`  ${output.slice(0, 150).replace(/\n/g, " ")}...`);
  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (const item of CASES) {
  await testDrift(item);
}
