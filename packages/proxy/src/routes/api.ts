import { Hono } from "hono";
import {
  createApiKey,
  listApiKeys,
  listTraces,
  getStats,
  getTimeseries,
  getFlagBreakdown,
  upsertAlertConfig,
  getAlertConfig,
  getApiKeyByValue,
} from "../db.js";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "change-me";

export const apiRouter = new Hono();

// --- Admin middleware ---

function requireAdmin(c: Parameters<Parameters<typeof apiRouter.use>[1]>[0], next: () => Promise<void>) {
  const auth = c.req.header("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (secret !== ADMIN_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
}

// --- Guard key middleware (for per-key endpoints) ---

function requireGuardKey(c: Parameters<Parameters<typeof apiRouter.use>[1]>[0], next: () => Promise<void>) {
  const key = c.req.header("x-guard-key") ?? "";
  if (!key) return c.json({ error: "Missing X-Guard-Key" }, 401);
  const record = getApiKeyByValue(key);
  if (!record) return c.json({ error: "Invalid Guard API key" }, 401);
  (c as unknown as Record<string, unknown>).apiKeyRecord = record;
  return next();
}

// ============================================================
// Admin endpoints (require ADMIN_SECRET in Authorization header)
// ============================================================

// POST /api/keys — create a new API key
apiRouter.post("/keys", requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const apiKey = createApiKey(name);
  return c.json(apiKey, 201);
});

// GET /api/keys — list all API keys
apiRouter.get("/keys", requireAdmin, (c) => {
  return c.json(listApiKeys());
});

// ============================================================
// Per-key endpoints (require X-Guard-Key header)
// ============================================================

// GET /api/traces — list recent traces for this key (optional ?flag= filter)
apiRouter.get("/traces", requireGuardKey, (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const flag = c.req.query("flag") ?? undefined;
  return c.json(listTraces(record.id, limit, offset, flag));
});

// GET /api/flags — flag breakdown (count + % per flag) for this key
apiRouter.get("/flags", requireGuardKey, (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const hours = parseInt(c.req.query("hours") ?? "24");
  return c.json(getFlagBreakdown(record.id, hours));
});

// GET /api/stats — aggregated stats for this key
apiRouter.get("/stats", requireGuardKey, (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const hours = parseInt(c.req.query("hours") ?? "24");
  return c.json(getStats(record.id, hours));
});

// GET /api/timeseries — quality score bucketed over time for trend chart
apiRouter.get("/timeseries", requireGuardKey, (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const hours = parseInt(c.req.query("hours") ?? "24");
  const buckets = parseInt(c.req.query("buckets") ?? "24");
  return c.json(getTimeseries(record.id, hours, buckets));
});

// POST /api/alerts — configure drift alerting
apiRouter.post("/alerts", requireGuardKey, async (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const body = await c.req.json<{
    threshold?: number;
    window_hours?: number;
    webhook_url?: string | null;
  }>();

  const threshold = body.threshold ?? 0.2;
  const windowHours = body.window_hours ?? 24;
  const webhookUrl = body.webhook_url ?? null;

  if (threshold < 0 || threshold > 1) {
    return c.json({ error: "threshold must be between 0 and 1" }, 400);
  }

  const config = upsertAlertConfig(record.id, threshold, windowHours, webhookUrl);
  return c.json(config);
});

// GET /api/alerts — get current alert config
apiRouter.get("/alerts", requireGuardKey, (c) => {
  const record = (c as unknown as Record<string, { id: string }>).apiKeyRecord;
  const config = getAlertConfig(record.id);
  if (!config) return c.json({ message: "No alert config set" }, 404);
  return c.json(config);
});

// GET /api/health
apiRouter.get("/health", (c) => {
  return c.json({ status: "ok", ts: Date.now() });
});
