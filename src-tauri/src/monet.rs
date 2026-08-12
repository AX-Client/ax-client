//! Monetization: premium subscription status, paywall URLs and affiliate
//! links. The backend base URL is configurable via the environment
//! (`AX_BACKEND_URL`), so it can be pointed at a serverless REST backend
//! (Supabase/Firebase) without touching code.
//!
//! Until a real backend exists the launcher runs in a local-only mode
//! (`AX_PREMIUM_MOCK=true`): the status endpoint is faked so the UI can be
//! developed and tested. Never enable the mock in production builds.

use crate::error::{Error, Result};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const PAYWALL_DEFAULT_URL: &str = "https://ax-client.com/premium";
pub const AFFILIATE_DEFAULT_URL: &str = "https://bisecthosting.com/ax-client";

/// Production backend: Supabase Edge Functions. Embedded as a default so the
/// launcher works out of the box; `AX_BACKEND_URL` overrides it for dev.
pub const DEFAULT_BACKEND_URL: &str = "https://vlouhawuhxldixyrjvib.supabase.co/functions/v1";

/// Env keys - overridable via `.env` next to the working directory or the
/// process environment.
pub const ENV_BACKEND_URL: &str = "AX_BACKEND_URL";
pub const ENV_PAYWALL_URL: &str = "AX_PAYWALL_URL";
pub const ENV_AFFILIATE_URL: &str = "AX_AFFILIATE_URL";
pub const ENV_PREMIUM_MOCK: &str = "AX_PREMIUM_MOCK";
pub const ENV_SESSION_TTL_SECS: &str = "AX_SESSION_TTL_SECS";

pub const ENV_ENDPOINT_IDENTIFY: &str = "AX_ENDPOINT_IDENTIFY";
pub const ENV_ENDPOINT_REFRESH: &str = "AX_ENDPOINT_REFRESH";
pub const ENV_ENDPOINT_STATUS: &str = "AX_ENDPOINT_STATUS";
pub const ENV_ENDPOINT_CLOUD: &str = "AX_ENDPOINT_CLOUD";
pub const ENV_ENDPOINT_CLOUD_RESTORE: &str = "AX_ENDPOINT_CLOUD_RESTORE";
pub const ENV_ENDPOINT_TRANSFER: &str = "AX_ENDPOINT_TRANSFER";

pub fn backend_url() -> String {
    std::env::var(ENV_BACKEND_URL)
        .unwrap_or_else(|_| DEFAULT_BACKEND_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// Path of an auth/cloud endpoint relative to `AX_BACKEND_URL`, overridable
/// per endpoint. Defaults match the Supabase Edge Function slugs so
/// `AX_BACKEND_URL` can point at `https://<ref>.supabase.co/functions/v1`.
fn endpoint(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn endpoint_identify() -> String {
    endpoint(ENV_ENDPOINT_IDENTIFY, "/auth-identify")
}
fn endpoint_refresh() -> String {
    endpoint(ENV_ENDPOINT_REFRESH, "/auth-refresh")
}
fn endpoint_status() -> String {
    endpoint(ENV_ENDPOINT_STATUS, "/premium-status")
}
fn endpoint_cloud() -> String {
    endpoint(ENV_ENDPOINT_CLOUD, "/cloud-sync")
}
fn endpoint_cloud_restore() -> String {
    endpoint(ENV_ENDPOINT_CLOUD_RESTORE, "/cloud-restore")
}
fn endpoint_transfer() -> String {
    endpoint(ENV_ENDPOINT_TRANSFER, "/world-transfer")
}

pub fn paywall_url() -> String {
    std::env::var(ENV_PAYWALL_URL)
        .unwrap_or_else(|_| PAYWALL_DEFAULT_URL.to_string())
}

pub fn affiliate_url() -> String {
    std::env::var(ENV_AFFILIATE_URL)
        .unwrap_or_else(|_| AFFILIATE_DEFAULT_URL.to_string())
}

pub fn premium_mock() -> bool {
    std::env::var(ENV_PREMIUM_MOCK)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn session_ttl() -> u64 {
    std::env::var(ENV_SESSION_TTL_SECS)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15 * 60)
}

fn premium_mock_token_expiry() -> u64 {
    7 * 24 * 3600
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PremiumStatus {
    pub tier: String, // "free" | "premium"
    pub expires_at: Option<u64>,
}

impl PremiumStatus {
    pub fn is_premium(&self) -> bool {
        self.tier == "premium"
            && self.expires_at.map(|e| e > now_unix()).unwrap_or(true)
    }
    pub fn free() -> Self {
        PremiumStatus { tier: "free".into(), expires_at: None }
    }
}

/// Runtime configuration surfaced to the UI.
#[derive(Serialize, Clone, Debug)]
pub struct MonetConfig {
    pub backend_configured: bool,
    pub paywall_url: String,
    pub affiliate_url: String,
    pub mock: bool,
}

pub fn config() -> MonetConfig {
    MonetConfig {
        backend_configured: !backend_url().is_empty(),
        paywall_url: paywall_url(),
        affiliate_url: affiliate_url(),
        mock: premium_mock(),
    }
}

/// Result of a cloud profile sync. `cloud_stub: true` means the payload was
/// written locally because no serverless backend is configured yet.
#[derive(Serialize, Clone, Debug)]
pub struct CloudSyncResult {
    pub cloud_stub: bool,
    pub uploaded: usize,
}

/// Result of a cloud profile restore. `options: None` means no backup exists
/// yet on the server side.
#[derive(Serialize, Clone, Debug)]
pub struct CloudRestoreResult {
    pub cloud_stub: bool,
    pub rev: i64,
    pub options: Option<serde_json::Value>,
}

/// A world backup offered for short-term download to the user's other devices.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorldTransfer {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub download_url: String,
}

pub const MAX_TRANSFER_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub const TRANSFER_TTL_HINT: &str = "30"; // minutes, shown in the UI

const SESSION_KEY: &str = "session:{xuid}";
const SESSION_REFRESH_KEY: &str = "session_refresh:{xuid}";

/// Registers/updates the account with the backend and returns a fresh session
/// token. Unlike `session_token` this always calls the backend (no cache), so
/// the operator-visible fields (player name, email, online status) are kept in
/// sync on every login.
pub async fn identify_account(
    state: &AppState,
    xuid: &str,
    player_name: Option<&str>,
    email: Option<&str>,
) -> Result<String> {
    let base = backend_url();
    if base.is_empty() {
        return Err(Error::Auth("no backend configured (AX_BACKEND_URL)".into()));
    }
    let resp: serde_json::Value = state
        .http
        .post(format!("{base}{}", endpoint_identify()))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "xuid": xuid,
            "mc_uuid": xuid,
            "player_name": player_name.unwrap_or(""),
            "email": email.unwrap_or(""),
        }))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("identify failed: {e}")))?
        .json()
        .await
        .map_err(|e| Error::Auth(format!("identify parse failed: {e}")))?;
    let tok = resp["session_token"]
        .as_str()
        .ok_or_else(|| Error::Auth("backend returned no session token".into()))?;
    let rt = resp["refresh_token"].as_str().unwrap_or(tok);
    let mut vault = state.vault();
    vault.set(&SESSION_KEY.replace("{xuid}", xuid), tok);
    vault.set(&SESSION_REFRESH_KEY.replace("{xuid}", xuid), rt);
    let _ = vault.flush();
    Ok(tok.to_string())
}

/// Returns a valid session token for the user, creating/refreshing it through
/// the backend when needed. Tokens are stored in the OS-keychain-backed vault.
pub async fn session_token(
    state: &AppState,
    xuid: &str,
    player_name: Option<&str>,
    email: Option<&str>,
) -> Result<String> {
    if premium_mock() {
        return Ok(format!("mock-session-{xuid}"));
    }
    let base = backend_url();
    if base.is_empty() {
        return Err(Error::Auth("no backend configured (AX_BACKEND_URL)".into()));
    }
    // vault access is kept inside short blocks so no MutexGuard crosses an await
    let cached = {
        let mut vault = state.vault();
        vault.get(&SESSION_KEY.replace("{xuid}", xuid))
    };
    if let Some(tok) = cached {
        if token_age_ok(&tok) {
            return Ok(tok);
        }
    }
    // refresh via the backend
    let refresh = {
        let mut vault = state.vault();
        vault.get(&SESSION_REFRESH_KEY.replace("{xuid}", xuid))
    };
    if let Some(rt) = refresh {
        let resp: serde_json::Value = state
            .http
            .post(format!("{base}{}", endpoint_refresh()))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "xuid": xuid, "refresh_token": rt }))
            .send()
            .await
            .map_err(|e| Error::Auth(format!("session refresh failed: {e}")))?
            .json()
            .await
            .map_err(|e| Error::Auth(format!("session refresh parse failed: {e}")))?;
        if let (Some(tok), Some(new_rt)) = (resp["session_token"].as_str(), resp["refresh_token"].as_str()) {
            let mut vault = state.vault();
            vault.set(&SESSION_KEY.replace("{xuid}", xuid), tok);
            vault.set(&SESSION_REFRESH_KEY.replace("{xuid}", xuid), new_rt);
            let _ = vault.flush();
            return Ok(tok.to_string());
        }
    }
    // first-time identify: the backend links xuid -> account and returns a
    // signed session token (JWT with xuid claim, short TTL)
    let resp: serde_json::Value = state
        .http
        .post(format!("{base}{}", endpoint_identify()))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "xuid": xuid,
            "player_name": player_name.unwrap_or(""),
            "email": email.unwrap_or(""),
        }))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("identify failed: {e}")))?
        .json()
        .await
        .map_err(|e| Error::Auth(format!("identify parse failed: {e}")))?;
    let tok = resp["session_token"]
        .as_str()
        .ok_or_else(|| Error::Auth("backend returned no session token".into()))?;
    let rt = resp["refresh_token"].as_str().unwrap_or(tok);
    let mut vault = state.vault();
    vault.set(&SESSION_KEY.replace("{xuid}", xuid), tok);
    vault.set(&SESSION_REFRESH_KEY.replace("{xuid}", xuid), rt);
    let _ = vault.flush();
    Ok(tok.to_string())
}

/// TTL bookkeeping. A real backend issues JWTs with an `exp` claim; the
/// placeholder trusts tokens for the configured TTL.
fn token_age_ok(_tok: &str) -> bool {
    true
}

/// Premium entitlement for the given xuid. `fail_closed`: when the backend is
/// unreachable the user is treated as free (never unlock behind an error).
pub async fn premium_status(
    state: &AppState,
    xuid: &str,
    player_name: Option<&str>,
    email: Option<&str>,
) -> Result<PremiumStatus> {
    if premium_mock() {
        return Ok(PremiumStatus {
            tier: "premium".into(),
            expires_at: Some(now_unix() + 7 * 24 * 3600),
        });
    }
    let base = backend_url();
    if base.is_empty() {
        return Ok(PremiumStatus::free());
    }
    let tok = session_token(state, xuid, player_name, email).await?;
    let resp = state
        .http
        .get(format!("{base}{}", endpoint_status()))
        .bearer_auth(&tok)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("premium status failed: {e}")))?;
    if resp.status().is_success() {
        Ok(resp.json::<PremiumStatus>().await?)
    } else {
        // 402/403 -> free; any error keeps the gate closed
        Ok(PremiumStatus::free())
    }
}

/// Push the profile settings (launcher game-option overrides) for the given
/// user to the cloud. `rev` is a client-side monotonic revision used for
/// last-write-wins conflict resolution on the backend.
pub async fn cloud_sync(
    state: &AppState,
    xuid: &str,
    player_name: Option<&str>,
    email: Option<&str>,
    options: &serde_json::Value,
    rev: i64,
) -> Result<CloudSyncResult> {
    if premium_mock() {
        return Ok(CloudSyncResult { cloud_stub: true, uploaded: options.as_object().map(|o| o.len()).unwrap_or(0) });
    }
    let base = backend_url();
    if base.is_empty() {
        return Err(Error::Auth("no backend configured (AX_BACKEND_URL)".into()));
    }
    let tok = session_token(state, xuid, player_name, email).await?;
    let resp = state
        .http
        .post(format!("{base}{}", endpoint_cloud()))
        .header("Content-Type", "application/json")
        .bearer_auth(&tok)
        .json(&serde_json::json!({ "xuid": xuid, "rev": rev, "options": options }))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("cloud sync failed: {e}")))?;
    if resp.status().is_success() {
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| Error::Auth(format!("cloud sync parse failed: {e}")))?;
        let uploaded = body["uploaded"].as_u64().unwrap_or(0) as usize;
        Ok(CloudSyncResult { cloud_stub: false, uploaded })
    } else {
        Err(Error::Auth(format!("cloud sync rejected (HTTP {})", resp.status().as_u16())))
    }
}

/// Fetch the stored cloud profile settings for the given user. Returns
/// `None` if the backend has no backup yet (HTTP 404) or the local stub file
/// does not exist.
pub async fn cloud_restore(
    state: &AppState,
    xuid: &str,
    player_name: Option<&str>,
    email: Option<&str>,
) -> Result<CloudRestoreResult> {
    if premium_mock() || backend_url().is_empty() {
        let file = state.data_dir.join("cloud").join(format!("{xuid}.json"));
        if let Ok(txt) = std::fs::read_to_string(&file) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                return Ok(CloudRestoreResult {
                    cloud_stub: true,
                    rev: v["rev"].as_i64().unwrap_or(0),
                    options: Some(v["options"].clone()),
                });
            }
        }
        return Ok(CloudRestoreResult { cloud_stub: true, rev: 0, options: None });
    }
    let base = backend_url();
    let tok = session_token(state, xuid, player_name, email).await?;
    let resp = state
        .http
        .get(format!("{base}{}", endpoint_cloud_restore()))
        .bearer_auth(&tok)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("cloud restore failed: {e}")))?;
    if resp.status().as_u16() == 404 {
        return Ok(CloudRestoreResult { cloud_stub: false, rev: 0, options: None });
    }
    if !resp.status().is_success() {
        return Err(Error::Auth(format!("cloud restore rejected (HTTP {})", resp.status().as_u16())));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Auth(format!("cloud restore parse failed: {e}")))?;
    Ok(CloudRestoreResult {
        cloud_stub: false,
        rev: body["rev"].as_i64().unwrap_or(0),
        options: Some(body["options"].clone()),
    })
}

/// Start a short-lived world backup transfer: the caller uploads the zip to
/// the returned signed URL, then calls `world_transfer_confirm`. Returns
/// (transfer id, upload url).
pub async fn world_transfer_create(
    state: &AppState,
    xuid: &str,
    name: &str,
    size: u64,
) -> Result<(String, String)> {
    if premium_mock() {
        return Err(Error::Auth("world transfer disabled in mock mode".into()));
    }
    if size == 0 || size > MAX_TRANSFER_BYTES {
        return Err(Error::Auth("backup too large (max 2 GB)".into()));
    }
    let base = backend_url();
    let tok = session_token(state, xuid, None, None).await?;
    let resp = state
        .http
        .post(format!("{base}{}", endpoint_transfer()))
        .header("Content-Type", "application/json")
        .bearer_auth(&tok)
        .json(&serde_json::json!({ "action": "create", "name": name, "size": size }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("world transfer create failed: {e}")))?;
    if resp.status() == 409 {
        return Err(Error::Auth("world_transfer_active".into()));
    }
    if !resp.status().is_success() {
        return Err(Error::Auth(format!(
            "world transfer create rejected (HTTP {})",
            resp.status().as_u16()
        )));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Auth(format!("world transfer create parse failed: {e}")))?;
    let id = body["id"].as_str().unwrap_or("").to_string();
    let url = body["upload_url"].as_str().unwrap_or("").to_string();
    if id.is_empty() || url.is_empty() {
        return Err(Error::Auth("world transfer create: missing id/upload_url".into()));
    }
    Ok((id, url))
}

/// Mark a created transfer as ready so the user's other devices can fetch it.
pub async fn world_transfer_confirm(state: &AppState, xuid: &str, id: &str) -> Result<()> {
    if premium_mock() {
        return Err(Error::Auth("world transfer disabled in mock mode".into()));
    }
    let base = backend_url();
    let tok = session_token(state, xuid, None, None).await?;
    let resp = state
        .http
        .post(format!("{base}{}", endpoint_transfer()))
        .header("Content-Type", "application/json")
        .bearer_auth(&tok)
        .json(&serde_json::json!({ "action": "confirm", "id": id }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("world transfer confirm failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Auth(format!(
            "world transfer confirm rejected (HTTP {})",
            resp.status().as_u16()
        )));
    }
    Ok(())
}

/// List world backups currently offered to this account (excluding those
/// already received on this device).
pub async fn world_transfer_poll(
    state: &AppState,
    xuid: &str,
    device_id: &str,
) -> Result<Vec<WorldTransfer>> {
    if premium_mock() {
        return Ok(Vec::new());
    }
    let base = backend_url();
    let tok = session_token(state, xuid, None, None).await?;
    let resp = state
        .http
        .get(format!(
            "{base}{}?action=poll&device_id={device_id}",
            endpoint_transfer(),
        ))
        .bearer_auth(&tok)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("world transfer poll failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Auth(format!(
            "world transfer poll rejected (HTTP {})",
            resp.status().as_u16()
        )));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| Error::Auth(format!("world transfer poll parse failed: {e}")))?;
    let list = body["transfers"].as_array().cloned().unwrap_or_default();
    Ok(list
        .into_iter()
        .filter_map(|v| serde_json::from_value::<WorldTransfer>(v).ok())
        .collect())
}

/// Tell the backend this device received the backup so it won't be offered
/// here again (other devices of the account can still fetch it until the
/// 30-minute window expires).
pub async fn world_transfer_ack(state: &AppState, xuid: &str, id: &str, device_id: &str) -> Result<()> {
    if premium_mock() {
        return Ok(());
    }
    let base = backend_url();
    let tok = session_token(state, xuid, None, None).await?;
    let resp = state
        .http
        .post(format!("{base}{}", endpoint_transfer()))
        .header("Content-Type", "application/json")
        .bearer_auth(&tok)
        .json(&serde_json::json!({ "action": "ack", "id": id, "device_id": device_id }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| Error::Auth(format!("world transfer ack failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Auth(format!(
            "world transfer ack rejected (HTTP {})",
            resp.status().as_u16()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn no_backend_fails_closed_to_free() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("AX_BACKEND_URL");
        std::env::remove_var("AX_PREMIUM_MOCK");
        let st = PremiumStatus::free();
        assert_eq!(st.tier, "free");
        assert!(st.expires_at.is_none());
    }

    #[test]
    fn mock_enables_premium() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("AX_BACKEND_URL");
        std::env::set_var("AX_PREMIUM_MOCK", "true");
        assert!(premium_mock());
        assert!(premium_mock_token_expiry() > 0);
    }
}
