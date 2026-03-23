/**
 * Scorer test harness — no API key needed.
 * Runs 25 test cases covering all scoring dimensions and prints a report.
 */

import { scoreOutput } from "../src/scorer.js";
import type { ChatMessage } from "../src/types.js";

interface TestCase {
  name: string;
  messages: ChatMessage[];
  output: string;
  expect: {
    minScore?: number;
    maxScore?: number;
    flags?: Partial<Record<string, boolean>>;
  };
}

const CASES: TestCase[] = [
  // ── too_short ──────────────────────────────────────────────────────────────
  {
    name: "too_short: single word",
    messages: [{ role: "user", content: "Erkläre mir das Konzept von Dependency Injection in TypeScript." }],
    output: "Nein.",
    expect: { maxScore: 0.7, flags: { too_short: true } },
  },
  {
    name: "too_short: empty-ish",
    messages: [{ role: "user", content: "Was sind die Vorteile von TypeScript?" }],
    output: "Gut.",
    expect: { maxScore: 0.7, flags: { too_short: true } },
  },
  {
    name: "too_short: acceptable short answer",
    messages: [{ role: "user", content: "Was ist 2 + 2?" }],
    output: "Das Ergebnis ist 4.",
    expect: { minScore: 0.6, flags: { too_short: false } },
  },

  // ── refusal ────────────────────────────────────────────────────────────────
  {
    name: "refusal: classic pattern",
    messages: [{ role: "user", content: "Schreib mir einen Blogpost über KI." }],
    output: "I cannot help with that request as it violates my content guidelines.",
    expect: { maxScore: 0.8, flags: { refusal: true } },
  },
  {
    name: "refusal: as an AI",
    messages: [{ role: "user", content: "Was denkst du über dieses Thema?" }],
    output: "As an AI language model, I don't have personal opinions or feelings.",
    expect: { flags: { refusal: true } },
  },
  {
    name: "refusal: unable to",
    messages: [{ role: "user", content: "Kannst du mir eine Zusammenfassung geben?" }],
    output: "I am unable to provide a summary without the source text.",
    expect: { flags: { refusal: true } },
  },
  {
    name: "no refusal: legitimate helpful answer",
    messages: [{ role: "user", content: "Wie funktioniert ein Neural Network?" }],
    output: "Ein Neural Network besteht aus Schichten von Neuronen, die Eingabedaten verarbeiten. Jede Verbindung hat ein Gewicht, das während des Trainings angepasst wird, um den Fehler zu minimieren.",
    expect: { minScore: 0.6, flags: { refusal: false } },
  },

  // ── repetitive ─────────────────────────────────────────────────────────────
  {
    name: "repetitive: repeated sentences",
    messages: [{ role: "user", content: "Erkläre mir was Machine Learning ist." }],
    output: [
      "Machine Learning ist ein Teilgebiet der KI.",
      "Machine Learning ermöglicht es Maschinen zu lernen.",
      "Machine Learning ist ein Teilgebiet der KI.",
      "Machine Learning wird in vielen Bereichen eingesetzt.",
      "Machine Learning ist ein Teilgebiet der KI.",
      "Machine Learning ist sehr wichtig für die Zukunft.",
    ].join(" "),
    expect: { maxScore: 0.9, flags: { repetitive: true } },
  },
  {
    name: "not repetitive: rich varied content",
    messages: [{ role: "user", content: "Was ist der Unterschied zwischen supervised und unsupervised learning?" }],
    output: "Supervised Learning verwendet beschriftete Trainingsdaten, um ein Modell zu trainieren. Unsupervised Learning hingegen findet Muster ohne vorgegebene Labels. Ein drittes Paradigma ist Reinforcement Learning, bei dem ein Agent durch Belohnungen lernt. Jedes hat seine eigenen Anwendungsfälle und Stärken.",
    expect: { minScore: 0.6, flags: { repetitive: false } },
  },

  // ── format_mismatch ────────────────────────────────────────────────────────
  {
    name: "format_mismatch: asked for JSON, got prose",
    messages: [{ role: "user", content: "Return a JSON object with name and age fields for a sample user." }],
    output: "Sure! I would suggest using the name John and the age 30 for your sample user.",
    expect: { flags: { format_mismatch: true } },
  },
  {
    name: "format_mismatch: asked for JSON, got JSON",
    messages: [{ role: "user", content: "Return a JSON object with name and age fields." }],
    output: '{"name": "John", "age": 30}',
    expect: { flags: { format_mismatch: false } },
  },
  {
    name: "format_mismatch: asked for JSON array, got array",
    messages: [{ role: "user", content: "Give me a JSON array of 3 colors." }],
    output: '["red", "green", "blue"]',
    expect: { flags: { format_mismatch: false } },
  },
  {
    name: "format_mismatch: asked for markdown bullets, got prose",
    messages: [{ role: "user", content: "List the main bullet points of agile development as markdown." }],
    output: "Agile development focuses on iterative progress, collaboration, and flexibility. Teams work in short sprints and adapt to change quickly.",
    expect: { flags: { format_mismatch: true } },
  },
  {
    name: "format_mismatch: asked for bullets, got bullets",
    messages: [{ role: "user", content: "List the main benefits of agile as bullet points." }],
    output: "- Schnellere Lieferung\n- Bessere Anpassungsfähigkeit\n- Engere Zusammenarbeit\n- Kontinuierliches Feedback",
    expect: { flags: { format_mismatch: false } },
  },

  // ── low_relevance ──────────────────────────────────────────────────────────
  {
    name: "low_relevance: completely off-topic",
    messages: [{ role: "user", content: "How do I configure a Kubernetes ingress controller?" }],
    output: "The French Revolution began in 1789 and fundamentally transformed French society through the abolition of feudalism.",
    expect: { flags: { low_relevance: true } },
  },
  {
    name: "low_relevance: on-topic answer",
    messages: [{ role: "user", content: "How do I configure a Kubernetes ingress controller?" }],
    output: "To configure a Kubernetes ingress controller, first install it using Helm: `helm install ingress-nginx ingress-nginx/ingress-nginx`. Then create an Ingress resource that maps hostnames to your services.",
    expect: { flags: { low_relevance: false } },
  },

  // ── good outputs (should score high) ──────────────────────────────────────
  {
    name: "perfect: detailed technical answer",
    messages: [{ role: "user", content: "Erkläre mir wie Hono.js funktioniert und warum es schnell ist." }],
    output: "Hono.js ist ein ultraschnelles Web-Framework für Edge-Runtimes. Es verwendet einen RadixTree-Router, der O(1)-Lookup bietet und deutlich schneller ist als reguläre Ausdrücke. Hono unterstützt Cloudflare Workers, Bun, Deno und Node.js nativ und kompiliert zu minimalem Overhead. Die API ist Express-ähnlich, aber deutlich performanter durch konsequentes Vermeiden von Speicherallokationen.",
    expect: { minScore: 0.7 },
  },
  {
    name: "perfect: structured response with examples",
    messages: [{ role: "user", content: "Was sind die Unterschiede zwischen var, let und const in JavaScript?" }],
    output: "In JavaScript gibt es drei Arten von Variablen-Deklarationen:\n\n- **var**: Funktions-scoped, hoisting, kann mehrfach deklariert werden. Veraltet.\n- **let**: Block-scoped, kein hoisting, kann neu zugewiesen werden. Bevorzugt für veränderliche Werte.\n- **const**: Block-scoped, muss beim Deklarieren initialisiert werden, kann nicht neu zugewiesen werden. Bevorzugt für Konstanten.\n\nFaustregel: immer `const`, nur `let` wenn nötig, `var` nie.",
    expect: { minScore: 0.7 },
  },

  // ── edge cases ─────────────────────────────────────────────────────────────
  {
    name: "edge: code block response",
    messages: [{ role: "user", content: "Write a TypeScript function that reverses a string." }],
    output: "```typescript\nfunction reverseString(str: string): string {\n  return str.split('').reverse().join('');\n}\n\nconsole.log(reverseString('hello')); // 'olleh'\n```",
    expect: { minScore: 0.6, flags: { too_short: false, refusal: false } },
  },
  {
    name: "edge: long repetitive marketing text",
    messages: [{ role: "user", content: "Beschreibe unser Produkt." }],
    output: [
      "Unser Produkt ist das beste Produkt auf dem Markt.",
      "Unser Produkt bietet die beste Qualität auf dem Markt.",
      "Unser Produkt ist das beste Produkt auf dem Markt.",
      "Unser Produkt hat die beste Performance auf dem Markt.",
      "Unser Produkt ist das beste Produkt auf dem Markt.",
      "Unser Produkt bietet den besten Service auf dem Markt.",
    ].join(" "),
    expect: { flags: { repetitive: true } },
  },
  {
    name: "edge: system prompt context respected",
    messages: [
      { role: "system", content: "Du bist ein hilfreicher Assistent der immer auf Deutsch antwortet." },
      { role: "user", content: "Was ist Quantencomputing?" },
    ],
    output: "Quantencomputing nutzt Quantenmechanik, um Berechnungen durchzuführen. Statt klassischer Bits verwendet es Qubits, die durch Superposition gleichzeitig 0 und 1 sein können, was bestimmte Probleme exponentiell schneller löst.",
    expect: { minScore: 0.6 },
  },
  {
    name: "edge: partial refusal with some content",
    messages: [{ role: "user", content: "Erkläre mir Kryptographie." }],
    output: "I cannot provide a complete explanation, but I can say that cryptography involves encrypting data to protect it from unauthorized access.",
    expect: { flags: { refusal: true } },
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

let passed = 0;
let failed = 0;
const failures: string[] = [];

console.log("\n📊 AI Quality Guard — Scorer Test Suite\n");
console.log("─".repeat(60));

for (const tc of CASES) {
  const { score, flags } = scoreOutput(tc.messages, tc.output);
  const issues: string[] = [];

  if (tc.expect.minScore !== undefined && score < tc.expect.minScore) {
    issues.push(`score ${(score * 100).toFixed(0)}% < expected min ${(tc.expect.minScore * 100).toFixed(0)}%`);
  }
  if (tc.expect.maxScore !== undefined && score > tc.expect.maxScore) {
    issues.push(`score ${(score * 100).toFixed(0)}% > expected max ${(tc.expect.maxScore * 100).toFixed(0)}%`);
  }
  if (tc.expect.flags) {
    for (const [flag, expectedValue] of Object.entries(tc.expect.flags)) {
      const actual = (flags as Record<string, boolean>)[flag];
      if (actual !== expectedValue) {
        issues.push(`flag '${flag}' is ${actual} (expected ${expectedValue})`);
      }
    }
  }

  const activeFlags = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "none";

  if (issues.length === 0) {
    passed++;
    console.log(`${GREEN}✓${RESET} ${tc.name}`);
    console.log(`  ${DIM}score: ${(score * 100).toFixed(0)}%  flags: [${activeFlags}]${RESET}`);
  } else {
    failed++;
    failures.push(tc.name);
    console.log(`${RED}✗${RESET} ${tc.name}`);
    console.log(`  ${DIM}score: ${(score * 100).toFixed(0)}%  flags: [${activeFlags}]${RESET}`);
    for (const issue of issues) {
      console.log(`  ${YELLOW}→ ${issue}${RESET}`);
    }
  }
}

console.log("\n" + "─".repeat(60));
console.log(`\nResults: ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : ""}${failed} failed${RESET}  / ${CASES.length} total`);

if (failures.length > 0) {
  console.log(`\nFailed cases:`);
  for (const f of failures) console.log(`  ${RED}✗${RESET} ${f}`);
}

console.log();
process.exit(failed > 0 ? 1 : 0);
