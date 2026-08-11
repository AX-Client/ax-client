use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const BASE: &str = "https://api.modrinth.com/v2";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthHit {
    pub slug: String,
    pub title: String,
    pub description: String,
    #[serde(alias = "icon_url")]
    pub icon_url: Option<String>,
    pub downloads: Option<u64>,
    pub categories: Option<Vec<String>>,
    pub versions: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthVersion {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(alias = "version_number")]
    pub version_number: Option<String>,
    #[serde(alias = "version_type")]
    pub version_type: Option<String>,
    #[serde(alias = "date_published")]
    pub date_published: Option<String>,
    pub downloads: Option<u64>,
    #[serde(alias = "game_versions")]
    pub game_versions: Option<Vec<String>>,
    pub loaders: Option<Vec<String>>,
    pub files: Option<Vec<ModrinthFile>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthFile {
    pub url: Option<String>,
    pub filename: Option<String>,
    #[serde(alias = "file_size")]
    pub file_size: Option<u64>,
    pub hashes: Option<ModrinthHashes>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModrinthHashes {
    #[serde(alias = "sha1")]
    pub sha1: Option<String>,
}

#[derive(Deserialize)]
struct SearchWrap {
    hits: Option<Vec<ModrinthHit>>,
}

#[derive(Deserialize)]
struct GameVersionTag {
    version: String,
    version_type: Option<String>,
}

pub struct ModrinthClient {
    http: reqwest::Client,
}

impl ModrinthClient {
    pub fn new(http: reqwest::Client) -> Self {
        ModrinthClient { http }
    }

    async fn jget<T: for<'de> Deserialize<'de>>(&self, path: &str, query: &[(&str, String)]) -> Result<T> {
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
            .header("User-Agent", "azrealx-launcher/0.1")
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
        query: &str,
        class: &str,
        game_version: Option<&str>,
    ) -> Result<Vec<ModrinthHit>> {
        let mut facets = vec![serde_json::json!([format!("project_type:{class}")])];
        if let Some(gv) = game_version {
            facets.push(serde_json::json!([format!("versions:{gv}")]));
        }
        let facets_json = serde_json::to_string(&facets).unwrap_or_default();
        let q: Vec<(&str, String)> = vec![
            ("query", query.to_string()),
            ("limit", "30".into()),
            ("index", "downloads".into()),
            ("facets", facets_json),
        ];
        let wrap: SearchWrap = self.jget("/search", &q).await?;
        Ok(wrap.hits.unwrap_or_default())
    }

    pub async fn versions(
        &self,
        slug: &str,
        game_version: Option<&str>,
    ) -> Result<Vec<ModrinthVersion>> {
        let mut q: Vec<(&str, String)> = Vec::new();
        if let Some(gv) = game_version {
            q.push(("game_versions", format!("[\"{gv}\"]")));
        }
        self.jget(&format!("/project/{slug}/version"), &q).await
    }

    pub async fn game_versions(&self) -> Result<Vec<String>> {
        let tags: Vec<GameVersionTag> = self.jget("/tag/game_version", &[]).await?;
        Ok(tags
            .into_iter()
            .filter(|g| g.version_type.as_deref() == Some("release"))
            .map(|g| g.version)
            .filter(|v| !v.contains('-'))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_roundtrip() {
        let j = r#"{"slug":"fabric-api","title":"Fabric API","description":"x","icon_url":"https://cdn.modrinth.com/data/P7dR8mSH/icon.png","downloads":227096369,"categories":["fabric"],"versions":["1.21"]}"#;
        let m: ModrinthHit = serde_json::from_str(j).unwrap();
        assert_eq!(m.icon_url.as_deref(), Some("https://cdn.modrinth.com/data/P7dR8mSH/icon.png"));
        let out = serde_json::to_string(&m).unwrap();
        assert!(out.contains("\"iconUrl\""), "serialized keys are camelCase: {out}");
    }
}
