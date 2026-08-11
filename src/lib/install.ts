import type { InstallProgress } from "./types";
import { useApp } from "./store";

export interface InstallState {
  [profileId: string]: InstallProgress | null;
}

export const isActive = (p?: InstallProgress | null) =>
  !!p && (p.status === "progress" || p.status === "pending");

const busyStatuses = new Set(["progress", "download", "preparing", "pending"]);

/**
 * Promise that rejects after `base` ms — but keeps extending itself while an
 * install/download for the profile is still in progress (e.g. a managed Java
 * runtime being fetched for the first time). Prevents spurious
 * "starting took too long" errors on slow connections.
 */
export function launchTimeout(
  profileId: string,
  isInstalled: boolean,
  t: (key: string) => string
): Promise<never> {
  const base = isInstalled ? 45_000 : 120_000;
  return new Promise<never>((_, rej) => {
    const schedule = (delay: number) => {
      setTimeout(() => {
        const st = useApp.getState().installs[profileId];
        const busy = !!st && busyStatuses.has(st.status);
        if (busy) {
          schedule(120_000);
          return;
        }
        rej(new Error(t("launcher.launchTimeout")));
      }, delay);
    };
    schedule(base);
  });
}