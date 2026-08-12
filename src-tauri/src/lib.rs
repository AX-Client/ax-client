mod auth;
mod commands;
mod cosmetics;
mod curse;
mod discord;
mod download;
mod error;
mod extras;
mod gameopt;
mod install;
mod java;
mod launch;
mod logging;
mod meta;
mod misc;
mod modpacks;
mod model;
mod modrinth;
mod monet;
mod nbt;
mod playtime;
mod settings;
mod state;
mod vault;
mod zip_utils;

use error::Result;
use tauri::Manager;

pub fn run() -> Result<()> {
    let _ = dotenvy::dotenv(); // env-driven monetization config (.env / process env)
    let _data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("AzrealX");
    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel();
    logging::install_best_effort(log_tx);
    tauri::async_runtime::spawn(async move {
        while let Some(line) = log_rx.recv().await {
            // Console lines are forwarded to the frontend via `launcher_logs`;
            // keeping the channel drained avoids unbounded buffering.
            let _ = line;
        }
    });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::new()?)
        .manage(extras::Extras::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::get_paths,
            commands::get_settings,
            commands::set_settings,
            commands::get_profiles,
            commands::get_game_options,
            commands::write_live_options,
            commands::save_profile,
            commands::delete_profile,
            commands::game_dir_for,
            commands::install_profile,
            commands::cancel_install,
            commands::install_status,
            commands::version_manifest,
            commands::loader_versions,
            commands::installed_versions,
            commands::java_list,
            commands::java_install,
            commands::get_accounts,
            commands::ms_device_code,
            commands::ms_login,
            commands::ms_start_popup,
            commands::ms_exchange,
            commands::logout_account,
            commands::refresh_account,
            commands::refresh_all_accounts,
            commands::set_account_picture,
            commands::remove_account_picture,
            commands::launch_profile,
            commands::launch_profile_into,
            commands::stop_game,
            commands::game_status,
            commands::launcher_logs,
            commands::launcher_log_path,
            commands::game_logs,
            commands::curse_search,
            commands::curse_files,
            commands::curse_versions,
            commands::modrinth_search,
            commands::modrinth_versions,
            commands::modrinth_mc_versions,
            commands::install_curse_file,
            commands::install_modrinth_url,
            commands::remove_package,
            commands::toggle_package,
            commands::modpack_list_files,
            commands::modpack_import,
            commands::modpack_export,
            commands::worlds,
            commands::screenshots,
            commands::crash_reports,
            commands::backup_world,
            commands::list_world_backups,
            commands::restore_world_backup,
            commands::delete_world,
            commands::servers_read,
            commands::servers_save,
            commands::news_feed,
            commands::playtime_stats,
            commands::check_update,
            commands::open_path,
            commands::open_game_dir,
            commands::open_url,
            commands::premium_status,
            commands::monet_config,
            commands::cloud_profiles_sync,
            commands::cloud_profiles_restore,
            commands::world_transfer_upload,
            commands::world_transfer_poll,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|_app_handle, _event| {});
    Ok(())
}