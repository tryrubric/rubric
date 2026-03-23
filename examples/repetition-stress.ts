/**
 * Mini-App 11: Repetition & Padding Stress Test
 * Prompts that tend to produce repetitive or padded outputs.
 * Tests: repetitive, verbose_padding scorer dimensions.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... GUARD_KEY=gk-... npx tsx examples/repetition-stress.ts
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
    label: "List request (often padded)",
    system: "Du bist ein hilfreicher Assistent.",
    prompt: "Gib mir 10 Tipps wie ich produktiver arbeiten kann.",
  },
  {
    label: "Explain to beginner (over-explanation risk)",
    system: "Erkläre Konzepte sehr ausführlich für Anfänger.",
    prompt: "Was ist eine API?",
  },
  {
    label: "Marketing copy (repetition risk)",
    system: "Du bist ein Marketing-Texter. Schreibe überzeugenden Content.",
    prompt: "Schreibe einen Absatz über unser innovatives KI-Produkt das Unternehmen transformiert.",
  },
  {
    label: "Comparison (tends to repeat structure)",
    system: "Du bist ein Tech-Analyst.",
    prompt: "Vergleiche Python und JavaScript für Backend-Entwicklung.",
  },
  {
    label: "Concise system prompt (should NOT pad)",
    system: "Antworte immer in maximal 2 Sätzen. Keine Füllwörter.",
    prompt: "Was ist der Unterschied zwischen supervised und unsupervised learning?",
  },
];

async function stressTest(item: typeof CASES[0]) {
  console.log(`\n📝 [${item.label}]`);

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: item.system },
      { role: "user", content: item.prompt },
    ],
  });

  const output = response.choices[0].message.content ?? "";
  const wordCount = output.split(/\s+/).length;
  console.log(`  ${wordCount} words | ${output.length} chars`);
  console.log(`  ${output.slice(0, 200).replace(/\n/g, " ")}...`);
  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (const item of CASES) {
  await stressTest(item);
}
