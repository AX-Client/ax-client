import { useState } from "react";
import { Lock, Crown, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { Button } from "./ui";

export default function PaywallModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [opening, setOpening] = useState(false);

  const upgrade = async () => {
    setOpening(true);
    try {
      const cfg = await api.monetConfig();
      if (cfg.paywall_url) await api.openUrl(cfg.paywall_url);
    } catch {
      /* leave the modal open; user can retry */
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[440px] rounded-xl2 bg-[#17171b] border border-white/[0.08] shadow-lifted p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center">
              <Crown className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-white">{t("monet.title")}</h2>
              <p className="text-xs text-white/45 mt-0.5">{t("monet.sub")}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[13px] text-white/70 flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-accent shrink-0" />
          {t("monet.freeHint")}
        </div>
        <Button variant="primary" className="w-full mt-4" onClick={upgrade} loading={opening}>
          <ExternalLink className="w-3.5 h-3.5" /> {t("monet.upgrade")}
        </Button>
        <p className="text-[11px] text-white/35 mt-3 text-center">{t("monet.openBrowserNote")}</p>
      </div>
    </div>
  );
}
