/**
 * Mini-App 2: Code Reviewer
 * Reviews code snippets and gives structured feedback. Tests:
 * - Format mismatch (must return markdown with sections)
 * - Relevance (feedback must relate to the code)
 * - Refusal detection (some models refuse "bad" code)
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... GUARD_KEY=gk-... npx tsx examples/code-reviewer.ts
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

const SNIPPETS = [
  {
    label: "Good: TypeScript with types",
    lang: "typescript",
    code: `
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(\`/api/users/\${id}\`);
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return res.json();
}`,
  },
  {
    label: "Bad: SQL injection risk",
    lang: "javascript",
    code: `
function getUser(username) {
  const query = "SELECT * FROM users WHERE name = '" + username + "'";
  return db.execute(query);
}`,
  },
  {
    label: "Bad: memory leak in React",
    lang: "typescript",
    code: `
function DataComponent() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => setData(d)); // no cleanup!
  }, []);
  return <div>{JSON.stringify(data)}</div>;
}`,
  },
  {
    label: "Mediocre: works but not idiomatic",
    lang: "python",
    code: `
def find_duplicates(lst):
  result = []
  for i in range(len(lst)):
    for j in range(i+1, len(lst)):
      if lst[i] == lst[j] and lst[i] not in result:
        result.append(lst[i])
  return result`,
  },
];

const SYSTEM = `Du bist ein erfahrener Senior Engineer. Review den folgenden Code und antworte in diesem Markdown-Format:

## Bewertung
[Kurze Gesamtbewertung in 1-2 Sätzen]

## Probleme
- [Problem 1]
- [Problem 2 falls vorhanden]

## Verbesserungsvorschlag
\`\`\`
[Verbesserter Code oder konkreter Hinweis]
\`\`\`

Sei direkt und konkret.`;

async function reviewCode(snippet: { label: string; lang: string; code: string }) {
  console.log(`\n🔍 Reviewing: ${snippet.label}`);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Reviewe diesen ${snippet.lang}-Code:\n\`\`\`${snippet.lang}\n${snippet.code}\n\`\`\``,
      },
    ],
  });

  console.log(response.choices[0].message.content);
  console.log(`\n✓ Tokens: ${response.usage?.total_tokens}`);
}

for (const snippet of SNIPPETS) {
  await reviewCode(snippet);
}
