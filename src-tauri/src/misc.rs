use crate::error::{Error, Result};
use crate::model::{CrashReportInfo, NewsItem, ScreenshotInfo, ServerEntry, WorldInfo};
use crate::nbt::Value;
use crate::state::AppState;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Server list (servers.dat, NBT-encoded)
// ---------------------------------------------------------------------------

fn servers_file(profile_dir: &Path) -> PathBuf {
    profile_dir.join("servers.dat")
}

/// Read the server list of a profile's game directory.
pub fn read_servers(game_dir: &Path) -> Result<Vec<ServerEntry>> {
    let path = servers_file(game_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let Ok(root) = Value::read_auto(&path) else {
        return Ok(Vec::new());
    };
    let mut servers = Vec::new();
    if let Some(list) = root.get("servers") {
        if let Value::List(items) = list {
            for item in items {
                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                    servers.push(ServerEntry {
                        name: name.to_string(),
                        ip: item
                            .get("ip")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        accept_textures: item
                            .get("acceptTextures")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0)
                            != 0,
                    });
                }
            }
        }
    }
    Ok(servers)
}

/// Write servers.dat into the game directory.
pub fn write_servers(game_dir: &Path, servers: &[ServerEntry]) -> Result<()> {
    let items: Vec<Value> = servers
        .iter()
        .map(|s| {
            let mut map = HashMap::new();
            map.insert("name".into(), Value::String(s.name.clone()));
            map.insert("ip".into(), Value::String(s.ip.clone()));
            map.insert(
                "acceptTextures".into(),
                Value::Byte(if s.accept_textures { 1 } else { 0 }),
            );
            Value::Compound(map)
        })
        .collect();
    let root = Value::Compound({
        let mut map = HashMap::new();
        map.insert("servers".into(), Value::List(items));
        map
    });
    crate::nbt::write_plain(&servers_file(game_dir), "servers", &root)
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

pub fn worlds_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("saves")
}

pub fn list_worlds(game_dir: &Path) -> Result<Vec<WorldInfo>> {
    let dir = worlds_dir(game_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.path().is_dir() {
            continue;
        }
        let folder = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let name = folder.clone();
        let level_dat = entry.path().join("level.dat");
        let mut info = WorldInfo {
            name,
            folder: folder.clone(),
            size_bytes: dir_size(&entry.path()),
            modified: entry
                .metadata()
                .map(|m| m.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)).unwrap_or(0))
                .unwrap_or(0),
            level_name: Some(folder.clone()),
            last_played: None,
            game_mode: None,
            version: None,
            players: None,
        };
        if level_dat.exists() {
            if let Ok(root) = Value::read_gzip(&level_dat) {
                if let Some(d) = root.get("Data") {
                    if let Some(name) = d.get("LevelName").and_then(|v| v.as_str()) {
                        info.level_name = Some(name.to_string());
                    }
                    if let Some(t) = d.get("LastPlayed").and_then(|v| v.as_i64()) {
                        info.last_played = Some(t.max(0) as u64);
                    }
                    if let Some(g) = d.get("GameType").and_then(|v| v.as_i64()) {
                        info.game_mode = Some(match g {
                            0 => "Survival",
                            1 => "Creative",
                            2 => "Adventure",
                            3 => "Spectator",
                            _ => "Unknown",
                        }
                        .into());
                    }
                    if let Some(players) = d.get("Player") {
                        if let Some(p) = players.compound() {
                            if let Some(pos) = p.get("Pos") {
                                if let Value::List(items) = pos {
                                    info.players = Some(
                                        items
                                            .iter()
                                            .filter_map(|v| v.as_i64())
                                            .map(|v| format!("{v}"))
                                            .collect::<Vec<_>>()
                                            .join(", "),
                                    );
                                }
                            }
                        }
                    }
                    if let Some(v) = d.get("Version").and_then(|x| x.compound()) {
                        if let Some(name) = v.get("Name").and_then(|x| x.as_str()) {
                            info.version = Some(name.to_string());
                        }
                    }
                }
            }
        }
        out.push(info);
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

pub fn dir_size(path: &Path) -> u64 {
    fn walk(p: &Path, acc: &mut u64) {
        if let Ok(rd) = std::fs::read_dir(p) {
            for e in rd.flatten() {
                let p2 = e.path();
                if p2.is_dir() {
                    walk(&p2, acc);
                } else if let Ok(m) = p2.metadata() {
                    *acc += m.len();
                }
            }
        }
    }
    let mut acc = 0;
    walk(path, &mut acc);
    acc
}

/// Backup a world into the backups directory.
pub fn backup_world(
    state: &AppState,
    profile_id: &str,
    folder: &str,
) -> Result<PathBuf> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| Error::NotFound("profile".into()))?;
    let game_dir = state.game_dir_for(&profile);
    let src = worlds_dir(&game_dir).join(folder);
    if !src.is_dir() {
        return Err(Error::NotFound(format!("world {folder}")));
    }
    let backup_dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = backup_dir.join(format!("{folder}-{stamp}.zip"));
    zip_dir(&src, &dest)?;
    Ok(dest)
}

pub fn list_backups(state: &AppState, folder: &str) -> Result<Vec<PathBuf>> {
    let dir = state.data_dir.join("backups");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let prefix = format!("{folder}-");
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) && name.ends_with(".zip") {
            out.push(e.path());
        }
    }
    out.sort_by(|a, b| b.cmp(a));
    Ok(out)
}

pub fn restore_backup(
    state: &AppState,
    profile_id: &str,
    folder: &str,
    backup: &Path,
) -> Result<()> {
    let profile = state
        .profiles
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| Error::NotFound("profile".into()))?;
    let game_dir = state.game_dir_for(&profile);
    let dest = worlds_dir(&game_dir).join(folder);
    if dest.exists() {
        std::fs::remove_dir_all(&dest)?;
    }
    unzip_dir(backup, &dest)
}

fn zip_dir(src: &Path, dest: &Path) -> Result<()> {
    
    let file = std::fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    fn add_recursive(
        zip: &mut zip::ZipWriter<std::fs::File>,
        base: &Path,
        dir: &Path,
        options: zip::write::SimpleFileOptions,
    ) -> Result<()> {
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap_or(p.as_path());
            let name = rel.to_string_lossy().replace('\\', "/");
            if e.path().is_dir() {
                zip.add_directory(format!("{name}/"), options).map_err(|e| Error::Io(e.to_string()))?;
                add_recursive(zip, base, &e.path(), options)?;
            } else {
                zip.start_file(name, options).map_err(|e| Error::Io(e.to_string()))?;
                let mut f = std::fs::File::open(e.path())?;
                std::io::copy(&mut f, zip)?;
            }
        }
        Ok(())
    }
    add_recursive(&mut zip, src, src, options).map_err(|e| e)?;
    zip.finish().map_err(|e| crate::error::Error::Io(e.to_string()))?;
    Ok(())
}

fn unzip_dir(zip_path: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| crate::error::Error::Io(e.to_string()))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?;
        let name = entry.name().to_string();
        let rel = name.trim_start_matches('/');
        let out_path = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut out = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

pub fn delete_world(game_dir: &Path, folder: &str) -> Result<()> {
    let path = worlds_dir(game_dir).join(folder);
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

pub fn list_screenshots(game_dir: &Path) -> Result<Vec<ScreenshotInfo>> {
    let dir = game_dir.join("screenshots");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let p = e.path();
        if p.is_file() {
            if let Ok(m) = p.metadata() {
                out.push(ScreenshotInfo {
                    name: e.file_name().to_string_lossy().to_string(),
                    path: p.display().to_string(),
                    size_bytes: m.len(),
                    modified: m
                        .modified()
                        .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
                        .unwrap_or(0),
                });
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Crash reports
// ---------------------------------------------------------------------------

pub fn crash_reports(game_dir: &Path) -> Result<Vec<CrashReportInfo>> {
    let dir = game_dir.join("crash-reports");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut candidates: Vec<(u64, PathBuf)> = Vec::new();
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with("crash-") {
            if let Ok(m) = p.metadata() {
                candidates.push((
                    m.modified()
                        .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
                        .unwrap_or(0),
                    p,
                ));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    for (modified, p) in candidates.into_iter().take(10) {
        let content = std::fs::read_to_string(&p).unwrap_or_default();
        let head = content
            .lines()
            .take(200)
            .collect::<Vec<_>>()
            .join("\n");
        out.push(CrashReportInfo {
            name: p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
            path: p.display().to_string(),
            content: head,
            modified,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// News feed
// ---------------------------------------------------------------------------

pub async fn news_feed(state: &AppState) -> Result<Vec<NewsItem>> {
    let url = state.get_settings().news_feed_url.clone();
    let resp = state.http.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(Error::Http(format!("{url} -> {}", resp.status())));
    }
    let text = resp.text().await?;
    let mut items = Vec::new();
    let mut reader = quick_xml::Reader::from_str(&text);
    let mut buf = Vec::new();
    let mut current: Option<NewsItem> = None;
    let mut in_item = false;
    let mut field = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "item" {
                    in_item = true;
                    current = Some(NewsItem {
                        title: String::new(),
                        link: String::new(),
                        date: None,
                        description: None,
                    });
                    field.clear();
                } else if in_item {
                    field = name.clone();
                }
            }
            Ok(quick_xml::events::Event::Text(t)) => {
                if in_item && !field.is_empty() {
                    let s = t.unescape().unwrap_or_default().to_string().trim().to_string();
                    if let Some(item) = current.as_mut() {
                        match field.as_str() {
                            "title" => item.title.push_str(&s),
                            "link" => item.link.push_str(&s),
                            "pubDate" | "date" => item.date = Some(s),
                            "description" => item.description = Some(s),
                            _ => {}
                        }
                    }
                }
            }
            Ok(quick_xml::events::Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "item" {
                    if let Some(item) = current.take() {
                        if !item.title.is_empty() {
                            items.push(item);
                        }
                    }
                    in_item = false;
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(Error::Json(format!("RSS parse error: {e}"))),
            _ => {}
        }
        buf.clear();
    }
    items.truncate(8);
    Ok(items)
}

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

pub async fn check_update(state: &AppState) -> Result<crate::model::UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let resp = state
        .http
        .get("https://api.github.com/repos/azrealx/azrealx/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "AzrealX")
        .send()
        .await;
    let latest = match resp {
        Ok(r) if r.status().is_success() => {
            let v: serde_json::Value = r.json().await.unwrap_or(serde_json::Value::Null);
            let tag = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
            let url = v["html_url"].as_str().unwrap_or("").to_string();
            Some((tag, url))
        }
        _ => None,
    };
    let (latest, url) = latest.unwrap_or((current.clone(), String::new()));
    Ok(crate::model::UpdateInfo {
        current: current.clone(),
        latest: if latest.is_empty() { None } else { Some(latest.clone()) },
        url: if url.is_empty() { None } else { Some(url) },
        up_to_date: latest.is_empty() || latest == current,
    })
}