import { useEffect, useState } from "react";
import {
  Box,
  Camera,
  FileWarning,
  FolderOpen,
  Trash2,
  Archive,
  RotateCcw,
  Plus,
  Globe,
  Pencil,
  ShieldCheck,
  Play,
  Loader2,
} from "lucide-react";
import { useApp } from "../lib/store";
import { launchTimeout } from "../lib/install";
import { api, fmtBytes, toast, timeAgo } from "../lib/api";
import type { CrashReportInfo, ScreenshotInfo, ServerEntry, WorldInfo } from "../lib/types";
import { Badge, Button, Card, EmptyState, Field, Modal, RefreshButton, SelectInput, SpinnerBlock, TextInput, Toggle, cx } from "../components/ui";
import { useT } from "../lib/i18n";

type Tab = "worlds" | "screenshots" | "crashes" | "servers";

export default function WorldsPage() {
  const t = useT();
  const { profiles, refreshProfiles } = useApp();
  const [profileId, setProfileId] = useState("");
  const [tab, setTab] = useState<Tab>("worlds");
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [shots, setShots] = useState<ScreenshotInfo[]>([]);
  const [crashes, setCrashes] = useState<CrashReportInfo[]>([]);
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [backupFolder, setBackupFolder] = useState<string | null>(null);
  const [crashView, setCrashView] = useState<CrashReportInfo | null>(null);
  const [serverEdit, setServerEdit] = useState<ServerEntry | null>(null);
  const [serverDraft, setServerDraft] = useState<{ name: string; ip: string; acceptTextures: boolean }>({
    name: "",
    ip: "",
    acceptTextures: false,
  });
  const [serverSaving, setServerSaving] = useState(false);

  useEffect(() => {
    if (!profileId && profiles.length) setProfileId(profiles[0].id);
  }, [profiles, profileId]);

  const load = async (quiet?: boolean) => {
    if (!profileId) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      if (tab === "worlds") setWorlds(await api.worlds(profileId));
      else if (tab === "screenshots") setShots(await api.screenshots(profileId));
      else if (tab === "crashes") setCrashes(await api.crashReports(profileId));
      else setServers(await api.serversRead(profileId));
    } catch (e) {
      toast(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [tab, profileId]);

  const backup = async (w: WorldInfo) => {
    try {
      await api.backupWorld(profileId, w.folder);
      toast(t("worlds.backedUp", { name: w.name }));
    } catch (e) {
      toast(String(e));
    }
  };

  const showBackups = async (w: WorldInfo) => {
    setBackupFolder(w.folder);
    try {
      setBackups(await api.listWorldBackups(w.folder));
    } catch (e) {
      toast(String(e));
    }
  };

  const restore = async (b: string) => {
    if (!backupFolder) return;
    if (!confirm(t("worlds.restoreQ", { name: b }))) return;
    try {
      await api.restoreWorldBackup(profileId, backupFolder, b);
      toast(t("worlds.restored"));
      await load();
    } catch (e) {
      toast(String(e));
    } finally {
      setBackupFolder(null);
    }
  };

  const del = async (w: WorldInfo) => {
    if (!confirm(t("worlds.deleteQ", { name: w.name }))) return;
    try {
      await api.deleteWorld(profileId, w.folder);
      await load();
    } catch (e) {
      toast(String(e));
    }
  };

  const openServerModal = (s?: ServerEntry) => {
    setServerDraft({
      name: s?.name ?? "",
      ip: s?.ip ?? "",
      acceptTextures: s?.acceptTextures ?? false,
    });
    setServerEdit(s ?? null);
  };

  const saveServer = async () => {
    const name = serverDraft.name.trim();
    const ip = serverDraft.ip.trim();
    if (!name || !ip) return;
    setServerSaving(true);
    try {
      const next = serverEdit
        ? servers.map((s) => (s === serverEdit ? { name, ip, acceptTextures: serverDraft.acceptTextures } : s))
        : [...servers, { name, ip, acceptTextures: serverDraft.acceptTextures }];
      await api.serversSave(profileId, next);
      setServers(next);
      setServerEdit(null);
      toast(t("worlds.savedServers"));
    } catch (e) {
      toast(String(e));
    } finally {
      setServerSaving(false);
    }
  };

  const removeServer = async (s: ServerEntry) => {
    if (!confirm(t("worlds.removeServerQ", { name: s.name }))) return;
    try {
      const next = servers.filter((x) => x !== s);
      await api.serversSave(profileId, next);
      setServers(next);
    } catch (e) {
      toast(String(e));
    }
  };

  const quickplaySupported = (gameVersion: string) => {
    const [maj, min, pat] = gameVersion.split(".").map((s) => parseInt(s, 10) || 0);
    return maj > 1 || (maj === 1 && min > 20) || (maj === 1 && min === 20 && pat >= 2);
  };

  const play = async (key: string, target: { world?: string; server?: string }) => {
    if (!profileId) return;
    const profile = profiles.find((p) => p.id === profileId);
    if (target.world && profile && !quickplaySupported(profile.gameVersion)) {
      toast(t("worlds.noQuickPlay"));
    }
    setStartingKey(key);
    useApp.getState().setStartingProfileId(profileId);
    try {
      if (profile && profile.installStatus !== "installed") {
        await api.installProfile(profileId);
        await refreshProfiles();
      }
      const res = await Promise.race([
        api.launchProfileInto(profileId, target),
        launchTimeout(profileId, profile?.installStatus === "installed", t),
      ]);
      if (res === "launched") {
        useApp.getState().setGameRunning(true);
        useApp.getState().setRunningProfileId(profileId);
        toast(t("common.launching", { name: profile?.name ?? "" }));
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setStartingKey(null);
      useApp.getState().setStartingProfileId(null);
    }
  };

  const playButton = (key: string, target: { world?: string; server?: string }, title: string) => (
    <button
      onClick={() => play(key, target)}
      title={title}
      aria-label={title}
      className="w-9 h-9 shrink-0 rounded-lg bg-accent hover:bg-accent/80 text-white flex items-center justify-center transition disabled:opacity-50"
    >
      {startingKey === key ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Play className="w-4 h-4 fill-current" />
      )}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("worlds.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("worlds.sub")}
          </p>
        </div>
        <div className="w-56 shrink-0">
          <SelectInput
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <RefreshButton onClick={() => load(true)} loading={refreshing} title={t("common.refresh")} />
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-1 w-fit p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          {(["worlds", "servers", "screenshots", "crashes"] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={cx(
                "px-4 py-1.5 rounded-lg text-[13px] font-medium transition capitalize",
                tab === tabKey ? "bg-accent text-white" : "text-white/55 hover:text-white"
              )}
            >
              {tabKey === "worlds"
                ? t("worlds.tabWorlds")
                : tabKey === "screenshots"
                  ? t("worlds.tabScreenshots")
                  : tabKey === "crashes"
                    ? t("worlds.tabCrashes")
                    : t("worlds.tabServers")}{" "}
              ({tabKey === "worlds" ? worlds.length : tabKey === "screenshots" ? shots.length : tabKey === "crashes" ? crashes.length : servers.length})
            </button>
          ))}
        </div>
        {tab === "servers" && profileId && (
          <Button size="sm" onClick={() => openServerModal()}>
            <Plus className="w-3.5 h-3.5" /> {t("worlds.addServer")}
          </Button>
        )}
      </div>

      {!profileId ? (
        <Card className="p-8 text-white/45 text-sm">{t("worlds.createFirst")}</Card>
      ) : loading ? (
        <SpinnerBlock label={t("common.loading")} />
      ) : tab === "worlds" && worlds.length === 0 ? (
        <Card className="p-8"><EmptyState icon={<Box />} title={t("worlds.emptyWorlds")} body={t("worlds.emptyWorldsBody")} /></Card>
      ) : tab === "screenshots" && shots.length === 0 ? (
        <Card className="p-8"><EmptyState icon={<Camera />} title={t("worlds.emptyShots")} body={t("worlds.emptyShotsBody")} /></Card>
      ) : tab === "crashes" && crashes.length === 0 ? (
        <Card className="p-8"><EmptyState icon={<FileWarning />} title={t("worlds.emptyCrashes")} body={t("worlds.emptyCrashesBody")} /></Card>
      ) : tab === "servers" && servers.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<Globe />}
            title={t("worlds.emptyServers")}
            body={t("worlds.emptyServersBody")}
            action={
              <Button onClick={() => openServerModal()}>
                <Plus className="w-4 h-4" /> {t("worlds.addServer")}
              </Button>
            }
          />
        </Card>
      ) : tab === "servers" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {servers.map((s) => (
            <Card key={`${s.name}-${s.ip}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
                    <div className="text-[14px] font-semibold text-white truncate">{s.name}</div>
                  </div>
                  <div className="text-[11px] text-white/40 mt-1 font-mono">{s.ip}</div>
                  <div className="mt-2 flex gap-1.5">
                    <Badge tone="blue">Multiplayer</Badge>
                    {s.acceptTextures && <Badge tone="green">{t("worlds.acceptTextures")}</Badge>}
                  </div>
                </div>
                {playButton(`server:${s.ip}`, { server: s.ip }, t("worlds.playServer"))}
              </div>
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => openServerModal(s)}>
                  <Pencil className="w-3.5 h-3.5" /> {t("common.edit")}
                </Button>
                <Button size="sm" variant="ghost" className="text-white/40 hover:text-red-400" onClick={() => removeServer(s)}>
                  <Trash2 className="w-3.5 h-3.5" /> {t("worlds.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : tab === "worlds" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {worlds.map((w) => (
            <Card key={w.folder} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-white truncate">{w.name}</div>
                  <div className="text-[11px] text-white/40 mt-0.5">
                    {w.levelName ? `${w.levelName} · ` : ""}
                    {fmtBytes(w.sizeBytes)} · {timeAgo(w.modified * 1000)}
                  </div>
                  {w.gameMode && (
                    <div className="mt-2 flex gap-1.5">
                      <Badge tone="blue">{w.gameMode}</Badge>
                      {w.players && <Badge>{t("worlds.players", { n: String(w.players) })}</Badge>}
                    </div>
                  )}
                </div>
                {playButton(`world:${w.folder}`, { world: w.folder }, t("worlds.playWorld"))}
              </div>
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <Button size="sm" onClick={() => backup(w)}>
                  <Archive className="w-3.5 h-3.5" /> {t("worlds.backup")}
                </Button>
                <Button size="sm" onClick={() => showBackups(w)}>
                  <Box className="w-3.5 h-3.5" /> {t("worlds.backups")}
                </Button>
                <Button size="sm" variant="ghost" className="text-white/40 hover:text-red-400" onClick={() => del(w)}>
                  <Trash2 className="w-3.5 h-3.5" /> {t("worlds.delete")}
                </Button>
              </div>
            </Card>
          ))}

          <div className="md:col-span-2 flex items-center gap-3 text-[12px] text-white/40 px-2">
            <Button size="sm" variant="ghost" onClick={() => profileId && api.openGameDir(profileId).catch((e) => toast(e))}>
              <FolderOpen className="w-3.5 h-3.5" /> {t("launcher.openDir")}
            </Button>
          </div>
        </div>
      ) : tab === "screenshots" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {shots.map((s) => (
            <Card key={s.path} className="overflow-hidden">
              <div className="aspect-video bg-black flex items-center justify-center">
                <img src={`file://${s.path}`} alt={s.name} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-white truncate">{s.name}</div>
                  <div className="text-[10px] text-white/40">{fmtBytes(s.sizeBytes)} · {timeAgo(s.modified * 1000)}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => api.openPath(s.path).catch((e) => toast(e))}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {crashes.map((c) => (
            <Card key={c.path} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-white truncate">{c.name}</div>
                <div className="text-[11px] text-white/40">{timeAgo(c.modified * 1000)}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => setCrashView(c)}>
                  <FileWarning className="w-3.5 h-3.5" /> {t("worlds.view")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => api.openPath(c.path).catch((e) => toast(e))}>
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!crashView} onClose={() => setCrashView(null)} title={t("worlds.crashTitle")} wide>
        <pre className="text-[11px] font-mono text-amber-200/80 bg-black/30 rounded-lg p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap">
          {crashView?.content ?? ""}
        </pre>
      </Modal>

      <Modal open={!!backupFolder} onClose={() => setBackupFolder(null)} title={t("worlds.backupsTitle")}>
        {backups.length === 0 ? (
          <p className="text-sm text-white/45">{t("worlds.noBackups")}</p>
        ) : (
          <div className="space-y-2">
            {backups.map((b) => (
              <div key={b} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-white/80 truncate">{b}</span>
                <Button size="sm" onClick={() => restore(b)}>
                  <RotateCcw className="w-3.5 h-3.5" /> {t("worlds.restore")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal open={!!serverEdit} onClose={() => setServerEdit(null)} title={serverEdit ? t("worlds.editServer") : t("worlds.addServer")}>
        <div className="space-y-4">
          <Field label={t("worlds.serverName")}>
            <TextInput
              value={serverDraft.name}
              placeholder={t("worlds.serverNamePh")}
              onChange={(e) => setServerDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label={t("worlds.serverIp")} hint={t("worlds.serverIpHint")}>
            <TextInput
              value={serverDraft.ip}
              placeholder={t("worlds.serverIpPh")}
              className="font-mono"
              onChange={(e) => setServerDraft((d) => ({ ...d, ip: e.target.value }))}
            />
          </Field>
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[13px] text-white/70">{t("worlds.acceptTextures")}</span>
            <Toggle
              checked={serverDraft.acceptTextures}
              onChange={(v) => setServerDraft((d) => ({ ...d, acceptTextures: v }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setServerEdit(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={saveServer}
              loading={serverSaving}
              disabled={!serverDraft.name.trim() || !serverDraft.ip.trim()}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}