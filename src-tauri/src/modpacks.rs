use crate::error::{Error, Result};
use crate::model::Profile;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Modrinth pack format: `modrinth.index.json` + `overrides/`.
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthIndex {
    pub format_version: i32,
    pub game: String,
    pub name: String,
    pub version_id: Option<String>,
    pub files: Vec<ModrinthFile>,
    pub dependencies: HashMap<String, String>,
    pub overrides: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthFile {
    pub path: String,
    pub hashes: HashMap<String, String>,
    pub env: Option<serde_json::Value>,
    pub downloads: Vec<String>,
    pub file_size: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseManifest {
    pub minecraft: CurseMc,
    pub manifest_type: Option<String>,
    pub manifest_version: i32,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub files: Vec<CurseManifestFile>,
    pub overrides: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseManifestFile {
    pub project_id: i64,
    pub file_id: i64,
    pub required: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CurseMc {
    pub version: String,
    pub mod_loaders: Option<Vec<serde_json::Value>>,
}

/// Import a modpack zip into a profile's game directory. Installs mods,
/// shaders, resource packs and config overrides to their correct folders.
pub async fn import_from_zip(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
    zip_path: &Path,
) -> Result<usize> {
    let game_dir = state.game_dir_for(profile);
    std::fs::create_dir_all(&game_dir)?;

    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| Error::Io(format!("not a valid zip: {e}")))?;

    // 1. Detect manifest type
    let mut modrinth_index: Option<ModrinthIndex> = None;
    let mut curse_manifest: Option<CurseManifest> = None;
    for i in 0..archive.len() {
        let name = archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?.name().to_string();
        if name.ends_with("modrinth.index.json") {
            let mut content = String::new();
            archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?.read_to_string(&mut content)?;
            modrinth_index = Some(serde_json::from_str(&content)?);
        } else if name.ends_with("manifest.json") && !name.contains("index") {
            let mut content = String::new();
            archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?.read_to_string(&mut content)?;
            if content.contains("\"minecraft\"") || content.contains("projectID") {
                curse_manifest = serde_json::from_str(&content).ok();
            }
        }
    }

    // 2. Extract overrides
    let overrides_root = modrinth_index
        .as_ref()
        .and_then(|m| m.overrides.clone())
        .or_else(|| {
            curse_manifest
                .as_ref()
                .and_then(|m| m.overrides.clone())
        })
        .unwrap_or_else(|| "overrides".into());
    let mut installed = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }
        if let Some(rel) = name.strip_prefix(&format!("{overrides_root}/")) {
            if rel.contains("index.json") || rel.is_empty() {
                continue;
            }
            let dest = game_dir.join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut out)?;
            installed += 1;
            use tauri::Emitter;
            let _ = app.emit(
                "modpack-progress",
                serde_json::json!({"phase": "overrides", "file": rel}),
            );
        }
    }

    // 3. Download all files listed in the index
    let mut files: Vec<crate::download::DownloadSpec> = Vec::new();
    if let Some(idx) = &modrinth_index {
        for f in &idx.files {
            if let Some(primary) = f.downloads.first() {
                files.push(crate::download::DownloadSpec {
                    url: primary.clone(),
                    dest: game_dir.join(&f.path),
                    sha1: f.hashes.get("sha1").cloned(),
                    size: f.file_size,
                    name: f.path.clone(),
                });
            }
        }
        // Record the pack in the profile's package list
        if let Some(version_id) = &idx.version_id {
            track_package(state, profile, &idx.name, "modrinth", version_id);
            let _ = state.persist_profiles();
        }
    } else if let Some(manifest) = &curse_manifest {
        let key = state.get_settings().curseforge_api_key.clone();
        if key.trim().is_empty() {
            return Err(Error::Auth(
                "CurseForge API key required to install this modpack. \
                 Add it in Settings → Accounts.".into(),
            ));
        }
        let client = crate::curse::CurseClient::new(state.http.clone(), key);
        for f in &manifest.files {
            let file = client.file(f.project_id, f.file_id).await?;
            if let Some(dl) = &file.download_url {
                let safe_name = file
                    .file_name
                    .as_deref()
                    .unwrap_or("mod.jar")
                    .split('/')
                    .last()
                    .unwrap_or("mod.jar")
                    .to_string();
                let dest = if safe_name.contains("resourcepack") || true {
                    // CF serves the file with its own name; place in root of
                    // the loaders mods dir per convention (modpack overrides
                    // usually pair this manifest with an overrides folder)
                    game_dir.join("mods").join(&safe_name)
                } else {
                    game_dir.join(&safe_name)
                };
                files.push(crate::download::DownloadSpec {
                    url: dl.to_string(),
                    dest,
                    sha1: None,
                    size: None,
                    name: safe_name,
                });
            }
        }
    }

    if !files.is_empty() {
        let concurrency = state.get_settings().download_concurrency.max(1);
        state
            .engine
            .run(Some(app), &format!("modpack:{}", profile.id), files, concurrency)
            .await?;
        installed += 1; // markers
    }

    // Mark the profile installed
    {
        let mut profiles = state.profiles.lock().unwrap();
        if let Some(p) = profiles.iter_mut().find(|p| p.id == profile.id) {
            p.install_status = "installed".into();
        }
    }
    let _ = state.persist_profiles();
    Ok(installed)
}

/// Export the current profile as a Modrinth-format pack zip.
pub fn export_to_zip(
    state: &AppState,
    profile: &Profile,
    dest_path: &Path,
) -> Result<()> {
    let game_dir = state.game_dir_for(profile);
    if !game_dir.exists() {
        return Err(Error::NotFound(format!("game directory {}", game_dir.display())));
    }
    let file = std::fs::File::create(dest_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // modrinth.index.json
    let index = ModrinthIndex {
        format_version: 1,
        game: "minecraft".into(),
        name: profile.name.clone(),
        version_id: Some(profile.game_version.clone()),
        files: Vec::new(),
        dependencies: {
            let mut map = HashMap::new();
            map.insert("minecraft".into(), profile.game_version.clone());
            if let Some(lv) = &profile.loader_version {
                if profile.loader != "vanilla" {
                    map.insert(profile.loader.clone(), lv.clone());
                }
            }
            map
        },
        overrides: Some("overrides".into()),
    };
    zip.start_file("modrinth.index.json", options).map_err(|e| crate::error::Error::Io(e.to_string()))?;
    serde_json::to_writer_pretty(&mut zip, &index)?;

    // Map mods/ + config/ + shaders + resourcepacks into overrides
    let mut overrides = Vec::new();
    let dirs = ["mods", "config", "shaderpacks", "resourcepacks", "options.txt"];
    for d in &dirs {
        let p = game_dir.join(d);
        if p.exists() {
            overrides.push(p);
        }
    }
    let mut count = 0usize;
    for dir in overrides {
        let base = PathBuf::from("overrides");
        add_dir_to_zip(&mut zip, &dir, &base, options)?;
        count += 1;
    }
    zip.finish().map_err(|e| crate::error::Error::Io(e.to_string()))?;
    let _ = count;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let rel = prefix.join(e.file_name());
        if e.path().is_dir() {
            zip.add_directory(format!("{}/", rel.to_string_lossy().replace('\\', "/")), options).map_err(|e| crate::error::Error::Io(e.to_string()))?;
            add_dir_to_zip(zip, &e.path(), &rel, options)?;
        } else {
            let name = rel.to_string_lossy().replace('\\', "/");
            zip.start_file(name, options).map_err(|e| crate::error::Error::Io(e.to_string()))?;
            let mut f = std::fs::File::open(e.path())?;
            std::io::copy(&mut f, zip)?;
        }
    }
    Ok(())
}

fn track_package(state: &AppState, profile: &Profile, name: &str, source: &str, version: &str) {
    let mut profiles = state.profiles.lock().unwrap();
    if let Some(p) = profiles.iter_mut().find(|p| p.id == profile.id) {
        let pkg = crate::model::InstalledPackage {
            id: name.to_string(),
            name: name.to_string(),
            file_name: "modpack".into(),
            source: source.into(),
            version: version.into(),
            sha1: None,
            installed_at: chrono::Utc::now().to_rfc3339(),
            enabled: true,
            kind: "modpack".into(),
        };
        if !p.packages.iter().any(|x| x.id == name) {
            p.packages.push(pkg);
        }
    }
}