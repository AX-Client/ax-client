use crate::auth::{self, AuthClient, MineToken};
use crate::error::{Error, Result};
use crate::meta::{ArgumentValue, VersionJson};
use crate::model::{Account, GameStatus, Profile, Settings};
use crate::state::AppState;
use crate::install::PreparedGame;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::Command;

pub struct RunningGame {
    pub profile_id: String,
    pub pid: u32,
    pub started: u64,
    pub log_path: PathBuf,
    pub child: Arc<tokio::sync::Mutex<tokio::process::Child>>,
    pub stopping: Arc<AtomicBool>,
}

/// Where the game should jump directly into: a saved world (singleplayer) or
/// a server (multiplayer).
#[derive(Clone, Debug)]
pub enum LaunchTarget {
    Normal,
    World(String),
    Server(String),
}

impl LaunchTarget {
    fn game_args(&self, quickplay: bool) -> Vec<String> {
        match self {
            LaunchTarget::Normal => Vec::new(),
            LaunchTarget::World(folder) if quickplay => {
                vec!["--quickPlaySingleplayer".into(), folder.clone()]
            }
            LaunchTarget::World(_) => Vec::new(),
            LaunchTarget::Server(ip) if quickplay => {
                vec!["--quickPlayMultiplayer".into(), ip.clone()]
            }
            LaunchTarget::Server(ip) => vec!["--server".into(), ip.clone()],
        }
    }
}

/// Quick-Play game args are understood since 1.20.2; older versions only have
/// the legacy `--server` argument for direct server joins.
pub fn quickplay_supported(vid: &str) -> bool {
    let mut parts = vid.split('.').map(|s| s.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);
    major > 1 || (major == 1 && minor > 20) || (major == 1 && minor == 20 && patch >= 2)
}

fn emit(app: &AppHandle, profile_id: &str, status: &str, message: &str, pid: Option<u32>) {
    use tauri::Emitter;
    let payload = GameStatus {
        profile_id: profile_id.to_string(),
        status: status.to_string(),
        pid,
        started_at: None,
        log_path: None,
    };
    let _ = app.emit("game", payload);
    let _ = message;
}

/// Substitution map for both `${key}` and `{key}` forms.
pub struct ArgMap {
    map: HashMap<String, String>,
}

impl ArgMap {
    pub fn substitute(&self, s: &str) -> String {
        let mut out = s.to_string();
        for (k, v) in &self.map {
            out = out.replace(&format!("${{{k}}}"), v);
            out = out.replace(&format!("{{{k}}}"), v);
        }
        out
    }
}

fn build_arg_map(
    prepared: &PreparedGame,
    profile: &Profile,
    account: &Account,
    mc_token: &str,
    xuid: &str,
) -> ArgMap {
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath = prepared
        .classpath
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(sep);
    let mut map = HashMap::new();
    map.insert("auth_player_name".to_string(), account.player_name.clone());
    map.insert("auth_uuid".to_string(), auth::plain_uuid(&account.player_uuid));
    map.insert("auth_access_token".to_string(), mc_token.to_string());
    map.insert(
        "auth_session".to_string(),
        format!("token:{mc_token}:{}", auth::plain_uuid(&account.player_uuid)),
    );
    map.insert("auth_xuid".to_string(), xuid.to_string());
    map.insert("clientid".to_string(), "AzrealX".to_string());
    map.insert("user_type".to_string(), "msa".to_string());
    map.insert("user_properties".to_string(), "{}".to_string());
    map.insert("version_name".to_string(), prepared.version_id.clone());
    map.insert(
        "version_type".to_string(),
        if profile.game_version.contains("pre") {
            "snapshot"
        } else {
            "release"
        }
        .to_string(),
    );
    map.insert(
        "game_directory".to_string(),
        prepared.game_dir.display().to_string(),
    );
    map.insert(
        "assets_root".to_string(),
        prepared.root.join("assets").display().to_string(),
    );
    map.insert("assets_index_name".to_string(), prepared.assets_index_id.clone());
    map.insert(
        "natives_directory".to_string(),
        prepared.natives_dir.display().to_string(),
    );
    map.insert("classpath".to_string(), classpath);
    map.insert("classpath_separator".to_string(), sep.to_string());
    map.insert(
        "library_directory".to_string(),
        prepared.root.join("libraries").display().to_string(),
    );
    map.insert("launcher_name".to_string(), "AzrealX".to_string());
    map.insert("launcher_version".to_string(), env!("CARGO_PKG_VERSION").to_string());
    let (w, h) = profile
        .resolution
        .as_ref()
        .map(|r| (r.width as u32, r.height as u32))
        .unwrap_or((854, 480));
    map.insert("resolution_width".to_string(), w.to_string());
    map.insert("resolution_height".to_string(), h.to_string());
    ArgMap { map }
}

/// JVM options: memory, user flags, version JSON jvm arguments.
fn jvm_args(vj: &VersionJson, profile: &Profile, settings: &Settings, m: &ArgMap) -> Vec<String> {
    let mut args = Vec::new();
    let memory = profile.memory_mb.unwrap_or(settings.max_ram_mb).max(512);
    args.push(format!("-Xmx{}M", memory));
    args.push(format!("-Xms{}M", (memory / 4).max(256)));
    if settings.jvm_args.trim().is_empty() {
        args.push("-XX:+UseG1GC".into());
        args.push("-XX:+ParallelRefProcEnabled".into());
        args.push("-XX:MaxGCPauseMillis=200".into());
        args.push("-XX:+UnlockExperimentalVMOptions".into());
        args.push("-XX:+DisableExplicitGC".into());
        args.push("-XX:G1NewSizePercent=20".into());
        args.push("-XX:G1MaxNewSizePercent=50".into());
        args.push("-XX:G1HeapRegionSize=16M".into());
        args.push("-Dfile.encoding=UTF-8".into());
    } else {
        args.extend(settings.jvm_args.split_whitespace().map(String::from));
    }
    if !profile.extra_jvm_args.trim().is_empty() {
        args.extend(profile.extra_jvm_args.split_whitespace().map(String::from));
    }
    if let Some(jvm) = &vj.arguments {
        if let Some(list) = &jvm.jvm {
            for arg in list {
                match arg {
                    ArgumentValue::Plain(s) => args.push(m.substitute(s)),
                    ArgumentValue::Complex { value, rules } => {
                        if crate::meta::rules_allow(rules, profile.resolution.is_some()) {
                            for s in value {
                                args.push(m.substitute(s));
                            }
                        }
                    }
                }
            }
        }
    }
    args
}

/// Game arguments: modern `arguments.game` or legacy `minecraftArguments`.
fn game_args(vj: &VersionJson, m: &ArgMap, custom_resolution: bool) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(a) = &vj.arguments {
        if let Some(game) = &a.game {
            for arg in game {
                match arg {
                    ArgumentValue::Plain(s) => out.push(m.substitute(s)),
                    ArgumentValue::Complex { value, rules } => {
                        if crate::meta::rules_allow(rules, custom_resolution) {
                            for s in value {
                                out.push(m.substitute(s));
                            }
                        }
                    }
                }
            }
            return out;
        }
    }
    if let Some(legacy) = &vj.minecraft_arguments {
        for part in legacy.split_whitespace() {
            out.push(m.substitute(part));
        }
    }
    out
}

/// Obtain a valid Minecraft access token for the account. Re-uses the cached
/// token when present, otherwise refreshes via the Microsoft refresh token.
async fn ensure_token(state: &AppState, account: &Account) -> Result<(MineToken, String)> {
    let cached;
    let xuid;
    let ms_refresh;
    {
        let mut vault = state.vault();
        cached = vault.get(&format!("{}:mc_access", account.player_uuid));
        xuid = vault
            .get(&format!("{}:xuid", account.player_uuid))
            .unwrap_or_default();
        ms_refresh = vault.get(&format!("{}:ms_refresh", account.player_uuid));
    }
    if let Some(token) = cached {
        if !token.is_empty() {
            return Ok((
                MineToken {
                    access_token: token,
                    refresh_token: String::new(),
                    expires_in: 0,
                },
                xuid,
            ));
        }
    }
    let Some(refresh) = ms_refresh else {
        return Err(Error::Auth(
            "This account has no usable session. Please sign in again.".into(),
        ));
    };
    let settings = state.get_settings();
    let client = AuthClient::new(
        Arc::new(state.http.clone()),
        settings.auth_client_id.clone(),
    );
    let result = client
        .refresh_account(&account.player_uuid, &refresh)
        .await?;
    let token = result
        .mc
        .ok_or_else(|| Error::Auth("could not obtain a Minecraft token".into()))?;
    let new_xuid = result
        .xsts
        .map(|x| x.xuid.clone())
        .unwrap_or_default();
    {
        let mut vault = state.vault();
        vault.set(&format!("{}:mc_access", account.player_uuid), &token.access_token);
        vault.set(&format!("{}:mc_refresh", account.player_uuid), &token.refresh_token);
        if !new_xuid.is_empty() {
            vault.set(&format!("{}:xuid", account.player_uuid), &new_xuid);
        }
        let _ = vault.flush();
    }
    Ok((token, new_xuid))
}

/// Full launch pipeline. Spawns the JVM, streams output to a log file and the
/// UI, and returns a handle to monitor.
pub async fn run(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
    account: &Account,
    prepared: &PreparedGame,
    target: &LaunchTarget,
) -> Result<RunningGame> {
    emit(app, &profile.id, "preparing", "Preparing launch…", None);
    let (token, xuid) = ensure_token(state, account).await?;
    let m = build_arg_map(prepared, profile, account, &token.access_token, &xuid);
    let settings = state.get_settings();

    let jvm = jvm_args(&prepared.vj, profile, &settings, &m);
    let mut game = game_args(&prepared.vj, &m, profile.resolution.is_some());
    game.extend(target.game_args(quickplay_supported(&profile.game_version)));
    let main_class = prepared.main_class.clone();

    let java = crate::java::locate_or_download(app, state, profile).await?;
    let game_dir = &prepared.game_dir;
    std::fs::create_dir_all(game_dir)?;
    if let Err(e) = crate::gameopt::apply(game_dir, &settings.game_options, &prepared.version_id) {
        log::warn!("failed to apply game options: {e}");
    }
    // cosmetics: ship ax-cosmetics.jar + session sidecar into the game
    if let Err(e) = crate::cosmetics::ensure_installed(app, state, game_dir.to_path_buf(), xuid.clone()).await {
        log::warn!("cosmetics injection skipped: {e}");
    }

    let logs_dir = state.data_dir.join("logs").join("games");
    std::fs::create_dir_all(&logs_dir)?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let log_path = logs_dir.join(format!("{}-{timestamp}.log", prepared.version_id));

    let mut cmd = Command::new(&java);
    cmd.current_dir(game_dir)
        .args(&jvm)
        .arg("-cp")
        .arg(m.substitute("${classpath}"))
        .arg(&main_class)
        .args(&game)
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| Error::Launch(format!("Failed to start Java: {e}")))?;

    let pid = child.id().unwrap_or(0);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| Error::Launch("no stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| Error::Launch("no stderr".into()))?;

    // Stream game output → log file + UI events
    let log_file = log_path.clone();
    let app_ui = app.clone();
    tokio::spawn(async move {
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
            .await
            .ok();
        let mut writer = match file {
            Some(f) => Some(BufWriter::new(f)),
            None => None,
        };
        let mut stdout = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match stdout.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim_end().to_string();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Some(w) = writer.as_mut() {
                        let _ = w.write_all(format!("{trimmed}\n").as_bytes()).await;
                    }
                    use tauri::Emitter;
                    let _ = app_ui.emit("game-line", &trimmed);
                }
            }
        }
        if let Some(mut w) = writer {
            let _ = w.flush().await;
        }
        // Drain stderr to avoid blocking the child.
        let mut stderr = BufReader::new(stderr);
        let mut buf = Vec::new();
        let _ = stderr.read_until(b'\n', &mut buf).await;
    });

    emit(app, &profile.id, "running", "Game launched", Some(pid));
    log::info!("Game started pid={pid} file={}", log_path.display());

    let running = RunningGame {
        profile_id: profile.id.clone(),
        pid,
        started: chrono::Utc::now().timestamp() as u64,
        log_path,
        child: Arc::new(tokio::sync::Mutex::new(child)),
        stopping: Arc::new(AtomicBool::new(false)),
    };
    Ok(running)
}

/// Wait for the game to exit, then report it.
pub async fn wait_and_finish(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
    game: Arc<RunningGame>,
) -> Result<i32> {
    let mut child = game.child.lock().await;
    let exit = tokio::select! {
        status = child.wait() => status.map_err(|e| Error::Launch(e.to_string()))?,
        _ = tokio::signal::ctrl_c() => return Err(Error::Canceled),
    };
    drop(child);
    game.stopping.store(true, Ordering::SeqCst);
    let code = exit.code().unwrap_or(-1);
    let seconds = chrono::Utc::now().timestamp().saturating_sub(game.started as i64).max(0) as u64;
    if state.get_settings().playtime {
        if let Ok(mut pt) = state.playtime.lock() {
            let _ = pt.add_session(seconds);
        }
    }
    {
        let mut profiles = state.profiles.lock().unwrap();
        if let Some(p) = profiles.iter_mut().find(|p| p.id == profile.id) {
            p.last_played = Some(chrono::Utc::now().to_rfc3339());
            p.play_count += 1;
            p.play_seconds += seconds;
            p.install_status = "installed".into();
        }
    }
    let _ = state.persist_profiles();
    if let Some(stopping) = { state.running.lock().unwrap().as_ref().map(|r| r.stopping.clone()) } {
        let _ = stopping;
    }
    *state.running.lock().unwrap() = None;
    emit(app, &profile.id, "exited", &format!("Exit code {code}"), Some(code as u32));
    use tauri::Emitter;
    let _ = app.emit(
        "game",
        serde_json::json!({
            "profileId": profile.id,
            "status": "exited",
            "pid": null,
            "startedAt": null,
            "logPath": game.log_path.to_string_lossy().to_string(),
            "exitCode": code,
            "playtimeSeconds": seconds,
        }),
    );
    log::info!("Game exited code={code} session={seconds}s");
    Ok(code)
}

/// Request the running game to stop.
pub async fn stop(state: &AppState) -> Result<()> {
    {
        let mut guard = state.running.lock().unwrap();
        if let Some(game) = guard.as_mut() {
            game.stopping.store(true, Ordering::SeqCst);
            #[cfg(unix)]
            unsafe {
                libc::kill(-(game.pid as i32), libc::SIGTERM);
            }
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &game.pid.to_string()])
                    .status();
            }
        }
    }
    // Grace period so the game can exit cleanly, then force-kill leftovers.
    for _ in 0..10 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let alive = {
            let guard = state.running.lock().unwrap();
            guard.as_ref().and_then(running_pid)
        };
        if alive.is_none() {
            break;
        }
    }
    if let Some(pid) = {
        let guard = state.running.lock().unwrap();
        guard.as_ref().and_then(running_pid)
    } {
        #[cfg(unix)]
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .status();
        }
    }
    Ok(())
}

fn running_pid(g: &Arc<RunningGame>) -> Option<i32> {
    Some(g.pid as i32)
}