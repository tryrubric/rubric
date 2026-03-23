/**
 * Mini-App 6: Batch Sentiment & Intent Classifier
 * Classifies customer messages by sentiment, intent, and urgency.
 * Tests: JSON array format, relevance (output must relate to input text),
 * language consistency (German inputs → German labels expected).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... GUARD_KEY=gk-... npx tsx examples/sentiment-batch.ts
 */

import OpenAI from "openai";

const GUARD_KEY = process.env.GUARD_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:3000";

if (!GUARD_KEY || !OPENAI_KEY) { console.error("Missing GUARD_KEY or OPENAI_API_KEY"); process.exit(1); }

const client = new OpenAI({
  apiKey: OPENAI_KEY,
  baseURL: `${GUARD_URL}/v1`,
  defaultHeaders: { "x-guard-key": GUARD_KEY },
});

const MESSAGES = [
  "Ich liebe euer Produkt! Seit ich es nutze spare ich täglich 2 Stunden. Macht weiter so!",
  "Wann kommt endlich Dark Mode?? Ich frage das jetzt schon seit 6 Monaten.",
  "Bitte kündigt meinen Account sofort. Ich wechsle zur Konkurrenz wegen des schlechten Supports.",
  "Kleiner Bug: Wenn ich auf Safari den Export-Button klicke, passiert nichts. Chrome funktioniert.",
  "Habt ihr einen Reseller-Plan? Ich würde gerne 10 Lizenzen für mein Team kaufen.",
  "Mein Passwort wurde möglicherweise kompromittiert. Was soll ich tun?",
];

interface Classification {
  id: number;
  sentiment: "positive" | "neutral" | "negative";
  intent: string;
  urgency: "low" | "medium" | "high" | "critical";
  action_required: boolean;
  summary: string;
}

const SYSTEM = `Classify the following customer messages. Return a JSON array where each item has:
{
  "id": <number matching input>,
  "sentiment": "positive"|"neutral"|"negative",
  "intent": "short description of what the user wants",
  "urgency": "low"|"medium"|"high"|"critical",
  "action_required": true|false,
  "summary": "one sentence summarizing the issue"
}

Return ONLY the JSON array.`;

async function classify(batch: string[]) {
  console.log(`\n📊 Classifying ${batch.length} customer messages...`);

  const numbered = batch.map((msg, i) => `[${i + 1}] ${msg}`).join("\n\n");

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: numbered },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  try {
    const results: Classification[] = JSON.parse(raw);
    const maxIntentLen = Math.max(...results.map((r) => r.intent.length));

    console.log(`\n  ${"ID".padEnd(3)} ${"SENTIMENT".padEnd(10)} ${"URGENCY".padEnd(9)} ${"ACT".padEnd(5)} INTENT`);
    console.log("  " + "─".repeat(70));
    for (const r of results) {
      const sentimentColor = r.sentiment === "positive" ? "✓" : r.sentiment === "negative" ? "✗" : "~";
      const act = r.action_required ? "YES" : "no";
      console.log(
        `  ${String(r.id).padEnd(3)} ${sentimentColor} ${r.sentiment.padEnd(9)} ${r.urgency.padEnd(9)} ${act.padEnd(5)} ${r.intent}`
      );
    }

    const critical = results.filter((r) => r.urgency === "critical" || r.urgency === "high");
    if (critical.length > 0) {
      console.log(`\n  ⚠ ${critical.length} high-priority item(s) need attention`);
    }
  } catch {
    console.log("  ✗ Invalid JSON:", raw.slice(0, 200));
  }

  console.log(`\n  Tokens: ${response.usage?.total_tokens}`);
}

await classify(MESSAGES);
