use serde_json::{json, Value};
use std::time::Duration;

fn base_url() -> String {
    std::env::var("AX_BACKEND_URL")
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string()
}

fn secret() -> String {
    std::env::var("AX_ADMIN_SECRET").unwrap_or_default()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .unwrap_or_default()
}

async fn admin_call(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let base = base_url();
    if base.is_empty() {
        return Err("AX_BACKEND_URL ist nicht gesetzt. Bitte im src-tauri/.env hinterlegen.".into());
    }
    let sec = secret();
    if sec.is_empty() {
        return Err("AX_ADMIN_SECRET ist nicht gesetzt. Bitte im src-tauri/.env hinterlegen.".into());
    }
    let mut req = client()
        .request(reqwest::Method::from_bytes(method.as_bytes()).unwrap(), format!("{base}{path}"))
        .bearer_auth(&sec)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| format!("Backend nicht erreichbar: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Backend ({status}): {}", text.chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| {
        if text.trim().is_empty() {
            "Leere Antwort vom Backend".to_string()
        } else {
            text
        }
    })
}

#[tauri::command]
pub async fn admin_stats() -> Result<Value, String> {
    admin_call("GET", "/admin-stats", None).await
}

#[tauri::command]
pub async fn admin_grant(xuid: String, tier: String, days: i64) -> Result<Value, String> {
    admin_call("POST", "/admin-grant", Some(json!({ "xuid": xuid, "tier": tier, "days": days }))).await
}

#[tauri::command]
pub async fn admin_news_list() -> Result<Value, String> {
    admin_call("GET", "/admin-news", None).await
}

#[tauri::command]
pub async fn admin_news_post(title: String, body: String, link: String) -> Result<Value, String> {
    admin_call("POST", "/admin-news", Some(json!({ "action": "post", "title": title, "body": body, "link": link }))).await
}

#[tauri::command]
pub async fn admin_news_delete(id: String) -> Result<Value, String> {
    admin_call("POST", "/admin-news", Some(json!({ "action": "delete", "id": id }))).await
}
