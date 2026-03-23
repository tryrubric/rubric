import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { ApiKey, AlertConfig, Trace } from "./types.js";

const DB_PATH = process.env.DB_PATH ?? "./data/guard.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS traces (
    id                 TEXT PRIMARY KEY,
    api_key_id         TEXT NOT NULL,
    provider           TEXT NOT NULL,
    model              TEXT NOT NULL,
    prompt_tokens      INTEGER,
    completion_tokens  INTEGER,
    total_tokens       INTEGER,
    latency_ms         INTEGER NOT NULL,
    cost_usd           REAL,
    quality_score      REAL,
    quality_flags      TEXT,
    input              TEXT NOT NULL,
    output             TEXT NOT NULL,
    created_at         INTEGER NOT NULL,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  );

  CREATE INDEX IF NOT EXISTS idx_traces_api_key_id ON traces(api_key_id);
  CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at);

  CREATE TABLE IF NOT EXISTS alert_configs (
    id           TEXT PRIMARY KEY,
    api_key_id   TEXT NOT NULL,
    threshold    REAL NOT NULL DEFAULT 0.2,
    window_hours INTEGER NOT NULL DEFAULT 24,
    webhook_url  TEXT,
    created_at   INTEGER NOT NULL,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
  );

  CREATE TABLE IF NOT EXISTS alert_events (
    id           TEXT PRIMARY KEY,
    api_key_id   TEXT NOT NULL,
    type         TEXT NOT NULL,
    message      TEXT NOT NULL,
    score_now    REAL,
    score_before REAL,
    triggered_at INTEGER NOT NULL
  );
`);

// --- API Keys ---

export function createApiKey(name: string): ApiKey {
  const id = crypto.randomUUID();
  const key = "gk-" + crypto.randomUUID().replace(/-/g, "");
  const created_at = Date.now();
  db.prepare(
    "INSERT INTO api_keys (id, key, name, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, key, name, created_at);
  return { id, key, name, created_at };
}

export function getApiKeyByValue(key: string): ApiKey | null {
  return db
    .prepare<[string], ApiKey>("SELECT * FROM api_keys WHERE key = ?")
    .get(key) ?? null;
}

export function listApiKeys(): ApiKey[] {
  return db
    .prepare<[], ApiKey>("SELECT * FROM api_keys ORDER BY created_at DESC")
    .all();
}

// --- Traces ---

export function insertTrace(trace: Trace): void {
  db.prepare(
    `INSERT INTO traces
      (id, api_key_id, provider, model, prompt_tokens, completion_tokens,
       total_tokens, latency_ms, cost_usd, quality_score, quality_flags,
       input, output, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    trace.id,
    trace.api_key_id,
    trace.provider,
    trace.model,
    trace.prompt_tokens,
    trace.completion_tokens,
    trace.total_tokens,
    trace.latency_ms,
    trace.cost_usd,
    trace.quality_score,
    trace.quality_flags,
    trace.input,
    trace.output,
    trace.created_at
  );
}

export function listTraces(apiKeyId: string, limit = 50, offset = 0): Trace[] {
  return db
    .prepare<[string, number, number], Trace>(
      "SELECT * FROM traces WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .all(apiKeyId, limit, offset);
}

export interface StatsRow {
  total_traces: number;
  avg_quality: number | null;
  avg_latency: number | null;
  total_cost: number | null;
  total_tokens: number | null;
}

export function getStats(apiKeyId: string, windowHours = 24): StatsRow {
  const since = Date.now() - windowHours * 3600 * 1000;
  return db
    .prepare<[string, number], StatsRow>(
      `SELECT
         COUNT(*)            AS total_traces,
         AVG(quality_score)  AS avg_quality,
         AVG(latency_ms)     AS avg_latency,
         SUM(cost_usd)       AS total_cost,
         SUM(total_tokens)   AS total_tokens
       FROM traces
       WHERE api_key_id = ? AND created_at >= ?`
    )
    .get(apiKeyId, since) as StatsRow;
}

export interface TimeseriesBucket {
  timestamp: number; // start of bucket (ms)
  avg_quality: number | null;
  count: number;
}

export function getTimeseries(
  apiKeyId: string,
  hours: number,
  buckets: number
): TimeseriesBucket[] {
  const now = Date.now();
  const windowMs = hours * 3600 * 1000;
  const bucketMs = windowMs / buckets;
  const since = now - windowMs;

  const rows = db
    .prepare<[string, number], { created_at: number; quality_score: number | null }>(
      `SELECT created_at, quality_score FROM traces
       WHERE api_key_id = ? AND created_at >= ?
       ORDER BY created_at ASC`
    )
    .all(apiKeyId, since);

  const result: TimeseriesBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    const bucketStart = since + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const bucketRows = rows.filter(
      (r) => r.created_at >= bucketStart && r.created_at < bucketEnd
    );
    const scores = bucketRows
      .map((r) => r.quality_score)
      .filter((s): s is number => s !== null);
    result.push({
      timestamp: bucketStart,
      avg_quality: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      count: bucketRows.length,
    });
  }
  return result;
}

export function getWindowAvgQuality(
  apiKeyId: string,
  fromMs: number,
  toMs: number
): number | null {
  const row = db
    .prepare<[string, number, number], { avg_quality: number | null }>(
      `SELECT AVG(quality_score) AS avg_quality
       FROM traces
       WHERE api_key_id = ? AND created_at >= ? AND created_at < ?`
    )
    .get(apiKeyId, fromMs, toMs);
  return row?.avg_quality ?? null;
}

// --- Alert Configs ---

export function upsertAlertConfig(
  apiKeyId: string,
  threshold: number,
  windowHours: number,
  webhookUrl: string | null
): AlertConfig {
  const existing = db
    .prepare<[string], AlertConfig>(
      "SELECT * FROM alert_configs WHERE api_key_id = ?"
    )
    .get(apiKeyId);

  if (existing) {
    db.prepare(
      `UPDATE alert_configs
       SET threshold = ?, window_hours = ?, webhook_url = ?
       WHERE api_key_id = ?`
    ).run(threshold, windowHours, webhookUrl, apiKeyId);
    return { ...existing, threshold, window_hours: windowHours, webhook_url: webhookUrl };
  }

  const id = crypto.randomUUID();
  const created_at = Date.now();
  db.prepare(
    `INSERT INTO alert_configs (id, api_key_id, threshold, window_hours, webhook_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, apiKeyId, threshold, windowHours, webhookUrl, created_at);
  return { id, api_key_id: apiKeyId, threshold, window_hours: windowHours, webhook_url: webhookUrl, created_at };
}

export function getAlertConfig(apiKeyId: string): AlertConfig | null {
  return db
    .prepare<[string], AlertConfig>(
      "SELECT * FROM alert_configs WHERE api_key_id = ?"
    )
    .get(apiKeyId) ?? null;
}

export function recordAlertEvent(
  apiKeyId: string,
  type: string,
  message: string,
  scoreNow: number | null,
  scoreBefore: number | null
): void {
  db.prepare(
    `INSERT INTO alert_events (id, api_key_id, type, message, score_now, score_before, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), apiKeyId, type, message, scoreNow, scoreBefore, Date.now());
}
