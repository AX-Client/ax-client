import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cx } from "./ui";

export default function TitleBar() {
  const t = useT();
  const [version, setVersion] = useState("0.1.0");
  const [online] = useState(true);

  useEffect(() => {
    api.appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header className="h-10 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-black/[0.18] backdrop-blur-2xl saturate-150 drag">
      <div className="flex items-center gap-2 text-[11px] text-white/35">
        <img src="/icon.png" alt="AzrealX" className="w-4 h-4 rounded-[4px] object-cover" />
        <span>{t("titleBar.name")}</span>
        <span className="w-1 h-1 rounded-full bg-white/15" />
        <span className="text-white/25">v{version}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full",
            online ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}
        >
          <span className={cx("w-1.5 h-1.5 rounded-full", online ? "bg-green-400" : "bg-red-400")} />
          {online ? t("titleBar.online") : t("titleBar.offline")}
        </span>
      </div>
    </header>
  );
}