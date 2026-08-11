import { useEffect, useState } from "react";
import { Wrench, Download, CheckCircle2, FolderOpen } from "lucide-react";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import type { JavaInfo } from "../lib/types";
import { Badge, Button, Card, EmptyState, ProgressBar, RefreshButton, SpinnerBlock } from "../components/ui";
import { useT } from "../lib/i18n";

export default function JavaPage() {
  const t = useT();
  const [runtimes, setRuntimes] = useState<JavaInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const { installs } = useApp();
  const javaProg = Object.values(installs).find((p) => p?.profileId.startsWith("java")) ?? null;

  const load = (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setRefreshing(!!quiet);
    api
      .javaList()
      .then(setRuntimes)
      .catch((e) => toast(e))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => load(), []);

  const install = async (tag: string) => {
    setInstalling(tag);
    try {
      await api.javaInstall(tag);
      toast(t("java.installed", { tag }));
      load();
    } catch (e) {
      toast(String(e));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("java.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("java.sub")}
          </p>
        </div>
        <RefreshButton onClick={() => load(true)} loading={refreshing} title={t("common.refresh")} />
      </div>

      {javaProg && javaProg.status === "progress" && (
        <Card className="p-4">
          <div className="flex justify-between text-[12px] text-white/50 mb-2">
            <span>{javaProg.message || t("java.downloading")}</span>
            <span>{Math.round(javaProg.percent)}%</span>
          </div>
          <ProgressBar percent={javaProg.percent} />
        </Card>
      )}

      {loading ? (
        <SpinnerBlock label={t("java.checking")} />
      ) : runtimes.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={<Wrench className="w-5 h-5" />}
            title={t("java.empty")}
            body={t("java.emptyBody")}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {runtimes.map((r) => (
            <Card key={r.tag} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-white">{r.tag}</span>
                  <Badge tone={r.usable ? "green" : "neutral"}>{r.version}</Badge>
                </div>
                <div className="text-[11px] text-white/40 mt-1 truncate">{r.path}</div>
                <div className="text-[11px] text-white/35 mt-0.5 capitalize">{r.kind} {t("java.kind")}</div>
              </div>
              {r.usable ? (
                <span className="flex items-center gap-1.5 text-green-400 text-[12px] font-medium shrink-0">
                  <CheckCircle2 className="w-4 h-4" /> {t("java.ready")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  loading={installing === r.tag}
                  onClick={() => install(r.tag)}
                >
                  <Download className="w-3.5 h-3.5" /> {t("java.installTag", { tag: r.tag })}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[12px] text-white/40">
        <Button size="sm" variant="ghost" onClick={() => api.paths().then((p) => api.openPath(p.managedJavaDir).catch((e) => toast(e)))}>
          <FolderOpen className="w-3.5 h-3.5" /> {t("java.openFolder")}
        </Button>
        <span>{t("java.storedIn")}</span>
      </div>
    </div>
  );
}