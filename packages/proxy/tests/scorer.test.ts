/**
 * Scorer test harness — no API key needed.
 * 42 test cases covering all 8 scoring dimensions + benchmark report.
 */

import { scoreOutput } from "../src/scorer.js";
import type { ChatMessage } from "../src/types.js";

interface TestCase {
  name: string;
  category: string;
  messages: ChatMessage[];
  output: string;
  expect: {
    minScore?: number;
    maxScore?: number;
    flags?: Partial<Record<string, boolean>>;
  };
}

const u = (content: string): ChatMessage[] => [{ role: "user", content }];
const sys = (system: string, user: string): ChatMessage[] => [
  { role: "system", content: system },
  { role: "user", content: user },
];

const CASES: TestCase[] = [

  // ══════════════════════════════════════════════════════════════════
  // TOO SHORT
  // ══════════════════════════════════════════════════════════════════
  {
    category: "too_short",
    name: "single word answer to complex question",
    messages: u("Erkläre mir wie Dependency Injection in TypeScript funktioniert und gib mir ein Beispiel."),
    output: "Nein.",
    expect: { maxScore: 0.8, flags: { too_short: true } },
  },
  {
    category: "too_short",
    name: "empty-ish response",
    messages: u("Was sind die Vor- und Nachteile von Microservices?"),
    output: "Gut.",
    expect: { maxScore: 0.8, flags: { too_short: true } },
  },
  {
    category: "too_short",
    name: "acceptable: short answer to simple question",
    messages: u("Was ist 2 + 2?"),
    output: "Das Ergebnis ist 4.",
    expect: { minScore: 0.85, flags: { too_short: false } },
  },
  {
    category: "too_short",
    name: "acceptable: one-liner for one-liner prompt",
    messages: u("Wie heißt die Hauptstadt von Frankreich?"),
    output: "Paris.",
    expect: { flags: { too_short: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // REFUSAL
  // ══════════════════════════════════════════════════════════════════
  {
    category: "refusal",
    name: "classic cannot help",
    messages: u("Schreib mir einen Blogpost über maschinelles Lernen."),
    output: "I cannot help with that request as it violates my content guidelines.",
    expect: { maxScore: 0.85, flags: { refusal: true } },
  },
  {
    category: "refusal",
    name: "as an AI language model",
    messages: u("Was denkst du darüber?"),
    output: "As an AI language model, I don't have personal opinions or feelings about this topic.",
    expect: { flags: { refusal: true } },
  },
  {
    category: "refusal",
    name: "unable to",
    messages: u("Kannst du mir eine Zusammenfassung geben?"),
    output: "I am unable to provide a summary without the source text to work from.",
    expect: { flags: { refusal: true } },
  },
  {
    category: "refusal",
    name: "no refusal: legitimate answer",
    messages: u("Wie funktioniert ein Neural Network auf hohem Niveau?"),
    output: "Ein Neural Network besteht aus Schichten von Neuronen, die Eingabedaten schrittweise transformieren. Jede Verbindung hat ein Gewicht, das beim Training angepasst wird um den Fehler zu minimieren. Backpropagation berechnet den Gradienten des Fehlers, SGD aktualisiert die Gewichte.",
    expect: { minScore: 0.8, flags: { refusal: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // REPETITIVE
  // ══════════════════════════════════════════════════════════════════
  {
    category: "repetitive",
    name: "exact sentence duplication",
    messages: u("Erkläre Machine Learning."),
    output: [
      "Machine Learning ist ein Teilgebiet der künstlichen Intelligenz.",
      "Machine Learning ermöglicht es Maschinen aus Daten zu lernen.",
      "Machine Learning ist ein Teilgebiet der künstlichen Intelligenz.",
      "Machine Learning wird in vielen Bereichen angewendet.",
      "Machine Learning ist ein Teilgebiet der künstlichen Intelligenz.",
      "Machine Learning hat die Tech-Welt verändert.",
    ].join(" "),
    expect: { flags: { repetitive: true } },
  },
  {
    category: "repetitive",
    name: "marketing filler repetition",
    messages: u("Beschreibe unser Produkt."),
    output: "Unser innovatives Produkt bietet innovative Lösungen für innovative Unternehmen. Mit unserer innovativen Plattform können innovative Teams innovative Ergebnisse erzielen. Unsere innovative Technologie ist die innovativste Lösung auf dem innovativen Markt für innovative Produkte.",
    expect: { flags: { repetitive: true } },
  },
  {
    category: "repetitive",
    name: "no repetition: varied content",
    messages: u("Was ist der Unterschied zwischen supervised und unsupervised learning?"),
    output: "Supervised Learning verwendet beschriftete Daten um ein Modell zu trainieren. Das Modell lernt eine Abbildung von Eingabe auf Ausgabe. Unsupervised Learning hingegen findet Muster ohne Labels — Clustering ist ein typisches Beispiel. Reinforcement Learning bildet ein drittes Paradigma: ein Agent lernt durch Belohnungen und Bestrafungen.",
    expect: { flags: { repetitive: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // FORMAT MISMATCH
  // ══════════════════════════════════════════════════════════════════
  {
    category: "format_mismatch",
    name: "asked JSON, got prose",
    messages: u("Return a JSON object with fields name, age, and email for a sample user."),
    output: "Sure! For a sample user I would suggest using the name John Doe, age 30, and email john@example.com.",
    expect: { flags: { format_mismatch: true } },
  },
  {
    category: "format_mismatch",
    name: "asked JSON, got valid JSON",
    messages: u("Return a JSON object with fields name, age, and email."),
    output: '{"name": "John Doe", "age": 30, "email": "john@example.com"}',
    expect: { flags: { format_mismatch: false } },
  },
  {
    category: "format_mismatch",
    name: "asked bullet list, got prose",
    messages: u("List the main advantages of TypeScript as bullet points."),
    output: "TypeScript offers many advantages. It provides static typing which helps catch errors early. It has excellent IDE support and autocompletion. The code is more maintainable in large projects.",
    expect: { flags: { format_mismatch: true } },
  },
  {
    category: "format_mismatch",
    name: "asked bullet list, got bullets",
    messages: u("List the main advantages of TypeScript as bullet points."),
    output: "- Static typing catches bugs at compile time\n- Excellent IDE support and autocompletion\n- Better maintainability in large codebases\n- Gradual adoption — works with plain JS\n- Rich ecosystem and community",
    expect: { flags: { format_mismatch: false } },
  },
  {
    category: "format_mismatch",
    name: "asked table, got prose",
    messages: u("Create a comparison table of Python, JavaScript, and Go."),
    output: "Python is great for data science. JavaScript runs everywhere. Go is compiled and fast. Each has different use cases and strengths.",
    expect: { flags: { format_mismatch: true } },
  },
  {
    category: "format_mismatch",
    name: "asked table, got table",
    messages: u("Create a comparison table of Python, JavaScript, and Go."),
    output: "| Language   | Typing    | Speed  | Main Use Case     |\n|-----------|-----------|--------|-------------------|\n| Python    | Dynamic   | Slow   | Data Science, AI  |\n| JavaScript| Dynamic   | Fast   | Web, Node.js      |\n| Go        | Static    | Fast   | Backend, CLIs     |",
    expect: { flags: { format_mismatch: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // LOW RELEVANCE
  // ══════════════════════════════════════════════════════════════════
  {
    category: "low_relevance",
    name: "completely off-topic answer",
    messages: u("How do I configure a Kubernetes ingress controller with nginx?"),
    output: "The French Revolution began in 1789 and fundamentally transformed French society through the abolition of feudalism and the declaration of universal rights.",
    expect: { flags: { low_relevance: true } },
  },
  {
    category: "low_relevance",
    name: "on-topic answer",
    messages: u("How do I configure a Kubernetes ingress controller with nginx?"),
    output: "Install the nginx ingress controller via Helm: `helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx`. Then create an Ingress resource that maps your hostname to the backend service. Make sure to annotate it with `kubernetes.io/ingress.class: nginx`.",
    expect: { flags: { low_relevance: false } },
  },
  {
    category: "low_relevance",
    name: "tangentially related but not useful",
    messages: u("What are the best practices for database indexing in PostgreSQL?"),
    output: "Databases are very important in software development. Many companies use databases to store their data. It is important to choose the right database for your use case.",
    expect: { flags: { low_relevance: true } },
  },

  // ══════════════════════════════════════════════════════════════════
  // LANGUAGE MISMATCH
  // ══════════════════════════════════════════════════════════════════
  {
    category: "language_mismatch",
    name: "German prompt, English output",
    messages: u("Erkläre mir bitte wie Quantencomputer funktionieren und was sie von klassischen Computern unterscheidet."),
    output: "Quantum computers use qubits instead of classical bits. While classical bits are either 0 or 1, qubits can exist in superposition, being both simultaneously. This allows quantum computers to solve certain problems exponentially faster than classical computers.",
    expect: { flags: { language_mismatch: true } },
  },
  {
    category: "language_mismatch",
    name: "English prompt, German output",
    messages: u("Please explain how REST APIs work and give me a simple example."),
    output: "REST APIs sind eine standardisierte Methode für Webservices. Sie verwenden HTTP-Methoden wie GET, POST, PUT und DELETE. Jede Ressource hat eine eindeutige URL. Ein Beispiel wäre GET /users/123 um einen bestimmten User abzurufen.",
    expect: { flags: { language_mismatch: true } },
  },
  {
    category: "language_mismatch",
    name: "German prompt, German output — no mismatch",
    messages: u("Wie funktioniert ein Proxy-Server und welche Vorteile hat er?"),
    output: "Ein Proxy-Server ist ein Vermittler zwischen Client und Zielserver. Er leitet Anfragen weiter und kann dabei Caching, Lastverteilung und Sicherheitsprüfungen durchführen. Vorteile: Anonymität, Performance durch Caching, zentrale Zugriffskontrolle.",
    expect: { flags: { language_mismatch: false } },
  },
  {
    category: "language_mismatch",
    name: "English prompt, English output — no mismatch",
    messages: u("What are the main differences between REST and GraphQL APIs?"),
    output: "REST uses multiple endpoints, each returning fixed data shapes. GraphQL uses a single endpoint where the client specifies exactly what data it needs. REST is simpler to cache; GraphQL avoids over-fetching. Choose REST for simple CRUD, GraphQL for complex data requirements.",
    expect: { flags: { language_mismatch: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // VERBOSE PADDING
  // ══════════════════════════════════════════════════════════════════
  {
    category: "verbose_padding",
    name: "high filler phrase density",
    messages: u("Was ist Docker?"),
    output: "It is important to note that Docker is a containerization platform. Needless to say, containers are very useful. It goes without saying that Docker has changed modern development. As I mentioned earlier, containers are isolated environments. It is worth noting that Docker uses images. In conclusion, it is important to note that Docker is widely used. To summarize what I have said above, Docker is a tool for containers. At the end of the day, Docker simplifies deployment significantly.",
    expect: { flags: { verbose_padding: true } },
  },
  {
    category: "verbose_padding",
    name: "low lexical diversity",
    messages: u("Describe the benefits of cloud computing for enterprises."),
    output: "Cloud computing gives many benefits. Cloud computing is very beneficial. These cloud benefits are good for companies. Companies benefit from cloud. The cloud provides company benefits. Enterprise cloud benefits include cloud scalability. Cloud scales well for enterprise. Enterprise companies use cloud for benefits. Cloud benefits enterprises because cloud is beneficial. The benefits of cloud for enterprise are cloud benefits.",
    expect: { flags: { verbose_padding: true } },
  },
  {
    category: "verbose_padding",
    name: "long but high-quality content",
    messages: u("Erkläre ausführlich wie der JavaScript Event Loop funktioniert."),
    output: "Der JavaScript Event Loop ist das Herzstück der asynchronen Programmierung in Node.js und im Browser. JavaScript ist single-threaded — es gibt nur einen Call Stack, der Funktionen ausführt.\n\nWenn eine asynchrone Operation (setTimeout, fetch, I/O) aufgerufen wird, wird sie aus dem Call Stack genommen und vom Browser/Node.js verwaltet. Nach Abschluss landet der Callback in der Callback Queue.\n\nDer Event Loop prüft kontinuierlich: Ist der Call Stack leer? Wenn ja, nimmt er den nächsten Callback aus der Queue und legt ihn auf den Stack. Die Microtask Queue (Promises, queueMicrotask) hat dabei Priorität über die Macrotask Queue (setTimeout, setInterval).\n\nPraktische Konsequenz: Ein blockierender Loop würde die gesamte App einfrieren, weil keine Callbacks verarbeitet werden können. Deshalb ist non-blocking I/O so wichtig.",
    expect: { minScore: 0.7, flags: { verbose_padding: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // HALLUCINATION RISK
  // ══════════════════════════════════════════════════════════════════
  {
    category: "hallucination_risk",
    name: "specific statistics not in prompt",
    messages: u("Wie schnell wächst der KI-Markt?"),
    output: "Der KI-Markt wächst sehr stark. Studies show that the market increased by 47.3% in 2023. Laut einer Studie wird der Markt bis 2028 auf $847.2 billion anwachsen. Forschungen zeigen dass 94.7% der Unternehmen bereits KI nutzen. According to the McKinsey study, productivity increased by 38.2%.",
    expect: { flags: { hallucination_risk: true } },
  },
  {
    category: "hallucination_risk",
    name: "year mentioned not in prompt context",
    messages: u("Wann wurde Python erfunden?"),
    output: "Python wurde von Guido van Rossum entwickelt und erstmals 1991 veröffentlicht. Die Sprache wurde von ABC beeinflusst. Python 2.0 wurde im Jahr 2000 veröffentlicht. Python 3.0 folgte im Jahr 2008.",
    expect: { flags: { hallucination_risk: false } }, // years in prompt context are expected for historical questions
  },
  {
    category: "hallucination_risk",
    name: "grounded response with no hallucination risk",
    messages: u("Was sind die Vorteile von TypeScript gegenüber JavaScript?"),
    output: "TypeScript bietet statische Typisierung, die Fehler schon zur Compile-Zeit aufdeckt. Das verbessert die IDE-Unterstützung erheblich: Autocomplete, Refactoring und Navigation funktionieren zuverlässiger. Der Code ist besser dokumentiert und leichter zu verstehen. Gleichzeitig ist TypeScript vollständig kompatibel mit JavaScript — jede JS-Datei ist valides TypeScript.",
    expect: { flags: { hallucination_risk: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // PERFECT OUTPUTS (should score high across the board)
  // ══════════════════════════════════════════════════════════════════
  {
    category: "perfect",
    name: "detailed technical explanation",
    messages: u("Erkläre mir wie Hono.js funktioniert und warum es schnell ist."),
    output: "Hono.js ist ein ultraschnelles Web-Framework für Edge-Runtimes. Es verwendet einen RadixTree-Router mit O(1)-Lookup — deutlich schneller als Regex-basierte Router. Hono unterstützt Cloudflare Workers, Bun, Deno und Node.js nativ ohne Overhead. Die API ist Express-ähnlich, aber durch konsequentes Vermeiden von Heap-Allokationen deutlich performanter. Im Benchmark schlägt Hono Express um Faktor 10+.",
    expect: { minScore: 0.8 },
  },
  {
    category: "perfect",
    name: "structured markdown response",
    messages: u("Was sind die Unterschiede zwischen var, let und const in JavaScript?"),
    output: "## var, let, const in JavaScript\n\n**var** — funktions-scoped, hoisting, kann mehrfach deklariert werden. Veraltet.\n\n**let** — block-scoped, kein hoisting, kann neu zugewiesen werden. Für veränderliche Werte.\n\n**const** — block-scoped, muss bei Deklaration initialisiert werden, kann nicht neu zugewiesen werden.\n\n> Faustregel: immer `const`, nur `let` wenn nötig, `var` nie.",
    expect: { minScore: 0.8 },
  },
  {
    category: "perfect",
    name: "code with explanation",
    messages: u("Write a TypeScript function that debounces another function."),
    output: "```typescript\nfunction debounce<T extends (...args: unknown[]) => void>(\n  fn: T,\n  delay: number\n): (...args: Parameters<T>) => void {\n  let timer: ReturnType<typeof setTimeout>;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delay);\n  };\n}\n\n// Usage\nconst debouncedSearch = debounce((query: string) => fetch(`/search?q=${query}`), 300);\n```\n\nThe function clears any pending timer on each call, only executing after `delay` ms of inactivity.",
    expect: { minScore: 0.75 },
  },
  {
    category: "perfect",
    name: "system prompt respected",
    messages: sys(
      "Du bist ein Experte für Cloud-Architektur. Antworte präzise auf Deutsch.",
      "Wann sollte ich Serverless vs. Container-basierte Architektur wählen?"
    ),
    output: "Serverless (Lambda, Cloud Run) wählen wenn: Event-getriggerte Workloads, unvorhersagbarer Traffic, keine Operational-Overhead. Container (ECS, Kubernetes) wählen wenn: lange laufende Prozesse, State nötig, volle Kontrolle über Runtime, Vendor-Lock-in vermeiden. Serverless ist günstiger bei niedrigem Traffic, Container bei konstant hohem Durchsatz.",
    expect: { minScore: 0.8, flags: { language_mismatch: false, refusal: false } },
  },

  // ══════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ══════════════════════════════════════════════════════════════════
  {
    category: "edge",
    name: "code-only response",
    messages: u("Write a Python one-liner to flatten a nested list."),
    output: "[item for sublist in nested for item in sublist]",
    expect: { flags: { too_short: false, refusal: false } },
  },
  {
    category: "edge",
    name: "multi-turn context",
    messages: [
      { role: "user", content: "Ich baue eine REST API mit Node.js." },
      { role: "assistant", content: "Welches Framework verwendest du — Express, Fastify oder Hono?" },
      { role: "user", content: "Hono. Wie setze ich JWT-Auth um?" },
    ],
    output: "Mit Hono kannst du JWT-Auth so implementieren:\n```ts\nimport { Hono } from 'hono'\nimport { jwt } from 'hono/jwt'\n\nconst app = new Hono()\napp.use('/api/*', jwt({ secret: process.env.JWT_SECRET! }))\n```\nDer Middleware verifiziert den Bearer-Token automatisch.",
    expect: { minScore: 0.75, flags: { refusal: false, language_mismatch: false } },
  },
  {
    category: "edge",
    name: "mixed language content (code with comments)",
    messages: u("Gib mir ein TypeScript Beispiel für einen API call."),
    output: "```typescript\n// Fetch user from API\nasync function getUser(id: string) {\n  const response = await fetch(`/api/users/${id}`);\n  if (!response.ok) throw new Error('Failed to fetch');\n  return response.json();\n}\n```\n\nDiese Funktion macht einen einfachen GET-Request und gibt die JSON-Antwort zurück.",
    expect: { flags: { language_mismatch: false } }, // code snippets are exempt
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

let passed = 0;
let failed = 0;
const failures: string[] = [];
const categoryStats: Record<string, { pass: number; fail: number; scores: number[] }> = {};
const allScores: number[] = [];

console.log(`\n${BOLD}📊 AI Quality Guard — Scorer Test Suite${RESET}\n`);
console.log("─".repeat(70));

for (const tc of CASES) {
  const { score, flags } = scoreOutput(tc.messages, tc.output);
  const issues: string[] = [];

  if (tc.expect.minScore !== undefined && score < tc.expect.minScore) {
    issues.push(`score ${(score * 100).toFixed(0)}% < min ${(tc.expect.minScore * 100).toFixed(0)}%`);
  }
  if (tc.expect.maxScore !== undefined && score > tc.expect.maxScore) {
    issues.push(`score ${(score * 100).toFixed(0)}% > max ${(tc.expect.maxScore * 100).toFixed(0)}%`);
  }
  if (tc.expect.flags) {
    for (const [flag, expected] of Object.entries(tc.expect.flags)) {
      const actual = (flags as Record<string, boolean>)[flag];
      if (actual !== expected) {
        issues.push(`'${flag}' is ${actual} (expected ${expected})`);
      }
    }
  }

  const activeFlags = Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
  const cat = tc.category;
  if (!categoryStats[cat]) categoryStats[cat] = { pass: 0, fail: 0, scores: [] };
  categoryStats[cat].scores.push(score);
  allScores.push(score);

  if (issues.length === 0) {
    passed++;
    categoryStats[cat].pass++;
    console.log(`${GREEN}✓${RESET} ${DIM}[${cat}]${RESET} ${tc.name}`);
    console.log(`  ${DIM}score: ${(score * 100).toFixed(0)}%  flags: [${activeFlags}]${RESET}`);
  } else {
    failed++;
    categoryStats[cat].fail++;
    failures.push(tc.name);
    console.log(`${RED}✗${RESET} ${DIM}[${cat}]${RESET} ${tc.name}`);
    console.log(`  ${DIM}score: ${(score * 100).toFixed(0)}%  flags: [${activeFlags}]${RESET}`);
    for (const issue of issues) {
      console.log(`  ${YELLOW}→ ${issue}${RESET}`);
    }
  }
}

// ─── Benchmark Report ─────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(70));
console.log(`\n${BOLD}BENCHMARK REPORT${RESET}\n`);

console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : RESET}${failed} failed${RESET}  / ${CASES.length} total\n`);

console.log(`${BOLD}By category:${RESET}`);
const catPad = Math.max(...Object.keys(categoryStats).map((k) => k.length));
for (const [cat, stats] of Object.entries(categoryStats)) {
  const avg = stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length;
  const status = stats.fail === 0 ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(
    `  ${status} ${cat.padEnd(catPad)}  ${stats.pass}/${stats.pass + stats.fail} passed  avg score: ${(avg * 100).toFixed(0)}%`
  );
}

const avgAll = allScores.reduce((a, b) => a + b, 0) / allScores.length;
const minScore = Math.min(...allScores);
const maxScore = Math.max(...allScores);
console.log(`\n${BOLD}Score distribution across all test cases:${RESET}`);
console.log(`  avg: ${(avgAll * 100).toFixed(1)}%  min: ${(minScore * 100).toFixed(0)}%  max: ${(maxScore * 100).toFixed(0)}%`);

// Score histogram
const buckets = [0, 20, 40, 60, 80, 100];
console.log(`\n${BOLD}Score histogram:${RESET}`);
for (let i = 0; i < buckets.length - 1; i++) {
  const lo = buckets[i], hi = buckets[i + 1];
  const count = allScores.filter((s) => s * 100 >= lo && s * 100 < hi).length;
  const bar = "█".repeat(count * 2);
  console.log(`  ${String(lo).padStart(3)}-${hi}%  ${CYAN}${bar}${RESET} ${count}`);
}

if (failures.length > 0) {
  console.log(`\n${BOLD}${RED}Failed:${RESET}`);
  for (const f of failures) console.log(`  ${RED}✗${RESET} ${f}`);
}

console.log();
process.exit(failed > 0 ? 1 : 0);
