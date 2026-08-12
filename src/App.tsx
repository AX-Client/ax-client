import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "./lib/store";
import { api, toast } from "./lib/api";
import { applyAppearance } from "./lib/appearance";
import { useT } from "./lib/i18n";
import type { GameStatus, InstallProgress } from "./lib/types";
import Sidebar, { type Page } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import { Toasts } from "./components/ui";
import LauncherPage from "./pages/Launcher";
import VersionsPage from "./pages/Versions";
import ModsPage from "./pages/Mods";
import ModpacksPage from "./pages/Modpacks";
import WorldsPage from "./pages/Worlds";
import CustomizePage from "./pages/Customize";
import AccountsPage from "./pages/Accounts";
import JavaPage from "./pages/Java";
import SettingsPage from "./pages/Settings";
import NewsPage from "./pages/News";
import PremiumPage from "./pages/Premium";

interface DownloadEvent {
  batch: string;
  id: string;
  name: string;
  done: number;
  total: number;
  status: string;
  error?: string | null;
  speed?: number;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_INOUT = [0.65, 0, 0.35, 1] as const;
const ACCENT = "rgb(var(--accent))";
const ACCENT_SOFT = "rgba(var(--accent), 0.55)";

function Splash({ scene }: { scene: number }) {
  const t = useT();
  const particles = useRef(
    Array.from({ length: 8 }, (_, i) => ({
      id: i,
      x: (i * 83.7) % 100,
      size: 1.5 + ((i * 37) % 3),
      duration: 22 + ((i * 53) % 10),
      delay: ((i * 29) % 12),
      opacity: 0.08 + ((i * 17) % 10) / 60,
    }))
  ).current;
  const blobs = useRef([
    { id: 0, w: 620, h: 620, left: "-10%", top: "-20%", color: "rgba(var(--accent), 0.13)", x: [0, 110, -40, 0], y: [0, -60, 40, 0], d: 24 },
    { id: 1, w: 540, h: 540, left: "64%", top: "46%", color: "rgba(var(--accent), 0.09)", x: [0, -90, 60, 0], y: [0, 70, -30, 0], d: 30 },
    { id: 2, w: 470, h: 470, left: "28%", top: "60%", color: "rgba(255,255,255,0.045)", x: [0, 70, -60, 0], y: [0, -50, 30, 0], d: 36 },
  ]).current;
  const letters = "AX CLIENT".split("");

  return (
    <motion.div
      className="absolute inset-0 z-[100] overflow-hidden"
      style={{ background: "#07090f" }}
      exit={{ opacity: 0, scale: 1.06, transition: { duration: 0.9, ease: EASE_INOUT } }}
    >
      {/* ----- aurora drift ----- */}
      {blobs.map((b) => (
        <motion.div
          key={b.id}
          className="absolute pointer-events-none"
          style={{
            width: b.w,
            height: b.h,
            left: b.left,
            top: b.top,
            background: b.color,
            filter: "blur(90px)",
            borderRadius: "50%",
          }}
          animate={{ x: b.x, y: b.y }}
          transition={{ duration: b.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      {/* ----- floating dust ----- */}
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full bg-white pointer-events-none"
          style={{ left: `${p.x}%`, width: p.size, height: p.size, opacity: p.opacity }}
          animate={{ y: ["-8vh", "-112vh"] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "linear" }}
        />
      ))}

      {/* ----- vignette ----- */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ boxShadow: "inset 0 0 260px rgba(0,0,0,0.55)" }}
      />

      {/* ----- persistent emblem ----- */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        animate={{
          y: scene >= 2 ? -84 : 0,
          scale: scene >= 2 ? 0.97 : 1,
          rotate: scene >= 2 ? -1.6 : 0,
        }}
        transition={{ type: "spring", stiffness: 160, damping: 24, mass: 0.9 }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.86 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.1 }}
          className="relative"
        >
          {/* breathing glow */}
          <motion.div
            className="absolute -inset-14 rounded-full"
            style={{ boxShadow: `0 0 110px ${ACCENT_SOFT}` }}
            animate={{ opacity: [0.16, 0.42, 0.16] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* glass tile */}
          <div className="relative w-32 h-32 rounded-[36px] bg-white/[0.055] border border-white/[0.1] overflow-hidden flex items-center justify-center"
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.8), 0 0 60px rgba(var(--accent),0.25), inset 0 1px 0 rgba(255,255,255,0.14)" }}
          >
            <img src="/icon.png" alt="AzrealX" className="w-[74px] h-[74px] rounded-[26px] object-cover" />
            <motion.div
              className="absolute w-[60%] h-[220%]"
              style={{
                background: "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.10) 50%, transparent 100%)",
                transform: "rotate(20deg)",
              }}
              animate={{ x: ["-180%", "320%"] }}
              transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: "easeInOut" }}
            />
            <div
              className="absolute inset-0"
              style={{ boxShadow: "inset 0 0 24px rgba(var(--accent),0.16)" }}
            />
          </div>
          {/* floor light */}
          <motion.div
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-44 h-9 rounded-full"
            style={{ background: "radial-gradient(ellipse, rgba(var(--accent),0.28), transparent 70%)" }}
            animate={{ opacity: [0.22, 0.5, 0.22], scaleX: [0.85, 1.1, 0.85] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </motion.div>

      {/* ----- scene 1: expanding ring ----- */}
      <AnimatePresence>
        {scene === 1 && (
          <motion.div
            key="ring"
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            exit={{ opacity: 0, transition: { duration: 0.4, ease: "easeOut" } }}
          >
            <motion.div
              className="absolute w-40 h-40 rounded-full border"
              style={{ borderColor: ACCENT_SOFT }}
              animate={{ scale: [0.85, 2.0], opacity: [0.65, 0] }}
              transition={{ duration: 2.0, repeat: Infinity, ease: EASE_OUT }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----- scene 2: wordmark cascade ----- */}
      <AnimatePresence>
        {scene >= 2 && (
          <motion.div
            key="title"
            className="absolute inset-0 flex flex-col items-center justify-center pt-[150px] pointer-events-none"
            exit={{ opacity: 0, scale: 1.03, transition: { duration: 0.55, ease: EASE_INOUT } }}
          >
            <div className="flex items-baseline" style={{ letterSpacing: "0.09em", marginRight: "-0.09em" }}>
              {letters.map((ch, i) => (
                <motion.span
                  key={i}
                  className="relative select-none font-semibold"
                  style={{
                    fontSize: "clamp(44px, 9vw, 104px)",
                    fontWeight: 650,
                    color: ch === "X" ? ACCENT : "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    width: ch === " " ? "0.32em" : undefined,
                  }}
                  initial={{ opacity: 0, y: 26 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.06, duration: 0.7, ease: EASE_OUT }}
                >
                  {ch === "X" && (
                    <motion.span
                      className="absolute -inset-4 rounded-full"
                      style={{ background: `radial-gradient(circle, ${ACCENT_SOFT}, transparent 65%)` }}
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: [0, 0.7, 0], scale: [0.4, 1.6, 2.0] }}
                      transition={{ delay: 0.12 + i * 0.06 + 0.3, duration: 0.9, times: [0, 0.5, 1], ease: EASE_INOUT }}
                    />
                  )}
                  {ch}
                </motion.span>
              ))}
            </div>

            {/* reserved slot – line draws inside without shifting letters */}
            <div className="mt-2 relative w-64 h-6">
              {scene >= 3 && (
                <motion.div
                  className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
                  style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.75, ease: EASE_OUT }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----- scene 3: light surge ----- */}
      <AnimatePresence>
        {scene === 3 && (
          <motion.div
            key="surge"
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(620px 440px at 50% 44%, rgba(var(--accent),0.14), transparent 70%)" }}
            initial={{ opacity: 0, scale: 0.65 }}
            animate={{ opacity: [0, 0.8, 0.4], scale: 1.6 }}
            transition={{ duration: 1.8, times: [0, 0.45, 1], ease: EASE_INOUT }}
          />
        )}
      </AnimatePresence>

      {/* ----- status line ----- */}
      <motion.div
        className="absolute bottom-12 inset-x-0 flex items-center justify-center gap-2 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.7 }}
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full"
            style={{ background: ACCENT }}
            animate={{ opacity: [0.15, 0.9, 0.15], scale: [0.8, 1.15, 0.8] }}
            transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
          />
        ))}
        <span className="ml-3 text-[11px] uppercase tracking-[0.6em] text-white/25" style={{ marginRight: "-0.6em" }}>
          {t("app.starting")}
        </span>
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const t = useT();
  const boot = useApp((s) => s.boot);
  const booted = useApp((s) => s.booted);
  const setGameRunning = useApp((s) => s.setGameRunning);
  const setInstall = useApp((s) => s.setInstall);
  const refreshProfiles = useApp((s) => s.refreshProfiles);
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const settings = useApp((s) => s.settings);

  useEffect(() => {
    if (!booted) boot();
  }, [booted, boot]);

  useEffect(() => {
    if (!settings) return;
    const shallow = matchMedia("(prefers-color-scheme: light)");
    const apply = () => applyAppearance(settings.theme, settings.accent);
    apply();
    shallow.addEventListener("change", apply);
    return () => shallow.removeEventListener("change", apply);
  }, [settings]);

  const missedRef = useRef(0);
  useEffect(() => {
    if (!booted) return;
    const iv = setInterval(async () => {
      const app = useApp.getState();
      const gs = await api.gameStatus().catch(() => null);
      if (gs && gs.status !== "exited") {
        missedRef.current = 0;
        if (gs.profileId) app.setRunningProfileId(gs.profileId);
        if (!app.gameRunning) app.setGameRunning(true);
      } else if (!app.launchingProfileId && !app.startingProfileId && app.gameRunning) {
        missedRef.current += 1;
        if (missedRef.current >= 2) {
          missedRef.current = 0;
          app.setGameRunning(false);
          app.setRunningProfileId(null);
        }
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [booted]);

  useEffect(() => {
    if (!booted) return;
    const auto = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        // register with the backend (name/email/online status) on start and
        // periodically while the launcher runs
        await api.premiumStatus();
      } catch {
        // ignore: offline backend or no account
      }
      try {
        await api.refreshAllAccounts();
      } catch {
        // ignore: accounts without a refresh token are skipped backend-side
      }
      try {
        const received = await api.worldTransferPoll();
        for (const name of received) toast(t("worlds.transferReceived", { name }));
      } catch {
        // ignore: transfer polling is opportunistic
      }
      const app = useApp.getState();
      await app.refreshAccounts();
      await app.refreshProfiles();
      app.bumpAccountRefresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void auto();
    };
    document.addEventListener("visibilitychange", onVisible);
    const bootTimer = setTimeout(auto, 8000);
    const iv = setInterval(auto, 120000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(bootTimer);
      clearInterval(iv);
    };
  }, [booted, refreshProfiles]);

  useEffect(() => {
    const un1 = listen<GameStatus>("game", (e) => {
      const running = e.payload.status === "running" || e.payload.status === "preparing";
      setGameRunning(running);
      if (running) {
        useApp.getState().setRunningProfileId(e.payload.profileId);
        setInstall(e.payload.profileId, null);
      }
      if (!running) {
        useApp.getState().setRunningProfileId(null);
        setInstall(e.payload.profileId, null);
      }
      const launching = useApp.getState().launchingProfileId;
      if (launching && e.payload.status === "preparing") {
        const cur = useApp.getState().installs[launching];
        setInstall(launching, {
          ...(cur ?? { profileId: launching }),
          profileId: launching,
          phase: "launch",
          message: t("launcher.startingMinecraft"),
          status: "progress",
          percent: 100,
          done: 1,
          total: 1,
          speed: 0,
        });
      }
      if (e.payload.status === "running") {
        refreshProfiles();
      }
      if (e.payload.status === "exited" || e.payload.status === "error") {
        const id = useApp.getState().launchingProfileId;
        if (id) setInstall(id, null);
        refreshProfiles();
        useApp.getState().bumpAccountRefresh();
      }
    });
    const un2 = listen<InstallProgress>("install", (e) => {
      setInstall(e.payload.profileId, e.payload);
      if (e.payload.status === "done" || e.payload.status === "error") {
        refreshProfiles();
      }
    });
    const un3 = listen<InstallProgress>("java", (e) => {
      setInstall(e.payload.profileId || "java:runtime", e.payload);
      const launching = useApp.getState().launchingProfileId;
      if (launching) {
        setInstall(launching, {
          ...e.payload,
          profileId: launching,
          message: e.payload.message || t("launcher.installingJava"),
        });
      }
    });
    const un4 = listen<DownloadEvent>("download", (e) => {
      const { batch } = e.payload;
      let key: string | null = null;
      if (batch.startsWith("install:")) {
        key = batch.slice("install:".length).split(":")[0];
      } else if (batch.startsWith("java:")) {
        const tag = batch.slice("java:".length).split(":")[0];
        key = tag ? `java:${tag}` : null;
      }
      if (!key) return;
      const cur = useApp.getState().installs[key];
      const pct =
        e.payload.total > 0
          ? Math.min(100, Math.round((e.payload.done / e.payload.total) * 100))
          : 0;
      const file = e.payload.name.split("/").pop() ?? e.payload.name;
      const message = e.payload.status === "error" ? t("launcher.downloadFailed", { file }) : t("launcher.downloading", { file });
      const upd: InstallProgress = {
        profileId: cur ? cur.profileId : key,
        phase: cur ? cur.phase : "download",
        message,
        status:
          e.payload.status === "error" ? "error" : cur?.status === "error" ? "error" : "progress",
        percent: pct,
        done: e.payload.done,
        total: e.payload.total,
        speed: e.payload.speed ?? 0,
      };
      setInstall(key, upd);
      const launching = useApp.getState().launchingProfileId;
      if (launching && key.startsWith("java:")) {
        setInstall(launching, { ...upd, profileId: launching, message: t("launcher.preparingJava") });
      }
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
      un3.then((f) => f());
      un4.then((f) => f());
    };
  }, [booted, setInstall, refreshProfiles, setGameRunning]);

  const [splashDone, setSplashDone] = useState(false);
  const [scene, setScene] = useState(0);
  useEffect(() => {
    if (!booted) return;
    const timers = [1500, 3100, 4800, 6200].map((ms, i) => setTimeout(() => setScene(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [booted]);
  useEffect(() => {
    if (booted && scene >= 4) {
      const t = setTimeout(() => setSplashDone(true), 1200);
      return () => clearTimeout(t);
    }
  }, [booted, scene]);

  return (
    <>
      <div className="h-full w-full app-bg">
<motion.div
        className="h-full w-full flex flex-col"
        initial={false}
        animate={splashDone ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.8, ease: EASE_INOUT }}
      >
        <TitleBar />
          <div className="flex-1 flex min-h-0">
            <Sidebar page={page as Page} onNavigate={setPage} />
            <main className="flex-1 min-w-0 overflow-y-auto">
  <div className="h-full mx-auto max-w-[1280px] px-8 py-7">
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={page}
        initial={{ opacity: 0, y: 16, scale: 0.985, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -10, scale: 0.99, filter: "blur(6px)" }}
        transition={{ type: "spring", stiffness: 240, damping: 28, mass: 0.9 }}
        className="h-full"
      >
                {page === "launcher" && <LauncherPage />}
                {page === "versions" && <VersionsPage />}
                {page === "mods" && <ModsPage />}
                {page === "modpacks" && <ModpacksPage />}
                {page === "worlds" && <WorldsPage />}
                {page === "customize" && <CustomizePage />}
                {page === "accounts" && <AccountsPage />}
                {page === "java" && <JavaPage />}
                {page === "settings" && <SettingsPage />}
                {page === "news" && <NewsPage />}
                {page === "premium" && <PremiumPage />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <Toasts />
    </motion.div>
      </div>
      <AnimatePresence>{!splashDone && <Splash scene={scene} />}</AnimatePresence>
    </>
  );
}

// keep tree-shaking friendliness
export { api };