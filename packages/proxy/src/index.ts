import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { proxyRouter } from "./routes/proxy.js";
import { apiRouter } from "./routes/api.js";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

// LLM proxy — intercepts /v1/* calls
app.route("/", proxyRouter);

// Management API
app.route("/api", apiRouter);

// Root info
app.get("/", (c) =>
  c.json({
    name: "AI Quality Guard",
    version: "0.1.0",
    endpoints: {
      proxy: "POST /v1/chat/completions  (set baseURL to this server)",
      health: "GET /api/health",
      traces: "GET /api/traces  (X-Guard-Key: gk-...)",
      stats: "GET /api/stats   (X-Guard-Key: gk-...)",
      alerts: "POST /api/alerts (X-Guard-Key: gk-...)",
      keys: "POST /api/keys   (Authorization: Bearer <ADMIN_SECRET>)",
    },
  })
);

const port = parseInt(process.env.PORT ?? "3000");

serve({ fetch: app.fetch, port }, () => {
  console.log(`AI Quality Guard proxy listening on http://localhost:${port}`);
});
