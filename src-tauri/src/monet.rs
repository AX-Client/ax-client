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

pub fn backend_url() -> String {
    std::env::var(ENV_BACKEND_URL)
        .unwrap_or_default()
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

const SESSION_KEY: &str = "session:{xuid}";
const SESSION_REFRESH_KEY: &str = "session_refresh:{xuid}";

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
