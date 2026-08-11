pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::admin_stats,
            commands::admin_grant,
            commands::admin_news_list,
            commands::admin_news_post,
            commands::admin_news_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
