import { create } from "zustand";
import { api } from "./api";
import type { InstallProgress, Profile, Settings } from "./types";

interface AppStore {
  booted: boolean;
  settings: Settings | null;
  profiles: Profile[];
  accountCount: number;
  appVersion: string;
  installs: Record<string, InstallProgress | null>;
  gameRunning: boolean;
  runningProfileId: string | null;
  errors: string[];
  accountRefreshTick: number;

  boot: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  bumpAccountRefresh: () => void;
  clearErrors: () => void;
  setGameRunning: (v: boolean) => void;
  setRunningProfileId: (v: string | null) => void;
  setInstall: (id: string, p: InstallProgress | null) => void;
  launchingProfileId: string | null;
  setLaunchingProfileId: (v: string | null) => void;
  startingProfileId: string | null;
  setStartingProfileId: (v: string | null) => void;
  languageDraft: string | null;
  setLanguageDraft: (l: string | null) => void;
  stop: () => Promise<boolean>;
  page: string;
  setPage: (p: string) => void;
}

export const useApp = create<AppStore>((set) => ({
  booted: false,
  settings: null,
  profiles: [],
  accountCount: 0,
  appVersion: "",
  installs: {},
  gameRunning: false,
  errors: [],
  runningProfileId: null,
  launchingProfileId: null,
  startingProfileId: null,
  languageDraft: null,
  page: "launcher",
  accountRefreshTick: 0,

  async boot() {
    try {
      const [version, settings, profiles, accounts, gs] = await Promise.all([
        api.appVersion(),
        api.getSettings(),
        api.profiles(),
        api.accounts(),
        api.gameStatus().catch(() => null),
      ]);
      set({
        appVersion: version,
        settings,
        profiles,
        accountCount: accounts.length,
        gameRunning: gs != null,
        runningProfileId: gs?.profileId ?? null,
        booted: true,
      });
    } catch (e) {
      set({ booted: true, errors: [String(e)] });
    }
  },

  async refreshProfiles() {
    try {
      set({ profiles: await api.profiles() });
    } catch (e) {
      set((s) => ({ errors: [...s.errors.slice(-4), String(e)] }));
    }
  },

  async refreshAccounts() {
    try {
      const accounts = await api.accounts();
      set({ accountCount: accounts.length });
    } catch (e) {
      set((s) => ({ errors: [...s.errors.slice(-4), String(e)] }));
    }
  },

  bumpAccountRefresh: () => set((s) => ({ accountRefreshTick: s.accountRefreshTick + 1 })),

  clearErrors: () => set({ errors: [] }),
  setGameRunning: (v) => set({ gameRunning: v }),
  setRunningProfileId: (v) => set({ runningProfileId: v }),
  setInstall: (id, p) => set((s) => ({ installs: { ...s.installs, [id]: p } })),
  setLaunchingProfileId: (v) => set({ launchingProfileId: v }),
  setStartingProfileId: (v) => set({ startingProfileId: v }),
  setLanguageDraft: (l) => set({ languageDraft: l }),
  async stop() {
    try {
      await api.stopGame();
    } catch {
      return false;
    }
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const gs = await api.gameStatus().catch(() => null);
      if (!gs || gs.status === "exited") break;
    }
    set({ gameRunning: false, runningProfileId: null });
    return true;
  },
  setPage: (p) => set({ page: p }),
}));

const toastSubs = new Set<(m: string) => void>();
export function toast(m: string) {
  toastSubs.forEach((fn) => fn(m));
}
export function onToast(fn: (m: string) => void): () => void {
  toastSubs.add(fn);
  return () => {
    toastSubs.delete(fn);
  };
}