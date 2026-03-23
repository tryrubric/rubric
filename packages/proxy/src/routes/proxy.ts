import { Hono } from "hono";
import { getApiKeyByValue, insertTrace, db } from "../db.js";
import { scoreOutput, maybeJudgeAsync } from "../scorer.js";
import { estimateCost } from "../costs.js";
import { checkDriftAndAlert } from "../alerting.js";
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from "../types.js";

// Provider base URLs — extend as needed
const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai",
  together: "https://api.together.xyz",
  openrouter: "https://openrouter.ai/api",
};

export const proxyRouter = new Hono();

// Intercept all /v1/* routes
proxyRouter.all("/v1/*", async (c) => {
  // 1. Validate Guard API key
  const guardKey = c.req.header("x-guard-key");
  if (!guardKey) {
    return c.json({ error: "Missing X-Guard-Key header" }, 401);
  }

  const apiKeyRecord = getApiKeyByValue(guardKey);
  if (!apiKeyRecord) {
    return c.json({ error: "Invalid Guard API key" }, 401);
  }

  // 2. Determine upstream provider
  const providerHint = (c.req.header("x-provider") ?? "openai").toLowerCase();
  const providerBase = PROVIDER_URLS[providerHint] ?? PROVIDER_URLS.openai;

  // 3. Build upstream URL — strip guard-specific headers
  const url = new URL(c.req.url);
  const upstreamUrl = providerBase + url.pathname + url.search;

  const headersToForward = new Headers(c.req.raw.headers);
  headersToForward.delete("x-guard-key");
  headersToForward.delete("x-provider");
  // Don't forward compression — proxy reads body as text, compressed pass-through breaks it
  headersToForward.delete("accept-encoding");
  // Ensure host matches upstream
  headersToForward.set("host", new URL(providerBase).host);

  // 4. Parse body to capture request payload
  let body: ChatCompletionRequest | null = null;
  let rawBody: string | null = null;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    rawBody = await c.req.text();
    try {
      body = JSON.parse(rawBody) as ChatCompletionRequest;
    } catch {
      body = null;
    }
  }

  const startMs = Date.now();
  const isChat = url.pathname.includes("chat/completions");
  const isStreaming = body?.stream === true;

  // 5. Forward to upstream
  const upstream = await fetch(upstreamUrl, {
    method: c.req.method,
    headers: headersToForward,
    body: rawBody ?? undefined,
  });

  const latencyMs = Date.now() - startMs;

  // 6. Pass response back to client; simultaneously capture it for logging
  if (isStreaming && isChat) {
    return handleStreaming(c, upstream, apiKeyRecord.id, body, latencyMs);
  }

  // Non-streaming
  const responseText = await upstream.text();

  // Async logging — don't block the response
  if (isChat && body) {
    logTrace(apiKeyRecord.id, body, responseText, latencyMs, providerHint).catch(() => {});
  }

  // Strip content-encoding — fetch() already decompressed the body
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");

  return new Response(responseText, {
    status: upstream.status,
    headers: responseHeaders,
  });
});

// --- Streaming handler ---

async function handleStreaming(
  c: { req: { raw: Request } },
  upstream: Response,
  apiKeyId: string,
  body: ChatCompletionRequest | null,
  latencyMs: number
): Promise<Response> {
  if (!upstream.body) {
    return new Response(null, { status: upstream.status, headers: upstream.headers });
  }

  // Tee the stream so we can read it for logging without buffering for the client
  const [clientStream, logStream] = upstream.body.tee();

  // Async: accumulate SSE chunks and log when done
  if (body) {
    accumulateAndLog(logStream, apiKeyId, body, latencyMs).catch(() => {});
  }

  const streamHeaders = new Headers(upstream.headers);
  streamHeaders.delete("content-encoding");
  streamHeaders.delete("transfer-encoding");

  return new Response(clientStream, {
    status: upstream.status,
    headers: streamHeaders,
  });
}

async function accumulateAndLog(
  stream: ReadableStream,
  apiKeyId: string,
  body: ChatCompletionRequest,
  latencyMs: number
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let model = body.model;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  // Parse SSE lines to extract content and usage
  const lines = accumulated.split("\n");
  let outputContent = "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data) as {
        model?: string;
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      if (chunk.model) model = chunk.model;
      outputContent += chunk.choices?.[0]?.delta?.content ?? "";
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    } catch {
      // Ignore malformed chunks
    }
  }

  await saveTrace(apiKeyId, body, outputContent, model, promptTokens, completionTokens, latencyMs, "openai");
}

// --- Non-streaming log helper ---

async function logTrace(
  apiKeyId: string,
  body: ChatCompletionRequest,
  responseText: string,
  latencyMs: number,
  provider: string
): Promise<void> {
  try {
    const response = JSON.parse(responseText) as ChatCompletionResponse;
    const output = response.choices?.[0]?.message?.content ?? "";
    const usage = response.usage;
    await saveTrace(
      apiKeyId,
      body,
      output,
      response.model ?? body.model,
      usage?.prompt_tokens ?? null,
      usage?.completion_tokens ?? null,
      latencyMs,
      provider
    );
  } catch {
    // Don't crash the proxy on logging errors
  }
}

// --- Core save logic ---

async function saveTrace(
  apiKeyId: string,
  body: ChatCompletionRequest,
  output: string,
  model: string,
  promptTokens: number | null,
  completionTokens: number | null,
  latencyMs: number,
  provider: string
): Promise<void> {
  const messages = body.messages as ChatMessage[];
  const { score, flags } = scoreOutput(messages, output);

  const totalTokens =
    promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null;

  const costUsd =
    promptTokens !== null && completionTokens !== null
      ? estimateCost(model, promptTokens, completionTokens)
      : null;

  const traceId = crypto.randomUUID();

  insertTrace({
    id: traceId,
    api_key_id: apiKeyId,
    provider,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    latency_ms: latencyMs,
    cost_usd: costUsd,
    quality_score: score,
    quality_flags: JSON.stringify(flags),
    input: JSON.stringify(messages),
    output,
    created_at: Date.now(),
  });

  // Optionally refine score via LLM-as-judge (fire & forget)
  maybeJudgeAsync(traceId, messages, output, (judgeScore) => {
    // Update the trace quality_score with judge's verdict
    // Simple blend: 70% judge + 30% heuristic
    const blended = judgeScore * 0.7 + score * 0.3;
    db.run("UPDATE traces SET quality_score = ? WHERE id = ?", [blended, traceId]);
  }).catch(() => {});

  // Check for quality drift every 10 traces (cheap throttle)
  if (Math.random() < 0.1) {
    checkDriftAndAlert(apiKeyId).catch(() => {});
  }
}
