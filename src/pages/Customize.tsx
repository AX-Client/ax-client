import { useEffect, useState } from "react";
import { SlidersHorizontal, RotateCcw, RefreshCw, CloudUpload } from "lucide-react";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import { Button, Card, SelectInput, Slider, Toggle } from "../components/ui";
import PaywallModal from "../components/PaywallModal";
import { useT } from "../lib/i18n";

interface SliderDef {
  kind: "slider";
  min: number;
  max: number;
  step?: number;
  dflt: number;
  fmt: (v: number) => string;
  /** convert UI (degrees for fov) -> stored options.txt value */
  toStored: (v: number) => string;
  /** convert stored value -> UI value (falls back to default) */
  fromStored: (s: string | undefined) => number;
}

interface ToggleDef {
  kind: "toggle";
  dflt: boolean;
}

interface SelectDef {
  kind: "select";
  dflt: string;
  options: Array<{ value: string; labelKey: string }>;
  /** migrate legacy stored values (e.g. ao:true -> 2) */
  fixIn?: (v: string) => string;
}

interface MultiDef {
  kind: "multi";
  render: "toggle" | "select";
  keys: string[];
  dflt: string;
  options?: Array<{ value: string; labelKey: string }>;
  /** split one UI value into the stored keys (same value for all aliases) */
  map: (v: string) => Record<string, string>;
  back: (patch: Record<string, string>) => string | undefined;
}

type Opt = {
  key: string;
  labelKey: string;
  hintKey?: string;
  def: SliderDef | ToggleDef | SelectDef | MultiDef;
};

const OUT = 40; // fov offset base: degrees = 40 * value + 70
const fovToStored = (deg: number) => (((deg - 70) / OUT) as number).toFixed(1);
const fovFromStored = (s: string | undefined) => {
  if (s === undefined) return 70;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 70;
  if (Math.abs(n) > 5) return n; // legacy: stored as raw degrees
  return 70 + n * OUT;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const OPTIONS: Opt[] = [
  { key: "renderDistance", labelKey: "go.drawDistance", def: { kind: "slider", min: 2, max: 32, dflt: 12, fmt: (v) => `${v}`, toStored: (v) => `${v}`, fromStored: (s) => s === undefined ? 12 : clamp(parseFloat(s), 2, 32) || 12 } },
  { key: "simulationDistance", labelKey: "go.simDistance", def: { kind: "slider", min: 5, max: 32, dflt: 12, fmt: (v) => `${v}`, toStored: (v) => `${v}`, fromStored: (s) => s === undefined ? 12 : clamp(parseFloat(s), 5, 32) || 12 } },
  { key: "maxFps", labelKey: "go.maxFps", def: { kind: "slider", min: 10, max: 260, step: 10, dflt: 120, fmt: (v) => `${v}`, toStored: (v) => `${v}`, fromStored: (s) => s === undefined ? 120 : clamp(parseFloat(s), 10, 260) || 120 } },
  { key: "fov", labelKey: "go.fov", def: { kind: "slider", min: 30, max: 110, dflt: 70, fmt: (v) => `${v}°`, toStored: fovToStored, fromStored: fovFromStored } },
  { key: "gamma", labelKey: "go.brightness", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 0.5, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 0.5 : clamp(parseFloat(s), 0, 1) } },
  { key: "mouseSensitivity", labelKey: "go.sensitivity", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 0.5, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 0.5 : clamp(parseFloat(s), 0, 1) } },
  { key: "guiScale", labelKey: "go.guiScale", def: { kind: "slider", min: 0, max: 4, dflt: 0, fmt: (v) => (v === 0 ? "Auto" : `${v}x`), toStored: (v) => `${v}`, fromStored: (s) => s === undefined ? 0 : clamp(parseFloat(s), 0, 4) || 0 } },
  { key: "mipmapLevels", labelKey: "go.mipmaps", def: { kind: "slider", min: 0, max: 4, dflt: 4, fmt: (v) => `${v}`, toStored: (v) => `${v}`, fromStored: (s) => s === undefined ? 4 : clamp(parseFloat(s), 0, 4) || 4 } },
  { key: "entityDistanceScaling", labelKey: "go.entityDistance", hintKey: "go.entityDistanceHint", def: { kind: "slider", min: 0.5, max: 5, step: 0.25, dflt: 1, fmt: (v) => `${v.toFixed(2)}x`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0.5, 5) } },
  { key: "graphicsMode", labelKey: "go.graphics", def: { kind: "select", dflt: "1", options: [
    { value: "0", labelKey: "go.graphicsFast" },
    { value: "1", labelKey: "go.graphicsFancy" },
    { value: "2", labelKey: "go.graphicsFabulous" },
  ] } },
  { key: "particles", labelKey: "go.particles", def: { kind: "select", dflt: "0", options: [
    { value: "0", labelKey: "go.particlesAll" },
    { value: "1", labelKey: "go.particlesReduced" },
    { value: "2", labelKey: "go.particlesMinimal" },
  ] } },
  { key: "cloudStatus", labelKey: "go.clouds", def: { kind: "multi", render: "select", keys: ["cloudStatus", "renderClouds"], dflt: "2", options: [
    { value: "0", labelKey: "go.cloudsOff" },
    { value: "1", labelKey: "go.cloudsFast" },
    { value: "2", labelKey: "go.cloudsFancy" },
  ], map: (v) => v === "0" ? { cloudStatus: "0", renderClouds: "false" } : { cloudStatus: v, renderClouds: "true" }, back: (p) => {
    if (p.cloudStatus !== undefined) return ["0", "1", "2"].includes(p.cloudStatus) ? p.cloudStatus : undefined;
    return p.renderClouds === "true" ? "2" : p.renderClouds === "false" ? "0" : undefined;
  } } },
  { key: "chatVisibility", labelKey: "go.chatVisibility", def: { kind: "select", dflt: "0", options: [
    { value: "0", labelKey: "go.chatVisible" },
    { value: "1", labelKey: "go.chatCommands" },
    { value: "2", labelKey: "go.chatHidden" },
  ] } },
  { key: "lang", labelKey: "go.language", def: { kind: "select", dflt: "en_us", options: [
    { value: "en_us", labelKey: "go.langEn" },
    { value: "de_de", labelKey: "go.langDe" },
    { value: "fr_fr", labelKey: "go.langFr" },
    { value: "es_es", labelKey: "go.langEs" },
    { value: "zh_cn", labelKey: "go.langZh" },
    { value: "ja_jp", labelKey: "go.langJa" },
    { value: "ru_ru", labelKey: "go.langRu" },
    { value: "pt_br", labelKey: "go.langPt" },
    { value: "it_it", labelKey: "go.langIt" },
    { value: "ko_kr", labelKey: "go.langKo" },
  ] } },
  { key: "fullscreen", labelKey: "go.fullscreen", def: { kind: "toggle", dflt: false } },
  { key: "ao", labelKey: "go.smoothLighting", def: { kind: "select", dflt: "1", fixIn: (v) => (v === "true" ? "2" : v === "false" ? "0" : v), options: [
    { value: "0", labelKey: "go.aoOff" },
    { value: "1", labelKey: "go.aoMin" },
    { value: "2", labelKey: "go.aoMax" },
  ] } },
  { key: "autoJump", labelKey: "go.autoJump", def: { kind: "toggle", dflt: false } },
  { key: "toggleSprint", labelKey: "go.toggleSprint", def: { kind: "toggle", dflt: false } },
  { key: "toggleCrouch", labelKey: "go.toggleCrouch", def: { kind: "toggle", dflt: false } },
  { key: "vsync", labelKey: "go.vsync", def: { kind: "multi", render: "toggle", keys: ["vsync", "enableVsync"], dflt: "true", map: (v) => ({ vsync: v, enableVsync: v }), back: (p) => p.vsync ?? p.enableVsync } },
  { key: "showSubtitles", labelKey: "go.subtitles", def: { kind: "toggle", dflt: false } },
  { key: "hideServerAddress", labelKey: "go.hideAddress", def: { kind: "toggle", dflt: false } },
  { key: "soundCategory.master", labelKey: "go.volMaster", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.music", labelKey: "go.volMusic", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.weather", labelKey: "go.volWeather", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.block", labelKey: "go.volBlocks", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.hostile", labelKey: "go.volHostile", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.player", labelKey: "go.volPlayers", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
  { key: "soundCategory.ambient", labelKey: "go.volAmbient", def: { kind: "slider", min: 0, max: 1, step: 0.05, dflt: 1, fmt: (v) => `${Math.round(v * 100)}%`, toStored: (v) => v.toFixed(2), fromStored: (s) => s === undefined ? 1 : clamp(parseFloat(s), 0, 1) } },
];

/** UI value -> full stored options.txt patch (aliases expanded). */
function buildStored(ui: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of OPTIONS) {
    const v = ui[o.key];
    if (v === undefined) continue;
    const d = o.def;
    if (d.kind === "slider") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) out[o.key] = d.toStored(n);
    } else if (d.kind === "toggle") {
      out[o.key] = String(v === "true");
    } else if (d.kind === "select") {
      out[o.key] = v;
    } else {
      Object.assign(out, d.map(v));
    }
  }
  return out;
}

/** Which launcher options the Bridge mod can push live into a running game. */
const LIVE: Record<string, { t: string; key?: string } | null> = {
  renderDistance: { t: "int" },
  simulationDistance: { t: "int" },
  maxFps: { t: "int" },
  fov: { t: "double" },
  gamma: { t: "double" },
  mouseSensitivity: { t: "double" },
  guiScale: { t: "int" },
  mipmapLevels: { t: "int" },
  entityDistanceScaling: { t: "double" },
  graphicsMode: { t: "string" },
  particles: { t: "string" },
  chatVisibility: { t: "string" },
  fullscreen: { t: "bool" },
  ao: { t: "bool" },
  autoJump: { t: "bool" },
  toggleSprint: { t: "bool" },
  toggleCrouch: { t: "bool" },
  vsync: { t: "bool", key: "enableVsync" },
  showSubtitles: { t: "bool" },
  hideServerAddress: { t: "bool" },
  "soundCategory.master": { t: "double" },
  "soundCategory.music": { t: "double" },
  "soundCategory.weather": { t: "double" },
  "soundCategory.block": { t: "double" },
  "soundCategory.hostile": { t: "double" },
  "soundCategory.player": { t: "double" },
  "soundCategory.ambient": { t: "double" },
};

/** Build the Bridge mod payload from the current UI state. */
function livePatch(ui: Record<string, string>): Record<string, { t: string; v: string | number | boolean }> {
  const out: Record<string, { t: string; v: string | number | boolean }> = {};
  for (const o of OPTIONS) {
    const lv = LIVE[o.key];
    if (!lv) continue;
    const raw = ui[o.key];
    if (raw === undefined) continue;
    const k = lv.key ?? o.key;
    if (lv.t === "bool") {
      out[k] = { t: "bool", v: raw === "true" };
    } else if (lv.t === "int") {
      const n = Math.round(parseFloat(raw));
      if (Number.isFinite(n)) out[k] = { t: "int", v: n };
    } else if (lv.t === "double") {
      const stored = o.def.kind === "slider" ? o.def.toStored(parseFloat(raw)) : raw;
      const d = parseFloat(stored);
      if (Number.isFinite(d)) out[k] = { t: "double", v: d };
    } else {
      out[k] = { t: "string", v: raw };
    }
  }
  return out;
}

/** stored patch -> UI values (with legacy migration). */
function buildUi(patch: Record<string, string>): Record<string, string> {
  const ui: Record<string, string> = {};
  const alias = (key: string) => patch[key] ?? (key === "mouseSensitivity" ? patch.sensitivity : undefined);
  for (const o of OPTIONS) {
    const d = o.def;
    if (d.kind === "slider") {
      ui[o.key] = String(d.fromStored(alias(o.key)) ?? d.dflt);
    } else if (d.kind === "toggle") {
      const v = alias(o.key);
      ui[o.key] = String(v === undefined ? d.dflt : v === "true");
    } else if (d.kind === "select") {
      let v = alias(o.key) ?? d.dflt;
      if (d.fixIn) v = d.fixIn(v);
      if (!d.options.some((op) => op.value === v)) v = d.dflt;
      ui[o.key] = v;
    } else {
      ui[o.key] = d.back(patch) ?? d.dflt;
    }
  }
  return ui;
}

/** single stored value -> UI value (same rules as buildUi per option). */
function storedToUi(o: Opt, raw: string | undefined): string {
  const d = o.def;
  if (d.kind === "slider") return String(d.fromStored(raw) ?? d.dflt);
  if (d.kind === "toggle") return String(raw === undefined ? d.dflt : raw === "true");
  if (d.kind === "select") {
    let v = raw ?? d.dflt;
    if (d.fixIn) v = d.fixIn(v);
    if (!d.options.some((op) => op.value === v)) v = d.dflt;
    return v;
  }
  return raw ?? d.dflt;
}

export default function CustomizePage() {
  const t = useT();
  const { settings, profiles, gameRunning, runningProfileId } = useApp();
  const [ui, setUi] = useState<Record<string, string>>({});
  const [profileId, setProfileId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [paywall, setPaywall] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    let file: Record<string, string> = {};
    try {
      file = await api.gameOptions(id);
    } catch {
      file = {};
    }
    // the game's current options.txt wins; launcher overrides fill gaps
    const patch = { ...(settings?.gameOptions ?? {}), ...file };
    setUi(buildUi(patch));
    setLoading(false);
  };

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((p) => p.id === profileId)) {
      setProfileId(profiles[0].id);
      return;
    }
    load(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, profileId]);

  // live return channel: while a game runs, mirror in-game changes back
  // into the UI every few seconds (only when the user hasn't edited)
  useEffect(() => {
    if (!gameRunning || !runningProfileId || runningProfileId !== profileId) return;
    let cancelled = false;
    const tick = async () => {
      if (!cancelled && !dirty && !saving && !loading) {
        try {
          const file = await api.gameOptions(runningProfileId);
          setUi((u) => {
            const next = { ...u };
            for (const o of OPTIONS) {
              const raw = file[o.key] ?? (o.key === "mouseSensitivity" ? file.sensitivity : undefined);
              if (raw === undefined) continue;
              const conv = storedToUi(o, raw);
              if (next[o.key] !== conv) next[o.key] = conv;
            }
            return next;
          });
        } catch {
          /* game may have just stopped - ignore */
        }
      }
    };
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameRunning, runningProfileId, profileId, dirty, saving, loading]);

  const set = (key: string, v: string) => {
    setUi((u) => ({ ...u, [key]: v }));
    setDirty(true);
  };

  const reset = () => {
    setUi(buildUi({}));
    setDirty(true);
  };

  const cloudSync = async () => {
    if (gameRunning) {
      toast(t("monet.cloudSyncGameRunning"));
      return;
    }
    setSyncing(true);
    try {
      const st = await api.premiumStatus();
      if (st.tier !== "premium") {
        setPaywall(true);
        return;
      }
      const res = await api.cloudSync();
      toast(t(res.cloud_stub ? "monet.cloudStub" : "monet.cloudSynced"));
    } catch (e) {
      toast(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const stored = buildStored(ui);
      await api.setSettings({ gameOptions: stored });
      setDirty(false);
      // live push into the running game via the AzrealX Bridge mod
      if (gameRunning && runningProfileId) {
        try {
          await api.writeLiveOptions(runningProfileId, livePatch(ui));
          toast(t("go.liveApplied"));
        } catch (e) {
          toast(`[live] ${e}`);
        }
      } else {
        toast(t("go.saved"));
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!profiles.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/45">
        {t("go.noProfile")}
      </div>
    );
  }

  if (loading) return null;

  const row = (o: Opt) => {
    const d = o.def;
    const v = ui[o.key];
    return (
      <div key={o.key} className="flex items-center justify-between gap-6 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-white/85">{t(o.labelKey)}</div>
          {o.hintKey && <div className="text-[11px] text-white/35 mt-0.5">{t(o.hintKey)}</div>}
        </div>
        {d.kind === "toggle" && (
          <Toggle checked={v === "true"} onChange={(b) => set(o.key, String(b))} />
        )}
        {(d.kind === "select" || (d.kind === "multi" && d.render === "select")) && (
          <SelectInput className="w-44" value={v} onChange={(e) => set(o.key, e.target.value)}>
            {(d.kind === "select" ? d.options : (d.kind === "multi" ? d.options : []) as Array<{ value: string; labelKey: string }>).map((op) => (
              <option key={op.value} value={op.value}>{t(op.labelKey)}</option>
            ))}
          </SelectInput>
        )}
        {d.kind === "multi" && d.render === "toggle" && (
          <Toggle checked={v === "true"} onChange={(b) => set(o.key, String(b))} />
        )}
        {d.kind === "slider" && (
          <Slider
            value={parseFloat(v) || 0}
            min={d.min}
            max={d.max}
            step={d.step ?? 1}
            format={d.fmt}
            onChange={(n) => set(o.key, String(n))}
          />
        )}
      </div>
    );
  };

  const section = (titleKey: string, keys: string[]) => (
    <Card className="p-5">
      <div className="text-[13px] font-semibold text-white/90 mb-1">{t(titleKey)}</div>
      <div className="divide-y divide-white/[0.05]">
        {keys.map((k) => row(OPTIONS.find((o) => o.key === k) as Opt))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-white tracking-tight">{t("go.title")}</h1>
            <p className="text-sm text-white/45 mt-0.5">{t("go.sub")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" disabled={loading} title={t("go.reload")} onClick={() => load(profileId)}>
            <RefreshCw className="w-3.5 h-3.5" /> {t("go.reload")}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={!dirty}>
            <RotateCcw className="w-3.5 h-3.5" /> {t("go.reset")}
          </Button>
          <Button variant="ghost" onClick={cloudSync} loading={syncing}>
            <CloudUpload className="w-3.5 h-3.5" /> {t("monet.cloudSync")}
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            {t("go.apply")}
          </Button>
        </div>
      </div>

      {paywall && <PaywallModal onClose={() => setPaywall(false)} />}

      <div className="flex items-center gap-3">
        <span className="text-[12.5px] text-white/55 font-medium">{t("go.profile")}</span>
        <SelectInput className="w-60" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </SelectInput>
        <span className="text-[11.5px] text-white/35">{t("go.profileHint")}</span>
      </div>

      <div className="rounded-xl border border-accent/20 bg-accent/[0.06] px-4 py-3 text-[12px] text-white/60 flex items-center gap-2">
        <SlidersHorizontal className="w-3.5 h-3.5 text-accent shrink-0" />
        {gameRunning ? t("go.liveNote") : t("go.note")}
      </div>

      {section("go.sectionDisplay", [
        "renderDistance", "simulationDistance", "maxFps", "fov", "gamma", "guiScale",
        "graphicsMode", "particles", "cloudStatus", "mipmapLevels", "entityDistanceScaling",
        "fullscreen", "vsync", "ao",
      ])}
      {section("go.sectionControls", ["mouseSensitivity", "toggleSprint", "toggleCrouch", "autoJump", "showSubtitles"])}
      {section("go.sectionChat", ["chatVisibility", "hideServerAddress", "lang"])}
      {section("go.sectionAudio", [
        "soundCategory.master", "soundCategory.music", "soundCategory.weather", "soundCategory.block",
        "soundCategory.hostile", "soundCategory.player", "soundCategory.ambient",
      ])}
    </div>
  );
}