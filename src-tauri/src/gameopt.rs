//! Game options: launcher-side overrides written into the game's options.txt
//! before every launch.

use crate::error::Result;
use std::collections::HashMap;
use std::path::Path;

/// Merge the launcher's managed options into `<game_dir>/options.txt`.
///
/// Existing keys that are not managed are preserved. Managed keys with an
/// empty value are removed again, so a plain "default" can be restored.
///
/// Every managed value is normalized to the format the game expects (see
/// `sanitize_value`). Minecraft parses its options lazily and crashes with a
/// NumberFormatException when the Video Settings screen renders an option
/// whose stored value has the wrong type (e.g. `ao:true`), so we must never
/// write a raw value.
pub fn apply(game_dir: &Path, options: &HashMap<String, String>, mc_version: &str) -> Result<()> {
    if options.is_empty() {
        return Ok(());
    }
    let legacy_format = !is_26_style(mc_version);
    let sound_sep = if legacy_format { "." } else { "_" };
    let path = game_dir.join("options.txt");
    let mut map: HashMap<String, String> = read(game_dir)?;
    for (k, v) in options {
        let file_key = match k.as_str() {
            "graphicsMode" if !legacy_format => "graphicsPreset".to_string(),
            _ => k.clone(),
        };
        match sanitize_value(k, v, legacy_format) {
            Some(clean) => {
                map.insert(file_key, clean);
            }
            None => {
                map.remove(&file_key);
            }
        }
    }
    if map.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    // keys pointing at sound volumes must use the separator the game writes
    if sound_sep != "." {
        let keys: Vec<String> = map.keys().cloned().collect();
        for k in keys {
            if let Some(rest) = k.strip_prefix("soundCategory.") {
                let v = map.remove(&k).unwrap_or_default();
                map.insert(format!("soundCategory_{rest}"), v);
            }
        }
    }
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    let mut out = String::new();
    for k in keys {
        out.push_str(&format!("{}:{}\n", k, map[k]));
    }
    std::fs::write(&path, out)?;
    Ok(())
}

/// Read the raw `options.txt` of a game directory.
///
/// Returns the parsed key/value pairs exactly as the game wrote them (no
/// normalization, so the UI can mirror the in-game state).
pub fn read(game_dir: &Path) -> Result<HashMap<String, String>> {
    let path = game_dir.join("options.txt");
    let mut map = HashMap::new();
    if !path.exists() {
        return Ok(map);
    }
    let raw = std::fs::read_to_string(&path)?;
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.starts_with('#') {
                continue;
            }
            let mut k = k.trim().to_string();
            // 26.x writes sound volumes with an underscore (soundCategory_master);
            // normalize to the dot form the launcher UI uses internally.
            if k.starts_with("soundCategory_") {
                k = format!("soundCategory.{}", &k["soundCategory_".len()..]);
            }
            map.insert(k, v.trim().to_string());
        }
    }
    Ok(map)
}

const APP_LANGS: [&str; 16] = [
    "en_us", "de_de", "fr_fr", "es_es", "pt_br", "it_it", "nl_nl", "pl_pl", "ru_ru", "ja_jp",
    "ko_kr", "zh_cn", "zh_tw", "tr_tr", "sv_se", "cs_cz",
];

/// Minecraft 26.x rewrote the video options: `ao` is again a boolean and new
/// keys like `enableVsync`/`renderClouds`/`graphicsPreset` exist. Older
/// versions (1.19.3..26.0) store `ao` as an int 0..2.
fn is_26_style(version: &str) -> bool {
    let major: i32 = version
        .split(['.', '-'])
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    major >= 26
}

/// Normalize a managed option value to the exact format Minecraft expects.
///
/// Returns `None` when the value cannot be salvaged (the key is then
/// dropped so the game uses its own default).
///
/// Known formats (options.txt, MC wiki):
/// * booleans are `true`/`false` (parseBoolean is lenient, but we normalize anyway)
/// * `ao` (smooth lighting) is an int 0..2 since 1.19.3 (Off/Minimum/Maximum)
/// * `fov` is stored as an offset: `degrees = 40 * value + 70`, range -1..1
/// * non-compliant keys are only processed when they start with `soundCategory.`
fn sanitize_value(key: &str, val: &str, legacy_format: bool) -> Option<String> {
    let v = val.trim();
    if v.is_empty() {
        return None;
    }
    let boolv = |b: bool| if b { "true".to_string() } else { "false".to_string() };
    let intv = |s: &str, lo: i64, hi: i64| -> Option<String> {
        let n: f64 = s.parse().ok()?;
        if !n.is_finite() {
            return None;
        }
        Some((n.round().clamp(lo as f64, hi as f64)) as i64).map(|x| x.to_string())
    };
    let floatv = |s: &str, lo: f64, hi: f64| -> Option<String> {
        let n: f64 = s.parse().ok()?;
        if !n.is_finite() {
            return None;
        }
        Some(n.clamp(lo, hi).to_string())
    };
    match key {
        "fullscreen" | "autoJump" | "toggleSprint" | "toggleCrouch" | "vsync" | "enableVsync"
        | "showSubtitles" | "hideServerAddress" | "renderClouds" => {
            Some(boolv(v == "true" || v == "1"))
        }
        "ao" => {
            // 1.19.3 .. 26.0: int 0..2 (Off/Minimum/Maximum); 26.x: boolean.
            if legacy_format {
                intv(v, 0, 2)
            } else {
                Some(boolv(v == "true" || v == "1" || v == "2"))
            }
        }
        "graphicsMode" => {
            // legacy: int 0..2 (Fast/Fancy/Fabulous); 26.x: graphicsPreset enum.
            if legacy_format {
                intv(v, 0, 2)
            } else {
                Some(match v.trim().to_ascii_lowercase().as_str() {
                    "0" | "fast" => "fast".to_string(),
                    "1" | "fancy" => "fancy".to_string(),
                    "2" | "fabulous" => "fabulous".to_string(),
                    _ => "custom".to_string(),
                })
            }
        }
        "particles" | "cloudStatus" | "chatVisibility" => intv(v, 0, 2),
        "guiScale" => intv(v, 0, 4),
        "mipmapLevels" => intv(v, 0, 4),
        "maxFps" => intv(v, 10, 260),
        "renderDistance" => intv(v, 2, 32),
        "simulationDistance" => intv(v, 5, 32),
        "gamma" | "sensitivity" | "mouseSensitivity" => floatv(v, 0.0, 1.0),
        "entityDistanceScaling" => floatv(v, 0.5, 5.0),
        "fov" => {
            let n: f64 = v.parse().ok()?;
            if !n.is_finite() {
                return None;
            }
            let off = if n.abs() > 5.0 { (n - 70.0) / 40.0 } else { n };
            Some(format!("{:.1}", off.clamp(-1.0, 1.0)))
        }
        "lang" => {
            if APP_LANGS.contains(&v) {
                Some(v.to_string())
            } else {
                Some("en_us".to_string())
            }
        }
        k if k.starts_with("soundCategory.") || k.starts_with("soundCategory_") => {
            floatv(v, 0.0, 1.0)
        }
        _ => Some(v.to_string()),
    }
}