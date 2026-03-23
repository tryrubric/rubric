/**
 * Mini-App 7: Email Subject Line Optimizer
 * Takes a cold outreach email body and generates optimized subject lines.
 * Tests: relevance (subjects must match the email body), verbose_padding
 * (subject lines should be short, not padded), repetition detection.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... GUARD_KEY=gk-... npx tsx examples/email-optimizer.ts
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

const EMAILS = [
  {
    context: "SaaS cold outreach to CTOs",
    body: `Hi {{Name}},

ich habe gesehen dass ihr {{Company}} gerade stark wächst — Glückwunsch zur Serie A!

Ich baue AI Quality Guard, ein Tool das LLM-Outputs in Produktion überwacht.
Das Problem: wenn euer AI-Feature anfängt zu halluzinieren, merkt ihr es erst wenn sich Kunden beschweren.

Wir loggen jeden LLM-Call, bewerten den Output automatisch und alertieren bei Qualitätsdrift.
Integration: 1 Zeile Code. Kostenlos bis 10k Calls/Monat.

Hätte ich 15 Minuten für eine kurze Demo?

Viele Grüße`,
  },
  {
    context: "Freelancer pitching to a startup",
    body: `Hey {{Name}},

ich bin Fullstack-Entwickler mit Fokus auf AI-Integrationen und habe gerade euren Job für einen
"Senior AI Engineer" gesehen.

Meine letzten 3 Projekte: RAG-System für ein Legal-Tech-Startup, LLM-Pipeline-Optimierung
bei einem E-Commerce-Unternehmen (30% Kostenreduktion), und eine Custom Evaluation Suite.

Ich bin kein klassischer Angestellter — ich arbeite lieber projektbasiert als Freelancer.
Wenn das für euch passt, würde ich mich freuen von euch zu hören.

Portfolio: [link]`,
  },
  {
    context: "Partnership outreach",
    body: `Hallo {{Name}},

wir sind ein Team das AI-Observability-Tools für Entwickler baut und suchen
Partner die unsere Lösung in ihrem Stack empfehlen.

Unser Affiliate-Programm: 30% recurring commission, eigenes Dashboard, co-Marketing möglich.

Wäre das was für euch? Ich erkläre gerne mehr.`,
  },
];

const SYSTEM = `Du bist ein E-Mail-Marketing-Experte spezialisiert auf B2B-Outreach.

Generiere 5 Subject Lines für die folgende E-Mail. Gib sie als JSON-Array aus:
{
  "subjects": [
    { "text": "Subject Line 1", "type": "curiosity|value|personal|direct|question", "open_rate_score": 7 },
    ...
  ]
}

Regeln:
- Max 60 Zeichen pro Subject Line
- Kein Spam-Wörter (GRATIS, JETZT, dringend)
- Mix aus verschiedenen Ansätzen (curiosity, value prop, personal, direct, question)
- open_rate_score: 1-10 Schätzung der Öffnungsrate
- NUR JSON zurückgeben`;

async function optimizeSubjects(email: typeof EMAILS[0]) {
  console.log(`\n✉ Context: ${email.context}`);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: email.body },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  try {
    const result = JSON.parse(raw) as { subjects: Array<{ text: string; type: string; open_rate_score: number }> };
    const sorted = result.subjects.sort((a, b) => b.open_rate_score - a.open_rate_score);
    for (const s of sorted) {
      const chars = s.text.length;
      const warn = chars > 60 ? " ⚠ too long" : "";
      console.log(`  ${s.open_rate_score}/10  [${s.type.padEnd(8)}]  "${s.text}"${warn}`);
    }
  } catch {
    console.log("  ✗ Invalid JSON:", raw.slice(0, 200));
  }
  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (const email of EMAILS) {
  await optimizeSubjects(email);
}
