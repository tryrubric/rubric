/**
 * Mini-App 5: Meeting Notes → Action Items Extractor
 * Extracts structured action items from messy meeting transcripts.
 * Tests: relevance (items must be from the transcript), JSON format,
 * verbose_padding (LLMs often over-explain here).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... GUARD_KEY=gk-... npx tsx examples/meeting-notes.ts
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

const TRANSCRIPTS = [
  {
    title: "Produkt-Review Q1",
    text: `
Thomas: Also ich finde wir sollten das Dashboard überarbeiten, die Ladezeit ist zu lang.
Sarah: Ja stimmt. Ich kann mich darum kümmern, aber ich brauche die Daten vom Backend-Team.
Thomas: Klar, ich schreibe Max heute noch an. Bis Freitag sollte das klappen.
Sarah: Super. Dann kann ich nächste Woche mit der Optimierung anfangen.
Thomas: Achja, das Pricing-Meeting mit den Investoren — wer bereitet das vor?
Sarah: Das übernehme ich. Bis Mittwoch habe ich die Slides fertig.
Thomas: Perfekt. Dann sind wir für den Monat gut aufgestellt.
    `,
  },
  {
    title: "Tech Debt Sprint Planning",
    text: `
Dev 1: Wir müssen endlich die Node 18 → 22 Migration angehen. Das blockiert uns schon 3 Monate.
Dev 2: Ich hab letzte Woche ein Dokument geschrieben, das ist im Confluence.
Dev 1: Ja das hab ich gesehen, ist gut. Kannst du einen Branch aufmachen und anfangen?
Dev 2: Mache ich. Ich brauch aber jemanden der die Tests reviewed — die werden sich ändern.
Dev 3: Ich mache das Review. Schick mir einfach den PR wenn er ready ist.
Dev 1: Und das SQLite zu Postgres Thema — haben wir da schon einen Plan?
Dev 2: Noch nicht. Ich würde vorschlagen das als separates Epic zu tracken.
Dev 1: Agreed. Ich erstelle heute noch das Epic in Linear.
    `,
  },
];

const SYSTEM = `Du bist ein präziser Assistent für Meeting-Nachbereitung.
Extrahiere alle Action Items aus dem Meeting-Transkript als JSON-Array.

Schema:
[
  {
    "task": "Was genau zu tun ist",
    "owner": "Name der Person",
    "deadline": "Bis wann (oder null wenn nicht erwähnt)",
    "priority": "high|medium|low"
  }
]

Nur explizit erwähnte Action Items extrahieren. Keine Inferenzen.
Antworte NUR mit dem JSON-Array.`;

async function extractActions(transcript: typeof TRANSCRIPTS[0]) {
  console.log(`\n📋 Meeting: "${transcript.title}"`);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: transcript.text.trim() },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  try {
    const items = JSON.parse(raw);
    console.log(`  ${items.length} action items found:`);
    for (const item of items) {
      const deadline = item.deadline ? ` (bis: ${item.deadline})` : "";
      console.log(`  [${item.priority.toUpperCase()}] ${item.owner}: ${item.task}${deadline}`);
    }
  } catch {
    console.log("  ✗ Invalid JSON. Raw output:", raw.slice(0, 200));
  }
  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (const transcript of TRANSCRIPTS) {
  await extractActions(transcript);
}
