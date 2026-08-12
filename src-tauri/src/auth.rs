use crate::error::{Error, Result};
use crate::model::{DeviceCode, SkinInfo};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const MS_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_LIVE_DEVICE: &str = "https://login.live.com/oauth20_connect.srf";
const MS_LIVE_TOKEN: &str = "https://login.live.com/oauth20_token.srf";
const MS_LIVE_AUTHORIZE: &str = "https://login.live.com/oauth20_authorize.srf";
const MS_LIVE_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
/// Official Minecraft Java (Win32) client. Works without an own Azure app
/// through the legacy `login.live.com` flows (device code and authorize).
const DEFAULT_MS_CLIENT_ID: &str = "00000000402b5328";
const DEFAULT_MS_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL openid email profile";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MsToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    #[serde(default)]
    pub id_token: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct XstsResp {
    pub token: String,
    pub uhs: String,
    pub xuid: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MineToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McProfileResp {
    pub id: String,
    pub name: String,
    pub skins: Vec<SkinInfo>,
    pub capes: Vec<SkinInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LoginResult {
    pub xsts: Option<XstsResp>,
    pub mc: Option<MineToken>,
    pub profile: Option<McProfileResp>,
    pub email: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct DeviceCodeResp {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
    #[serde(default)]
    message: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct TokenResp {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    id_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub struct AuthClient {
    pub http: Arc<reqwest::Client>,
    pub client_id: String,
    /// Uses the built-in official Minecraft client with the legacy
    /// `login.live.com` flow instead of a user-registered Azure app.
    pub built_in: bool,
}

impl AuthClient {
    pub fn new(http: Arc<reqwest::Client>, client_id: String) -> Self {
        let built_in = client_id.trim().is_empty();
        AuthClient {
            http,
            client_id: if built_in {
                DEFAULT_MS_CLIENT_ID.to_string()
            } else {
                client_id
            },
            built_in,
        }
    }

    pub fn with_id(&self, client_id: String) -> Self {
        let built_in = client_id.trim().is_empty();
        AuthClient {
            http: self.http.clone(),
            client_id: if built_in {
                DEFAULT_MS_CLIENT_ID.to_string()
            } else {
                client_id
            },
            built_in,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.client_id.trim().is_empty() {
            return Err(Error::Auth(
                "No Microsoft application client ID configured.".into(),
            ));
        }
        Ok(())
    }

    pub async fn device_code(&self) -> Result<DeviceCode> {
        self.validate()?;
        let (url, form) = if self.built_in {
            (
                MS_LIVE_DEVICE,
                vec![
                    ("client_id", self.client_id.as_str()),
                    ("scope", DEFAULT_MS_SCOPE),
                    ("response_type", "device_code"),
                ],
            )
        } else {
            (
                MS_DEVICE,
                vec![
                    ("client_id", self.client_id.as_str()),
                    ("scope", "XboxLive.signin offline_access"),
                ],
            )
        };
        let resp: DeviceCodeResp = self
            .http
            .post(url)
            .form(&form)
            .send()
            .await?
            .json()
            .await?;
        let interval = resp.interval.max(5);
        let message = if resp.message.is_empty() {
            format!(
                "Go to {} and enter the code {}",
                resp.verification_uri, resp.user_code
            )
        } else {
            resp.message
        };
        Ok(DeviceCode {
            device_code: resp.device_code,
            user_code: resp.user_code,
            verification_uri: resp.verification_uri,
            expires_in: resp.expires_in,
            interval,
            message,
        })
    }

    pub async fn poll_token(&self, code: &DeviceCode) -> Result<MsToken> {
        self.validate()?;
        let url = if self.built_in { MS_LIVE_TOKEN } else { MS_TOKEN };
        let form = [
            ("client_id", self.client_id.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", code.device_code.as_str()),
        ];
        let resp = self.http.post(MS_TOKEN).form(&form).send().await?;
        let json: TokenResp = resp.json().await?;
        if let Some(err) = json.error {
            let msg = match err.as_str() {
                "authorization_pending" => "authorization_pending".to_string(),
                "slow_down" => "slow_down".to_string(),
                "authorization_declined" => "The user declined the sign-in.".into(),
                "expired_token" => "The sign-in request expired.".into(),
                "bad_verification_code" => "Incorrect verification code.".into(),
                other => other.to_string(),
            };
            return Err(Error::Auth(msg));
        }
        Ok(MsToken {
            access_token: json
                .access_token
                .ok_or_else(|| Error::Auth("missing access token".into()))?,
            refresh_token: json
                .refresh_token
                .ok_or_else(|| Error::Auth("missing refresh token".into()))?,
            expires_in: json.expires_in.unwrap_or(3600),
            id_token: json.id_token.clone(),
        })
    }

    pub async fn refresh_ms(&self, refresh_token: &str) -> Result<MsToken> {
        self.validate()?;
        let mut form = vec![
            ("client_id", self.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ];
        if self.built_in {
            form.push(("scope", DEFAULT_MS_SCOPE));
        } else {
            form.push(("scope", "XboxLive.signin offline_access"));
        }
        let url = if self.built_in { MS_LIVE_TOKEN } else { MS_TOKEN };
        let resp = self.http.post(url).form(&form).send().await?;
        let json: TokenResp = resp.json().await?;
        if let Some(err) = json.error {
            return Err(Error::Auth(err));
        }
        Ok(MsToken {
            access_token: json
                .access_token
                .ok_or_else(|| Error::Auth("missing access token".into()))?,
            refresh_token: json
                .refresh_token
                .unwrap_or_else(|| refresh_token.to_string()),
            expires_in: json.expires_in.unwrap_or(3600),
            id_token: json.id_token.clone(),
        })
    }

    /// URL for the in-app sign-in window (built-in Microsoft client only).
    /// The response redirects to `MS_LIVE_REDIRECT` carrying the auth code.
    pub fn authorize_url(&self) -> String {
        debug_assert!(self.built_in);
        let mut url = tauri::Url::parse(MS_LIVE_AUTHORIZE).expect("authorize url");
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("response_type", "code")
            .append_pair("response_mode", "query")
            .append_pair("redirect_uri", MS_LIVE_REDIRECT)
            .append_pair("scope", DEFAULT_MS_SCOPE)
            .append_pair("prompt", "select_account");
        url.to_string()
    }

    /// Exchange an authorization code for MS tokens.
    pub async fn exchange_ms(&self, code: &str) -> Result<MsToken> {
        self.validate()?;
        let mut form = vec![
            ("client_id", self.client_id.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code),
        ];
        let url = if self.built_in {
            form.push(("scope", DEFAULT_MS_SCOPE));
            form.push(("redirect_uri", MS_LIVE_REDIRECT));
            MS_LIVE_TOKEN
        } else {
            MS_TOKEN
        };
        let resp = self.http.post(url).form(&form).send().await?;
        let json: TokenResp = resp.json().await?;
        if let Some(err) = json.error {
            return Err(Error::Auth(err));
        }
        Ok(MsToken {
            access_token: json
                .access_token
                .ok_or_else(|| Error::Auth("missing access token".into()))?,
            refresh_token: json.refresh_token.unwrap_or_default(),
            expires_in: json.expires_in.unwrap_or(3600),
            id_token: json.id_token.clone(),
        })
    }

    pub async fn xbl_token(&self, ms_access: &str) -> Result<(String, String)> {
        let mut last_err: Option<Error> = None;
        for ticket in [
            format!("d={ms_access}"),
            ms_access.to_string(),
        ] {
            match self.xbl_ticket(&ticket).await {
                Ok(v) => return Ok(v),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap_or_else(|| {
            Error::Auth("Xbox Live authentication failed".into())
        }))
    }

    async fn xbl_ticket(&self, ticket: &str) -> Result<(String, String)> {
        let body = serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": ticket
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        });
        let resp = self
            .http
            .post(XBL_AUTH)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(body.to_string())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let detail = if text.trim().is_empty() {
                "empty response".to_string()
            } else {
                let mut t = text;
                t.truncate(300);
                t
            };
            return Err(Error::Auth(format!(
                "Xbox Live authentication failed (HTTP {status}): {detail}"
            )));
        }
        let text = resp.text().await?;
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| Error::Json(format!("xbl: {e}")))?;
        let token = v["Token"]
            .as_str()
            .ok_or_else(|| Error::Auth("Xbox Live authentication failed".into()))?
            .to_string();
        let uhs = v["DisplayClaims"]["xui"][0]["uhs"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok((token, uhs))
    }

    pub async fn xsts_token(&self, xbl_token: &str, xbl_uhs: &str) -> Result<XstsResp> {
        let body = serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        });
        let resp = self
            .http
            .post(XSTS_AUTH)
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await?;
        let text = resp.text().await?;
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| Error::Json(format!("xsts: {e}")))?;
        if let Some(err) = v["XErr"].as_i64() {
            let msg = match err {
                2148916233 => "This account is not registered for Xbox Live.".to_string(),
                2148916235 => "This account is under 18 and requires parental consent.".to_string(),
                2148916238 => "This account is not allowed to play Minecraft.".to_string(),
                other => format!("Xbox error code {other}"),
            };
            return Err(Error::Auth(msg));
        }
        let token = v["Token"]
            .as_str()
            .ok_or_else(|| Error::Auth("No XSTS token returned".into()))?
            .to_string();
        let uhs = xbl_uhs.to_string();
        let mut xuid = v["DisplayClaims"]["xui"][0]["xid"]
            .as_str()
            .unwrap_or("")
            .to_string();
        // Some Xbox accounts omit `xid` in DisplayClaims and even in the XSTS
        // JWT; resolve it via the Xbox identity API as a last resort.
        if xuid.is_empty() {
            xuid = xid_from_jwt(&token);
        }
        if xuid.is_empty() {
            xuid = match self.xuid_from_identity(&uhs, &token).await {
                Ok(x) => x,
                Err(_) => String::new()
            };
        }
        Ok(XstsResp { token, uhs, xuid })
    }

    /// Resolve the numeric Xbox user id through the Xbox Live identity API.
    /// Requires an XBL3.0 auth header (uhs + XSTS token).
    async fn xuid_from_identity(&self, uhs: &str, token: &str) -> Result<String> {
        let resp = self
            .http
            .get("https://xboxlive.com/identity/v2/account/xuid")
            .header("Authorization", format!("XBL3.0 x={uhs};{token}"))
            .header("x-xbl-contract-version", "2")
            .send()
            .await
            .map_err(|e| Error::Auth(format!("xuid lookup failed: {e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Error::Auth(format!("xuid lookup HTTP {status}: {text}")));
        }
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let xuid = v["xuid"].as_str().unwrap_or("").to_string();
        if xuid.is_empty() {
            return Err(Error::Auth(format!("xuid lookup returned no xuid: {text}")));
        }
        Ok(xuid)
    }

    pub async fn mc_token(&self, xsts: &XstsResp) -> Result<MineToken> {
        let body = serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", xsts.uhs, xsts.token)
        });
        let resp = self
            .http
            .post(MC_LOGIN)
            .header("Accept", "application/json")
            .json(&body)
            .send()
            .await?;
        let text = resp.text().await?;
        let v: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| Error::Json(format!("mc login: {e}")))?;
        if v.get("error").is_some() {
            let msg = v["error"].as_str().unwrap_or("unknown error");
            return Err(Error::Auth(format!("Minecraft login failed: {msg}")));
        }
        Ok(MineToken {
            access_token: v["access_token"]
                .as_str()
                .ok_or_else(|| Error::Auth("Minecraft token missing from response".into()))?
                .to_string(),
            refresh_token: v["refresh_token"].as_str().unwrap_or("").to_string(),
            expires_in: v["expires_in"].as_u64().unwrap_or(3600),
        })
    }

    pub async fn mc_profile(&self, token: &str) -> Result<McProfileResp> {
        let resp = self
            .http
            .get(MC_PROFILE)
            .bearer_auth(token)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Error::Auth(format!(
                "Profile request failed (HTTP {})",
                resp.status()
            )));
        }
        let p: McProfileResp = resp.json().await?;
        Ok(p)
    }

    /// Full login pipeline from an MS access token.
    pub async fn complete_login(&self, ms: MsToken) -> Result<LoginResult> {
        let email = ms.id_token.as_deref().and_then(email_from_id_token);
        let mut ms_access = ms.access_token;
        let (xbl, xbl_uhs) = match self.xbl_token(&ms_access).await {
            Ok(v) => v,
            Err(first_err) => {
                // Xbox sometimes rejects a just-issued token; retry once with
                // a freshly refreshed MS token before failing.
                if ms.refresh_token.is_empty() {
                    return Err(first_err);
                }
                let fresh = self.refresh_ms(&ms.refresh_token).await?;
                ms_access = fresh.access_token;
                self.xbl_token(&ms_access).await?
            }
        };
        let xsts = self.xsts_token(&xbl, &xbl_uhs).await?;
        let mc = self.mc_token(&xsts).await?;
        let profile = self.mc_profile(&mc.access_token).await?;
        Ok(LoginResult {
            xsts: Some(xsts),
            mc: Some(mc),
            profile: Some(profile),
            email,
        })
    }

    /// Refresh an existing account's tokens in place.
    pub async fn refresh_account(&self, _uuid: &str, ms_refresh: &str) -> Result<LoginResult> {
        let ms = self.refresh_ms(ms_refresh).await?;
        self.complete_login(ms).await
    }
}

/// Extract the `email` claim from a Microsoft id_token (unverified JWT —
/// used purely as a convenience claim, the account identity stays the XUID).
pub fn email_from_id_token(id_token: &str) -> Option<String> {
    let claims = jwt_claims(id_token)?;
    let email = claims.get("email")?.as_str()?.trim();
    if email.is_empty() || !email.contains('@') {
        return None;
    }
    Some(email.to_lowercase())
}

/// Extract the `xid` (Xbox user id) claim from an XSTS token (JWT). Used as a
/// fallback when the XSTS response body omits DisplayClaims.xid.
pub fn xid_from_jwt(xsts_token: &str) -> String {
    jwt_claims(xsts_token)
        .and_then(|c| c.get("xid").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_default()
}

/// Base64url-decode the payload segment of an (unverified) JWT.
fn jwt_claims(id_token: &str) -> Option<serde_json::Value> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = b64u(payload)?;
    serde_json::from_slice(&bytes).ok()
}

fn b64u(seg: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let padded = seg.replace('-', "+").replace('_', "/");
    let mut s = padded;
    while s.len() % 4 != 0 {
        s.push('=');
    }
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

/// UUID form used by Mojang: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
pub fn dash_uuid(raw: &str) -> String {
    let c = raw.trim();
    if c.len() == 32 && !c.contains('-') {
        return format!(
            "{}-{}-{}-{}-{}",
            &c[0..8], &c[8..12], &c[12..16], &c[16..20], &c[20..32]
        );
    }
    c.to_string()
}

pub fn plain_uuid(raw: &str) -> String {
    raw.replace('-', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_token_email_extraction() {
        let header = base64_url(r#"{"alg":"none"}"#);
        let claims = base64_url(r#"{"email":"Foo@Bar.com","sub":"123"}"#);
        let token = format!("{header}.{claims}.sig");
        assert_eq!(email_from_id_token(&token).as_deref(), Some("foo@bar.com"));
        assert_eq!(email_from_id_token("garbage"), None);
        assert_eq!(email_from_id_token("a.b.c"), None);
    }

    fn base64_url(data: &str) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data.as_bytes())
    }
}
