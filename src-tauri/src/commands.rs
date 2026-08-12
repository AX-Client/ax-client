use crate::auth::{self, AuthClient, MsToken};
use crate::model::*;
use crate::state::{AppState, slug};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub type CmdResult<T> = std::result::Result<T, String>;

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

#[tauri::command]
pub fn get_paths(state: State<'_, AppState>) -> PathsInfo {
    PathsInfo {
        data_dir: state.data_dir.display().to_string(),
        minecraft_dir: state.mc_root().display().to_string(),
        managed_java_dir: crate::java::java_dir(&state).display().to_string(),
        games_dir: state.games_dir.display().to_string(),
    }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.get_settings()
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, patch: serde_json::Value) -> CmdResult<Settings> {
    let mut settings = state.get_settings();
    if let Some(m) = patch.as_object() {
        for (k, v) in m {
            let field = serde_json::to_string(v).unwrap_or_default();
            match k.as_str() {
                "theme" => settings.theme = v.as_str().unwrap_or("system").to_string(),
                "language" => settings.language = v.as_str().unwrap_or("en").to_string(),
                "accent" => settings.accent = v.as_str().unwrap_or("blue").to_string(),
                "telemetry" => settings.telemetry = v.as_bool().unwrap_or(false),
                "discordRpc" => settings.discord_rpc = v.as_bool().unwrap_or(false),
                "playtime" => settings.playtime = v.as_bool().unwrap_or(true),
                "minecraftDir" => {
                    settings.minecraft_dir = v.as_str().map(|s| s.to_string());
                }
                "maxRamMb" => settings.max_ram_mb = v.as_u64().unwrap_or(4096),
                "jvmArgs" => settings.jvm_args = v.as_str().unwrap_or("").to_string(),
                "javaPath" => {
                    settings.java_path = v.as_str().map(|s| s.to_string());
                }
                "managedJava" => settings.managed_java = v.as_str().unwrap_or("auto").to_string(),
                "authClientId" => {
                    settings.auth_client_id = v.as_str().unwrap_or("").trim().to_string();
                }
                "curseforgeApiKey" => {
                    settings.curseforge_api_key = v.as_str().unwrap_or("").trim().to_string();
                }
                "downloadConcurrency" => {
                    settings.download_concurrency = v.as_u64().unwrap_or(12) as usize;
                }
                "newsFeedUrl" => settings.news_feed_url = v.as_str().unwrap_or("").to_string(),
                "gameOptions" => {
                    if let Some(obj) = v.as_object() {
                        settings.game_options = obj
                            .iter()
                            .map(|(k, val)| (k.clone(), val.as_str().unwrap_or("").to_string()))
                            .collect();
                    }
                }
                _ => {}
            }
            let _ = &field;
        }
    }
    state.set_settings(settings.clone()).map_err(|e| e.to_string())?;
    Ok(settings)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

fn active_account_id(state: &State<'_, AppState>) -> Option<String> {
    state
        .accounts
        .lock()
        .unwrap()
        .iter()
        .max_by_key(|a| a.last_used.clone().unwrap_or_default())
        .map(|a| a.id.clone())
}

/// Current in-game values of a profile as Minecraft wrote them.
#[tauri::command]
pub fn get_game_options(state: State<'_, AppState>, profile_id: String) -> std::collections::HashMap<String, String> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned();
    let Some(profile) = profile else {
        return std::collections::HashMap::new();
    };
    let dir = state.game_dir_for(&profile);
    crate::gameopt::read(&dir).unwrap_or_default()
}

/// Live-apply launcher options into a running game.
///
/// Writes `azrealx-live-options.json` into the profile's game directory so
/// the AzrealX Bridge mod (which watches that file) applies the values in
/// the running game without a restart.
#[tauri::command]
pub fn write_live_options(
    state: State<'_, AppState>,
    profile_id: String,
    options: serde_json::Value,
) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned();
    let Some(profile) = profile else {
        return Err("profile not found".into());
    };
    let dir = state.game_dir_for(&profile);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut out = String::new();
    out.push_str(&format!(
        "rev:{}\n",
        chrono::Utc::now().timestamp_millis()
    ));
    if let Some(obj) = options.as_object() {
        for (key, entry) in obj {
            let t = entry
                .get("t")
                .and_then(|x| x.as_str())
                .unwrap_or("string");
            let v = match entry.get("v") {
                Some(serde_json::Value::Bool(b)) => b.to_string(),
                Some(x) => x.to_string(),
                None => continue,
            };
            out.push_str(&format!("{key}:{t}:{v}\n"));
        }
    }
    std::fs::write(dir.join("azrealx-live-options.json"), out).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_profiles(state: State<'_, AppState>) -> Vec<Profile> {
    let active = active_account_id(&state);
    let (owned, changed) = {
        let mut list = state.profiles.lock().unwrap();
        let mut changed = false;
        if let Some(acc) = &active {
            for p in list.iter_mut() {
                if p.account_id.is_none() {
                    p.account_id = Some(acc.clone());
                    changed = true;
                }
            }
        }
        let owned: Vec<Profile> = list
            .iter()
            .filter(|p| {
                if let Some(acc) = &active {
                    p.account_id.as_deref() == Some(acc.as_str())
                } else {
                    false
                }
            })
            .cloned()
            .collect();
        (owned, changed)
    };
    if changed {
        let _ = state.persist_profiles();
    }
    owned
}

#[tauri::command]
pub fn save_profile(state: State<'_, AppState>, profile: Profile) -> CmdResult<Profile> {
    let active = active_account_id(&state);
    let now = chrono::Utc::now().to_rfc3339();
    let mut profile = profile;
    profile.updated_at = now.clone();
    let mut list = state.profiles.lock().unwrap();
    let exists = list.iter().any(|p| p.id == profile.id);
    if exists {
        if let Some(p) = list.iter_mut().find(|p| p.id == profile.id) {
            profile.account_id = p.account_id.clone();
            *p = profile.clone();
        }
    } else {
        let Some(acc) = active else {
            drop(list);
            return Err("Sign in to an account first before creating a profile.".into());
        };
        if profile.id.trim().is_empty() {
            profile.id = format!(
                "{}-{}",
                slug(&profile.name),
                chrono::Utc::now().timestamp_millis()
            );
        }
        profile.account_id = Some(acc);
        if profile.created_at.is_empty() {
            profile.created_at = now;
        }
        list.push(profile.clone());
    }
    drop(list);
    state.persist_profiles().map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.profiles.lock().unwrap().retain(|p| p.id != id);
    state.persist_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_dir_for(state: State<'_, AppState>, profile_id: String) -> CmdResult<String> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("profile {profile_id} not found"))?;
    Ok(state.game_dir_for(&profile).display().to_string())
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn install_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> CmdResult<String> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("profile {profile_id} not found"))?;

    {
        let mut p = InstallProgress::new(&profile_id);
        p.status = "progress".into();
        p.phase = "metadata".into();
        p.message = "Starting installation…".into();
        state.set_install(p.clone());
        let _ = app.emit("install", &p);
    }

    let outcome: crate::error::Result<()> = async {
        if profile.loader == "forge" || profile.loader == "neoforge" {
            crate::install::run_loader_installer(&app, &state, &profile).await?;
        }
        let _ = crate::install::prepare(&app, &state, &profile, false).await?;
        Ok(())
    }
    .await;

    match outcome {
        Ok(()) => {
            {
                let mut p = state
                    .install(&profile_id)
                    .unwrap_or_else(|| InstallProgress::new(&profile_id));
                p.status = "done".into();
                p.phase = "done".into();
                p.message = "Installation complete".into();
                p.percent = 100.0;
                p.done = p.total;
                state.set_install(p.clone());
                let _ = app.emit("install", &p);
            }
            let mut profiles = state.profiles.lock().unwrap();
            if let Some(p) = profiles.iter_mut().find(|p| p.id == profile_id) {
                p.install_status = "installed".into();
            }
            drop(profiles);
            state.persist_profiles().map_err(|e| e.to_string())?;
            Ok("installed".into())
        }
        Err(e) => {
            let mut p = state
                .install(&profile_id)
                .unwrap_or_else(|| InstallProgress::new(&profile_id));
            p.status = "error".into();
            p.message = e.to_string();
            state.set_install(p.clone());
            let _ = app.emit("install", &p);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn cancel_install(app: AppHandle, state: State<'_, AppState>, profile_id: String) -> bool {
    let _ = state.cancel_install(&profile_id);
    if let Some(mut p) = state.install(&profile_id) {
        p.status = "error".into();
        p.message = "Installation canceled".into();
        let _ = app.emit("install", &p);
    }
    true
}

#[tauri::command]
pub fn install_status(state: State<'_, AppState>, profile_id: String) -> Option<InstallProgress> {
    state.install(&profile_id)
}

// ---------------------------------------------------------------------------
// Meta data
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn version_manifest(state: State<'_, AppState>) -> CmdResult<Vec<VersionEntryMeta>> {
    let manifest = crate::meta::fetch_version_manifest(&state).await.map_err(|e| e.to_string())?;
    Ok(manifest
        .versions
        .into_iter()
        .filter(|v| {
            v.kind == "release" || v.kind == "snapshot" || v.kind == "old_beta" || v.kind == "old_alpha"
        })
        .map(|v| VersionEntryMeta {
            is_latest: Some(&v.id) == Some(&manifest.latest.release) || Some(&v.id) == Some(&manifest.latest.snapshot),
            is_last_release: v.id == manifest.latest.release,
            id: v.id,
            version_type: v.kind,
            release_time: v.release_time,
        })
        .collect())
}

#[tauri::command]
pub async fn loader_versions(
    state: State<'_, AppState>,
    loader: String,
    mc: String,
) -> CmdResult<Vec<String>> {
    let result = match loader.as_str() {
        "fabric" => crate::meta::fetch_fabric_versions(&state, &mc).await,
        "quilt" => crate::meta::fetch_quilt_versions(&state, &mc).await,
        "forge" => crate::meta::fetch_forge_versions(&state, &mc).await,
        "neoforge" => crate::meta::fetch_neoforge_versions(&state).await,
        _ => return Err("unknown loader".into()),
    };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn installed_versions(state: State<'_, AppState>) -> Vec<String> {
    if let Ok(dir) = std::fs::read_dir(state.mc_root().join("versions")) {
        let mut out = Vec::new();
        for e in dir.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_file() && name.ends_with(".json") {
                out.push(name.trim_end_matches(".json").to_string());
            }
        }
        out.sort();
        out
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn java_list(state: State<'_, AppState>) -> Vec<JavaInfo> {
    crate::java::list_javas(&state)
}

#[tauri::command]
pub async fn java_install(app: AppHandle, state: State<'_, AppState>, tag: String) -> CmdResult<()> {
    crate::java::install_managed(&app, &state, &tag)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_accounts(state: State<'_, AppState>) -> Vec<Account> {
    state.accounts.lock().unwrap().clone()
}

#[tauri::command]
pub fn ms_device_code(state: State<'_, AppState>) -> CmdResult<DeviceCode> {
    let settings = state.get_settings();
    let client = AuthClient::new(
        Arc::new(state.http.clone()),
        settings.auth_client_id,
    );
    tauri::async_runtime::block_on(async move { client.device_code().await })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ms_login(
    state: State<'_, AppState>,
    device_code: String,
    interval: u64,
    max_wait: u64,
) -> CmdResult<Account> {
    let settings = state.get_settings();
    let client = AuthClient::new(
        Arc::new(state.http.clone()),
        settings.auth_client_id,
    );
    let code = DeviceCode {
        device_code,
        user_code: String::new(),
        verification_uri: String::new(),
        expires_in: max_wait,
        interval,
        message: String::new(),
    };
    let started = std::time::Instant::now();
    let ms = loop {
        if started.elapsed().as_secs() > max_wait {
            return Err("device code expired".into());
        }
        match client.poll_token(&code).await {
            Ok(t) => break t,
            Err(e) if e.to_string().contains("authorization_pending")
                || e.to_string().contains("slow_down") => {
                tokio::time::sleep(std::time::Duration::from_secs(interval.max(3))).await;
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let ms_token = ms.clone();
    finalize_ms_login(&state, &client, ms_token).await
}

/// Store a completed login (MS token in hand) as an account.
async fn finalize_ms_login(
    state: &State<'_, AppState>,
    client: &AuthClient,
    ms_token: MsToken,
) -> CmdResult<Account> {
    let result = client
        .complete_login(ms_token.clone())
        .await
        .map_err(|e| e.to_string())?;
    let profile = result
        .profile
        .ok_or_else(|| "no profile in login result".to_string())?;
    let mc = result.mc.ok_or_else(|| "no minecraft token".to_string())?;
    let xuid = result.xsts.map(|x| x.xuid).unwrap_or_default();

    let account = Account {
        id: auth::plain_uuid(&profile.id),
        username: profile.name.clone(),
        player_name: profile.name.clone(),
        player_uuid: auth::plain_uuid(&profile.id),
        account_type: "msa".into(),
        skins: profile.skins.clone(),
        capes: profile
            .capes
            .iter()
            .filter_map(|c| c.url.clone())
            .collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_used: Some(chrono::Utc::now().to_rfc3339()),
        picture: None,
        email: result.email.clone(),
    };

    {
        let mut vault = state.vault();
        vault.set(&format!("{}:mc_access", account.player_uuid), &mc.access_token);
        vault.set(&format!("{}:mc_refresh", account.player_uuid), &mc.refresh_token);
        vault.set(&format!("{}:ms_refresh", account.player_uuid), &ms_token.refresh_token);
        if !xuid.is_empty() {
            vault.set(&format!("{}:xuid", account.player_uuid), &xuid);
        }
        vault.flush().map_err(|e| e.to_string())?;
    }

    // Register the account with the backend on every sign-in so the operator
    // sees name/email/online status. Best-effort: a failing identify must not
    // break the local login. Backend identity is the Minecraft UUID (always
    // present; the Xbox XUID is not reliably returned by Microsoft).
    let backend_id = auth::plain_uuid(&account.player_uuid);
    {
        let name = Some(account.player_name.as_str());
        let email = account.email.as_deref();
        if let Err(e) = crate::monet::identify_account(&state, &backend_id, name, email).await {
            log::warn!("identify_account failed (ignored): {e}");
        }
    }

    let mut accounts = state.accounts.lock().unwrap();
    accounts.retain(|a| a.player_uuid != account.player_uuid);
    accounts.push(account.clone());
    drop(accounts);
    state.persist_accounts().map_err(|e| e.to_string())?;
    Ok(account)
}

/// Opens an in-app Microsoft sign-in window (Modrinth style). Built-in
/// client only; falls back to the device code flow for custom Azure apps.
#[tauri::command]
pub async fn ms_start_popup(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let settings = state.get_settings();
    let client = AuthClient::new(Arc::new(state.http.clone()), settings.auth_client_id);
    if !client.built_in {
        return Err(
            "A custom Azure app is configured. Use the device-code sign-in instead.".into(),
        );
    }
    if let Some(existing) = app.get_webview_window("ms-auth") {
        let _ = existing.close();
    }
    let url = client.authorize_url();
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "ms-auth",
        tauri::WebviewUrl::External(parsed),
    )
    .title("Sign in with Microsoft")
    .inner_size(520.0, 680.0)
    .center()
    .resizable(false)
    .on_navigation(move |url| {
        let url_str = url.to_string();
        if url_str.starts_with("https://login.live.com/oauth20_desktop.srf") {
            let mut code = None;
            let mut error = None;
            for (k, v) in url.query_pairs() {
                if k == "code" {
                    code = Some(v.to_string());
                }
                if k == "error" {
                    error = Some(v.to_string());
                }
            }
            if let Some(c) = code {
                let _ = app_handle.emit("ms_auth_code", c);
            } else if let Some(e) = error {
                let _ = app_handle.emit("ms_auth_error", format!("Microsoft sign-in failed: {e}"));
            }
            if let Some(w) = app_handle.get_webview_window("ms-auth") {
                let _ = w.close();
            }
            return false;
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Exchanges the auth code from the sign-in popup for an account.
#[tauri::command]
pub async fn ms_exchange(state: State<'_, AppState>, code: String) -> CmdResult<Account> {
    let settings = state.get_settings();
    let client = AuthClient::new(Arc::new(state.http.clone()), settings.auth_client_id);
    let ms = client.exchange_ms(&code).await.map_err(|e| e.to_string())?;
    finalize_ms_login(&state, &client, ms).await
}

// The MS refresh token is not returned by complete_login; we store a marker
// so the account remains usable with a future refresh. (Stored from device
// flow populating it on first login.)
fn ms_refresh_of(_account: &Account) -> String {
    String::new()
}

impl crate::auth::MsToken {
    fn access_token_refresh(&self, _self_ref: &Self) -> String {
        _self_ref.refresh_token.clone()
    }
}

#[tauri::command]
pub async fn logout_account(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let uuid = id.replace('-', "");
    {
        let mut vault = state.vault();
        let keys: Vec<String> = {
            let out = Vec::new();
            if let Some(v) = vault.get(&format!("{uuid}:mc_access")) { let _ = v; }
            // vault does not expose a key list; remove known keys
            let _ = &out;
            out
        };
        let _ = keys;
    }
    // All known token keys for this account:
    let prefixes = ["mc_access", "mc_refresh", "ms_refresh", "xuid"];
    {
        let mut vault = state.vault();
        for p in prefixes {
            vault.remove(&format!("{uuid}:{p}"));
        }
        vault.flush().map_err(|e| e.to_string())?;
    }
    state.accounts.lock().unwrap().retain(|a| a.id != id && a.player_uuid != uuid);
    state.persist_accounts().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_account_picture(
    state: State<'_, AppState>,
    id: String,
    image_base64: String,
) -> CmdResult<()> {
    use base64::Engine;
    let raw = image_base64
        .split(',')
        .next_back()
        .unwrap_or("")
        .trim()
        .to_string();
    if raw.is_empty() {
        return Err("no image data provided".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&raw)
        .map_err(|e| format!("invalid image data: {e}"))?;
    if bytes.is_empty() {
        return Err("image is empty".into());
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("image is too large (max 8 MB)".into());
    }
    let ext = if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else {
        return Err("unsupported image format (png, jpg, webp, gif allowed)".into());
    };
    let dir = state.data_dir.join("account-pics");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{id}.{ext}"));
    std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
    let path = file.to_string_lossy().to_string();
    {
        let mut accounts = state.accounts.lock().unwrap();
        let Some(a) = accounts.iter_mut().find(|a| a.id == id) else {
            return Err("account not found".into());
        };
        a.picture = Some(path);
    }
    state.persist_accounts().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_account_picture(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    {
        let mut accounts = state.accounts.lock().unwrap();
        let Some(a) = accounts.iter_mut().find(|a| a.id == id) else {
            return Err("account not found".into());
        };
        if let Some(p) = a.picture.take() {
            let _ = std::fs::remove_file(p);
        }
    }
    state.persist_accounts().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn refresh_all_accounts(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
    let ids: Vec<String> = state
        .accounts
        .lock()
        .unwrap()
        .iter()
        .map(|a| a.id.clone())
        .collect();
    let settings = state.get_settings();
    let client = AuthClient::new(
        Arc::new(state.http.clone()),
        settings.auth_client_id,
    );
    let mut changed = Vec::new();
    for id in ids {
        let uuid = match state.accounts.lock().unwrap().iter().find(|a| a.id == id).cloned() {
            Some(a) => a,
            None => continue,
        };
        let ms_refresh = {
            let mut vault = state.vault();
            vault.get(&format!("{}:ms_refresh", auth::plain_uuid(&uuid.player_uuid)))
        };
        let Some(refresh) = ms_refresh.filter(|r| !r.is_empty()) else {
            continue;
        };
        let result = match client
            .refresh_account(&auth::plain_uuid(&uuid.player_uuid), &refresh)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                    continue;
            }
        };
        let Some(p) = result.profile else { continue };
        {
            let mut accounts = state.accounts.lock().unwrap();
            if let Some(a) = accounts.iter_mut().find(|a| a.id == id) {
                a.player_name = p.name.clone();
                a.skins = p.skins.clone();
                a.last_used = Some(chrono::Utc::now().to_rfc3339());
                changed.push(a.clone());
            }
        }
        // keep the operator-visible account data (name/email/online) in sync on
        // every launcher start; best-effort so backend hiccups never block the app
        let backend_id = auth::plain_uuid(&uuid.player_uuid);
        let email = result.email.as_deref();
        if let Err(e) = crate::monet::identify_account(&state, &backend_id, Some(&p.name), email).await {
            log::warn!("identify_account failed (ignored): {e}");
        }
    }
    state.persist_accounts().map_err(|e| e.to_string())?;
    Ok(changed)
}

#[tauri::command]
pub async fn refresh_account(state: State<'_, AppState>, id: String) -> CmdResult<Account> {
    let uuid = state.accounts.lock().unwrap().iter().find(|a| a.id == id).cloned()
        .ok_or_else(|| "account not found".to_string())?;
    let ms_refresh = {
        let mut vault = state.vault();
        vault.get(&format!("{}:ms_refresh", auth::plain_uuid(&uuid.player_uuid)))
    };
    if let Some(refresh) = ms_refresh {
        if !refresh.is_empty() {
            let settings = state.get_settings();
            let client = AuthClient::new(Arc::new(state.http.clone()), settings.auth_client_id);
            let result = client.refresh_account(&auth::plain_uuid(&uuid.player_uuid), &refresh).await.map_err(|e| e.to_string())?;
            if let Some(p) = result.profile {
                let mut accounts = state.accounts.lock().unwrap();
                if let Some(a) = accounts.iter_mut().find(|a| a.id == id) {
                    a.player_name = p.name.clone();
                    a.skins = p.skins.clone();
                    a.last_used = Some(chrono::Utc::now().to_rfc3339());
                    if let Some(e) = result.email {
                        a.email = Some(e);
                    }
                }
                let updated = accounts.iter().find(|a| a.id == id).cloned().unwrap_or(uuid);
                drop(accounts);
                state.persist_accounts().map_err(|e| e.to_string())?;
                return Ok(updated);
            }
        }
    }
    Err("this account cannot be refreshed; sign in again".into())
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn launch_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> CmdResult<String> {
    launch_with_target(&app, &state, &profile_id, crate::launch::LaunchTarget::Normal).await
}

/// Launch a profile directly into a saved world or a server (Quick-Play).
#[tauri::command]
pub async fn launch_profile_into(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    world: Option<String>,
    server: Option<String>,
) -> CmdResult<String> {
    let target = match (world, server) {
        (Some(folder), _) => crate::launch::LaunchTarget::World(folder),
        (None, Some(ip)) => crate::launch::LaunchTarget::Server(ip),
        (None, None) => crate::launch::LaunchTarget::Normal,
    };
    launch_with_target(&app, &state, &profile_id, target).await
}

async fn launch_with_target(
    app: &AppHandle,
    state: &State<'_, AppState>,
    profile_id: &str,
    target: crate::launch::LaunchTarget,
) -> CmdResult<String> {
    {
        let running = state.running.lock().unwrap();
        if running.is_some() {
            return Err("A game instance is already running.".into());
        }
    }
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| format!("profile {profile_id} not found"))?;

    let account = state
        .accounts
        .lock()
        .unwrap()
        .iter()
        .max_by_key(|a| a.last_used.clone().unwrap_or_default())
        .cloned()
        .ok_or_else(|| "No Microsoft account is signed in. Add an account first.".to_string())?;

    {
        let mut accounts = state.accounts.lock().unwrap();
        if let Some(a) = accounts.iter_mut().find(|a| a.id == account.id) {
            a.last_used = Some(chrono::Utc::now().to_rfc3339());
        }
    }
    let _ = state.persist_accounts();

    let prepared = crate::install::prepare(&app, &state, &profile, true)
        .await
        .map_err(|e| e.to_string())?;

    let running = crate::launch::run(&app, &state, &profile, &account, &prepared, &target)
        .await
        .map_err(|e| e.to_string())?;

    let game_arc = Arc::new(running);
    *state.running.lock().unwrap() = Some(game_arc.clone());

    let settings = state.get_settings();
    if settings.discord_rpc {
        use tauri::Manager;
        let app2 = app.clone();
        let extras = app2.state::<crate::extras::Extras>();
        extras.discord.set_activity(crate::discord::Activity {
            state: Some(format!("Playing {}", profile.name)),
            details: Some(format!("{} {}", profile.game_version, profile.loader)),
            image_key: Some("azrealx".into()),
            image_text: Some("AzrealX".into()),
        });
    }

    let app_owned = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app_owned.state::<AppState>();
        let _ = crate::launch::wait_and_finish(&app_owned, &state, &profile, game_arc).await;
        if state.get_settings().discord_rpc {
            use tauri::Manager;
            let extras = app_owned.state::<crate::extras::Extras>();
            extras.discord.clear();
        }
    });
    Ok("launched".into())
}

#[tauri::command]
pub async fn stop_game(state: State<'_, AppState>) -> CmdResult<()> {
    crate::launch::stop(&state).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_status(state: State<'_, AppState>) -> Option<GameStatus> {
    state.running.lock().unwrap().as_ref().map(|r| GameStatus {
        profile_id: r.profile_id.clone(),
        status: "running".into(),
        pid: Some(r.pid),
        started_at: None,
        log_path: Some(r.log_path.display().to_string()),
    })
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn launcher_logs(limit: usize) -> Vec<String> {
    crate::logging::buffered(limit)
}

#[tauri::command]
pub fn launcher_log_path() -> Option<String> {
    crate::logging::log_path().map(|p| p.display().to_string())
}

#[tauri::command]
pub fn game_logs(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<String>> {
    let dir = state.data_dir.join("logs").join("games");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    let prefix = format!("{}-", crate::install::version_id_for(&profile));
    let mut newest: Option<(u64, std::path::PathBuf)> = None;
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) {
            let m = e.metadata().map_err(|e| e.to_string())?;
            let t = m.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)).unwrap_or(0);
            if newest.as_ref().map(|(t2, _)| t > *t2).unwrap_or(true) {
                newest = Some((t, e.path()));
            }
        }
    }
    let Some((_, path)) = newest else {
        return Ok(Vec::new());
    };
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    if lines.len() > 600 {
        lines.drain(0..lines.len() - 600);
    }
    Ok(lines)
}

// ---------------------------------------------------------------------------
// CurseForge
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn curse_search(
    state: State<'_, AppState>,
    query: String,
    class_id: i64,
    game_version: Option<String>,
    index: u32,
) -> CmdResult<Vec<crate::curse::CurseMod>> {
    let settings = state.get_settings();
    let client = crate::curse::CurseClient::new(state.http.clone(), settings.curseforge_api_key.clone());
    client
        .search(class_id, &query, game_version.as_deref(), index)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn curse_files(
    state: State<'_, AppState>,
    mod_id: i64,
    game_version: Option<String>,
    index: u32,
) -> CmdResult<Vec<crate::curse::CurseFile>> {
    let settings = state.get_settings();
    let client = crate::curse::CurseClient::new(state.http.clone(), settings.curseforge_api_key.clone());
    client
        .files(mod_id, game_version.as_deref(), index)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn curse_versions(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let settings = state.get_settings();
    let client = crate::curse::CurseClient::new(state.http.clone(), settings.curseforge_api_key.clone());
    client.game_versions().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn modrinth_search(
    state: State<'_, AppState>,
    query: String,
    class_id: String,
    game_version: Option<String>,
) -> CmdResult<Vec<crate::modrinth::ModrinthHit>> {
    crate::modrinth::ModrinthClient::new(state.http.clone())
        .search(&query, &class_id, game_version.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn modrinth_versions(
    state: State<'_, AppState>,
    slug: String,
    game_version: Option<String>,
) -> CmdResult<Vec<crate::modrinth::ModrinthVersion>> {
    crate::modrinth::ModrinthClient::new(state.http.clone())
        .versions(&slug, game_version.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn modrinth_mc_versions(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    crate::modrinth::ModrinthClient::new(state.http.clone())
        .game_versions()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_curse_file(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    mod_id: i64,
    file_id: i64,
    name: String,
) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    let settings = state.get_settings();
    let client = crate::curse::CurseClient::new(state.http.clone(), settings.curseforge_api_key.clone());
    let file = client.file(mod_id, file_id).await.map_err(|e| e.to_string())?;
    let Some(url) = file.download_url.clone() else {
        return Err("CurseForge returned no download URL for this file".into());
    };
    let safe = file
        .file_name
        .clone()
        .unwrap_or_else(|| format!("{name}.jar"))
        .split('/')
        .last()
        .unwrap_or(&name)
        .to_string();
    let dest = state.game_dir_for(&profile).join("mods").join(&safe);
    let result = crate::download::Engine::new()
        .run(
            Some(&app),
            &format!("curse:{}:{}", mod_id, file_id),
            vec![crate::download::DownloadSpec {
                url,
                dest: dest.clone(),
                sha1: None,
                size: None,
                name: safe.clone(),
            }],
            1,
        )
        .await;
    if result.is_err() && result.clone().err().map(|e| e.to_string().contains("Canceled")).unwrap_or(false) {
        return Err("Download canceled".into());
    }
    result.map_err(|e| e.to_string())?;

    let mut profiles = state.profiles.lock().unwrap();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == profile_id) {
        let pkg = InstalledPackage {
            id: format!("cf-{mod_id}-{file_id}"),
            name,
            file_name: safe.clone(),
            source: "curseforge".into(),
            version: file.display_name.clone().unwrap_or_default(),
            sha1: None,
            installed_at: chrono::Utc::now().to_rfc3339(),
            enabled: true,
            kind: "mod".into(),
        };
        p.packages.retain(|x| x.id != pkg.id);
        p.packages.push(pkg);
        p.install_status = "installed".into();
    }
    drop(profiles);
    state.persist_profiles().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn install_modrinth_url(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    version_json: serde_json::Value,
) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;

    let project_id = version_json["id"].as_str().unwrap_or("").to_string();
    let file = &version_json["files"][0];
    let url = file["url"].as_str().ok_or_else(|| "no download url".to_string())?;
    let filename = file["filename"].as_str().unwrap_or("mod.jar").to_string();
    let sha1 = file["hashes"]["sha1"].as_str().map(|s| s.to_string());
    let size = file["size"].as_u64();
    let version_number = version_json["version_number"].as_str().unwrap_or("").to_string();
    let name = version_json["name"].as_str().unwrap_or("Mod").to_string();

    let kind = if filename.ends_with(".zip") && filename.contains("shader") {
        "shader"
    } else if filename.contains("resource") || filename.ends_with(".zip") {
        "resource"
    } else {
        "mod"
    };
    let sub = match kind {
        "shader" => "shaderpacks",
        "resource" => "resourcepacks",
        _ => "mods",
    };
    let dest = state.game_dir_for(&profile).join(sub).join(&filename);
    let result = state
        .engine
        .run(
            Some(&app),
            &format!("modrinth:{}", project_id),
            vec![crate::download::DownloadSpec {
                url: url.to_string(),
                dest: dest.clone(),
                sha1,
                size,
                name: filename.clone(),
            }],
            1,
        )
        .await;
    result.map_err(|e| e.to_string())?;

    let mut profiles = state.profiles.lock().unwrap();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == profile_id) {
        let pkg = InstalledPackage {
            id: format!("modrinth:{project_id}"),
            name: name.clone(),
            file_name: filename,
            source: "modrinth".into(),
            version: version_number,
            sha1: None,
            installed_at: chrono::Utc::now().to_rfc3339(),
            enabled: true,
            kind: kind.into(),
        };
        p.packages.retain(|x| x.id != pkg.id);
        p.packages.push(pkg);
        p.install_status = "installed".into();
    }
    drop(profiles);
    state.persist_profiles().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_package(
    state: State<'_, AppState>,
    profile_id: String,
    package_id: String,
) -> CmdResult<()> {
    let mut profiles = state.profiles.lock().unwrap();
    let Some(profile) = profiles.iter().find(|p| p.id == profile_id).cloned() else {
        return Err("profile not found".into());
    };
    let Some(pkg) = profile.packages.iter().find(|p| p.id == package_id).cloned() else {
        return Err("package not found".into());
    };
    let game_dir = state.game_dir_for(&profile);
    let base_path = match pkg.kind.as_str() {
        "shader" => game_dir.join("shaderpacks"),
        "resource" | "resourcepack" => game_dir.join("resourcepacks"),
        _ => game_dir.join("mods"),
    };
    let current = base_path.join(&pkg.file_name);
    let (new_name, enabled) = if pkg.enabled {
        (
            format!("{}.disabled", pkg.file_name.trim_end_matches(".disabled")),
            false,
        )
    } else {
        (
            pkg.file_name.trim_end_matches(".disabled").to_string(),
            true,
        )
    };
    let new_path = base_path.join(&new_name);
    if current.exists() {
        std::fs::rename(&current, &new_path).map_err(|e| e.to_string())?;
    } else if enabled {
        return Err("file not found — reinstalling may be needed".into());
    }
    if let Some(p) = profiles.iter_mut().find(|p| p.id == profile_id) {
        if let Some(pkg) = p.packages.iter_mut().find(|p| p.id == package_id) {
            pkg.enabled = enabled;
            pkg.file_name = new_name;
        }
    }
    drop(profiles);
    state.persist_profiles().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_package(
    state: State<'_, AppState>,
    profile_id: String,
    package_id: String,
) -> CmdResult<()> {
    let mut profiles = state.profiles.lock().unwrap();
    let Some(profile) = profiles.iter().find(|p| p.id == profile_id).cloned() else {
        return Err("profile not found".into());
    };
    let Some(pkg) = profile.packages.iter().find(|p| p.id == package_id).cloned() else {
        return Err("package not found".into());
    };
    let game_dir = state.game_dir_for(&profile);
    if let Some(p) = profiles.iter_mut().find(|p| p.id == profile_id) {
        p.packages.retain(|p| p.id != package_id);
    }
    drop(profiles);
    let target = match pkg.kind.as_str() {
        "shader" => game_dir.join("shaderpacks").join(&pkg.file_name),
        "resource" | "resourcepack" => game_dir.join("resourcepacks").join(&pkg.file_name),
        _ => game_dir.join("mods").join(&pkg.file_name),
    };
    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }
    state.persist_profiles().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Modpacks
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn modpack_list_files(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<crate::model::InstalledPackage>> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    Ok(profile.packages)
}

#[tauri::command]
pub async fn modpack_import(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
) -> CmdResult<usize> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    if !std::path::Path::new(&path).exists() {
        return Err(format!("file not found: {path}"));
    }
    crate::modpacks::import_from_zip(&app, &state, &profile, std::path::Path::new(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn modpack_export(
    state: State<'_, AppState>,
    profile_id: String,
    dest: String,
) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::modpacks::export_to_zip(&state, &profile, std::path::Path::new(&dest))
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Library: worlds / screenshots / servers / backups
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn worlds(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<WorldInfo>> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::list_worlds(&state.game_dir_for(&profile)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn screenshots(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<ScreenshotInfo>> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::list_screenshots(&state.game_dir_for(&profile)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn crash_reports(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<CrashReportInfo>> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::crash_reports(&state.game_dir_for(&profile)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_world(
    state: State<'_, AppState>,
    profile_id: String,
    folder: String,
) -> CmdResult<String> {
    let path = crate::misc::backup_world(&state, &profile_id, &folder).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn list_world_backups(state: State<'_, AppState>, folder: String) -> CmdResult<Vec<String>> {
    let paths = crate::misc::list_backups(&state, &folder).map_err(|e| e.to_string())?;
    Ok(paths.iter().map(|p| p.display().to_string()).collect())
}

#[tauri::command]
pub fn restore_world_backup(
    state: State<'_, AppState>,
    profile_id: String,
    folder: String,
    backup: String,
) -> CmdResult<()> {
    crate::misc::restore_backup(&state, &profile_id, &folder, std::path::Path::new(&backup))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_world(state: State<'_, AppState>, profile_id: String, folder: String) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::delete_world(&state.game_dir_for(&profile), &folder).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn servers_read(state: State<'_, AppState>, profile_id: String) -> CmdResult<Vec<ServerEntry>> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::read_servers(&state.game_dir_for(&profile)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn servers_save(
    state: State<'_, AppState>,
    profile_id: String,
    servers: Vec<ServerEntry>,
) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    crate::misc::write_servers(&state.game_dir_for(&profile), &servers).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn news_feed(state: State<'_, AppState>) -> CmdResult<Vec<NewsItem>> {
    crate::misc::news_feed(&state).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn playtime_stats(state: State<'_, AppState>) -> PlaytimeStats {
    state.playtime.lock().unwrap().stats()
}

#[tauri::command]
pub async fn check_update(state: State<'_, AppState>) -> CmdResult<UpdateInfo> {
    crate::misc::check_update(&state).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    let ok = std::process::Command::new("open").arg(&path).status().map(|s| s.success()).unwrap_or(false);
    #[cfg(target_os = "windows")]
    let ok = std::process::Command::new("explorer").arg(&path).status().map(|s| s.success()).unwrap_or(false);
    #[cfg(all(unix, not(target_os = "macos")))]
    let ok = std::process::Command::new("xdg-open").arg(&path).status().map(|s| s.success()).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(format!("could not open {}", path))
    }
}

#[tauri::command]
pub fn open_game_dir(state: State<'_, AppState>, profile_id: String) -> CmdResult<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    let dir = state.game_dir_for(&profile);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_path(dir.display().to_string())
}
// ---------------------------------------------------------------------------
// Monetization: premium status, paywall config, cloud sync guard
// ---------------------------------------------------------------------------

fn active_account(state: &State<'_, AppState>) -> Option<crate::model::Account> {
    let id = active_account_id(state)?;
    state
        .accounts
        .lock()
        .unwrap()
        .iter()
        .find(|a| a.id == id)
        .cloned()
}

/// Vault-backed xuid of the active account (linked during MS login).
/// Backend identity of the active account: the Minecraft UUID (plain). The
/// Xbox XUID is unreliable (Microsoft sometimes omits it), the MC UUID is
/// always present and unique per account.
fn active_xuid(state: &State<'_, AppState>) -> Option<String> {
    let account = active_account(state)?;
    Some(auth::plain_uuid(&account.player_uuid))
}

/// Premium tier of the currently logged-in account. Fails closed: no account,
/// no backend or an error => free.
#[tauri::command]
pub async fn premium_status(state: State<'_, AppState>) -> CmdResult<crate::monet::PremiumStatus> {
    let Some(xuid) = active_xuid(&state) else {
            return Ok(crate::monet::PremiumStatus::free());
    };
    let account = active_account(&state);
    let name = account.as_ref().map(|a| a.player_name.as_str()).filter(|n| !n.is_empty());
    let email = account.as_ref().and_then(|a| a.email.as_deref());
    // Register/refresh with the backend on every status poll: this is what
    // keeps the operator's user list (name/email/online) current even when no
    // MS token refresh happens. Best-effort, never fails the status itself.
    if let Err(e) = crate::monet::identify_account(&state, &xuid, name, email).await {
        log::warn!("identify_account failed (ignored): {e}");
    }
    crate::monet::premium_status(&state, &xuid, name, email).await.map_err(|e| e.to_string())
}

/// Paywall / affiliate links for the UI (env-driven).
#[tauri::command]
pub fn monet_config() -> crate::monet::MonetConfig {
    crate::monet::config()
}

/// Push the launcher-managed game options into the user's cloud profile.
///
/// Guardrail: blocked while a Minecraft process is running to avoid write
/// conflicts on the game's options.txt (the game owns that file while alive).
/// Until a serverless backend is configured the payload is stubbed to a local
/// file so the full gate can be tested end-to-end.
#[tauri::command]
pub async fn cloud_profiles_sync(state: State<'_, AppState>) -> CmdResult<crate::monet::CloudSyncResult> {
    if state.running.lock().unwrap().is_some() {
        return Err(String::from("cloud_sync_game_running"));
    }
    let account = active_account(&state).ok_or_else(|| String::from("no_account"))?;
    let xuid = active_xuid(&state).ok_or_else(|| String::from("no_xuid"))?;

    let name = Some(account.player_name.clone());
    let email = account.email.clone();
    let status = crate::monet::premium_status(&state, &xuid, name.as_deref(), email.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    if !status.is_premium() {
        return Err(String::from("premium_required"));
    }

    let options = state.get_settings().game_options;
    let payload = serde_json::json!(options);
    let rev = chrono::Utc::now().timestamp_millis();
    if crate::monet::backend_url().is_empty() {
        // local stub: keep writing to data_dir/cloud so the flow stays
        // testable before the serverless backend is provisioned
        let dir = state.data_dir.join("cloud");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join(format!("{}.json", crate::auth::plain_uuid(&account.player_uuid)));
        let stub = serde_json::json!({ "rev": rev, "options": payload });
        std::fs::write(&file, serde_json::to_vec_pretty(&stub).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        return Ok(crate::monet::CloudSyncResult { cloud_stub: true, uploaded: options.len() });
    }
    crate::monet::cloud_sync(&state, &xuid, name.as_deref(), email.as_deref(), &payload, rev)
        .await
        .map_err(|e| e.to_string())
}

/// Open a URL in the OS default browser (required so affiliate/cookie
/// tracking works - never an in-app webview).
#[tauri::command]
pub fn open_url(url: String) -> CmdResult<()> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(String::from("invalid url"));
    }
    open_path(url)
}
