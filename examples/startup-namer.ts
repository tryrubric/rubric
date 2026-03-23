/**
 * Mini-App 4: Startup Name Generator
 * Generates startup name ideas with rationale as structured JSON.
 * Tests: JSON format strictness, language consistency, hallucination risk
 * (no fake stats should be invented for a name suggestion).
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... GUARD_KEY=gk-... npx tsx examples/startup-namer.ts
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

interface NameIdea {
  name: string;
  domain: string;       // e.g. "traceflow.io"
  tagline: string;
  rationale: string;
  score: number;        // 1-10 how good the name is
}

const BRIEFS = [
  {
    description: "An AI LLM output quality monitoring tool — like Sentry but for AI responses",
    audience: "Solo developers and small startups using LLMs in production",
    vibe: "Technical, trustworthy, modern",
  },
  {
    description: "A marketplace connecting freelance ML engineers with companies",
    audience: "ML engineers looking for projects, companies needing AI talent",
    vibe: "Professional, community-focused",
  },
  {
    description: "A tool that auto-generates documentation from code comments and git history",
    audience: "Developer teams that hate writing docs",
    vibe: "Developer-friendly, slightly playful",
  },
];

const SYSTEM = `You are a startup naming expert. Generate exactly 3 startup name ideas as a JSON array.

Each idea must follow this schema:
[
  {
    "name": "StartupName",
    "domain": "startupname.io",
    "tagline": "One memorable sentence",
    "rationale": "Why this name works (2-3 sentences)",
    "score": 8
  }
]

Rules:
- Names must be 1-2 words, memorable, easy to spell
- Domain should be .io or .dev
- Score 1-10 based on memorability, availability likelihood, relevance
- Return ONLY the JSON array, no markdown, no explanation`;

async function generateNames(brief: typeof BRIEFS[0], index: number) {
  console.log(`\n🚀 Brief #${index + 1}: ${brief.description.slice(0, 50)}...`);

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Product: ${brief.description}\nAudience: ${brief.audience}\nVibe: ${brief.vibe}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "";
  try {
    const parsed = JSON.parse(raw);
    const ideas: NameIdea[] = Array.isArray(parsed) ? parsed : parsed.ideas ?? parsed.names ?? [];
    for (const idea of ideas) {
      console.log(`  ${idea.score}/10  ${idea.name} (${idea.domain}) — "${idea.tagline}"`);
    }
  } catch {
    console.log("  ✗ Invalid JSON:", raw.slice(0, 100));
  }
  console.log(`  Tokens: ${response.usage?.total_tokens}`);
}

for (let i = 0; i < BRIEFS.length; i++) {
  await generateNames(BRIEFS[i], i);
}
