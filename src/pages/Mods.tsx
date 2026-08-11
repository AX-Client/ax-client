import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Download, Trash2, Puzzle, Handshake, ExternalLink } from "lucide-react";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import type { InstalledPackage, ModrinthProject, ModrinthVersion } from "../lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  RefreshButton,
  SelectInput,
  SpinnerBlock,
  TextInput,
  cx,
} from "../components/ui";
import { useT } from "../lib/i18n";

const CLASS_FILTERS = [
  { id: "mod", labelKey: "mods.classMods" },
  { id: "modpack", labelKey: "mods.classPacks" },
  { id: "resourcepack", labelKey: "mods.classResource" },
  { id: "shader", labelKey: "mods.classShaders" },
];

function releaseTone(v: string): "green" | "amber" | "red" | "neutral" {
  if (v === "release") return "green";
  if (v === "beta") return "amber";
  if (v === "alpha") return "red";
  return "neutral";
}

export default function ModsPage() {
  const t = useT();
  const { profiles, refreshProfiles } = useApp();
  const [profileId, setProfileId] = useState<string>("");
  const [tab, setTab] = useState<"browse" | "installed">("browse");

  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0] ?? null;

  useEffect(() => {
    if (!profileId && profiles.length > 0) setProfileId(profiles[0].id);
  }, [profiles, profileId]);

  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("mod");
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [files, setFiles] = useState<ModrinthVersion[] | null>(null);
  const [selected, setSelected] = useState<ModrinthProject | null>(null);
  const [installing, setInstalling] = useState(false);
  const [mcFilter, setMcFilter] = useState<string>("");
  const [gameVersions, setGameVersions] = useState<string[]>([]);

  useEffect(() => {
    api.modrinthMcVersions().then(setGameVersions).catch(() => {});
  }, []);

  const seq = useRef(0);
  const doSearch = async (cls = classId, mkV = mcFilter, q = query) => {
    const my = ++seq.current;
    setSearching(true);
    try {
      const r = await api.modrinthSearch(q.trim(), cls, mkV || undefined);
      if (seq.current !== my) return;
      setResults(r);
    } catch (e) {
      if (seq.current !== my) return;
      toast(String(e));
    } finally {
      if (seq.current === my) setSearching(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => doSearch(classId, mcFilter, query), 350);
    return () => clearTimeout(id);
  }, [query, classId, mcFilter]);

  const openFiles = async (m: ModrinthProject) => {
    setSelected(m);
    setFiles(null);
    try {
      const f = await api.modrinthVersions(m.slug, mcFilter || undefined);
      setFiles(
        [...f].sort((a, b) =>
          (b.datePublished ?? "").localeCompare(a.datePublished ?? "")
        )
      );
    } catch (e) {
      setFiles([]);
      toast(String(e));
    }
  };

  const download = async (v: ModrinthVersion) => {
    if (!profile || !selected) {
      toast(t("worlds.createFirst"));
      return;
    }
    setInstalling(true);
    try {
      await api.installModrinthVersion(profile.id, v);
      await refreshProfiles();
      toast(
        t("mods.installedToast", {
          name: v.name || v.versionNumber || v.files?.[0]?.filename || "",
        })
      );
      setSelected(null);
    } catch (e) {
      toast(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const remove = async (p: InstalledPackage) => {
    if (!profile) return;
    if (!confirm(t("mods.removeQ", { name: p.name }))) return;
    try {
      await api.removePackage(profile.id, p.id);
      await refreshProfiles();
    } catch (e) {
      toast(String(e));
    }
  };

  const togglePackage = async (p: InstalledPackage) => {
    if (!profile) return;
    try {
      await api.togglePackage(profile.id, p.id);
      await refreshProfiles();
      toast(p.enabled ? t("mods.disabled") : t("mods.enabled"));
    } catch (e) {
      toast(String(e));
    }
  };

  const openAffiliate = async () => {
    try {
      const cfg = await api.monetConfig();
      if (cfg.affiliate_url) await api.openUrl(cfg.affiliate_url);
      else toast(t("aff.noUrl"));
    } catch (e) {
      toast(String(e));
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        api.modrinthMcVersions().then(setGameVersions).catch(() => {}),
        doSearch(classId, mcFilter, query),
        refreshProfiles(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredPackages = useMemo(
    () => (profile?.packages ?? []).filter((p) => p.kind !== "modpack"),
    [profile]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("mods.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("mods.sub")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SelectInput
            className="w-56"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
          <RefreshButton onClick={refreshAll} loading={refreshing} title={t("common.refresh")} />
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] w-fit">
        {(["browse", "installed"] as const).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={cx(
              "px-4 py-1.5 rounded-lg text-[13px] font-medium transition",
              tab === tabKey ? "bg-accent text-white" : "text-white/55 hover:text-white"
            )}
          >
            {tabKey === "browse" ? t("mods.browse") : t("mods.installed") + ` (${filteredPackages.length})`}
          </button>
        ))}
      </div>

      <Card className="p-4 flex items-center justify-between gap-4 bg-accent/[0.05] border-accent/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0">
            <Handshake className="w-4.5 h-4.5 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white">{t("aff.title")}</div>
            <div className="text-[12px] text-white/45 mt-0.5">{t("aff.sub")}</div>
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={openAffiliate} className="shrink-0">
          <ExternalLink className="w-3.5 h-3.5" /> {t("aff.cta")}
        </Button>
      </Card>

      {!profile ? (
        <Card className="p-8 text-center text-sm text-white/45">
          {t("worlds.createFirst")}
        </Card>
      ) : tab === "browse" ? (
        <>
          <Card className="p-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <Field label={t("common.search")}>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <TextInput
                      className="pl-9"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doSearch()}
                      placeholder={t("mods.searchPlaceholder")}
                    />
                  </div>
                </Field>
              </div>
              <div className="flex gap-2">
                {CLASS_FILTERS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setClassId(c.id)}
                    className={cx(
                      "px-3 py-2 rounded-lg text-[12px] font-medium border transition",
                      classId === c.id
                        ? "bg-accent/15 text-white border-accent/40"
                        : "text-white/55 border-white/10 hover:text-white"
                    )}
                  >
                    {t(c.labelKey)}
                  </button>
                ))}
              </div>
              <SelectInput
                className="w-40"
                value={mcFilter}
                onChange={(e) => setMcFilter(e.target.value)}
              >
                <option value="">{t("mods.allMc")}</option>
                {gameVersions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </SelectInput>
              <Button variant="primary" loading={searching} onClick={() => doSearch()}>
                <Search className="w-4 h-4" /> {t("mods.searchBtn")}
              </Button>
            </div>
          </Card>

          {searching ? (
            <SpinnerBlock label={query.trim() ? t("mods.searching") : t("mods.popularLoading")} />
          ) : results.length === 0 ? (
            <Card className="p-8 text-center text-sm text-white/45">
              {query ? t("mods.noResults") : t("mods.repoHint")}
            </Card>
          ) : (
            <>
              {!query.trim() && results.length > 0 && (
                <h2 className="text-[13px] font-semibold text-white/70">{t("mods.popular")}</h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.map((m) => (
                  <Card key={m.slug} className="p-4 flex gap-4 items-start cursor-pointer hover:border-white/15 transition" onClick={() => openFiles(m)}>
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/[0.04] shrink-0 flex items-center justify-center">
                      {m.iconUrl ? (
                        <img src={m.iconUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <Puzzle className="w-5 h-5 text-white/25" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[14px] font-semibold text-white truncate">{m.title}</h3>
                        <Badge tone="blue" title={t("mods.downloads")}>
                          <Download className="w-3 h-3" /> {fnum(m.downloads ?? 0)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[12px] text-white/45 line-clamp-2">{m.description}</p>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-white/35">
                        <span className="truncate">
                          {(m.categories?.length ? m.categories.slice(0, 3).join(", ") : m.versions?.slice(0, 3).join(", ")) ?? ""}
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {selected && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/60" onClick={() => setSelected(null)} />
              <div className="relative w-[580px] max-h-[70vh] rounded-xl2 bg-[#17171b] border border-white/[0.08] shadow-lifted flex flex-col">
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-white">{selected.title}</h2>
                    <p className="text-xs text-white/45 mt-0.5">{t("mods.pickFile")}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                    ✕
                  </Button>
                </div>
                <div className="px-5 py-3 overflow-y-auto">
                  {files === null ? (
                    <SpinnerBlock label={t("mods.loadingFiles")} />
                  ) : files.length === 0 ? (
                    <p className="text-sm text-white/45">{t("mods.noFiles")}</p>
                  ) : (
                    files.map((f) => (
                      <div key={f.id || f.versionNumber || Math.random()} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-white/85 truncate">
                            {f.versionNumber || f.name || f.files?.[0]?.filename}
                          </div>
                          <div className="text-[11px] text-white/40 mt-0.5">
                            {f.versionType ? <Badge tone={releaseTone(f.versionType)}>{f.versionType}</Badge> : null}
                            {" "}
                            {(f.gameVersions?.length ? f.gameVersions.slice(0, 4).join(", ") : "")}
                            {(f.loaders?.length ? ` · ${f.loaders.slice(0, 3).join(", ")}` : "")}
                            {formatBytes(f.files?.[0]?.fileSize ?? 0) !== "0 B"
                              ? ` · ${formatBytes(f.files?.[0]?.fileSize ?? 0)}`
                              : ""}
                          </div>
                        </div>
                        <Button size="sm" variant="primary" loading={installing} onClick={() => download(f)}>
                          <Download className="w-3.5 h-3.5" /> {t("mods.install")}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredPackages.length === 0 ? (
            <Card className="p-8 col-span-full text-center text-sm text-white/45">
              {t("mods.nothing")}
            </Card>
          ) : (
            filteredPackages.map((p) => (
              <Card key={p.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-white truncate">{p.name}</span>
                    <Badge tone={p.enabled ? "green" : "neutral"}>{p.enabled ? t("mods.enabled") : t("mods.disabled")}</Badge>
                  </div>
                  <div className="text-[11px] text-white/40 mt-1 line-clamp-1">{p.fileName}</div>
                  <div className="text-[11px] text-white/35 mt-0.5">
                    {p.source} · v{p.version}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" onClick={() => togglePackage(p)}>
                    {p.enabled ? t("mods.disable") : t("mods.enable")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(p)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function fnum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${u[i]}`;
}