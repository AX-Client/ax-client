import { invoke } from "@tauri-apps/api/core";
export { toast } from "./store";
import type {
  Account,
  CurseFile,
  CurseMod,
  CrashReportInfo,
  DeviceCode,
  GameStatus,
  InstallProgress,
  InstalledPackage,
  JavaInfo,
  ModrinthProject,
  ModrinthVersion,
  NewsItem,
  PathsInfo,
  PlaytimeStats,
  Profile,
  ScreenshotInfo,
  ServerEntry,
  Settings,
  UpdateInfo,
  VersionEntryMeta,
  WorldInfo,
  PremiumStatus,
  MonetConfig,
  CloudSyncResult,
  CloudRestoreResult,
} from "./types";

function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args);
}

export const api = {
  appVersion: () => cmd<string>("app_version"),
  paths: () => cmd<PathsInfo>("get_paths"),
  getSettings: () => cmd<Settings>("get_settings"),
  setSettings: (patch: Partial<Settings>) => cmd<Settings>("set_settings", { patch }),
  profiles: () => cmd<Profile[]>("get_profiles"),
  gameOptions: (profileId: string) =>
    cmd<Record<string, string>>("get_game_options", { profileId }),
  writeLiveOptions: (profileId: string, options: Record<string, { t: string; v: string | number | boolean }>) =>
    cmd<void>("write_live_options", { profileId, options }),
  saveProfile: (profile: Profile) => cmd<Profile>("save_profile", { profile }),
  deleteProfile: (id: string) => cmd<void>("delete_profile", { id }),
  gameDirFor: (profileId: string) => cmd<string>("game_dir_for", { profileId }),
  installProfile: (profileId: string) => cmd<string>("install_profile", { profileId }),
  cancelInstall: (profileId: string) => cmd<boolean>("cancel_install", { profileId }),
  installStatus: (profileId: string) =>
    cmd<InstallProgress | null>("install_status", { profileId }),
  versionManifest: () => cmd<VersionEntryMeta[]>("version_manifest"),
  loaderVersions: (loader: string, mc: string) =>
    cmd<string[]>("loader_versions", { loader, mc }),
  installedVersions: () => cmd<string[]>("installed_versions"),
  javaList: () => cmd<JavaInfo[]>("java_list"),
  javaInstall: (tag: string) => cmd<void>("java_install", { tag }),
  accounts: () => cmd<Account[]>("get_accounts"),
  deviceCode: () => cmd<DeviceCode>("ms_device_code"),
  msLogin: (deviceCode: string, interval: number, maxWait: number) =>
    cmd<Account>("ms_login", { deviceCode, interval, maxWait }),
  msStartPopup: () => cmd<void>("ms_start_popup"),
  msExchange: (code: string) => cmd<Account>("ms_exchange", { code }),
  logoutAccount: (id: string) => cmd<void>("logout_account", { id }),
  refreshAccount: (id: string) => cmd<Account>("refresh_account", { id }),
  refreshAllAccounts: () => cmd<Account[]>("refresh_all_accounts"),
  setAccountPicture: (id: string, imageBase64: string) =>
    cmd<void>("set_account_picture", { id, imageBase64 }),
  removeAccountPicture: (id: string) => cmd<void>("remove_account_picture", { id }),
  launchProfile: (profileId: string) => cmd<string>("launch_profile", { profileId }),
  launchProfileInto: (
    profileId: string,
    target: { world?: string; server?: string },
  ) =>
    cmd<string>("launch_profile_into", {
      profileId,
      world: target.world ?? null,
      server: target.server ?? null,
    }),
  stopGame: () => cmd<void>("stop_game"),
  gameStatus: () => cmd<GameStatus | null>("game_status"),
  launcherLogs: (limit: number) => cmd<string[]>("launcher_logs", { limit }),
  launcherLogPath: () => cmd<string | null>("launcher_log_path"),
  gameLogs: (profileId: string) => cmd<string[]>("game_logs", { profileId }),

  curseSearch: (query: string, classId: number, gameVersion?: string, index = 0) =>
    cmd<CurseMod[]>("curse_search", { query, classId, gameVersion, index }),
  curseFiles: (modId: number, gameVersion?: string, index = 0) =>
    cmd<CurseFile[]>("curse_files", { modId, gameVersion, index }),
  curseVersions: () => cmd<string[]>("curse_versions"),
  modrinthSearch: (query: string, classId: string, gameVersion?: string) =>
    cmd<ModrinthProject[]>("modrinth_search", { query, classId, gameVersion }),
  modrinthVersions: (slug: string, gameVersion?: string) =>
    cmd<ModrinthVersion[]>("modrinth_versions", { slug, gameVersion }),
  modrinthMcVersions: () => cmd<string[]>("modrinth_mc_versions"),
  installCurseFile: (profileId: string, modId: number, fileId: number, name: string) =>
    cmd<void>("install_curse_file", { profileId, modId, fileId, name }),
  installModrinthVersion: (profileId: string, versionJson: ModrinthVersion) =>
    cmd<void>("install_modrinth_url", { profileId, versionJson }),
  removePackage: (profileId: string, packageId: string) =>
    cmd<void>("remove_package", { profileId, packageId }),
  togglePackage: (profileId: string, packageId: string) =>
    cmd<void>("toggle_package", { profileId, packageId }),

  modpackListFiles: (profileId: string) =>
    cmd<InstalledPackage[]>("modpack_list_files", { profileId }),
  modpackImport: (profileId: string, path: string) =>
    cmd<void>("modpack_import", { profileId, path }),
  modpackExport: (profileId: string, dest: string) =>
    cmd<void>("modpack_export", { profileId, dest }),

  worlds: (profileId: string) => cmd<WorldInfo[]>("worlds", { profileId }),
  screenshots: (profileId: string) =>
    cmd<ScreenshotInfo[]>("screenshots", { profileId }),
  crashReports: (profileId: string) =>
    cmd<CrashReportInfo[]>("crash_reports", { profileId }),
  backupWorld: (profileId: string, folder: string) =>
    cmd<void>("backup_world", { profileId, folder }),
  listWorldBackups: (folder: string) => cmd<string[]>("list_world_backups", { folder }),
  restoreWorldBackup: (profileId: string, folder: string, backup: string) =>
    cmd<void>("restore_world_backup", { profileId, folder, backup }),
  deleteWorld: (profileId: string, folder: string) =>
    cmd<void>("delete_world", { profileId, folder }),

  serversRead: (profileId: string) =>
    cmd<ServerEntry[]>("servers_read", { profileId }),
  serversSave: (profileId: string, servers: ServerEntry[]) =>
    cmd<void>("servers_save", { profileId, servers }),

  newsFeed: () => cmd<NewsItem[]>("news_feed"),
  playtimeStats: () => cmd<PlaytimeStats>("playtime_stats"),
  checkUpdate: () => cmd<UpdateInfo>("check_update"),

  openPath: (path: string) => cmd<void>("open_path", { path }),
  openGameDir: (profileId: string) => cmd<void>("open_game_dir", { profileId }),
  openUrl: (url: string) => cmd<void>("open_url", { url }),
  premiumStatus: () => cmd<PremiumStatus>("premium_status"),
  monetConfig: () => cmd<MonetConfig>("monet_config"),
  cloudSync: () => cmd<CloudSyncResult>("cloud_profiles_sync"),
  cloudRestore: () => cmd<CloudRestoreResult>("cloud_profiles_restore"),

  // Utility callbacks the renderer uses for non-invoke work.
  async serverStatus(_ip: string): Promise<import("./types").ServerStatus> {
    return { online: false };
  },
};

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return "never";
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export type { InstalledPackage };