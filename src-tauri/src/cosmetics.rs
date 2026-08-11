//! Cosmetic mod injection: bundles `ax-cosmetics.jar` with the launcher and
//! hard-copies it into the game's `mods/` folder on every launch (auto-update
//! semantics). A small sidecar file (`ax-cosmetics.json`) carries the player
//! uuid + session token so the mod can fetch owned cape textures from the
//! CDN. The mod is client-only: capes only show for players using this
//! launcher, and the CDN validates the session token before serving art.
//!
//! The JAR itself is shipped via `bundle.resources` in `tauri.conf.json`
//! (same mechanism as `azrealx-bridge.jar`). Until the mod project exists the
//! resource is absent and injection is skipped gracefully.

use crate::error::Result;
use crate::monet;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const COSMETICS_JAR: &str = "ax-cosmetics.jar";
pub const COSMETICS_META: &str = "ax-cosmetics.json";

/// Copy the bundled cosmetics mod into the game directory and write the
/// session sidecar. Called during launch, after game options are applied.
/// Takes owned values so the calling future stays `Send` across awaits.
pub async fn ensure_installed(
    app: &tauri::AppHandle,
    state: &AppState,
    game_dir: PathBuf,
    xuid: String,
) -> Result<()> {
    let mods_dir = game_dir.join("mods");
    let jar_dest = mods_dir.join(COSMETICS_JAR);
    let meta_dest = game_dir.join(COSMETICS_META);

    // 1) bundled JAR from the app resources (resource_dir mirrors bundle.resources)
    let jar_src = app
        .path()
        .resource_dir()
        .map(|d| d.join(COSMETICS_JAR))
        .unwrap_or_default();
    if !jar_src.exists() {
        // mod project not shipped yet - clean up any stale copy
        let _ = std::fs::remove_file(&jar_dest);
        let _ = std::fs::remove_file(&meta_dest);
        return Ok(());
    }

    // 2) hard copy (always overwrite = auto-update)
    std::fs::create_dir_all(&mods_dir)?;
    std::fs::copy(&jar_src, &jar_dest)?;

    // 3) session sidecar - token goes through the keychain-backed vault flow,
    //    never written in plain text by hand
    let token = match monet::session_token(state, &xuid, None).await {
        Ok(t) => t,
        Err(e) => {
            log::warn!("cosmetics: no session token, mod stays dormant: {e}");
            return Ok(());
        }
    };
    let meta = serde_json::json!({
        "uuid": xuid,
        "sessionToken": token,
        "cdn": monet::backend_url(),
    });
    std::fs::write(&meta_dest, serde_json::to_vec_pretty(&meta)?)?;
    log::info!("cosmetics: installed {COSMETICS_JAR} + sidecar for {xuid}");
    Ok(())
}
