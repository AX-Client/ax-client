use crate::error::{Error, Result};
use crate::model::{InstallProgress, JavaInfo, Profile};
use crate::state::AppState;
use crate::download::DownloadSpec;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

pub fn java_dir(state: &AppState) -> PathBuf {
    state.mc_root().join("java-runtime")
}

fn bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

/// Parse the major Java version out of the `java -version` output.
pub fn parse_version_string(text: &str) -> Option<u32> {
    let lower = text.to_lowercase();
    let idx = lower.find("version \"")?;
    let rest = &lower[idx + 9..];
    let end = rest.find('"')?;
    let ver = &rest[..end];
    if let Some(stripped) = ver.strip_prefix("1.") {
        return stripped.split('.').next()?.parse().ok();
    }
    ver.split('.').next()?.parse().ok()
}

pub fn probe_version(bin: &PathBuf) -> Option<u32> {
    let out = Command::new(bin).arg("-version").output().ok()?;
    let mut text = String::from_utf8_lossy(&out.stderr).to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&out.stdout).to_string();
    }
    parse_version_string(&text)
}

/// Resolve the Java requirement for a profile (respecting its java_tag).
pub fn profile_java_major(profile: &Profile) -> u32 {
    if let Ok(tag) = profile.java_tag.parse::<u32>() {
        return tag;
    }
    match profile
        .game_version
        .split('.')
        .filter_map(|s| s.parse::<u32>().ok())
        .collect::<Vec<u32>>()
        .as_slice()
    {
        [] | [1] | [1, 0..=16, ..] => 8,
        [1, 17, ..] => 16,
        [1, 18..=20, ..] => 17,
        [1, 21..=24, ..] | [24, ..] => 21,
        [major, ..] if *major >= 25 => 25,
        _ => 21,
    }
}

pub fn required_tag(profile: &Profile) -> String {
    crate::meta::runtime_name_for(profile_java_major(profile))
}

/// Find a usable Java on this system: `java` on PATH, macOS java_home
/// virtual machines, and common Linux JDK locations.
pub fn system_java() -> Option<(PathBuf, Option<u32>)> {
    let mut candidates: Vec<PathBuf> = vec![PathBuf::from("java")];
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("/usr/libexec/java_home").output() {
            if out.status.success() {
                let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !home.is_empty() {
                    candidates.push(PathBuf::from(home).join("bin").join(bin_name()));
                }
            }
        }
        if let Ok(entries) = std::fs::read_dir("/Library/Java/JavaVirtualMachines") {
            for e in entries.flatten() {
                candidates.push(e.path().join("Contents/Home/bin").join(bin_name()));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/usr/lib/jvm") {
            for e in entries.flatten() {
                candidates.push(e.path().join("bin").join(bin_name()));
            }
        }
    }
    for c in candidates {
        if let Some(v) = probe_version(&c) {
            return Some((c, Some(v)));
        }
    }
    None
}

/// Locate the java binary anywhere under the managed runtime directory
/// (macOS Temurin archives use a `Contents/Home` bundle layout).
pub fn find_java_bin(root: &Path) -> Option<PathBuf> {
    let direct = root.join(bin_name());
    if direct.is_file() {
        return Some(direct);
    }
    let mut stack = vec![root.to_path_buf()];
    let mut seen = std::collections::HashSet::new();
    while let Some(dir) = stack.pop() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        let candidate = dir.join(bin_name());
        if candidate.is_file() {
            return Some(candidate);
        }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                if e.path().is_dir() {
                    stack.push(e.path());
                }
            }
        }
    }
    None
}

/// Merge `dest/Contents/Home` (macOS bundle layout) into `dest` itself.
fn normalize_macos_layout(dest: &Path) {
    let home = dest.join("Contents").join("Home");
    if !home.is_dir() {
        return;
    }
    if let Ok(rd) = std::fs::read_dir(&home) {
        for e in rd.flatten() {
            let from = e.path();
            let to = dest.join(e.file_name());
            if to.exists() {
                continue;
            }
            let _ = std::fs::rename(&from, &to);
        }
    }
    let _ = std::fs::remove_dir_all(dest.join("Contents"));
}

/// Locate the Java binary for a profile: custom path → managed runtime
/// (downloaded on demand) → system java. Falls back to Adoptium when
/// Mojang's runtime index is unreachable.
pub async fn locate_or_download(
    app: &AppHandle,
    state: &AppState,
    profile: &Profile,
) -> Result<PathBuf> {
    let settings = state.get_settings();
    if let Some(custom) = &settings.java_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let bin = PathBuf::from(trimmed);
            if bin.exists() {
                return Ok(bin);
            }
            return Err(Error::Launch(format!(
                "The configured Java path does not exist: {}",
                bin.display()
            )));
        }
    }

    let needed = profile_java_major(profile);
    let tag = required_tag(profile);
    let dir = java_dir(state);

    // 1) exact managed runtime
    if let Some(bin) = find_java_bin(&dir.join(&tag)) {
        if let Some(ver) = probe_version(&bin) {
            if ver >= needed.saturating_sub(1) {
                return Ok(bin);
            }
        }
    }

    // 2) any already-installed managed runtime of sufficient version
    if let Ok(entries) = std::fs::read_dir(java_dir(state)) {
        for e in entries.flatten() {
            if !e.path().is_dir() || e.file_name() == tag.as_str() {
                continue;
            }
            if let Some(bin) = find_java_bin(&e.path()) {
                if let Some(ver) = probe_version(&bin) {
                    if ver >= needed.saturating_sub(1) {
                        return Ok(bin);
                    }
                }
            }
        }
    }

    // 3) system Java
    if let Some((bin, Some(ver))) = system_java() {
        if ver >= needed.saturating_sub(1) {
            return Ok(bin);
        }
    }

    // 4) download (Mojang meta or Adoptium fallback)
    install_managed(app, state, &tag).await?;
    let bin = find_java_bin(&java_dir(state).join(&tag))
        .ok_or_else(|| {
            Error::Launch(format!(
                "No usable Java runtime available (need Java {needed}). \
                 Install a JDK or a managed runtime first."
            ))
        })?;
    Ok(bin)
}

fn emit(app: &AppHandle, state: &AppState, p: &InstallProgress) {
    state.set_install(p.clone());
    use tauri::Emitter;
    let _ = app.emit("java", p);
}

/// Download and extract a Mojang-provided Java runtime. When Mojang's
/// runtime index is unavailable, falls back to downloading a Temurin JDK
/// of the matching major version from Adoptium.
pub async fn install_managed(app: &AppHandle, state: &AppState, tag: &str) -> Result<()> {
    let runtimes = match crate::meta::java_runtime_args(state).await {
        Ok(r) => r,
        Err(err) => return install_adoptium(app, state, tag, err).await,
    };
    let runtime = match runtimes.iter().find(|r| r.name == tag) {
        Some(r) => r,
        None => {
            return install_adoptium(
                app,
                state,
                tag,
                Error::NotFound(format!("Java runtime {tag}")),
            )
            .await
        }
    };

    let dest = java_dir(state).join(tag);
    if dest.join(bin_name()).exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dest)?;

    let mut p = InstallProgress::new(&format!("java:{tag}"));
    p.phase = "download".into();
    p.message = format!("Downloading Java ({tag})…");
    p.status = "progress".into();
    emit(app, state, &p);

    let specs: Vec<DownloadSpec> = runtime
        .files
        .iter()
        .map(|f| DownloadSpec {
            url: f.artifact.url.clone(),
            dest: dest.join(&f.path),
            sha1: f.artifact.sha1.clone(),
            size: f.artifact.size,
            name: f.path.clone(),
        })
        .collect();

    let batch = format!("java:{tag}");
    if let Err(e) = state
        .engine
        .run(Some(app), &batch, specs, 12)
        .await
    {
        let mut p2 = InstallProgress::new(&format!("java:{tag}"));
        p2.status = "error".into();
        p2.message = e.to_string();
        emit(app, state, &p2);
        // Mojang's CDN failed — fall back to Adoptium before giving up.
        let _ = std::fs::remove_dir_all(&dest);
        return install_adoptium(app, state, tag, e).await;
    }

    let bin = dest.join(bin_name());
    if !bin.exists() {
        return Err(Error::Install("Java runtime missing after download".into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&bin)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin, perms)?;
    }

    let mut p2 = InstallProgress::new(&format!("java:{tag}"));
    p2.status = "done".into();
    p2.phase = "done".into();
    p2.message = format!("Java {tag} installed");
    p2.total = 1;
    p2.done = 1;
    emit(app, state, &p2);
    Ok(())
}

fn major_for_tag(tag: &str) -> u32 {
    if let Some(digits) = tag
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .next()
    {
        if let Ok(n) = digits.parse() {
            return n;
        }
    }
    match tag {
        "java-runtime-alpha" => 8,
        "java-runtime-beta" => 16,
        "java-runtime-delta" => 17,
        "java-runtime-gamma" => 21,
        "java-runtime-epsilon" => 25,
        _ => 17,
    }
}

/// Download a Temurin JDK from Adoptium and extract it into the managed
/// runtime directory, so the launcher stays usable without Mojang's
/// java-runtime index.
async fn install_adoptium(
    app: &AppHandle,
    state: &AppState,
    tag: &str,
    mojang_err: Error,
) -> Result<()> {
    let meta_msg = mojang_err.to_string();
    let major = major_for_tag(tag);
    let dest = java_dir(state).join(tag);
    if dest.join(bin_name()).exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dest)?;

    let mut p = InstallProgress::new(&format!("java:{tag}"));
    p.phase = "download".into();
    p.message = format!("Mojang runtime list unavailable — downloading Temurin JDK {major}…");
    p.status = "progress".into();
    emit(app, state, &p);

    let url = crate::meta::adoptium_url(major);
    let tmp = java_dir(state).join(format!("{tag}.download.tar.gz"));
    let batch = format!("java:{tag}");
    let size = state
        .http
        .head(&url)
        .send()
        .await
        .ok()
        .and_then(|r| r.content_length());
    let spec = DownloadSpec {
        url: url.clone(),
        dest: tmp.clone(),
        sha1: None,
        size,
        name: "temurin.tar.gz".into(),
    };
    if let Err(e) = state.engine.run(Some(app), &batch, vec![spec], 4).await {
        let _ = std::fs::remove_file(&tmp);
        let mut p2 = InstallProgress::new(&format!("java:{tag}"));
        p2.status = "error".into();
        p2.message = format!(
            "Java download failed ({e}). Mojang runtime list: {meta_msg}"
        );
        emit(app, state, &p2);
        return Err(Error::Launch(format!("Temurin download failed: {e}")));
    }

    let extract_dir = java_dir(state).join(format!("__extract_{tag}"));
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir)?;
    let tmp2 = tmp.clone();
    let extract2 = extract_dir.clone();
    tokio::task::spawn_blocking(move || {
        extract_archive(&tmp2, &extract2).map_err(|e| Error::Io(e.to_string()))
    })
    .await
    .map_err(|e| Error::Io(e.to_string()))??;

    // the archive contains a single top-level jdk-* directory → move its
    // contents into the final runtime directory
    let mut moved = false;
    if let Ok(entries) = std::fs::read_dir(&extract_dir) {
        for entry in entries.flatten() {
            let src = entry.path();
            let inner = if src.is_dir() { src } else { extract_dir.clone() };
            let iters: Vec<_> = std::fs::read_dir(&inner)
                .map(|rd| rd.flatten().collect())
                .unwrap_or_default();
            for e in iters {
                let from = e.path();
                let to = dest.join(e.file_name());
                if to.exists() {
                    let _ = std::fs::remove_dir_all(&to);
                    let _ = std::fs::remove_file(&to);
                }
                std::fs::rename(&from, &to).map_err(|e| Error::Io(e.to_string()))?;
            }
            moved = true;
            break;
        }
    }
    let _ = std::fs::remove_dir_all(&extract_dir);
    let _ = std::fs::remove_file(&tmp);

    if !moved {
        return Err(Error::Launch("Adoptium archive was empty".into()));
    }

    normalize_macos_layout(&dest);

    let bin = find_java_bin(&dest).unwrap_or_else(|| dest.join(bin_name()));
    #[cfg(unix)]
    if bin.exists() {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(m) = std::fs::metadata(&bin) {
            let mut perms = m.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&bin, perms);
        }
    }

    let ver = probe_version(&bin).map(|v| v.to_string()).unwrap_or_else(|| "unknown".into());
    let mut p2 = InstallProgress::new(&format!("java:{tag}"));
    p2.status = "done".into();
    p2.phase = "done".into();
    p2.message = format!("Temurin JDK {major} installed (Java {ver})");
    p2.total = 1;
    p2.done = 1;
    emit(app, state, &p2);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn test_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ax_java_test_{name}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn extract_targz_archive() {
        let dir = test_dir("targz");
        let archive = dir.join("jdk.tar.gz");
        {
            let file = std::fs::File::create(&archive).unwrap();
            let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
            let mut tar = tar::Builder::new(enc);
            let bytes = "hello".as_bytes();
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, "jdk-21/bin/java", bytes).unwrap();
            tar.finish().unwrap();
        }
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        extract_archive(&archive, &out).unwrap();
        assert!(out.join("jdk-21/bin/java").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_zip_archive() {
        let dir = test_dir("zip");
        let archive = dir.join("jdk.zip");
        {
            let file = std::fs::File::create(&archive).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("jdk-21/bin/java.exe", opts).unwrap();
            zip.write_all(b"mz").unwrap();
            zip.finish().unwrap();
        }
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        extract_archive(&archive, &out).unwrap();
        assert!(out.join("jdk-21/bin/java.exe").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_rejects_garbage() {
        let dir = test_dir("garbage");
        let archive = dir.join("jdk.bin");
        std::fs::write(&archive, b"not an archive").unwrap();
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        assert!(extract_archive(&archive, &out).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Extract an Adoptium Java archive into `extract_dir`. Adoptium serves
/// .tar.gz on macOS/Linux but .zip on Windows — detect the format from the
/// magic bytes.
fn extract_archive(archive: &Path, extract_dir: &Path) -> crate::error::Result<()> {
    let bytes = std::fs::read(archive).map_err(|e| Error::Io(e.to_string()))?;
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let gz = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
        let mut ar = tar::Archive::new(gz);
        ar.unpack(extract_dir).map_err(|e| Error::Io(e.to_string()))?;
        Ok(())
    } else if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|e| Error::Io(e.to_string()))?;
        zip.extract(extract_dir).map_err(|e| Error::Io(e.to_string()))?;
        Ok(())
    } else {
        Err(Error::Launch("unrecognized Java archive format".into()))
    }
}

/// List installed managed runtimes plus system java.
pub fn list_javas(state: &AppState) -> Vec<JavaInfo> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(java_dir(state)) {
        for e in entries.flatten() {
            let tag = e.file_name().to_string_lossy().to_string();
            if e.path().is_dir() {
                let bin = find_java_bin(&e.path()).unwrap_or_else(|| e.path().join(bin_name()));
                let version = probe_version(&bin)
                    .map(|v| if v == 8 { "1.8".into() } else { v.to_string() })
                    .unwrap_or_else(|| "unknown".into());
                out.push(JavaInfo {
                    tag: tag.clone(),
                    version,
                    path: bin.display().to_string(),
                    kind: "Managed".into(),
                    usable: bin.exists(),
                });
            }
        }
    }
    if let Some((path, version)) = system_java() {
        if version.is_some() {
            out.push(JavaInfo {
                tag: "system".into(),
                version: version
                    .map(|v| if v == 8 { "1.8".into() } else { v.to_string() })
                    .unwrap_or_else(|| "System Java".into()),
                path: path.display().to_string(),
                kind: "System".into(),
                usable: true,
            });
        }
    }
    out.sort_by(|a, b| a.tag.cmp(&b.tag));
    out
}