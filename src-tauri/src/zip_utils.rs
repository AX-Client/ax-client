use crate::error::Result;
use std::io::Read;
use std::path::Path;

/// Read all entries of a jar/zip file into memory, skipping directories and
/// META-INF entries where appropriate.
pub fn read_jar_entries(path: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        crate::error::Error::Io(format!("corrupt archive {}: {e}", path.display()))
    })?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }
        if name.ends_with("/META-INF/MANIFEST.MF") {
            continue;
        }
        if name.ends_with("META-INF/INDEX.LIST") || name.ends_with("META-INF/MANIFEST.MF") {
            continue;
        }
        // Skip classes we never need (module info, signature files)
        if name.contains("META-INF/") && (name.ends_with(".SF") || name.ends_with(".RSA") || name.ends_with(".DSA")) {
            continue;
        }
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf)?;
        out.push((name, buf));
    }
    Ok(out)
}

/// List the file names (paths) inside an archive without reading contents.
pub fn list_entries(path: &Path) -> Result<Vec<String>> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| {
        crate::error::Error::Io(format!("corrupt archive {}: {e}", path.display()))
    })?;
    let mut out = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| crate::error::Error::Io(e.to_string()))?;
        if !entry.is_dir() {
            out.push(entry.name().to_string());
        }
    }
    Ok(out)
}