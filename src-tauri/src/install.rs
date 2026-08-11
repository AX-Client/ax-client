use crate::download::DownloadSpec;
use crate::error::{Error, Result};
use crate::meta::{
    fetch_asset_index, fetch_fabric_profile, fetch_quilt_profile,
    platform, resolve_library, rules_allow, version_entry, Artifact, VersionJson,
};
use crate::model::{InstallProgress, Profile};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

pub struct PreparedGame {
    pub root: PathBuf,
    pub version_id: String,
    pub java_major: u32,
    pub classpath: Vec<PathBuf>,
    pub natives_dir: PathBuf,
    pub game_dir: PathBuf,
    pub assets_index_id: String,
    pub main_class: String,
    pub vj: VersionJson,
    pub json_path: PathBuf,
}

fn progress(app: &AppHandle, state: &AppState, p: &InstallProgress) {
    state.set_install(p.clone());
    use tauri::Emitter;
    let _ = app.emit("install", p);
}

fn set_phase(app: &AppHandle, state: &AppState, profile_id: &str, phase: &str, message: &str) {
    let mut p = state
        .install(profile_id)
        .unwrap_or_else(|| InstallProgress::new(profile_id));
    p.phase = phase.to_string();
    p.message = message.to_string();
    p.status = "progress".to_string();
    progress(app, state, &p);
}

pub fn version_id_for(profile: &Profile) -> String {
    match profile.loader.as_str() {
        "fabric" => format!(
            "fabric-loader-{}-{}",
            profile.loader_version.clone().unwrap_or_default(),
            profile.game_version
        ),
        "quilt" => format!(
            "quilt-loader-{}-{}",
            profile.loader_version.clone().unwrap_or_default(),
            profile.game_version
        ),
        "forge" => profile
            .loader_version
            .clone()
            .unwrap_or_else(|| profile.game_version.clone()),
        "neoforge" => {
            if let Some(lv) = &profile.loader_version {
                format!("{}-{}", profile.game_version, lv)
            } else {
                profile.game_version.clone()
            }
        }
        _ => profile.game_version.clone(),
    }
}

/// Load the launch JSON for a profile. Loader JSONs for Fabric/Quilt are
/// fetched from their meta services; Forge/NeoForge JSONs are produced by
/// their official installers and read from the versions directory.
async fn resolve_json(
    state: &AppState,
    profile: &Profile,
) -> Result<(VersionJson, String, PathBuf)> {
    let root = state.mc_root().join("versions");
    std::fs::create_dir_all(&root)?;

    // Prefer the id inside the resolved profile JSON (e.g. Fabric's
    // "fabric-loader-0.19.3-26.2"): it matches the concrete loader that
    // was actually fetched. Otherwise keep the naive id so jar, json and
    // classpath all stay in sync.
    let cache_file_id = |vj: &VersionJson| -> String {
        if !vj.id.is_empty() {
            vj.id.clone()
        } else {
            version_id_for(profile)
        }
    };

    let (vj, path): (VersionJson, PathBuf) = match profile.loader.as_str() {
        "fabric" => {
            let loader = profile.loader_version.as_deref().unwrap_or("stable");
            let candidate = format!("{}.json", version_id_for(profile));
            let path = root.join(&candidate);
            let vj = if path.exists() {
                let cached = read_json_file(&path)?;
                if cached.id.is_empty() || cached.id.contains("--") {
                    fetch_fabric_profile(state, &profile.game_version, loader)
                        .await
                        .map_err(|e| {
                            Error::Install(format!(
                                "Fabric has no loader for Minecraft {} (loader: {loader}). \
                                 Pick a different Minecraft version on the Versions page. ({e})",
                                profile.game_version
                            ))
                        })?
                } else {
                    cached
                }
            } else {
                fetch_fabric_profile(state, &profile.game_version, loader)
                    .await
                    .map_err(|e| {
                        Error::Install(format!(
                            "Fabric has no loader for Minecraft {} (loader: {loader}). \
                             Pick a different Minecraft version on the Versions page. ({e})",
                            profile.game_version
                        ))
                    })?
            };
            let id = cache_file_id(&vj);
            let path = root.join(format!("{id}.json"));
            (vj, path)
        }
        "quilt" => {
            let loader = profile.loader_version.as_deref().unwrap_or("latest");
            let candidate = root.join(format!("{}.json", version_id_for(profile)));
            let vj = if candidate.exists() {
                let cached = read_json_file(&candidate)?;
                if cached.id.is_empty() || cached.id.contains("--") {
                    fetch_quilt_profile(state, &profile.game_version, loader)
                        .await
                        .map_err(|e| {
                            Error::Install(format!(
                                "Quilt has no loader for Minecraft {} (loader {loader}). \
                                 Pick a different Minecraft version on the Versions page. ({e})",
                                profile.game_version
                            ))
                        })?
                } else {
                    cached
                }
            } else {
                fetch_quilt_profile(state, &profile.game_version, loader)
                    .await
                    .map_err(|e| {
                        Error::Install(format!(
                            "Quilt has no loader for Minecraft {} (loader {loader}). \
                             Pick a different Minecraft version on the Versions page. ({e})",
                            profile.game_version
                        ))
                    })?
            };
            let id = cache_file_id(&vj);
            let path = root.join(format!("{id}.json"));
            (vj, path)
        }
        "forge" | "neoforge" => {
            let path = root.join(format!("{}.json", version_id_for(profile)));
            if path.exists() {
                (read_json_file(&path)?, path)
            } else {
                return Err(Error::Install(
                    "The official loader installer has not run yet. \
                     Run \"Install loader\" in the profile first."
                        .into(),
                ));
            }
        }
        _ => {
            let entry = version_entry(state, &profile.game_version).await?;
            let vj = crate::meta::fetch_version_json(state, &entry).await?;
            let id = cache_file_id(&vj);
            let path = root.join(format!("{id}.json"));
            std::fs::write(&path, serde_json::to_vec(&vj)?)?;
            (vj, path)
        }
    };

    let id = cache_file_id(&vj);
    if !path.exists() {
        std::fs::write(&path, serde_json::to_vec(&vj)?)?;
    }
    Ok((vj, id, path))
}

fn read_json_file(path: &Path) -> Result<VersionJson> {
    let raw = std::fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|e| Error::Json(format!("{}: {e}", path.display())))
}

fn maven_dir(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return String::new();
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    format!("{}/{}/{version}", group.replace('.', "/"), artifact)
}

fn artifact_file(name: &str, artifact: &Artifact) -> String {
    if !artifact.url.is_empty() {
        if let Some(last) = artifact.url.rsplit('/').next() {
            if !last.is_empty() {
                return last.to_string();
            }
        }
    }
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        "unknown.jar".into()
    } else {
        format!("{}-{}.jar", parts[1], parts[2])
    }
}

fn artifact_dest(root: &Path, name: &str, artifact: &Artifact, extract: bool) -> PathBuf {
    let file = artifact_file(name, artifact);
    if extract {
        return root.join("natives-cache").join(&file);
    }
    let dir = maven_dir(name);
    root.join("libraries").join(dir).join(&file)
}

fn last_name(url: &str) -> String {
    url.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("file")
        .to_string()
}

async fn download_phase(
    app: &AppHandle,
    state: &AppState,
    profile_id: &str,
    specs: Vec<DownloadSpec>,
    cancel: &tokio_util::sync::CancellationToken,
) -> Result<()> {
    if specs.is_empty() {
        return Ok(());
    }
    let batch = format!("install:{profile_id}:libs");
    let engine = state.engine.clone();
    let concurrency = state.get_settings().download_concurrency.max(1);
    let result = engine
        .run(Some(app), &batch, specs, concurrency)
        .await;
    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            if cancel.is_cancelled() {
                return Err(Error::Canceled);
            }
            Err(e)
        }
    }
}

/// Download and verify all files needed by a profile. When `install` is true
/// this is driven by the Install button; during launch it is a no-op fast path
/// that only downloads missing files.
pub async fn prepare(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
    for_launch: bool,
) -> Result<PreparedGame> {
    let root = state.mc_root();
    for d in ["versions", "libraries", "assets/objects", "assets/indexes", "natives-cache"] {
        std::fs::create_dir_all(&root.join(d))?;
    }

    set_phase(app, state, &profile.id, "metadata", "Resolving version data…");
    let (mut vj, version_id, json_path) = resolve_json(state, profile).await?;

    // Loader profiles (Fabric/Quilt) carry only their own loader libraries
    // and no vanilla client jar, asset index or java requirement — the
    // official version JSON has to be merged in so the game is actually
    // launchable. The base fetch is always performed for loaders, so the
    // vanilla library list (joptsimple, gson, …) is available for the
    // classpath. Fail loudly on any error instead of launching broken.
    if profile.loader != "vanilla" {
        let entry = crate::meta::version_entry(state, &profile.game_version).await.map_err(
            |e| {
                Error::Install(format!(
                    "Vanilla version {} not found: {e}",
                    profile.game_version
                ))
            },
        )?;
        let base = crate::meta::fetch_version_json(state, &entry).await.map_err(|e| {
            Error::Install(format!(
                "Could not fetch vanilla version json for {}: {e}",
                profile.game_version
            ))
        })?;
        if vj.asset_index.is_none() {
            vj.asset_index = base.asset_index.clone();
        }
        match vj.downloads.as_mut() {
            Some(d) if d.client.is_none() => {
                d.client = base.downloads.as_ref().and_then(|b| b.client.clone());
            }
            None => vj.downloads = base.downloads.clone(),
            _ => {}
        }
        let mut known: std::collections::HashSet<String> =
            vj.libraries.iter().map(|l| l.name.clone()).collect();
        for lib in &base.libraries {
            if !known.insert(lib.name.clone()) {
                continue;
            }
            vj.libraries.push(lib.clone());
        }
        // Loader jsons ship an (almost) empty `arguments` block — just a
        // Fabric marker. Take the vanilla arguments (includes the macOS
        // -XstartOnFirstThread JVM rule and all game args) and keep any
        // loader-specific plain flags on top.
        let has_real_jvm = vj
            .arguments
            .as_ref()
            .and_then(|a| a.jvm.as_ref())
            .map(|j| j.len() > 1)
            .unwrap_or(false);
        if !has_real_jvm {
            if let Some(base_args) = &base.arguments {
                let mut merged = base_args.clone();
                if let (Some(base_jvm), Some(extra_jvm)) = (
                    merged.jvm.as_mut(),
                    vj.arguments.as_ref().and_then(|a| a.jvm.as_ref()),
                ) {
                    fn plain(a: &crate::meta::ArgumentValue) -> Option<&str> {
                        match a {
                            crate::meta::ArgumentValue::Plain(s) => Some(s.as_str()),
                            _ => None,
                        }
                    }
                    for a in extra_jvm {
                        if let Some(s) = plain(a) {
                            if !base_jvm.iter().any(|b| plain(b) == Some(s)) {
                                base_jvm.push(a.clone());
                            }
                        }
                    }
                }
                vj.arguments = Some(merged);
            }
        }
    }
    if vj.downloads.as_ref().and_then(|d| d.client.as_ref()).is_none() {
        return Err(Error::Install(format!(
            "No client jar available for {} — the profile cannot be launched.",
            profile.game_version
        )));
    }

    let java_major = vj.java_version.as_ref().map(|j| j.major_version).unwrap_or(8);
    let main_class = vj
        .main_class
        .clone()
        .ok_or_else(|| Error::Install("version JSON contains no main class".into()))?;
    let custom_resolution = profile.resolution.is_some();

    // --- client jar ---
    let mut specs: Vec<DownloadSpec> = Vec::new();
    if let Some(jar) = &vj.downloads.as_ref().and_then(|d| d.client.clone()) {
        let dest = root
            .join("versions")
            .join(&version_id)
            .join(format!("{version_id}.jar"));
        specs.push(DownloadSpec {
            url: jar.url.clone(),
            dest,
            sha1: jar.sha1.clone(),
            size: jar.size,
            name: format!("{version_id}.jar"),
        });
    }

    // --- libraries & natives ---
    let _p = platform();
    let mut natives: Vec<(PathBuf, String)> = Vec::new();
    for lib in &vj.libraries {
        if !rules_allow(&lib.rules, custom_resolution) {
            continue;
        }
        match resolve_library(lib) {
            Some((artifact, extract)) => {
                let dest = artifact_dest(&root, &lib.name, &artifact, extract);
                if extract {
                    natives.push((dest.clone(), last_name(&artifact.url)));
                }
                specs.push(DownloadSpec {
                    url: artifact.url.clone(),
                    dest,
                    sha1: artifact.sha1.clone(),
                    size: artifact.size,
                    name: last_name(&artifact.url),
                });
            }
            None => {
                if let Some(url) = crate::meta::derive_library_url(&lib.name) {
                    let file = artifact_file(&lib.name, &Artifact { url: url.clone(), sha1: None, size: None, path: None });
                    let dest = root.join("libraries").join(maven_dir(&lib.name)).join(&file);
                    specs.push(DownloadSpec {
                        url,
                        dest,
                        sha1: None,
                        size: None,
                        name: file,
                    });
                }
            }
        }
    }

    // --- assets ---
    let assets_index_id: String = if let Some(index) = &vj.asset_index {
        let index_file = root
            .join("assets")
            .join("indexes")
            .join(format!("{}.json", index.id));
        let content = if index_file.exists() {
            std::fs::read(&index_file)?
        } else {
            set_phase(app, state, &profile.id, "assets", "Downloading asset index…");
            let content = fetch_asset_index(state, index).await?;
            let bytes = serde_json::to_vec(&content)?;
            std::fs::write(&index_file, &bytes)?;
            bytes
        };
        let parsed: crate::meta::AssetIndexContent = serde_json::from_slice(&content)?;
        for (_, obj) in parsed.objects {
            specs.push(DownloadSpec {
                url: format!(
                    "{}{}/{}",
                    crate::meta::ASSETS_MIRROR,
                    &obj.hash[..2],
                    obj.hash
                ),
                dest: root
                    .join("assets")
                    .join("objects")
                    .join(&obj.hash[..2])
                    .join(&obj.hash),
                sha1: Some(obj.hash.clone()),
                size: Some(obj.size),
                name: format!("asset {}", &obj.hash[..8]),
            });
        }
        index.id.clone()
    } else {
        "legacy".into()
    };

    if for_launch {
        set_phase(app, state, &profile.id, "download", "Verifying files…");
        download_phase(app, state, &profile.id, specs, &state.token(&profile.id)).await?;
    } else {
        set_phase(app, state, &profile.id, "download", "Installing files…");
        download_phase(app, state, &profile.id, specs, &state.token(&profile.id)).await?;
    }
    // Explicitly move the bar off the download phase so the UI never sits at
    // a stale 99% while natives/launch continue.
    let mut p = state
        .install(&profile.id)
        .unwrap_or_else(|| InstallProgress::new(&profile.id));
    p.phase = "download".to_string();
    p.message = "Files ready".to_string();
    p.status = "progress".to_string();
    p.percent = 100.0;
    progress(app, state, &p);

    // --- natives extraction ---
    let natives_dir = root.join("versions").join(&version_id).join("natives");
    if !natives.is_empty() {
        set_phase(app, state, &profile.id, "natives", "Extracting native libraries…");
        std::fs::create_dir_all(&natives_dir)?;
        for (jar, _name) in &natives {
            let entries = crate::zip_utils::read_jar_entries(jar)?;
            for (path, bytes) in entries {
                let dest = natives_dir.join(&path);
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&dest, bytes)?;
            }
        }
    }

    // --- classpath ---
    let mut classpath = Vec::new();
    let client_jar = root.join("versions").join(&version_id).join(format!("{version_id}.jar"));
    classpath.push(client_jar);
    for lib in &vj.libraries {
        if !rules_allow(&lib.rules, custom_resolution) {
            continue;
        }
        if let Some((artifact, extract)) = resolve_library(lib) {
            if !extract {
                classpath.push(artifact_dest(&root, &lib.name, &artifact, false));
            }
        } else if crate::meta::derive_library_url(&lib.name).is_some() {
            let file = artifact_file(
                &lib.name,
                &Artifact {
                    url: String::new(),
                    sha1: None,
                    size: None,
                    path: None,
                },
            );
            classpath.push(root.join("libraries").join(maven_dir(&lib.name)).join(file));
        }
    }
    classpath.sort();
    classpath.dedup();

    Ok(PreparedGame {
        root: root.clone(),
        version_id,
        java_major,
        classpath,
        natives_dir,
        game_dir: state.game_dir_for(profile),
        assets_index_id: assets_index_id,
        main_class,
        vj,
        json_path,
    })
}

/// Run the official Forge/NeoForge installer to produce a version JSON.
pub async fn run_loader_installer(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
) -> Result<()> {
    let (installer_url, installer_file) = match profile.loader.as_str() {
        "forge" => {
            let v = profile
                .loader_version
                .clone()
                .ok_or_else(|| Error::invalid("missing loader version"))?;
            let url = format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar"
            );
            (url, format!("forge-{v}-installer.jar"))
        }
        "neoforge" => {
            let v = profile
                .loader_version
                .clone()
                .ok_or_else(|| Error::invalid("missing loader version"))?;
            let url = format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar"
            );
            (url, format!("neoforge-{v}-installer.jar"))
        }
        _ => return Err(Error::invalid("no installer for this loader")),
    };

    let root = state.mc_root();
    std::fs::create_dir_all(&root.join("installers"))?;
    let jar = root.join("installers").join(&installer_file);
    set_phase(app, state, &profile.id, "download", "Downloading loader installer…");
    download_phase(
        app,
        state,
        &profile.id,
        vec![DownloadSpec {
            url: installer_url,
            dest: jar.clone(),
            sha1: None,
            size: None,
            name: installer_file,
        }],
        &CancellationToken::new(),
    )
    .await?;

    set_phase(app, state, &profile.id, "installer", "Running official installer…");
    let java = crate::java::locate_or_download(app, state, profile).await?;
    let root = state.mc_root();

    // The installer writes version JSON + libraries into the Minecraft dir.
    let status = tokio::process::Command::new(&java)
        .current_dir(&root)
        .args(["-jar", jar.to_str().unwrap_or("")])
        .arg("--installClient")
        .status()
        .await?;
    if !status.success() {
        return Err(Error::Install("official installer exited with an error".into()));
    }
    Ok(())
}