use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub accent: String,
    pub telemetry: bool,
    pub discord_rpc: bool,
    pub playtime: bool,
    pub minecraft_dir: Option<String>,
    pub max_ram_mb: u64,
    pub jvm_args: String,
    pub java_path: Option<String>,
    pub managed_java: String,
    pub auth_client_id: String,
    pub curseforge_api_key: String,
    pub download_concurrency: usize,
    pub news_feed_url: String,
    /// Launcher-side overrides that are written into the game's options.txt
    /// before every launch (display, audio, controls, …).
    #[serde(default)]
    pub game_options: HashMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "system".into(),
            language: "en".into(),
            accent: "blue".into(),
            telemetry: false,
            discord_rpc: false,
            playtime: true,
            minecraft_dir: None,
            max_ram_mb: 4096,
            jvm_args: String::new(),
            java_path: None,
            managed_java: "auto".into(),
            auth_client_id: String::new(),
            curseforge_api_key: String::new(),
            download_concurrency: 12,
            news_feed_url: "https://www.minecraft.net/en-us/feeds/community-content/rss".into(),
            game_options: HashMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub username: String,
    pub player_name: String,
    pub player_uuid: String,
    pub account_type: String,
    pub skins: Vec<SkinInfo>,
    pub capes: Vec<String>,
    pub created_at: String,
    pub last_used: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkinInfo {
    pub id: String,
    pub state: String,
    pub url: Option<String>,
    pub variant: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPackage {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub source: String,
    pub version: String,
    pub sha1: Option<String>,
    pub installed_at: String,
    pub enabled: bool,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub install_status: String,
    pub memory_mb: Option<u64>,
    pub extra_jvm_args: String,
    pub java_tag: String,
    pub resolution: Option<Resolution>,
    pub custom_game_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_played: Option<String>,
    pub play_count: u64,
    #[serde(default)]
    pub play_seconds: u64,
    pub packages: Vec<InstalledPackage>,
    pub server: Option<ServerEntry>,
    pub latest_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub name: String,
    pub ip: String,
    pub accept_textures: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JavaInfo {
    pub tag: String,
    pub version: String,
    pub path: String,
    pub kind: String,
    pub usable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    pub profile_id: String,
    pub status: String,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub log_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub profile_id: String,
    pub phase: String,
    pub message: String,
    pub percent: f64,
    pub done: u64,
    pub total: u64,
    pub speed: u64,
    pub current_file: Option<String>,
    pub status: String,
}

impl InstallProgress {
    pub fn new(profile_id: &str) -> Self {
        InstallProgress {
            profile_id: profile_id.into(),
            phase: "idle".into(),
            message: String::new(),
            percent: 0.0,
            done: 0,
            total: 0,
            speed: 0,
            current_file: None,
            status: "idle".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DlEvent {
    pub batch: String,
    pub id: String,
    pub name: String,
    pub done: u64,
    pub total: u64,
    pub status: String,
    pub error: Option<String>,
    pub speed: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub name: String,
    pub folder: String,
    pub size_bytes: u64,
    pub modified: u64,
    pub level_name: Option<String>,
    pub last_played: Option<u64>,
    pub game_mode: Option<String>,
    pub version: Option<String>,
    pub players: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportInfo {
    pub name: String,
    pub path: String,
    pub content: String,
    pub modified: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub link: String,
    pub date: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeStats {
    pub total_seconds: u64,
    pub today_seconds: u64,
    pub week_seconds: u64,
    pub days: Vec<(String, u64)>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub url: Option<String>,
    pub up_to_date: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathsInfo {
    pub data_dir: String,
    pub minecraft_dir: String,
    pub managed_java_dir: String,
    pub games_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntryMeta {
    pub id: String,
    pub version_type: String,
    pub release_time: String,
    pub is_latest: bool,
    pub is_last_release: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub loader: String,
    pub minecraft: String,
    pub stable: bool,
}
