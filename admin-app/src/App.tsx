import { useCallback, useEffect, useState } from "react";
import { grant, newsDelete, newsList, newsPost, stats, type NewsItem, type Stats } from "./api";

type Tab = "dashboard" | "news" | "grants";

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function useLoad(fn: () => Promise<void>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [fn]
  );
  return { loading, error, load };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [configOk, setConfigOk] = useState<"ok" | "err" | "checking">("checking");

  useEffect(() => {
    stats()
      .then(() => setConfigOk("ok"))
      .catch(() => setConfigOk("err"));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <img className="logo" src="/logo.png" alt="" />
        <div>
          <h1>AX Admin</h1>
          <div className="sub">Backend-Verwaltung</div>
        </div>
        <div className="right">
          <span className={`status-pill ${configOk === "ok" ? "ok" : "err"}`}>
            {configOk === "checking"
              ? "Prüfe…"
              : configOk === "ok"
                ? "Backend verbunden"
                : "AX_BACKEND_URL / AX_ADMIN_SECRET fehlt"}
          </span>
        </div>
      </header>

      <nav className="tabs">
        {(
          [
            ["dashboard", "Dashboard"],
            ["news", "News"],
            ["grants", "Abos"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "dashboard" && <Dashboard />}
        {tab === "news" && <NewsTab />}
        {tab === "grants" && <GrantsTab />}
      </main>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState<Stats | null>(null);
  const { loading, error, load } = useLoad(async () => setData(await stats()));

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) return <div className="empty">Lade…</div>;
  if (error) return <div className="msg err">{error}</div>;
  if (!data) return null;

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="num">{data.users_total}</div>
          <div className="lbl">User insgesamt</div>
        </div>
        <div className="card">
          <div className="num">{data.online_count}</div>
          <div className="lbl">Gerade online</div>
        </div>
        <div className="card">
          <div className="num">{data.premium_count}</div>
          <div className="lbl">Premium</div>
        </div>
        <div className="card">
          <div className="num">{data.news_count}</div>
          <div className="lbl">News-Einträge</div>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h3>Online-Spieler</h3>
          <button className="btn ghost small" onClick={() => load()}>
            Aktualisieren
          </button>
        </div>
        {data.online_users.length === 0 ? (
          <div className="empty">Keine Spieler online</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>XUID</th>
              </tr>
            </thead>
            <tbody>
              {data.online_users.map((u) => (
                <tr key={u.xuid}>
                  <td>{u.player_name || "—"}</td>
                  <td className="mono">{u.xuid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewsTab() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { loading, error, load } = useLoad(async () => setItems(await newsList()));

  useEffect(() => {
    load();
  }, [load]);

  const post = async () => {
    if (!title.trim() || !body.trim()) {
      setMsg({ kind: "err", text: "Titel und Text sind Pflicht." });
      return;
    }
    setMsg(null);
    try {
      await newsPost(title.trim(), body.trim(), link.trim());
      setMsg({ kind: "ok", text: "News veröffentlicht." });
      setTitle("");
      setBody("");
      setLink("");
      await load(true);
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("News wirklich löschen?")) return;
    try {
      await newsDelete(id);
      await load(true);
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 16, alignItems: "start" }}>
      <div className="panel">
        <h3>Neuer Eintrag</h3>
        <label>Titel</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Update v1.4" />
        <label>Text</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht an alle User…" />
        <label>Link (optional)</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={post}>
            Veröffentlichen
          </button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="panel">
        <div className="toolbar">
          <h3>Bestehende News</h3>
          <button className="btn ghost small" onClick={() => load()}>
            Aktualisieren
          </button>
        </div>
        {loading && items.length === 0 ? (
          <div className="empty">Lade…</div>
        ) : error ? (
          <div className="msg err">{error}</div>
        ) : items.length === 0 ? (
          <div className="empty">Noch keine News</div>
        ) : (
          items.map((n) => (
            <div className="news-row" key={n.id}>
              <div>
                <div className="t">{n.title}</div>
                <div className="d">
                  {fmt(n.created_at)}
                  {n.link ? " · Link" : ""}
                </div>
              </div>
              <button className="btn small danger" onClick={() => remove(n.id)}>
                Löschen
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const TIERS: Array<{ key: string; label: string; tier: string; days: number }> = [
  { key: "1d", label: "1 Tag", tier: "premium", days: 1 },
  { key: "7d", label: "7 Tage", tier: "premium", days: 7 },
  { key: "30d", label: "30 Tage", tier: "premium", days: 30 },
  { key: "90d", label: "90 Tage", tier: "premium", days: 90 },
  { key: "365d", label: "1 Jahr", tier: "premium", days: 365 },
  { key: "lifetime", label: "Lebenslang", tier: "lifetime", days: 0 },
  { key: "0", label: "Entziehen", tier: "free", days: 0 },
];

function GrantsTab() {
  const [email, setEmail] = useState("");
  const [tierKey, setTierKey] = useState("7d");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const target = email.trim();
    if (!target) {
      setMsg({ kind: "err", text: "E-Mail eingeben." });
      return;
    }
    if (!target.includes("@")) {
      setMsg({ kind: "err", text: "Das sieht nicht nach einer E-Mail aus (enthält kein @)." });
      return;
    }
    const t = TIERS.find((x) => x.key === tierKey)!;
    setBusy(true);
    setMsg(null);
    try {
      await grant(target, t.tier, t.days);
      setMsg({ kind: "ok", text: t.key === "0" ? "Abo entzogen." : `Abo für ${t.label} gewährt.` });
      setEmail("");
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 480 }}>
      <h3>Abo vergeben / entziehen</h3>
      <label>E-Mail</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="spieler@example.com" className="mono" />
      <label>Dauer</label>
      <select value={tierKey} onChange={(e) => setTierKey(e.target.value)}>
        {TIERS.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 16 }}>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "Sende…" : tierKey === "0" ? "Abo entziehen" : "Abo gewähren"}
        </button>
      </div>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}
