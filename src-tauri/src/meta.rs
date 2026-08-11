use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

pub const VERSION_MANIFEST: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
pub const LIBRARIES_MIRROR: &str = "https://libraries.minecraft.net/";
pub const ASSETS_MIRROR: &str = "https://resources.download.minecraft.net/";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const QUILT_META: &str = "https://meta.quiltmc.org/v3";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifest {
    pub latest: Latest,
    pub versions: Vec<VersionEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
    pub sha1: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: Option<String>,
    pub major_version: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadsBlock {
    pub client: Option<Artifact>,
    pub server: Option<Artifact>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OsMatcher {
    pub name: Option<String>,
    pub arch: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FeaturesMatch {
    #[serde(default, rename = "has_custom_resolution")]
    pub has_custom_resolution: bool,
    #[serde(default, rename = "is_demo_user")]
    pub is_demo_user: bool,
    #[serde(default, rename = "has_quick_plays_support")]
    pub has_quick_plays_support: bool,
    #[serde(default, rename = "is_quick_play_singleplayer")]
    pub is_quick_play_singleplayer: bool,
    #[serde(default, rename = "is_quick_play_multiplayer")]
    pub is_quick_play_multiplayer: bool,
    #[serde(default, rename = "is_quick_play_realms")]
    pub is_quick_play_realms: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub action: String,
    pub os: Option<OsMatcher>,
    pub features: Option<FeaturesMatch>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<std::collections::HashMap<String, Artifact>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Extract {
    pub exclude: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<std::collections::HashMap<String, String>>,
    pub extract: Option<Extract>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArgumentsJson {
    pub game: Option<Vec<ArgumentValue>>,
    pub jvm: Option<Vec<ArgumentValue>>,
}

fn de_string_or_vec<'de, D>(d: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(String),
        Many(Vec<String>),
    }
    Ok(match OneOrMany::deserialize(d)? {
        OneOrMany::One(s) => vec![s],
        OneOrMany::Many(v) => v,
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum ArgumentValue {
    Plain(String),
    Complex {
        #[serde(deserialize_with = "de_string_or_vec")]
        value: Vec<String>,
        rules: Option<Vec<Rule>>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: Option<u64>,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoggingEntry {
    pub argument: Option<String>,
    pub file: Option<Artifact>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoggingBlock {
    pub client: Option<LoggingEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    pub main_class: Option<String>,
    pub assets: Option<String>,
    pub java_version: Option<JavaVersion>,
    pub downloads: Option<DownloadsBlock>,
    pub libraries: Vec<Library>,
    pub arguments: Option<ArgumentsJson>,
    pub minecraft_arguments: Option<String>,
    pub asset_index: Option<AssetIndexRef>,
    pub logging: Option<LoggingBlock>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexContent {
    pub objects: std::collections::HashMap<String, AssetObject>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntimeMeta {
    pub name: String,
    pub version: String,
    pub files: Vec<JavaFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JavaFile {
    pub path: String,
    pub artifact: Artifact,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FabricVersion {
    pub loader: FabricLoaderVersion,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FabricLoaderVersion {
    pub maven: String,
    pub version: String,
    pub stable: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuiltVersion {
    pub loader: QuiltLoaderVersion,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuiltLoaderVersion {
    pub version: String,
}

pub struct Platform {
    pub os_name: String,
    pub classifier: String,
    pub arch: String,
}

pub fn platform() -> Platform {
    let os_name = if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86"
    };
    let classifier = match os_name {
        "osx" => "natives-osx",
        "windows" => "natives-windows",
        _ => "natives-linux",
    };
    Platform {
        os_name: os_name.into(),
        classifier: classifier.into(),
        arch: arch.into(),
    }
}

pub fn runtime_name_for(java_major: u32) -> String {
    match java_major {
        8 => "jre-legacy".into(),
        16 => "java-runtime-beta".into(),
        17 | 18 => "java-runtime-delta".into(),
        21 => "java-runtime-gamma".into(),
        25 => "java-runtime-epsilon".into(),
        _ => "java-runtime-gamma".into(),
    }
}

/// Evaluate a rule list. `None`/empty → allowed. When rules exist, the
/// outcome follows the official semantics: a rule (os/features) that does
/// not match removes the argument/library — no match means excluded.
pub fn rules_allow(rules: &Option<Vec<Rule>>, custom_resolution: bool) -> bool {
    let Some(rules) = rules else { return true };
    let mut outcome: Option<bool> = None;
    let p = platform();
    for rule in rules {
        let mut matched = true;
        if let Some(os) = &rule.os {
            if let Some(name) = &os.name {
                if name.as_str() != p.os_name.as_str() {
                    matched = false;
                }
            }
            if let Some(arch) = &os.arch {
                if arch.as_str() != p.arch.as_str() {
                    matched = false;
                }
            }
        }
        if let Some(f) = &rule.features {
            let supports = f.has_custom_resolution == custom_resolution
                && !f.is_demo_user
                && !f.has_quick_plays_support
                && !f.is_quick_play_singleplayer
                && !f.is_quick_play_multiplayer
                && !f.is_quick_play_realms;
            if !supports {
                matched = false;
            }
        }
        if matched {
            outcome = Some(rule.action == "allow");
        }
    }
    outcome.unwrap_or(false)
}

/// Choose the artifact for this platform, plus whether it is a native jar.
pub fn resolve_library(lib: &Library) -> Option<(Artifact, bool)> {
    let p = platform();
    let mut natives = false;
    let mut see = None;
    if let Some(n) = &lib.natives {
        if let Some(classifier) = n.get(p.os_name.as_str()) {
            see = Some((classifier.clone(), true));
        }
    }
    let downloads = lib.downloads.as_ref()?;
    let artifact = match see {
        Some((classifier, true)) => {
            natives = true;
            downloads.classifiers.as_ref()?.get(&classifier).cloned()?
        }
        _ => downloads.artifact.clone()?,
    };
    Some((artifact, natives))
}

pub fn derive_library_url(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    let mirror = if group.starts_with("net.fabricmc") {
        "https://maven.fabricmc.net/"
    } else if group.starts_with("org.quiltmc") {
        "https://maven.quiltmc.org/repository/release/"
    } else {
        LIBRARIES_MIRROR
    };
    let group_path = group.replace('.', "/");
    Some(format!(
        "{mirror}{group_path}/{artifact}/{version}/{artifact}-{version}.jar"
    ))
}

pub async fn fetch_json<T: for<'de> Deserialize<'de>>(
    http: &reqwest::Client,
    url: &str,
) -> Result<T> {
    let resp = http.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(Error::Http(format!("{url} -> HTTP {}", resp.status())));
    }
    let text = resp.text().await?;
    serde_json::from_str(&text).map_err(|e| Error::Json(format!("{url}: {e}")))
}

pub async fn fetch_version_manifest(
    state: &crate::state::AppState,
) -> Result<VersionManifest> {
    if let Some(m) = state.manifest.lock().unwrap().clone() {
        return Ok(m);
    }
    let m: VersionManifest = fetch_json(&state.http, VERSION_MANIFEST).await?;
    *state.manifest.lock().unwrap() = Some(m.clone());
    Ok(m)
}

pub async fn version_entry(state: &crate::state::AppState, id: &str) -> Result<VersionEntry> {
    let m = fetch_version_manifest(state).await?;
    m.versions
        .iter()
        .find(|v| v.id == id)
        .cloned()
        .ok_or_else(|| Error::NotFound(format!("Minecraft version {id}")))
}

pub async fn fetch_version_json(
    state: &crate::state::AppState,
    entry: &VersionEntry,
) -> Result<VersionJson> {
    fetch_json(&state.http, &entry.url).await
}

pub async fn fetch_version_json_url(
    state: &crate::state::AppState,
    url: &str,
) -> Result<VersionJson> {
    fetch_json(&state.http, url).await
}

pub async fn fetch_asset_index(
    state: &crate::state::AppState,
    index: &AssetIndexRef,
) -> Result<AssetIndexContent> {
    fetch_json(&state.http, &index.url).await
}

pub async fn fetch_fabric_versions(
    state: &crate::state::AppState,
    mc: &str,
) -> Result<Vec<String>> {
    let url = format!("{FABRIC_META}/versions/loader/{mc}");
    let list: Vec<FabricVersion> = fetch_json(&state.http, &url).await?;
    Ok(list.into_iter().map(|v| v.loader.version).collect())
}

fn pick_fabric_loader<'a>(list: &'a [FabricVersion], selector: &str) -> Option<&'a str> {
    match selector {
        "stable" => list
            .iter()
            .find(|v| v.loader.stable == Some(true))
            .or_else(|| list.first())
            .map(|v| v.loader.version.as_str()),
        "latest" => list.first().map(|v| v.loader.version.as_str()),
        _ => list
            .iter()
            .find(|v| v.loader.version == selector)
            .map(|v| v.loader.version.as_str()),
    }
}

fn pick_quilt_loader<'a>(list: &'a [QuiltVersion], selector: &str) -> Option<&'a str> {
    if selector == "stable" || selector == "latest" {
        list.first().map(|v| v.loader.version.as_str())
    } else {
        list.iter()
            .find(|v| v.loader.version == selector)
            .map(|v| v.loader.version.as_str())
    }
}

pub async fn fetch_fabric_profile(
    state: &crate::state::AppState,
    mc: &str,
    loader: &str,
) -> Result<VersionJson> {
    let list: Vec<FabricVersion> =
        fetch_json(&state.http, &format!("{FABRIC_META}/versions/loader/{mc}")).await?;
    let resolved = pick_fabric_loader(&list, loader).ok_or_else(|| {
        Error::Install(format!(
            "Fabric has no loader version \"{loader}\" for Minecraft {mc}"
        ))
    })?;
    let url = format!("{FABRIC_META}/versions/loader/{mc}/{resolved}/profile/json");
    fetch_json(&state.http, &url).await
}

pub async fn fetch_quilt_versions(
    state: &crate::state::AppState,
    mc: &str,
) -> Result<Vec<String>> {
    let url = format!("{QUILT_META}/versions/loader/{mc}");
    let list: Vec<QuiltVersion> = fetch_json(&state.http, &url).await?;
    Ok(list.into_iter().map(|v| v.loader.version).collect())
}

pub async fn fetch_quilt_profile(
    state: &crate::state::AppState,
    mc: &str,
    loader: &str,
) -> Result<VersionJson> {
    let list: Vec<QuiltVersion> =
        fetch_json(&state.http, &format!("{QUILT_META}/versions/loader/{mc}")).await?;
    let resolved = pick_quilt_loader(&list, loader).ok_or_else(|| {
        Error::Install(format!(
            "Quilt has no loader version \"{loader}\" for Minecraft {mc}"
        ))
    })?;
    let url = format!("{QUILT_META}/versions/loader/{mc}/{resolved}/profile/json");
    fetch_json(&state.http, &url).await
}

fn parse_maven_versions(xml: &str) -> Vec<String> {
    let mut versions = Vec::new();
    let mut buf = String::new();
    let mut in_tag = false;
    for c in xml.chars() {
        if in_tag {
            if c == '>' {
                in_tag = false;
            }
        } else {
            match c {
                '<' => {
                    if !buf.trim().is_empty() {
                        versions.push(buf.trim().to_string());
                    }
                    buf.clear();
                    in_tag = true;
                }
                _ => buf.push(c),
            }
        }
    }
    versions
}

pub async fn fetch_forge_versions(
    state: &crate::state::AppState,
    mc: &str,
) -> Result<Vec<String>> {
    let url = format!("{FORGE_MAVEN}/maven-metadata.xml");
    let xml = state.http.get(&url).send().await?.text().await?;
    let prefix = format!("{mc}-");
    let mut out: Vec<String> = parse_maven_versions(&xml)
        .into_iter()
        .filter(|v| v.starts_with(&prefix) && !v.contains("+"))
        .collect();
    out.sort_by(|a, b| b.cmp(a));
    out.dedup();
    if out.is_empty() {
        return Err(Error::NotFound(format!("No Forge versions for {mc}")));
    }
    Ok(out)
}

pub async fn fetch_neoforge_versions(state: &crate::state::AppState) -> Result<Vec<String>> {
    let url = format!("{NEOFORGE_MAVEN}/maven-metadata.xml");
    let xml = state.http.get(&url).send().await?.text().await?;
    let mut out: Vec<String> = parse_maven_versions(&xml)
        .into_iter()
        .filter(|v| !v.contains("alpha") && !v.contains("beta") && !v.contains("rc") && !v.contains("snapshot"))
        .collect();
    out.sort_by(|a, b| b.cmp(a));
    out.dedup();
    Ok(out)
}

/// Direct download URL for a Temurin JDK build from Adoptium, used as a
/// fallback when Mojang's java-runtime index is unavailable.
pub fn adoptium_url(major: u32) -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    format!("https://api.adoptium.net/v3/binary/latest/{major}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse?project=jdk")
}

pub async fn java_runtime_args(state: &crate::state::AppState) -> Result<Vec<JavaRuntimeMeta>> {
    if let Some(m) = state.java_runtimes.lock().unwrap().clone() {
        return Ok(m);
    }
    let p = platform();
    let arch = if p.arch == "x86_64" { "x86_64" } else { "aarch64" };
    let url = format!(
        "https://launchermeta.mojang.com/v1/products/java-runtime/{}/{}/all.json",
        p.os_name, arch
    );
    let raw: serde_json::Value = fetch_json(&state.http, &url).await?;
    let mut out = Vec::new();
    if let Some(profiles) = raw.get("profiles") {
        for (name, profile) in profiles.as_object().unwrap_or(&serde_json::Map::new()) {
            if !(name.starts_with("java-runtime") || name.starts_with("jre-")) {
                continue;
            }
            let version = profile
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let files: Vec<JavaFile> = profile
                .get("files")
                .and_then(|f| f.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|f| {
                            let path = f.get("path")?.as_str()?;
                            let dl = f.get("downloads")?.get("raw")?;
                            let url = dl.get("url")?.as_str()?.to_string();
                            let sha1 = dl.get("sha1").and_then(|s| s.as_str()).map(|s| s.to_string());
                            let size = dl.get("size").and_then(|s| s.as_u64());
                            Some(JavaFile {
                                path: path.trim_start_matches('/').to_string(),
                                artifact: Artifact { url, sha1, size, path: None },
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if files.is_empty() {
                continue;
            }
            out.push(JavaRuntimeMeta {
                name: name.to_string(),
                version,
                files,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    *state.java_runtimes.lock().unwrap() = Some(out.clone());
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_v262_arguments() {
        if !std::path::Path::new("/tmp/v262.json").exists() {
            return;
        }
        let raw = std::fs::read_to_string("/tmp/v262.json").unwrap();
        let vj: VersionJson = serde_json::from_str(&raw).unwrap();
        assert!(vj.downloads.as_ref().unwrap().client.is_some());
        let args = vj.arguments.as_ref().unwrap();
        assert!(args.game.as_ref().unwrap().iter().count() > 20);
        println!("game args: {}", args.game.as_ref().unwrap().len());
        println!("jvm args: {}", args.jvm.as_ref().unwrap().len());
    }
}

#[cfg(test)]
mod quickplay_tests {
    use super::*;
    fn game_args_plain(vj: &VersionJson, custom: bool) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(a) = &vj.arguments {
            if let Some(game) = &a.game {
                for arg in game {
                    match arg {
                        ArgumentValue::Plain(s) => out.push(s.clone()),
                        ArgumentValue::Complex { value, rules } => {
                            if rules_allow(rules, custom) {
                                out.extend(value.iter().cloned());
                            }
                        }
                    }
                }
            }
        }
        out
    }
    #[test]
    fn no_quick_play_args() {
        if !std::path::Path::new("/tmp/v262.json").exists() {
            return;
        }
        let raw = std::fs::read_to_string("/tmp/v262.json").unwrap();
        let vj: VersionJson = serde_json::from_str(&raw).unwrap();
        let normal = mk_args(vj.clone(), false);
        let res = mk_args(vj.clone(), true);
        for a in &normal {
            assert!(!a.starts_with("--quickPlay"), "unexpected: {a}");
        }
        assert!(normal.iter().any(|a| a.starts_with("--username")));
        assert!(res.iter().any(|a| a == "--width"));
        println!("normal game args ({}):", normal.len());
        for a in &normal { println!("  {a}"); }
    }
    fn mk_args(vj: VersionJson, custom: bool) -> Vec<String> { game_args_plain(&vj, custom) }
}

