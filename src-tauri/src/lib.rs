mod fs;
mod ollama;
mod updater;

use std::collections::HashMap;

use ollama::{ActiveStreams, RuntimeOperationLock};

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ActiveStreams(std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::new()))))
        .manage(RuntimeOperationLock(std::sync::Arc::new(tokio::sync::Mutex::new(()))))
        .manage(updater::DownloadToken::default())
        .manage(fs::MemoryPathSelection::default())
        .invoke_handler(tauri::generate_handler![
            app_version,
            // Phase 2: Ollama runtime bridge
            ollama::runtime_status,
            ollama::list_models,
            ollama::chat_start,
            ollama::chat_cancel,
            ollama::load_model,
            ollama::unload_model,
            // Phase 4: Local storage & .AzaleaMemory
            fs::memory_path,
            fs::ensure_memory_dir,
            fs::save_conversation,
            fs::list_conversations,
            fs::load_conversation,
            fs::delete_conversation,
            fs::save_settings,
            fs::load_settings,
            fs::open_memory_folder,
            fs::pick_memory_parent_folder,
            fs::set_custom_path,
            fs::backup_memory,
            // File path commands stay unregistered until the attachment flow has
            // an explicit selected-file grant. The current UI reads only files
            // the user picked through the WebView file input.

            // Phase 7: Version Center & Manual Updater
            updater::check_update,
            updater::download_update,
            updater::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AzaleaHouse");
}
