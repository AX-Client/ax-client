import { useEffect, useState } from "react";
import { Crown, Check, Cloud, CloudUpload, CloudDownload, Globe, Sparkles, Zap, LifeBuoy, Rocket, ExternalLink } from "lucide-react";
import { api, toast } from "../lib/api";
import type { PremiumStatus } from "../lib/types";
import { useApp } from "../lib/store";
import { useT } from "../lib/i18n";
import { Button, Card } from "../components/ui";
import PaywallModal from "../components/PaywallModal";

type Action = { id: string; labelKey: string };

const FEATURES: Array<{ icon: typeof Cloud; titleKey: string; descKey: string; action?: Action }> = [
  { icon: CloudUpload, titleKey: "prem.featCloudTitle", descKey: "prem.featCloud", action: { id: "sync", labelKey: "prem.actSync" } },
  { icon: CloudDownload, titleKey: "monet.cloudRestore", descKey: "prem.featCloud", action: { id: "restore", labelKey: "prem.actRestore" } },
  { icon: Globe, titleKey: "prem.featWorldTitle", descKey: "prem.featWorld", action: { id: "worlds", labelKey: "prem.actWorlds" } },
  { icon: Sparkles, titleKey: "prem.featCosmeticsTitle", descKey: "prem.featCosmetics" },
  { icon: Rocket, titleKey: "prem.featEarlyTitle", descKey: "prem.featEarly" },
  { icon: Zap, titleKey: "prem.featPriorityTitle", descKey: "prem.featPriority" },
  { icon: LifeBuoy, titleKey: "prem.featSupportTitle", descKey: "prem.featSupport" },
];

const PLANS = [
  { id: "month", price: "2,99", per: "prem.perMonth", tagKey: null },
  { id: "year", price: "24,99", per: "prem.perYear", tagKey: "prem.bestValue", best: true },
  { id: "lifetime", price: "79,99", per: "prem.once", tagKey: null },
];

export default function PremiumPage() {
  const t = useT();
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);

  useEffect(() => {
    api.premiumStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const openPaywall = async () => {
    try {
      const cfg = await api.monetConfig();
      if (cfg.paywall_url) await api.openUrl(cfg.paywall_url);
      else toast(t("prem.noPaywall"));
    } catch (e) {
      toast(String(e));
    }
  };

  const premium = status?.tier === "premium";

  const runSync = async () => {
    setBusy("sync");
    try {
      const res = await api.cloudSync();
      toast(t(res.cloud_stub ? "monet.cloudStub" : "monet.cloudSynced"));
    } catch (e) {
      const m = String(e);
      toast(m.includes("cloud_sync_game_running") ? t("monet.cloudSyncGameRunning") : m);
    } finally {
      setBusy(null);
    }
  };

  const runRestore = async () => {
    if (!confirm(t("monet.cloudRestoreConfirm"))) return;
    setBusy("restore");
    try {
      const res = await api.cloudRestore();
      if (!res.options) {
        toast(t("monet.cloudEmpty"));
        return;
      }
      await api.setSettings({ gameOptions: res.options });
      toast(t(res.cloud_stub ? "monet.cloudStub" : "monet.cloudRestored"));
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
    }
  };

  const runWorlds = async () => {
    useApp.getState().setPage("worlds");
    toast(t("prem.goWorldsHint"));
  };

  const ACTIONS: Record<string, () => Promise<void>> = {
    sync: runSync,
    restore: runRestore,
    worlds: runWorlds,
  };

  const runAction = (a: Action) => {
    if (!premium) {
      setPaywall(true);
      return;
    }
    void ACTIONS[a.id]();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/25 flex items-center justify-center">
            <Crown className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold text-white tracking-tight">{t("prem.title")}</h1>
            <p className="text-sm text-white/45 mt-0.5">{t("prem.sub")}</p>
          </div>
        </div>
        <div
          className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold shrink-0 ${
            premium
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-white/[0.04] border-white/[0.08] text-white/50"
          }`}
        >
          {premium ? t("prem.active") : t("prem.freeTier")}
        </div>
      </div>

      {premium && status?.expires_at && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-[12px] text-emerald-200/80 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {t("prem.until", { date: new Date(status.expires_at * 1000).toLocaleDateString() })}
        </div>
      )}

      <Card className="p-6">
        <h2 className="text-[15px] font-semibold text-white">{t("prem.featuresTitle")}</h2>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {FEATURES.map((f) => (
            <div key={f.titleKey} className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/20 flex items-center justify-center shrink-0">
                <f.icon className="w-4 h-4 text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-white/85">{t(f.titleKey)}</div>
                <div className="text-[12px] text-white/45 mt-0.5">{t(f.descKey)}</div>
              </div>
              {f.action && (
                <div className="shrink-0">
                  <Button size="sm" variant="secondary" loading={busy === f.action.id} onClick={() => runAction(f.action!)}>
                    {t(f.action.labelKey)}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {paywall && <PaywallModal onClose={() => setPaywall(false)} />}

      <div className="grid sm:grid-cols-3 gap-4">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`relative rounded-xl2 border p-5 flex flex-col ${
              p.best ? "border-amber-400/40 bg-amber-400/[0.05]" : "border-white/[0.08] bg-[#17171b]"
            }`}
          >
            {p.tagKey && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-[10px] font-bold text-black">
                {t(p.tagKey)}
              </span>
            )}
            <div className="flex items-baseline gap-1.5">
              <span className="text-[28px] font-bold text-white tracking-tight">{p.price} €</span>
              <span className="text-[12px] text-white/40">{t(p.per)}</span>
            </div>
            <Button variant={p.best ? "primary" : "secondary"} className="w-full mt-4" onClick={openPaywall}>
              <ExternalLink className="w-3.5 h-3.5" /> {t("prem.get")}
            </Button>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-white/30 text-center">
        {t("prem.note")}
      </p>
    </div>
  );
}
