import { useEffect, useState } from "react";
import { Cpu, Globe2, Info, Palette, Download } from "lucide-react";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import { LANG_LIST, useT } from "../lib/i18n";
import { applyAppearance } from "../lib/appearance";
import type { Settings } from "../lib/types";
import { Button, Card, Field, RefreshButton, SelectInput, TextArea, TextInput, Toggle, cx } from "../components/ui";

export default function SettingsPage() {
  const t = useT();
  const { settings } = useApp();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setS(settings);
  }, [settings]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const saved = await api.setSettings(s);
      setS(saved);
      useApp.getState().boot();
      toast(t("settings.saved"));
    } catch (e) {
      toast(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!s) return null;

  const num = (v: string, fallback: number) => {
    const n = parseInt(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("settings.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("settings.sub")}
          </p>
        </div>
        <RefreshButton onClick={() => useApp.getState().boot()} title={t("common.refresh")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-semibold text-white">{t("settings.perf")}</h2>
          </div>
          <div className="space-y-4">
            <Field label={t("settings.memory")} hint={`${(s.maxRamMb / 1024).toFixed(1)} GB · ${t("settings.memoryHint")}`}>
              <TextInput
                type="number"
                value={String(s.maxRamMb)}
                onChange={(e) => set("maxRamMb", num(e.target.value, 4096))}
              />
            </Field>
            <Field label={t("settings.concurrency")}>
              <TextInput
                type="number"
                value={String(s.downloadConcurrency)}
                onChange={(e) => set("downloadConcurrency", Math.min(32, Math.max(1, num(e.target.value, 12))))}
              />
            </Field>
            <Field label={t("settings.jvmArgs")} hint={t("settings.jvmArgsHint")}>
              <TextArea
                value={s.jvmArgs}
                onChange={(e) => set("jvmArgs", e.target.value)}
                placeholder="-XX:+UseG1GC"
              />
            </Field>
            <Field label={t("settings.javaPref")} hint={t("settings.javaPrefHint")}>
              <SelectInput
                value={s.managedJava}
                onChange={(e) => set("managedJava", e.target.value)}
              >
                <option value="auto">{t("settings.javaAuto")}</option>
                <option value="latest">{t("settings.javaLatest")}</option>
                <option value="17">{t("settings.java17")}</option>
                <option value="21">{t("settings.java21")}</option>
              </SelectInput>
            </Field>
            <Field label={t("settings.javaPath")} hint={t("settings.javaPathHint")}>
              <TextInput
                value={s.javaPath ?? ""}
                onChange={(e) => set("javaPath", e.target.value || null)}
                placeholder="/usr/lib/jvm/java-17/bin/java"
              />
            </Field>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-semibold text-white">{t("settings.appearance")}</h2>
          </div>
          <div className="space-y-4">
            <Field label={t("settings.theme")}>
              <SelectInput value={s.theme} onChange={(e) => { set("theme", e.target.value); applyAppearance(e.target.value, s.accent); }}>
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
                <option value="light">{t("settings.themeLight")}</option>
              </SelectInput>
            </Field>
            <div>
              <div className="text-[13px] font-medium text-white/80">{t("settings.accent")}</div>
              <div className="flex items-center gap-2.5 mt-2">
                {(["blue", "orange", "green", "purple", "pink", "red", "teal"] as const).map((c) => (
                  <button
                    key={c}
                    title={c}
                    onClick={() => { set("accent", c); applyAppearance(s.theme, c); }}
                    className={cx(
                      "w-7 h-7 rounded-full transition-all duration-200 active:scale-90",
                      s.accent === c
                        ? "scale-110 shadow-[0_4px_12px_rgba(0,0,0,0.35)] ring-2 ring-white"
                        : "ring-1 ring-white/15 hover:scale-110"
                    )}
                    style={{
                      background:
                        c === "blue" ? "#0071e3" : c === "orange" ? "#ff9500" : c === "green" ? "#34c759" : c === "purple" ? "#5e5ce6" : c === "pink" ? "#ff375f" : c === "red" ? "#e03b2d" : "#30b0c7",
                    }}
                  />
                ))}
              </div>
            </div>
            <Field label={t("settings.language")}>
              <SelectInput value={s.language} onChange={(e) => { set("language", e.target.value); useApp.getState().setLanguageDraft(e.target.value); }}>
                {LANG_LIST.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <ToggleRow
              label={t("settings.discord")}
              desc={t("settings.discordDesc")}
              checked={s.discordRpc}
              onChange={(v) => set("discordRpc", v)}
            />
            <ToggleRow
              label={t("settings.playtime")}
              desc={t("settings.playtimeDesc")}
              checked={s.playtime}
              onChange={(v) => set("playtime", v)}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-semibold text-white">{t("settings.integrations")}</h2>
          </div>
          <div className="space-y-4">
            <Field label={t("settings.clientId")} hint={t("settings.clientIdHint")}>
              <TextInput
                value={s.authClientId}
                onChange={(e) => set("authClientId", e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <Field label={t("settings.newsFeed")}>
              <TextInput
                value={s.newsFeedUrl}
                onChange={(e) => set("newsFeedUrl", e.target.value)}
              />
            </Field>
            <ToggleRow
              label={t("settings.telemetry")}
              desc={t("settings.telemetryDesc")}
              checked={s.telemetry}
              onChange={(v) => set("telemetry", v)}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe2 className="w-4 h-4 text-accent" />
            <h2 className="text-[14px] font-semibold text-white">{t("settings.install")}</h2>
          </div>
          <div className="space-y-4">
            <Field label={t("settings.mcDir")} hint={t("settings.mcDirHint")}>
              <TextInput
                value={s.minecraftDir ?? ""}
                onChange={(e) => set("minecraftDir", e.target.value || null)}
                placeholder="~/minecraft"
              />
            </Field>
            <p className="text-[12px] text-white/35 leading-relaxed">
              {t("settings.mcDirDesc")}
            </p>
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" loading={saving} onClick={save}>
          <Download className="w-4 h-4" /> {t("settings.save")}
        </Button>
        {saving && <span className="text-sm text-white/40">{t("settings.saving")}</span>}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px] font-medium text-white/85">{label}</div>
        <div className="text-[11px] text-white/40 mt-0.5">{desc}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}