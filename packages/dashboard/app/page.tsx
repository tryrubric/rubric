"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total_traces: number;
  avg_quality: number | null;
  avg_latency: number | null;
  total_cost: number | null;
}

interface TimeseriesBucket {
  timestamp: number;
  avg_quality: number | null;
  count: number;
}

interface Trace {
  id: string;
  model: string;
  provider: string;
  quality_score: number | null;
  latency_ms: number;
  cost_usd: number | null;
  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  quality_flags: string | null;
  input: string;
  output: string;
  created_at: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AlertConfig {
  threshold: number;
  window_hours: number;
  webhook_url: string | null;
}

// ─── Flag metadata ────────────────────────────────────────────────────────────

const FLAG_META: Record<string, { label: string; description: string; color: string }> = {
  too_short:         { label: "Too short",         color: "#ef4444", description: "Response is too brief relative to the complexity of the prompt." },
  repetitive:        { label: "Repetitive",        color: "#f97316", description: "Output repeats sentences, trigrams, or overuses a single word stem." },
  refusal:           { label: "Refusal",            color: "#ef4444", description: "Model refused or declined to answer the request." },
  format_mismatch:   { label: "Format mismatch",   color: "#f97316", description: "Prompt asked for JSON/markdown/bullets but output doesn't match." },
  low_relevance:     { label: "Low relevance",      color: "#ef4444", description: "Response doesn't share enough keywords with the prompt." },
  language_mismatch: { label: "Language mismatch", color: "#f97316", description: "Response is in a different language than the prompt." },
  verbose_padding:   { label: "Verbose padding",   color: "#eab308", description: "Response contains filler phrases, marketing fluff, or is too long for the question." },
  hallucination_risk:{ label: "Hallucination risk",color: "#ef4444", description: "Output contains specific statistics, citations, or percentage claims not grounded in the prompt." },
};

// ─── API helpers ──────────────────────────────────────────────────────────────

function makeApi(guardKey: string, baseURL: string) {
  const headers = { "x-guard-key": guardKey, "content-type": "application/json" };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, { headers });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  return { get, post };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score === null) return "#6b6b7b";
  if (score >= 0.8) return "#22c55e";
  if (score >= 0.5) return "#eab308";
  return "#ef4444";
}

function scoreLabel(score: number | null): string {
  if (score === null) return "—";
  return `${(score * 100).toFixed(0)}%`;
}

function parseFlags(flagsJson: string | null): Record<string, boolean> {
  if (!flagsJson) return {};
  try { return JSON.parse(flagsJson); } catch { return {}; }
}

function activeFlags(flagsJson: string | null): string[] {
  return Object.entries(parseFlags(flagsJson)).filter(([, v]) => v).map(([k]) => k);
}

// ─── Trend chart (pure SVG) ───────────────────────────────────────────────────

function TrendChart({ data }: { data: TimeseriesBucket[] }) {
  const W = 700, H = 120, PAD = { top: 12, right: 12, bottom: 24, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const points = data
    .map((b, i) => ({ x: i, y: b.avg_quality }))
    .filter((p): p is { x: number; y: number } => p.y !== null);

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-[120px] text-sm" style={{ color: "var(--muted)" }}>
        Not enough data yet — send your first LLM calls through the proxy.
      </div>
    );
  }

  const n = data.length;
  const toX = (i: number) => PAD.left + (i / (n - 1)) * chartW;
  const toY = (v: number) => PAD.top + (1 - v) * chartH;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.x)} ${toY(p.y)}`).join(" ");
  const fillD = `${pathD} L ${toX(points.at(-1)!.x)} ${PAD.top + chartH} L ${toX(points[0].x)} ${PAD.top + chartH} Z`;
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 120 }}>
      <defs>
        <linearGradient id="fill-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e85d2c" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#e85d2c" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1.0].map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={toY(v)} x2={PAD.left + chartW} y2={toY(v)} stroke="#2a2a38" strokeWidth="1" />
          <text x={PAD.left - 6} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="#6b6b7b">{(v * 100).toFixed(0)}%</text>
        </g>
      ))}
      <path d={fillD} fill="url(#fill-grad)" />
      <path d={pathD} fill="none" stroke="#e85d2c" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p) => (
        <circle key={p.x} cx={toX(p.x)} cy={toY(p.y)} r="3" fill="#e85d2c" />
      ))}
      <text x={PAD.left} y={H - 4} fontSize="10" fill="#6b6b7b">{fmt(new Date(data[0].timestamp))}</text>
      <text x={PAD.left + chartW} y={H - 4} textAnchor="end" fontSize="10" fill="#6b6b7b">{fmt(new Date(data.at(-1)!.timestamp))}</text>
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "var(--muted)" }}>{label}</span>
      <span className="text-3xl font-bold" style={{ color: accent ?? "var(--text)" }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: "var(--muted)" }}>{sub}</span>}
    </div>
  );
}

// ─── Flag badges ──────────────────────────────────────────────────────────────

function FlagBadges({ flagsJson }: { flagsJson: string | null }) {
  const flags = activeFlags(flagsJson);
  if (!flags.length) return <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => {
        const meta = FLAG_META[f];
        return (
          <span key={f} className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
            style={{ background: `${meta?.color ?? "#ef4444"}22`, color: meta?.color ?? "#ef4444" }}>
            {meta?.label ?? f.replace(/_/g, " ")}
          </span>
        );
      })}
    </div>
  );
}

// ─── Trace detail panel ───────────────────────────────────────────────────────

function TraceDetail({ trace, onClose }: { trace: Trace; onClose: () => void }) {
  const flags = activeFlags(trace.quality_flags);
  let messages: ChatMessage[] = [];
  try { messages = JSON.parse(trace.input); } catch { /**/ }

  const roleBg: Record<string, string> = {
    system: "rgba(99,102,241,0.12)",
    user: "rgba(232,93,44,0.1)",
    assistant: "rgba(34,197,94,0.08)",
  };
  const roleColor: Record<string, string> = {
    system: "#818cf8",
    user: "var(--accent)",
    assistant: "#22c55e",
  };

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />

      {/* panel */}
      <div className="fixed right-0 top-0 h-full z-50 overflow-y-auto flex flex-col"
        style={{ width: "min(680px, 100vw)", background: "#0f0f13", borderLeft: "1px solid var(--border)" }}>

        {/* panel header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{ background: "#0f0f13", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold" style={{ color: scoreColor(trace.quality_score) }}>
              {scoreLabel(trace.quality_score)}
            </span>
            <div>
              <div className="text-sm font-semibold font-mono">{trace.model}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                {trace.provider} · {new Date(trace.created_at).toLocaleString()}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-xl leading-none cursor-pointer px-2"
            style={{ color: "var(--muted)" }}>✕</button>
        </div>

        <div className="flex flex-col gap-6 p-6">

          {/* metrics row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Latency", value: `${trace.latency_ms}ms` },
              { label: "Tokens", value: trace.total_tokens != null ? String(trace.total_tokens) : "—" },
              { label: "Cost", value: trace.cost_usd != null ? `$${trace.cost_usd.toFixed(6)}` : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg px-4 py-3 text-center"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>{label}</div>
                <div className="text-base font-bold font-mono">{value}</div>
              </div>
            ))}
          </div>

          {/* quality analysis */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
              style={{ background: "var(--surface)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              Quality analysis
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {Object.entries(FLAG_META).map(([key, meta]) => {
                const fired = flags.includes(key);
                return (
                  <div key={key} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 text-sm">{fired ? "✗" : "✓"}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold" style={{ color: fired ? meta.color : "var(--text)" }}>
                        {meta.label}
                      </span>
                      {fired && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{meta.description}</p>
                      )}
                    </div>
                    <span className="text-xs font-semibold shrink-0" style={{ color: fired ? meta.color : "#22c55e" }}>
                      {fired ? "FLAGGED" : "ok"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* prompt messages */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
              Prompt ({messages.length} message{messages.length !== 1 ? "s" : ""})
            </div>
            <div className="flex flex-col gap-2">
              {messages.map((msg, i) => (
                <div key={i} className="rounded-lg p-4" style={{ background: roleBg[msg.role] ?? "var(--surface)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2"
                    style={{ color: roleColor[msg.role] ?? "var(--muted)" }}>
                    {msg.role}
                  </div>
                  <pre className="text-sm whitespace-pre-wrap break-words font-sans" style={{ color: "var(--text)" }}>
                    {msg.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>

          {/* response */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
              Response
            </div>
            <div className="rounded-lg p-4" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#22c55e" }}>
                assistant
              </div>
              <pre className="text-sm whitespace-pre-wrap break-words font-sans" style={{ color: "var(--text)" }}>
                {trace.output || <span style={{ color: "var(--muted)" }}>(empty)</span>}
              </pre>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── Alert config form ────────────────────────────────────────────────────────

function AlertForm({ guardKey, baseURL, initial }: { guardKey: string; baseURL: string; initial: AlertConfig | null }) {
  const [threshold, setThreshold] = useState(String(((initial?.threshold ?? 0.2) * 100).toFixed(0)));
  const [windowH, setWindowH] = useState(String(initial?.window_hours ?? 24));
  const [webhook, setWebhook] = useState(initial?.webhook_url ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true); setMsg("");
    try {
      const api = makeApi(guardKey, baseURL);
      await api.post("/api/alerts", { threshold: parseFloat(threshold) / 100, window_hours: parseInt(windowH), webhook_url: webhook || null });
      setMsg("Saved!");
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full rounded-lg px-3 py-2 text-sm bg-[#0f0f13] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
  const borderStyle = { border: "1px solid var(--border)" };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Drop threshold (%)</label>
          <input className={inputCls} style={borderStyle} type="number" min="1" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Window (hours)</label>
          <input className={inputCls} style={borderStyle} type="number" min="1" value={windowH} onChange={(e) => setWindowH(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Webhook URL (Slack / generic)</label>
        <input className={inputCls} style={borderStyle} type="url" placeholder="https://hooks.slack.com/..." value={webhook} onChange={(e) => setWebhook(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50"
          style={{ background: "var(--accent)", color: "white" }}>
          {saving ? "Saving…" : "Save alert config"}
        </button>
        {msg && <span className="text-sm" style={{ color: msg === "Saved!" ? "var(--green)" : "#ef4444" }}>{msg}</span>}
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [guardKey, setGuardKey] = useState("");
  const [baseURL, setBaseURL] = useState("http://localhost:3000");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesBucket[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [alertConfig, setAlertConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const k = localStorage.getItem("guard_key") ?? "";
    const u = localStorage.getItem("guard_url") ?? "http://localhost:3000";
    if (k) { setGuardKey(k); setBaseURL(u); }
  }, []);

  const fetchAll = useCallback(async (key: string, url: string) => {
    setLoading(true);
    const api = makeApi(key, url);
    try {
      const [s, ts, tr] = await Promise.all([
        api.get<Stats>("/api/stats?hours=24"),
        api.get<TimeseriesBucket[]>("/api/timeseries?hours=24&buckets=24"),
        api.get<Trace[]>("/api/traces?limit=50"),
      ]);
      setStats(s); setTimeseries(ts); setTraces(tr); setError(""); setConnected(true);
      api.get<AlertConfig>("/api/alerts").then(setAlertConfig).catch(() => {});
    } catch (e) { setError(String(e)); setConnected(false); }
    finally { setLoading(false); }
  }, []);

  async function connect() {
    if (!guardKey.startsWith("gk-")) { setError("Key must start with gk-"); return; }
    localStorage.setItem("guard_key", guardKey);
    localStorage.setItem("guard_url", baseURL);
    await fetchAll(guardKey, baseURL);
  }

  useEffect(() => {
    if (!connected) return;
    intervalRef.current = setInterval(() => fetchAll(guardKey, baseURL), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [connected, guardKey, baseURL, fetchAll]);

  // close detail panel on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSelectedTrace(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Connect screen ─────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl p-8 flex flex-col gap-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <div className="inline-block text-xs font-bold tracking-widest uppercase mb-3 px-2 py-1 rounded"
              style={{ background: "rgba(232,93,44,0.15)", color: "var(--accent)" }}>
              AI Quality Guard
            </div>
            <h1 className="text-2xl font-bold">Connect your proxy</h1>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Enter your Guard API key to view your dashboard.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Proxy URL</label>
              <input className="w-full rounded-lg px-3 py-2 text-sm bg-[#0f0f13] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                style={{ border: "1px solid var(--border)" }}
                value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="http://localhost:3000" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Guard API Key</label>
              <input className="w-full rounded-lg px-3 py-2 text-sm bg-[#0f0f13] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-mono"
                style={{ border: "1px solid var(--border)" }}
                value={guardKey} onChange={(e) => setGuardKey(e.target.value)} placeholder="gk-..." autoComplete="off" />
            </div>
          </div>
          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{error}</p>
          )}
          <button onClick={connect} className="w-full py-2.5 rounded-lg font-semibold text-sm cursor-pointer"
            style={{ background: "var(--accent)", color: "white" }}>
            Connect
          </button>
        </div>
      </main>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  const avgQ = stats?.avg_quality ?? null;

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto flex flex-col gap-6">

      {/* Trace detail panel */}
      {selectedTrace && (
        <TraceDetail trace={selectedTrace} onClose={() => setSelectedTrace(null)} />
      )}

      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-widest uppercase px-2 py-1 rounded"
            style={{ background: "rgba(232,93,44,0.15)", color: "var(--accent)" }}>
            AI Quality Guard
          </span>
          <span className="text-sm font-mono" style={{ color: "var(--muted)" }}>{guardKey.slice(0, 12)}…</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs" style={{ color: "var(--muted)" }}>Refreshing…</span>}
          <button onClick={() => fetchAll(guardKey, baseURL)}
            className="text-xs px-3 py-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            Refresh
          </button>
          <button onClick={() => { setConnected(false); localStorage.removeItem("guard_key"); }}
            className="text-xs px-3 py-1.5 rounded-lg cursor-pointer"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>
            Disconnect
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Avg quality (24h)" value={scoreLabel(avgQ)} sub="0 = bad · 100% = perfect" accent={scoreColor(avgQ)} />
        <StatCard label="Total traces (24h)" value={stats?.total_traces?.toLocaleString() ?? "—"} />
        <StatCard label="Avg latency" value={stats?.avg_latency != null ? `${Math.round(stats.avg_latency)}ms` : "—"} />
        <StatCard label="Total cost (24h)" value={stats?.total_cost != null ? `$${stats.total_cost.toFixed(4)}` : "—"} sub="based on public pricing" />
      </div>

      {/* Trend chart */}
      <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold mb-4">Quality trend — last 24h</h2>
        <TrendChart data={timeseries} />
      </div>

      {/* Traces table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold">Recent traces</h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>Click a row to inspect</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Time", "Model", "Quality", "Latency", "Cost", "Flags"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold tracking-wider uppercase"
                    style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traces.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
                    No traces yet — route a LLM call through the proxy to get started.
                  </td>
                </tr>
              ) : traces.map((t) => (
                <tr key={t.id}
                  onClick={() => setSelectedTrace(t)}
                  className="border-b transition-colors cursor-pointer"
                  style={{ borderColor: "var(--border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--muted)" }}>
                    {new Date(t.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{t.model}</td>
                  <td className="px-4 py-3 font-bold" style={{ color: scoreColor(t.quality_score) }}>
                    {scoreLabel(t.quality_score)}
                  </td>
                  <td className="px-4 py-3 text-xs">{t.latency_ms}ms</td>
                  <td className="px-4 py-3 text-xs font-mono">
                    {t.cost_usd != null ? `$${t.cost_usd.toFixed(6)}` : "—"}
                  </td>
                  <td className="px-4 py-3"><FlagBadges flagsJson={t.quality_flags} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert config */}
      <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-sm font-semibold mb-1">Quality drift alerting</h2>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Sends a webhook when avg quality drops by the threshold between consecutive windows.
        </p>
        <AlertForm guardKey={guardKey} baseURL={baseURL} initial={alertConfig} />
      </div>

    </main>
  );
}
