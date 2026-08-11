export interface Settings {
  theme: string;
  language: string;
  accent: string;
  telemetry: boolean;
  discordRpc: boolean;
  playtime: boolean;
  minecraftDir?: string | null;
  maxRamMb: number;
  jvmArgs: string;
  javaPath?: string | null;
  managedJava: string;
  authClientId: string;
  curseforgeApiKey: string;
  downloadConcurrency: number;
  newsFeedUrl: string;
  gameOptions: Record<string, string>;
}

export interface Account {
  id: string;
  username: string;
  playerName: string;
  playerUuid: string;
  accountType: string;
  skins: SkinInfo[];
  capes: string[];
  createdAt: string;
  lastUsed?: string | null;
  picture?: string | null;
  email?: string | null;
}

export interface SkinInfo {
  id: string;
  state: string;
  url?: string | null;
  variant?: string | null;
}

export interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  iconUrl?: string | null;
  downloads?: number | null;
  categories?: string[] | null;
  versions?: string[] | null;
}

export interface ModrinthVersion {
  id?: string | null;
  name?: string | null;
  versionNumber?: string | null;
  versionType?: string | null;
  datePublished?: string | null;
  downloads?: number | null;
  gameVersions?: string[] | null;
  loaders?: string[] | null;
  files?: ModrinthFileInfo[] | null;
}

export interface ModrinthFileInfo {
  url?: string | null;
  filename?: string | null;
  fileSize?: number | null;
  hashes?: { sha1?: string | null } | null;
}

export interface InstalledPackage {
  id: string;
  name: string;
  fileName: string;
  source: string;
  version: string;
  sha1?: string | null;
  installedAt: string;
  enabled: boolean;
  kind: string;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface ServerEntry {
  name: string;
  ip: string;
  acceptTextures: boolean;
}

export interface Profile {
  id: string;
  name: string;
  icon: string;
  accountId?: string | null;
  gameVersion: string;
  loader: string;
  loaderVersion?: string | null;
  installStatus: string;
  memoryMb?: number | null;
  extraJvmArgs: string;
  javaTag: string;
  resolution?: Resolution | null;
  customGameDir?: string | null;
  createdAt: string;
  updatedAt: string;
  lastPlayed?: string | null;
  playCount: number;
  playSeconds: number;
  packages: InstalledPackage[];
  server?: ServerEntry | null;
  latestVersion: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
}

export interface JavaInfo {
  tag: string;
  version: string;
  path: string;
  kind: string;
  usable: boolean;
}

export interface GameStatus {
  profileId: string;
  status: string;
  pid?: number | null;
  startedAt?: string | null;
  logPath?: string | null;
}

export interface InstallProgress {
  profileId: string;
  phase: string;
  message: string;
  percent: number;
  done: number;
  total: number;
  speed: number;
  currentFile?: string | null;
  status: string;
}

export interface WorldInfo {
  name: string;
  folder: string;
  sizeBytes: number;
  modified: number;
  levelName?: string | null;
  lastPlayed?: number | null;
  gameMode?: string | null;
  version?: string | null;
  players?: string | null;
}

export interface ScreenshotInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modified: number;
}

export interface CrashReportInfo {
  name: string;
  path: string;
  content: string;
  modified: number;
}

export interface NewsItem {
  title: string;
  link: string;
  date?: string | null;
  description?: string | null;
}

export interface PlaytimeStats {
  totalSeconds: number;
  todaySeconds: number;
  weekSeconds: number;
  days: Array<[string, number]>;
}

export interface UpdateInfo {
  current: string;
  latest?: string | null;
  url?: string | null;
  upToDate: boolean;
}

export interface PathsInfo {
  dataDir: string;
  minecraftDir: string;
  managedJavaDir: string;
  gamesDir: string;
}

export interface VersionEntryMeta {
  id: string;
  versionType: string;
  releaseTime: string;
  isLatest: boolean;
  isLastRelease: boolean;
}

export interface LoaderVersion {
  loader: string;
  minecraft: string;
  stable: boolean;
}

export interface CurseMod {
  id: number;
  slug: string;
  name: string;
  summary: string;
  logo?: { thumbnailUrl?: string | null } | null;
  downloadCount?: number | null;
  gameVersions?: string[] | null;
  latestFiles?: CurseFile[] | null;
}

export interface CurseFile {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl?: string | null;
  gameVersions?: string[] | null;
  fileDate?: string | null;
  fileLength?: number | null;
  releaseType?: number | null;
}

export interface ServerStatus {
  online: boolean;
  motd?: string;
  players?: { online: number; max: number } | null;
  version?: string | null;
}
export interface PremiumStatus {
  tier: "free" | "premium";
  expires_at?: number | null;
}

export interface MonetConfig {
  backend_configured: boolean;
  paywall_url: string;
  affiliate_url: string;
  mock: boolean;
}

export interface CloudSyncResult {
  cloud_stub: boolean;
  uploaded: number;
}
