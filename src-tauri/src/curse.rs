use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const BASE: &str = "https://api.curseforge.com/v1";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseMod {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub links: Option<CurseLinks>,
    pub logo: Option<CurseLogo>,
    pub class_id: Option<i64>,
    pub download_count: Option<u64>,
    pub game_versions: Option<Vec<String>>,
    pub latest_files: Option<Vec<CurseFile>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseLinks {
    pub website_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseLogo {
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseFile {
    pub id: i64,
    pub display_name: Option<String>,
    pub file_name: Option<String>,
    pub download_url: Option<String>,
    pub game_versions: Option<Vec<String>>,
    pub file_date: Option<String>,
    pub file_length: Option<u64>,
    pub release_type: Option<i32>,
}

#[derive(Deserialize)]
struct Wrap<T> {
    data: Option<T>,
}

#[derive(Deserialize)]
struct GameVersion {
    name: String,
}

pub struct CurseClient {
    http: reqwest::Client,
    key: String,
    game_id: i64,
}

impl CurseClient {
    pub fn new(http: reqwest::Client, key: String) -> Self {
        CurseClient {
            http,
            key,
            game_id: 432,
        }
    }

    fn check_key(&self) -> Result<()> {
        if self.key.trim().is_empty() {
            return Err(Error::Auth(
                "An API key is required for mod search. Add it in Settings → Integrations.".into(),
            ));
        }
        Ok(())
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<Wrap<T>> {
        self.check_key()?;
        let mut url = format!("{BASE}{path}");
        if !query.is_empty() {
            let qs: Vec<String> = query
                .iter()
                .map(|(k, v)| format!("{k}={}", percent_encode(v)))
                .collect();
            url.push('?');
            url.push_str(&qs.join("&"));
        }
        let resp = self
            .http
            .get(&url)
            .header("x-api-key", self.key.as_str())
            .header("Accept", "application/json")
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Error::Http(format!("{url} -> {}", resp.status())));
        }
        resp.json().await.map_err(Into::into)
    }

    pub async fn search(
        &self,
        class_id: i64,
        query: &str,
        game_version: Option<&str>,
        index: u32,
    ) -> Result<Vec<CurseMod>> {
        let mut q: Vec<(&str, String)> = vec![
            ("classId", class_id.to_string()),
            ("sortField", "6".into()),
            ("sortOrder", "desc".into()),
            ("index", (index * 20).to_string()),
            ("pageSize", "20".into()),
        ];
        if !query.trim().is_empty() {
            q.push(("searchFilter", query.trim().to_string()));
        }
        if let Some(gv) = game_version {
            q.push(("gameVersion", gv.to_string()));
        }
        let wrap: Wrap<Vec<CurseMod>> = self.get_json("/mods/search", &q).await?;
        Ok(wrap.data.unwrap_or_default())
    }

    pub async fn files(
        &self,
        mod_id: i64,
        game_version: Option<&str>,
        index: u32,
    ) -> Result<Vec<CurseFile>> {
        let mut q: Vec<(&str, String)> = vec![
            ("pageSize", "50".into()),
            ("index", (index * 50).to_string()),
        ];
        if let Some(gv) = game_version {
            q.push(("gameVersion", gv.to_string()));
        }
        let wrap: Wrap<Vec<CurseFile>> = self
            .get_json(&format!("/mods/{mod_id}/files"), &q)
            .await?;
        Ok(wrap.data.unwrap_or_default())
    }

    pub async fn file(&self, mod_id: i64, file_id: i64) -> Result<CurseFile> {
        let wrap: Wrap<CurseFile> = self
            .get_json(&format!("/mods/{mod_id}/files/{file_id}"), &[])
            .await?;
        wrap.data.ok_or_else(|| Error::NotFound(format!("file {file_id}")))
    }

    pub async fn game_versions(&self) -> Result<Vec<String>> {
        let wrap: Wrap<Vec<GameVersion>> = self
            .get_json(&format!("/games/{}/versions", self.game_id), &[])
            .await?;
        Ok(wrap
            .data
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect())
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}