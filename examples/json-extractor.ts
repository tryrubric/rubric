/**
 * Mini-App 3: Structured Data Extractor
 * Extracts structured JSON from unstructured text. Tests:
 * - Format mismatch (must return valid JSON — strict test)
 * - Low relevance (extracted fields must relate to input)
 * - Edge case: ambiguous or missing data
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... GUARD_KEY=gk-... npx tsx examples/json-extractor.ts
 */

import OpenAI from "openai";

const GUARD_KEY = process.env.GUARD_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GUARD_URL = process.env.GUARD_URL ?? "http://localhost:3000";

if (!GUARD_KEY || !OPENAI_KEY) {
  console.error("Missing GUARD_KEY or OPENAI_API_KEY");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: OPENAI_KEY,
  baseURL: `${GUARD_URL}/v1`,
  defaultHeaders: { "x-guard-key": GUARD_KEY },
});

interface ExtractedJob {
  title: string;
  company: string;
  location: string | null;
  salary_eur_per_month: number | null;
  remote: boolean;
  skills: string[];
}

const JOB_ADS = [
  `Senior TypeScript Engineer (m/w/d) bei TechCorp GmbH in Berlin.
   Wir suchen einen erfahrenen Entwickler für unser Kernprodukt.
   Skills: TypeScript, React, Node.js, PostgreSQL.
   Gehalt: 75.000 - 95.000 EUR/Jahr. Hybrid-Modell, 2 Tage Remote.`,

  `FULLSTACK DEV WANTED – Remote-First-Startup sucht dich!
   Wir sind ein KI-Startup aus München und suchen einen Fullstack-Entwickler.
   Tech-Stack: Next.js, Python, FastAPI, Supabase.
   Kein fixes Gehalt angegeben, equity-basiert.
   100% remote, asynchrone Arbeitskultur.`,

  `Junior Frontend Developer
   Für unser Designstudio in Hamburg suchen wir eine/n Junior-Entwickler/in.
   Wichtig: HTML, CSS, JavaScript, idealerweise Vue.js.
   Einstiegsgehalt 38.000 EUR, nach 6 Monaten Review.
   Vollzeit im Büro, kein Homeoffice.`,
];

const SYSTEM = `Du bist ein präziser Daten-Extraktor. Extrahiere aus der Stellenanzeige die folgenden Felder als reines JSON:

{
  "title": "Job-Titel",
  "company": "Firmenname oder null",
  "location": "Stadt oder null",
  "salary_eur_per_month": Monatsgehalt als Zahl (Mitte der Range) oder null,
  "remote": true/false,
  "skills": ["skill1", "skill2"]
}

Antworte NUR mit dem JSON-Objekt, kein Text davor oder danach.`;

async function extract(ad: string, index: number) {
  console.log(`\n📋 Extracting from Ad #${index + 1}...`);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: ad },
    ],
  });

  const raw = response.choices[0].message.content ?? "";

  // Validate: is it real JSON?
  try {
    const parsed = JSON.parse(raw) as ExtractedJob;
    console.log("✓ Valid JSON extracted:");
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("✗ Invalid JSON output (format_mismatch will be flagged):");
    console.log(raw);
  }

  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (let i = 0; i < JOB_ADS.length; i++) {
  await extract(JOB_ADS[i], i);
}
