use crate::error::Result;
use crate::model::{Account, Profile, Settings};
use crate::vault::Vault;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;

pub struct AppState {
    pub data_dir: PathBuf,
    pub minecraft_dir: PathBuf,
    pub games_dir: PathBuf,
    pub engine: crate::download::Engine,
    pub settings: Mutex<Settings>,
    pub profiles: Mutex<Vec<Profile>>,
    pub accounts: Mutex<Vec<Account>>,
    pub vault: Mutex<Vault>,
    pub http: reqwest::Client,
    pub running: Mutex<Option<Arc<crate::launch::RunningGame>>>,
    pub installs: Mutex<std::collections::HashMap<String, crate::model::InstallProgress>>,
    pub install_tokens: Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>,
    pub playtime: Mutex<crate::playtime::Playtime>,
    pub manifest: Mutex<Option<crate::meta::VersionManifest>>,
    pub java_runtimes: Mutex<Option<Vec<crate::meta::JavaRuntimeMeta>>>,
}

impl AppState {
    pub fn new() -> Result<Self> {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AzrealX");
        std::fs::create_dir_all(&data_dir)?;
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let minecraft_dir = std::env::var("AZREALX_MC_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                // Windows launchers use %APPDATA%\.minecraft; macOS/Linux use ~/.minecraft
                #[cfg(target_os = "windows")]
                {
                    let appdata = std::env::var("APPDATA")
                        .map(PathBuf::from)
                        .unwrap_or(home.clone());
                    appdata.join(".minecraft")
                }
                #[cfg(not(target_os = "windows"))]
                {
                    home.join(".minecraft")
                }
            });
        std::fs::create_dir_all(&minecraft_dir)?;
        let games_dir = minecraft_dir.join("azrealx-games");
        std::fs::create_dir_all(&games_dir)?;

        let settings = crate::settings::load(&data_dir)?;
        let vault = Vault::open(&data_dir)?;

        let http = reqwest::Client::builder()
            .user_agent(format!(
                "AzrealX/{} (Minecraft Launcher)",
                env!("CARGO_PKG_VERSION")
            ))
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default();

        let state = AppState {
            data_dir,
            minecraft_dir,
            games_dir,
            engine: crate::download::Engine::new(),
            settings: Mutex::new(settings),
            profiles: Mutex::new(Vec::new()),
            accounts: Mutex::new(Vec::new()),
            vault: Mutex::new(vault),
            http,
            running: Mutex::new(None),
            installs: Mutex::new(std::collections::HashMap::new()),
            install_tokens: Mutex::new(std::collections::HashMap::new()),
            playtime: Mutex::new(crate::playtime::Playtime::open()?),
            manifest: Mutex::new(None),
            java_runtimes: Mutex::new(None),
        };
        state.load_persisted()?;
        state.migrate_playtime()?;
        Ok(state)
    }

    /// One-time migration: spread the legacy global playtime (collected before
    /// per-profile tracking existed) across profiles proportionally to starts.
    fn migrate_playtime(&self) -> Result<()> {
        let legacy_seconds = self.playtime.lock().unwrap().ping();
        if legacy_seconds == 0 {
            return Ok(());
        }
        let mut profiles = self.profiles.lock().unwrap();
        if profiles.iter().any(|p| p.play_seconds > 0) {
            return Ok(());
        }
        let total_starts: u64 = profiles.iter().map(|p| p.play_count).sum();
        if total_starts == 0 {
            return Ok(());
        }
        let mut unallocated = legacy_seconds;
        for p in profiles.iter_mut().filter(|p| p.play_count > 0) {
            let share = legacy_seconds * p.play_count / total_starts;
            p.play_seconds += share;
            unallocated -= share;
        }
        for p in profiles.iter_mut().filter(|p| p.play_count > 0) {
            if unallocated == 0 {
                break;
            }
            p.play_seconds += 1;
            unallocated -= 1;
        }
        drop(profiles);
        self.persist_profiles()
    }

    fn load_persisted(&self) -> Result<()> {
        let pf = self.data_dir.join("profiles.json");
        if pf.exists() {
            let raw = std::fs::read_to_string(&pf)?;
            let p: Vec<Profile> = serde_json::from_str(&raw).unwrap_or_default();
            *self.profiles.lock().unwrap() = p;
        }
        let af = self.data_dir.join("accounts.json");
        if af.exists() {
            let raw = std::fs::read_to_string(&af)?;
            let a: Vec<Account> = serde_json::from_str(&raw).unwrap_or_default();
            *self.accounts.lock().unwrap() = a;
        }
        Ok(())
    }

    pub fn persist_profiles(&self) -> Result<()> {
        let data = serde_json::to_string_pretty(&*self.profiles.lock().unwrap())?;
        std::fs::write(self.data_dir.join("profiles.json"), data)?;
        Ok(())
    }

    pub fn persist_accounts(&self) -> Result<()> {
        let data = serde_json::to_string_pretty(&*self.accounts.lock().unwrap())?;
        std::fs::write(self.data_dir.join("accounts.json"), data)?;
        Ok(())
    }

    pub fn get_settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, s: Settings) -> Result<()> {
        *self.settings.lock().unwrap() = s.clone();
        crate::settings::save(&self.data_dir, &s)
    }

    pub fn game_dir_for(&self, profile: &Profile) -> PathBuf {
        if let Some(custom) = &profile.custom_game_dir {
            if !custom.trim().is_empty() {
                return PathBuf::from(custom);
            }
        }
        self.games_dir.join(slug(&profile.name))
    }

    pub fn mc_root(&self) -> PathBuf {
        let s = self.settings.lock().unwrap();
        s.minecraft_dir
            .clone()
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.minecraft_dir.clone())
    }

    pub fn ensure_dir(&self, app: &tauri::AppHandle, event: &str, payload: &impl serde::Serialize) {
        use tauri::Emitter;
        let _ = app.emit(event, payload);
    }

    pub fn set_install(&self, p: crate::model::InstallProgress) {
        self.installs.lock().unwrap().insert(p.profile_id.clone(), p);
    }

    pub fn install(&self, profile_id: &str) -> Option<crate::model::InstallProgress> {
        self.installs.lock().unwrap().get(profile_id).cloned()
    }

    pub fn cancel_install(&self, profile_id: &str) -> bool {
        let mut map = self.install_tokens.lock().unwrap();
        let Some(tok) = map.remove(profile_id) else {
            return false;
        };
        tok.cancel();
        true
    }

    pub fn token(&self, profile_id: &str) -> tokio_util::sync::CancellationToken {
        self.install_tokens
            .lock()
            .unwrap()
            .entry(profile_id.to_string())
            .or_insert_with(tokio_util::sync::CancellationToken::new)
            .clone()
    }

    pub fn vault(&self) -> std::sync::MutexGuard<'_, Vault> {
        self.vault.lock().unwrap()
    }
}

pub fn slug(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "default".into()
    } else {
        trimmed
    }
}