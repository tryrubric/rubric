/**
 * Mini-App 1: Article Summarizer
 * Summarizes articles/texts in German. Tests:
 * - Relevance (does the summary match the article?)
 * - Format (structured output with title + bullets)
 * - Length (not too short for long input)
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... GUARD_KEY=gk-... npx tsx examples/summarizer.ts
 */

import OpenAI from "openai";

const GUARD_KEY = process.env.GUARD_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:3000";

if (!GUARD_KEY || !GROQ_KEY) {
  console.error("Missing GUARD_KEY or GROQ_API_KEY");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: GROQ_KEY,
  baseURL: `${GUARD_URL}/v1`,
  defaultHeaders: { "x-guard-key": GUARD_KEY, "x-provider": "groq" },
});

const ARTICLES = [
  {
    title: "KI in der Medizin",
    text: `Künstliche Intelligenz revolutioniert die Medizin. In der Radiologie können KI-Systeme
    Tumoren auf Röntgenbildern mit einer Genauigkeit erkennen, die menschliche Radiologen
    teilweise übertrifft. In der Pharmakologie beschleunigt KI die Wirkstoffentwicklung erheblich —
    was früher Jahre dauerte, ist jetzt in Monaten möglich. Gleichzeitig gibt es Bedenken:
    Datenschutz, Haftung bei Fehldiagnosen und die Frage, ob Ärzte KI-Empfehlungen blind vertrauen
    sollten. Experten sind sich einig: KI wird Ärzte nicht ersetzen, sondern ihr bestes Werkzeug werden.`,
  },
  {
    title: "Der Aufstieg von Rust",
    text: `Rust ist die beliebteste Programmiersprache bei Entwicklern — zum achten Mal in Folge laut
    Stack Overflow Survey. Was macht sie so besonders? Memory safety ohne Garbage Collector.
    Rust erzwingt Speichersicherheit zur Compile-Zeit durch das Ownership-System, was Buffer Overflows
    und Use-after-free-Bugs eliminiert. Microsoft, Google und die Linux Foundation setzen bereits auf
    Rust für sicherheitskritische Komponenten. Der einzige Nachteil: die steile Lernkurve.
    Entwickler berichten von Wochen bis Monaten, bis das Ownership-Konzept "klick" macht.`,
  },
  {
    title: "Homeoffice-Trends 2026",
    text: `Nach dem großen Remote-Work-Experiment der Pandemie haben sich Unternehmen neu orientiert.
    Hybrid-Modelle dominieren: drei Tage im Büro, zwei remote — oder umgekehrt. Vollständiges
    Remote-Work ist selten geworden, vor allem bei großen Unternehmen. Interessant: Startups
    hingegen setzen weiterhin stark auf Fully-Remote, da sie dadurch weltweit Talente rekrutieren
    können. Die Produktivitätsforschung zeigt gemischte Ergebnisse — es kommt stark auf den
    Job-Typ und die persönliche Präferenz an.`,
  },
];

async function summarize(article: { title: string; text: string }) {
  console.log(`\n📄 Summarizing: "${article.title}"...`);

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content:
          "Du bist ein präziser Redakteur. Fasse Artikel in strukturiertem Markdown zusammen: " +
          "Titel als ## Überschrift, dann 3-5 bullet points mit den wichtigsten Punkten, " +
          "dann ein kurzer Satz als Fazit.",
      },
      {
        role: "user",
        content: `Fasse diesen Artikel zusammen:\n\n${article.text}`,
      },
    ],
  });

  const summary = response.choices[0].message.content;
  console.log(summary);
  console.log(`\n✓ Tokens: ${response.usage?.total_tokens} | Quality score visible in dashboard`);
}

for (const article of ARTICLES) {
  await summarize(article);
}
