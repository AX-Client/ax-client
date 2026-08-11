use crate::error::Result;
use crate::model::Settings;
use std::path::Path;

pub fn load(dir: &Path) -> Result<Settings> {
    let file = dir.join("settings.json");
    if file.exists() {
        let raw = std::fs::read_to_string(&file)?;
        let mut s: Settings = serde_json::from_str(&raw)
            .unwrap_or_else(|_| Settings::default());
        s.auth_client_id = s.auth_client_id.trim().to_string();
        Ok(s)
    } else {
        Ok(Settings::default())
    }
}

pub fn save(dir: &Path, settings: &Settings) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("settings.json"), serde_json::to_string_pretty(settings)?)?;
    Ok(())
}