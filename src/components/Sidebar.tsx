import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Newspaper,
  Gamepad2,
  Layers,
  Boxes,
  Wrench,
  Globe,
  FolderArchive,
  UserCircle,
  Settings,
  Sparkles,
  Crown,
  Play,
  Square,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { useApp, toast } from "../lib/store";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cx } from "./ui";
import type { Account, Profile } from "../lib/types";

export type Page =
  | "launcher"
  | "versions"
  | "mods"
  | "modpacks"
  | "java"
  | "accounts"
  | "worlds"
  | "customize"
  | "settings"
  | "news"
  | "premium";

const NAV: Array<{ id: Page; labelKey: string; icon: typeof Gamepad2; sectionKey: string; badge?: string }> = [
  { id: "launcher", labelKey: "nav.home", icon: Sparkles, sectionKey: "nav.play" },
  { id: "versions", labelKey: "nav.versions", icon: Layers, sectionKey: "nav.play" },
  { id: "mods", labelKey: "nav.mods", icon: Boxes, sectionKey: "nav.play" },
  { id: "modpacks", labelKey: "nav.modpacks", icon: FolderArchive, sectionKey: "nav.play" },
  { id: "worlds", labelKey: "nav.worlds", icon: Globe, sectionKey: "nav.play" },
  { id: "customize", labelKey: "nav.customize", icon: SlidersHorizontal, sectionKey: "nav.play" },
  { id: "premium", labelKey: "nav.premium", icon: Crown, sectionKey: "nav.plus", badge: "PRO" },
  { id: "accounts", labelKey: "nav.accounts", icon: UserCircle, sectionKey: "nav.system" },
  { id: "java", labelKey: "nav.java", icon: Wrench, sectionKey: "nav.system" },
  { id: "news", labelKey: "nav.news", icon: Newspaper, sectionKey: "nav.system" },
  { id: "settings", labelKey: "nav.settings", icon: Settings, sectionKey: "nav.system" },
];

export default function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const t = useT();
  const { gameRunning, runningProfileId, startingProfileId, profiles, refreshProfiles } = useApp();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [update, setUpdate] = useState<{ current?: string; latest?: string | null; upToDate: boolean; url?: string | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [stopping, setStopping] = useState(false);

  const runningProfile: Profile | null = profiles.find((p) => p.id === runningProfileId) ?? null;

  useEffect(() => {
    api.checkUpdate().then((u) => setUpdate(u)).catch(() => setUpdate({ upToDate: true }));
  }, []);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => {});
  }, []);

  const last: Profile | null = (() => {
    const sorted = [...profiles].sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""));
    return sorted[0] ?? null;
  })();
  const me = accounts[0];

  const quickPlay = async () => {
    if (!last) {
      onNavigate("versions");
      return;
    }
    setPlaying(true);
    useApp.getState().setStartingProfileId(last.id);
    try {
      if (last.installStatus !== "installed") {
        await api.installProfile(last.id);
        await refreshProfiles();
      }
      const res = await Promise.race([
        api.launchProfile(last.id),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(t("launcher.launchTimeout"))), 45000)),
      ]);
      if (res === "launched") {
        useApp.getState().setGameRunning(true);
        useApp.getState().setRunningProfileId(last.id);
        toast(t("common.launching", { name: last.name }));
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setPlaying(false);
      useApp.getState().setStartingProfileId(null);
    }
  };

  const stopGame = async () => {
    setStopping(true);
    const ok = await useApp.getState().stop();
    setStopping(false);
    if (ok) toast(t("launcher.stopped"));
  };

  let lastSection = "";

  return (
    <aside className="w-60 shrink-0 h-full flex flex-col border-r border-white/[0.06] bg-[#0b0c10]/60 backdrop-blur-2xl">
      <button
        onClick={() => onNavigate("launcher")}
        className="group px-5 h-[74px] flex items-center gap-3 no-drag w-full transition-colors hover:bg-white/[0.04] active:scale-[0.98]"
      >
        <img
          src="/icon.png"
          alt="AzrealX"
          className="w-10 h-10 rounded-[13px] object-cover shadow-[0_4px_14px_rgba(0,113,227,0.35)] transition-transform group-hover:scale-105 group-active:scale-95"
        />
        <div className="text-left min-w-0">
          <div className="text-[17px] font-semibold tracking-tight text-white leading-none">AX Client</div>
          <div className="text-[10px] text-white/40 mt-1.5 leading-none tracking-[0.14em]">{t("common.subline")}</div>
        </div>
      </button>

      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-0.5 no-drag">
        {NAV.map((item, i) => {
          const sectionHeader = item.sectionKey !== lastSection ? t(item.sectionKey) : null;
          lastSection = item.sectionKey;
          const active = page === item.id;
          return (
            <div key={item.id}>
              {sectionHeader && (
                <div className="mt-3.5 mb-1.5 px-2 text-[9.5px] font-semibold tracking-[0.12em] text-white/25">
                  {sectionHeader}
                </div>
              )}
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.04, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => onNavigate(item.id)}
                className={cx(
                  "relative w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[10px] text-[13px] font-medium transition-colors duration-200 active:scale-[0.98]",
                  active ? "text-white" : "text-white/50 hover:text-white/90 hover:bg-white/[0.05]"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-[10px] glass-soft shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5 w-full min-w-0">
                  <item.icon
                    className={cx(
                      "w-4 h-4 shrink-0 transition-all duration-300",
                      active
                        ? "text-accent drop-shadow-[0_0_6px_rgba(0,113,227,0.7)]"
                        : "text-white/35"
                    )}
                  />
                  <span className="truncate">{t(item.labelKey)}</span>
                  {item.badge && (
                    <span className="ml-auto text-[8px] font-bold tracking-[0.1em] px-1.5 py-0.5 rounded-md bg-gradient-to-b from-amber-300 to-amber-500 text-black">
                      {item.badge}
                    </span>
                  )}
                  {item.id === "launcher" && gameRunning && (
                    <span className="ml-auto w-2 h-2 rounded-full bg-green-500 animate-pulseSoft shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
                  )}
                </span>
              </motion.button>
            </div>
          );
        })}
      </nav>

      {update && !update.upToDate && update.latest && (
        <button
          onClick={() => {
            if (update.url) api.openPath("x-safari-https://" + update.url.replace(/^https?:\/\//, ""));
          }}
          className="mx-3 mb-3 px-3 py-2.5 rounded-xl glass-soft text-left no-drag hover:bg-white/[0.08] transition"
        >
          <div className="text-[12px] font-semibold text-accent">
            {t("sidebar.available", { v: update.latest })}
          </div>
          <div className="text-[11px] text-white/50">{t("sidebar.updateDesc")}</div>
        </button>
      )}

      <div className="px-3 pb-3 shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[18px] glass-soft p-3 no-drag"
        >
          <div className="flex items-center gap-2.5">
            {me ? (
              me.picture ? (
                <img
                  src={convertFileSrc(me.picture)}
                  alt={me.playerName}
                  className="w-9 h-9 rounded-xl object-cover border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 64 64" className="w-5 h-5" aria-hidden>
                    <circle cx="32" cy="24" r="13" fill="#8b93a0" />
                    <path d="M6 62C8 47 18 40 32 40s24 7 26 22z" fill="#8b93a0" />
                  </svg>
                </div>
              )
            ) : (
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent/30 to-[#5e5ce6]/30 border border-white/10 flex items-center justify-center shrink-0">
                <Gamepad2 className="w-4 h-4 text-white/70" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold tracking-[0.12em] text-white/35 uppercase">
                {gameRunning ? t("sidebar.nowPlaying") : t("sidebar.quickResume")}
              </div>
              <div className="text-[13px] font-semibold text-white truncate leading-tight mt-0.5">
                {(runningProfile ?? last) ? (runningProfile ?? last)!.name : me ? me.playerName : t("sidebar.noProfile")}
              </div>
            </div>
            {gameRunning && (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulseSoft shadow-[0_0_8px_rgba(34,197,94,0.9)] shrink-0" />
            )}
          </div>

          {(runningProfile ?? last) && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] text-white/55">
                MC {runningProfile?.gameVersion ?? last!.gameVersion}
              </span>
              <span
                className={cx(
                  "px-1.5 py-0.5 rounded-md border text-[10px] capitalize",
                  (runningProfile ?? last)!.loader === "vanilla"
                    ? "bg-white/[0.06] border-white/[0.08] text-white/55"
                    : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                )}
              >
                {(runningProfile ?? last)!.loader}
              </span>
            </div>
          )}

          {gameRunning ? (
            <button
              onClick={stopGame}
              disabled={stopping}
              className={cx(
                "mt-2.5 w-full flex items-center justify-center gap-2 rounded-[11px] px-3 py-2 text-[13px] font-medium transition-all duration-200 active:scale-[0.98]",
                "bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 hover:border-red-500/50",
                stopping && "opacity-60 pointer-events-none"
              )}
            >
              {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
              {stopping ? t("launcher.stopping") : t("launcher.stop")}
            </button>
          ) : (
            <button
              onClick={quickPlay}
              disabled={!last || playing}
              className={cx(
                "mt-2.5 w-full flex items-center justify-center gap-2 rounded-[11px] px-3 py-2 text-[13px] font-medium transition-all duration-200 active:scale-[0.98]",
                "btn-sheen bg-gradient-to-b from-accent-hover to-accent text-white",
                "shadow-[0_6px_18px_rgba(0,113,227,0.38),inset_0_1px_0_rgba(255,255,255,0.28)] hover:brightness-110",
                (!last || playing) && "opacity-50 pointer-events-none"
              )}
            >
              {playing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {playing
                ? t("sidebar.starting")
                : last
                  ? t("sidebar.playNow")
                  : t("sidebar.createProfile")}
            </button>
          )}
        </motion.div>
      </div>

      <div className="px-5 py-3.5 border-t border-white/[0.06] flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-2">
          {gameRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
              <span className="text-[11px] text-green-400">{t("sidebar.gameRunning")}</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-white/15" />
              <span className="text-[11px] text-white/40">{t("sidebar.idle")}</span>
            </>
          )}
        </div>
        <span className="text-[10px] text-white/25">{update?.current ? `v${update.current}` : ""}</span>
      </div>
      <div className="px-5 pb-2 text-[9px] font-mono text-white/20 leading-snug">
        {gameRunning ? "RUN" : "idle"}{(runningProfileId ? "·rid:" + runningProfileId.slice(0, 4) : "")}
        {startingProfileId ? " ·START" : ""}{stopping ? " ·STOP" : ""}
      </div>
    </aside>
  );
}