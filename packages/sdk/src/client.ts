export interface QualityGuardOptions {
  /** Your Guard API key (starts with gk-) */
  apiKey: string;
  /** Base URL of your Rubric proxy. Default: http://localhost:3000 */
  baseURL?: string;
}

/**
 * QualityGuard — wraps any OpenAI-compatible client to route through
 * the Rubric proxy for logging, scoring, and alerting.
 */
export class QualityGuard {
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: QualityGuardOptions) {
    this.apiKey = opts.apiKey;
    this.baseURL = (opts.baseURL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  /**
   * Returns a modified copy of an OpenAI client instance that routes
   * all requests through the Rubric proxy.
   *
   * @example
   * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
   * const client = guard.wrap(openai);
   * // All calls through `client` are now monitored.
   */
  wrap<T extends { baseURL: string; defaultHeaders: Record<string, string> }>(client: T): T {
    // OpenAI SDK allows mutating baseURL and defaultHeaders on the instance
    (client as { baseURL: string }).baseURL = `${this.baseURL}/v1`;
    (client as { defaultHeaders: Record<string, string> }).defaultHeaders = {
      ...(client.defaultHeaders ?? {}),
      "x-guard-key": this.apiKey,
    };
    return client;
  }

  /**
   * Returns configuration to pass directly to the OpenAI constructor
   * to route through the guard proxy.
   *
   * @example
   * const openai = new OpenAI({
   *   apiKey: process.env.OPENAI_API_KEY,
   *   ...guard.openAIConfig(),
   * });
   */
  openAIConfig(): { baseURL: string; defaultHeaders: Record<string, string> } {
    return {
      baseURL: `${this.baseURL}/v1`,
      defaultHeaders: {
        "x-guard-key": this.apiKey,
      },
    };
  }

  // --- Management API helpers ---

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-guard-key": this.apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Guard API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Fetch recent traces for your API key */
  traces(opts: { limit?: number; offset?: number } = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    const qs = params.toString() ? `?${params}` : "";
    return this.request("GET", `/api/traces${qs}`);
  }

  /** Fetch aggregated quality stats */
  stats(opts: { hours?: number } = {}): Promise<{
    total_traces: number;
    avg_quality: number | null;
    avg_latency: number | null;
    total_cost: number | null;
    total_tokens: number | null;
  }> {
    const qs = opts.hours ? `?hours=${opts.hours}` : "";
    return this.request("GET", `/api/stats${qs}`);
  }

  /** Configure quality drift alerting */
  configureAlerts(opts: {
    threshold?: number;    // 0–1, default 0.2 (20% drop)
    window_hours?: number; // default 24
    webhook_url?: string;  // Slack or generic webhook URL
  }): Promise<unknown> {
    return this.request("POST", "/api/alerts", opts);
  }

  /** Get current alert configuration */
  getAlertConfig(): Promise<unknown> {
    return this.request("GET", "/api/alerts");
  }
}
