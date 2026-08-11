import type { InstallProgress } from "./types";

export interface InstallState {
  [profileId: string]: InstallProgress | null;
}

export const isActive = (p?: InstallProgress | null) =>
  !!p && (p.status === "progress" || p.status === "pending");