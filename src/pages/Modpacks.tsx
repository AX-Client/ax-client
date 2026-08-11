import { useEffect, useState } from "react";
import { FolderOpen, PackagePlus, FileDown, Archive } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import type { InstalledPackage } from "../lib/types";
import { Badge, Button, Card, EmptyState, RefreshButton, SelectInput, SpinnerBlock } from "../components/ui";
import { useT } from "../lib/i18n";

export default function ModpacksPage() {
  const t = useT();
  const { profiles, refreshProfiles } = useApp();
  const [profileId, setProfileId] = useState<string>("");
  const [files, setFiles] = useState<InstalledPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];

  useEffect(() => {
    if (!profileId && profiles.length) setProfileId(profiles[0].id);
  }, [profiles, profileId]);

  const load = (quiet?: boolean) => {
    if (!profileId) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    api
      .modpackListFiles(profileId)
      .then(setFiles)
      .catch((e) => toast(e))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => load(), [profileId]);

  const importModpack = async () => {
    if (!profile) return;
    const res = await open({
      multiple: false,
      filters: [
        { name: t("modpacks.filter"), extensions: ["zip", "mrpack"] },
      ],
    });
    if (!res) return;
    setBusy(true);
    try {
      await api.modpackImport(profile.id, res as string);
      await refreshProfiles();
      toast(t("modpacks.imported"));
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportModpack = async () => {
    if (!profile) return;
    setBusy(true);
    const dest = `/tmp/azrealx-${profile.id}.zip`;
    try {
      await api.modpackExport(profile.id, dest);
      await api.openPath("/tmp");
      toast(t("modpacks.exported", { path: dest }));
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("modpacks.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("modpacks.sub")}
          </p>
        </div>
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
        <RefreshButton onClick={() => load(true)} loading={refreshing} title={t("common.refresh")} />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" loading={busy} onClick={importModpack}>
          <PackagePlus className="w-4 h-4" /> {t("modpacks.importBtn")}
        </Button>
        <Button loading={busy} onClick={exportModpack}>
          <Archive className="w-4 h-4" /> {t("modpacks.export")}
        </Button>
        <Button
          onClick={() => profile && api.openGameDir(profile.id).catch((e) => toast(e))}
        >
          <FolderOpen className="w-4 h-4" /> {t("modpacks.gameDir")}
        </Button>
      </div>

      {!profile ? (
        <Card className="p-8 text-white/45 text-center text-sm">
          {t("worlds.createFirst")}
        </Card>
      ) : loading ? (
        <SpinnerBlock label={t("modpacks.loading")} />
      ) : files.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={<FileDown className="w-5 h-5" />}
            title={t("modpacks.emptyTitle")}
            body={t("modpacks.emptyBody")}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.05]">
          {files.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                  <Archive className="w-4 h-4 text-white/40" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-white truncate">
                    {p.name}
                    <span className="ml-2 text-[11px] text-white/35">
                      {p.version && `v${p.version}`} · {p.source}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/40 truncate">{p.fileName}</div>
                </div>
              </div>
              <Badge tone={p.enabled ? "green" : "neutral"}>
                {p.enabled ? t("modpacks.enabled") : t("modpacks.disabled")}
              </Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}