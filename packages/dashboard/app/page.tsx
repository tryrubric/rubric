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
  quality_flags: string | null;
  output: string;
  created_at: number;
}

interface AlertConfig {
  threshold: number;
  window_hours: number;
  webhook_url: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function makeApi(guardKey: string, baseURL: string) {
  const headers = { "x-guard-key": guardKey, "content-type": "application/json" };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, { headers });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
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
  if (!flagsJson) return null;
  let flags: Record<string, boolean>;
  try { flags = JSON.parse(flagsJson); } catch { return null; }
  const active = Object.entries(flags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));
  if (!active.length) return <span className="text-xs" style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((f) => (
        <span key={f} className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
          {f}
        </span>
      ))}
    </div>
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
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50" style={{ background: "var(--accent)", color: "white" }}>
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
        api.get<Trace[]>("/api/traces?limit=25"),
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

  // ── Connect screen ────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl p-8 flex flex-col gap-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <div className="inline-block text-xs font-bold tracking-widest uppercase mb-3 px-2 py-1 rounded" style={{ background: "rgba(232,93,44,0.15)", color: "var(--accent)" }}>
              AI Quality Guard
            </div>
            <h1 className="text-2xl font-bold">Connect your proxy</h1>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Enter your Guard API key to view your dashboard.</p>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Proxy URL</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm bg-[#0f0f13] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                style={{ border: "1px solid var(--border)" }}
                value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="http://localhost:3000"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>Guard API Key</label>
              <input
                className="w-full rounded-lg px-3 py-2 text-sm bg-[#0f0f13] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-mono"
                style={{ border: "1px solid var(--border)" }}
                value={guardKey} onChange={(e) => setGuardKey(e.target.value)} placeholder="gk-..." autoComplete="off"
              />
            </div>
          </div>
          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{error}</p>
          )}
          <button onClick={connect} className="w-full py-2.5 rounded-lg font-semibold text-sm cursor-pointer" style={{ background: "var(--accent)", color: "white" }}>
            Connect
          </button>
        </div>
      </main>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const avgQ = stats?.avg_quality ?? null;

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto flex flex-col gap-6">

      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-widest uppercase px-2 py-1 rounded" style={{ background: "rgba(232,93,44,0.15)", color: "var(--accent)" }}>
            AI Quality Guard
          </span>
          <span className="text-sm font-mono" style={{ color: "var(--muted)" }}>{guardKey.slice(0, 12)}…</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs" style={{ color: "var(--muted)" }}>Refreshing…</span>}
          <button onClick={() => fetchAll(guardKey, baseURL)} className="text-xs px-3 py-1.5 rounded-lg cursor-pointer" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            Refresh
          </button>
          <button onClick={() => { setConnected(false); localStorage.removeItem("guard_key"); }} className="text-xs px-3 py-1.5 rounded-lg cursor-pointer" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>
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
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold">Recent traces</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Time", "Model", "Quality", "Latency", "Cost", "Flags"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold tracking-wider uppercase" style={{ color: "var(--muted)" }}>{h}</th>
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
                <tr key={t.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--muted)" }}>{new Date(t.created_at).toLocaleTimeString()}</td>
                  <td className="px-4 py-3 font-mono text-xs">{t.model}</td>
                  <td className="px-4 py-3 font-bold" style={{ color: scoreColor(t.quality_score) }}>{scoreLabel(t.quality_score)}</td>
                  <td className="px-4 py-3 text-xs">{t.latency_ms}ms</td>
                  <td className="px-4 py-3 text-xs font-mono">{t.cost_usd != null ? `$${t.cost_usd.toFixed(6)}` : "—"}</td>
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
