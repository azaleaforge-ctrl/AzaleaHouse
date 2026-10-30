mod fs;
mod ollama;
mod updater;

use std::collections::HashMap;

use ollama::ActiveStreams;

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ActiveStreams(tokio::sync::Mutex::new(HashMap::new())))
        .manage(updater::DownloadToken::default())
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
            fs::set_custom_path,
            fs::backup_memory,
            // Phase 5: File reader & vision
            fs::read_file_text,
            fs::encode_image,
            fs::validate_file,
            fs::save_attachment,
            fs::list_attachments,
            fs::delete_attachment,
            // Phase 7: Version Center & Manual Updater
            updater::check_update,
            updater::download_update,
            updater::cancel_download,
            updater::apply_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AzaleaHouse");
}
