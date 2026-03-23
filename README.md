# Rubric

**Sentry for AI — LLM output quality monitoring in production.**

Rubric sits between your app and any LLM provider. It logs every call, scores the output quality automatically, and alerts you when something drifts — before your users notice.

```
Your App → Rubric Proxy → OpenAI / Anthropic / Groq / ...
                ↓
          Quality Score
          Flag Detection
          Drift Alerting
          Dashboard
```

## Why Rubric?

Most LLM monitoring tools require you to instrument your code, set up complex pipelines, or pay for enterprise contracts. Rubric is:

- **1-line integration** — change `baseURL`, done
- **Works with any OpenAI-compatible API** — OpenAI, Groq, Together, OpenRouter, local models
- **Heuristic + LLM-as-judge** — fast scoring on every call, deep evaluation sampled at 10%
- **Open source** — MIT license, self-hostable, no vendor lock-in

---

## Quick Start

### 1. Start the proxy

```bash
git clone https://github.com/rubric-dev/rubric
cd rubric
cp .env.example .env   # add your ADMIN_SECRET
npm install
npm run proxy
```

### 2. Create an API key

```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Authorization: Bearer your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
# → {"key": "gk-..."}
```

### 3. Route your LLM calls through Rubric

**JavaScript / TypeScript**
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "http://localhost:3000/v1",          // point to Rubric
  defaultHeaders: { "x-guard-key": "gk-..." },  // your Rubric key
});

// All existing OpenAI calls work unchanged
const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Summarize this article..." }],
});
```

**Python**
```python
import openai
from rubric import openai_config

client = openai.OpenAI(**openai_config(
  guard_key="gk-...",
  base_url="http://localhost:3000"
))

# All existing calls work unchanged
response = client.chat.completions.create(...)
```

**Groq / Other providers** — add `x-provider` header:
```typescript
defaultHeaders: {
  "x-guard-key": "gk-...",
  "x-provider": "groq"   // or: openai, anthropic, together, openrouter
}
```

### 4. Open the dashboard

```bash
npm run dashboard
# → http://localhost:3001
```

---

## Quality Scoring

Rubric scores every LLM response on 8 dimensions:

| Flag | What it catches | Score penalty |
|------|----------------|---------------|
| `too_short` | Response too brief for the prompt complexity | −40% |
| `refusal` | Model refused or declined the request | −30% |
| `low_relevance` | Output doesn't relate to the prompt | −25% |
| `hallucination_risk` | Ungrounded statistics, fake citations, invented data | −20% |
| `format_mismatch` | Asked for JSON/markdown but got plain text | −15% |
| `language_mismatch` | Response in wrong language | −15% |
| `repetitive` | Repeated sentences, trigrams, or word stems | −15% |
| `verbose_padding` | Filler phrases, marketing fluff, over-long responses | −10% |

Scores range 0.0–1.0. A score below 0.7 indicates a problematic response.

### LLM-as-Judge (optional)

Set `JUDGE_API_KEY` (Anthropic key) in `.env` to enable deep quality evaluation on 10% of calls. The judge score is blended with heuristics (70/30).

---

## Dashboard

The Rubric dashboard gives you the Sentry-style flow:

1. **Problems overview** — which quality issues are most common, with counts and percentages
2. **Click a problem** → filtered trace list showing only affected calls
3. **Click a trace** → full detail: prompt, response, quality analysis, metrics

---

## Drift Alerting

Configure a webhook to get notified when quality drops:

```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "x-guard-key: gk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "threshold": 0.15,
    "window_hours": 24,
    "webhook_url": "https://hooks.slack.com/..."
  }'
```

Works with Slack, Discord, or any HTTP webhook.

---

## Supported Providers

| Provider | `x-provider` value |
|----------|-------------------|
| OpenAI | `openai` (default) |
| Groq | `groq` |
| Anthropic | `anthropic` |
| Together AI | `together` |
| OpenRouter | `openrouter` |

---

## Self-hosting with Docker

```bash
docker compose up
# Proxy on :3000, Dashboard on :3001
```

---

## Architecture

```
packages/
  proxy/      — Hono.js proxy server (Node.js + TypeScript)
  sdk/        — TypeScript/JavaScript SDK
  sdk-python/ — Python SDK
  dashboard/  — Next.js dashboard
examples/     — 11 example apps for testing
```

---

## License

MIT — see [LICENSE](LICENSE)
