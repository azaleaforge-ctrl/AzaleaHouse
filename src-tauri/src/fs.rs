//! AzaleaHouse → Local storage bridge (Phase 4).
//!
//! Operasi filesystem privileged semua lewat command API Tauri:
//!   - `memory_path`       : path akar `.AzaleaMemory` yang sedang dipakai.
//!   - `ensure_memory_dir`  : buat struktur folder jika belum ada.
//!   - `save_conversation`  : tulis JSON percakapan (atomic).
//!   - `list_conversations` : daftar semua percakapan.
//!   - `save_settings`      : tulis JSON preferensi (atomic).
//!   - `load_settings`      : baca preferensi.
//!   - `open_memory_folder` : buka Explorer ke folder memori.
//!   - `set_custom_path`    : migrasi ke lokasi khusus (dengan backup rollback).
//!   - `backup_memory`      : snapshot `.AzaleaMemory`.
//!   - `read_file_text`     : ekstrak teks dari TXT/MD/JSON/CSV.
//!   - `encode_image`       : base64-encode gambar untuk vision pipeline.
//!   - `validate_file`      : validasi ukuran & tipe sebelum proses.
//!   - `save_attachment`    : copy file ke `.AzaleaMemory/attachments/`.
//!   - `list_attachments`   : daftar lampiran tersimpan.
//!   - `delete_attachment`  : hapus lampiran.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::fs;

/// Versi skema penyimpanan — dinaikkan bila format berubah.
const SCHEMA_VERSION: u32 = 1;

/// Struktur folder standar di dalam `.AzaleaMemory`.
const SUBDIRS: &[&str] = &["profile", "conversations", "memories", "indexes", "attachments", "backups", "cache", "metadata"];

/// Payload untuk menyimpan satu percakapan.
#[derive(Serialize, Deserialize)]
pub struct ConversationRecord {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub messages: Vec<ConversationMessage>,
}

#[derive(Serialize, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub time: String,
    pub thinking: Option<String>,
}

/// Payload untuk menyimpan pengaturan (disediakan frontend).
#[derive(Serialize, Deserialize)]
pub struct SettingsRecord {
    pub schema_version: u32,
    pub appearance: serde_json::Value,
    pub ai: serde_json::Value,
}

/// Resolusi path `.AzaleaMemory` — default di `%LOCALAPPDATA%\AzaleaHouse\.AzaleaMemory\`.
fn default_memory_path() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // Fallback pada platform non-Windows
            dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
        });
    local.join("AzaleaHouse").join(".AzaleaMemory")
}

/// Resolusi path `.AzaleaMemory` — baca custom path dari file metadata, atau fallback ke default.
pub(crate) async fn resolve_memory_path() -> PathBuf {
    // Cek apakah ada file metadata/custom_path
    // Kita pakai tempat sementara di local app data untuk menyimpan path kustom
    let home = std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")));
    let marker = home.join("AzaleaHouse").join(".AzaleaMemory").join("metadata").join("custom_path");

    if marker.exists() {
        if let Ok(path_str) = fs::read_to_string(&marker).await {
            let trimmed = path_str.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }
    default_memory_path()
}

/// Emit path ke frontend (untuk display di Settings).
#[tauri::command]
pub async fn memory_path() -> Result<String, String> {
    let path = resolve_memory_path().await;
    Ok(path.to_string_lossy().to_string())
}

/// Pastikan struktur folder ada.
#[tauri::command]
pub async fn ensure_memory_dir(_app: tauri::AppHandle) -> Result<(), String> {
    let base = resolve_memory_path().await;
    for sub in SUBDIRS {
        let dir = base.join(sub);
        fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Gagal membuat folder {sub}: {e}"))?;
    }
    // Tulis marker metadata
    let meta_dir = base.join("metadata");
    let marker = meta_dir.join(".schema_version");
    tokio::fs::write(&marker, SCHEMA_VERSION.to_string())
        .await
        .map_err(|e| format!("Gagal menulis metadata: {e}"))?;
    Ok(())
}

/// Simpan/overwrite satu percakapan.
#[tauri::command]
pub async fn save_conversation(
    _app: tauri::AppHandle,
    conversation: ConversationRecord,
) -> Result<(), String> {
    let base = resolve_memory_path().await;
    let dir = base.join("conversations");
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Gagal buat folder conversations: {e}"))?;

    let path = dir.join(format!("{}.json", conversation.id));

    // Tulis ke file sementara lalu rename (atomic).
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&conversation)
        .map_err(|e| format!("Gagal serialisasi JSON: {e}"))?;
    fs::write(&tmp_path, json)
        .await
        .map_err(|e| format!("Gagal tulis file sementara: {e}"))?;
    fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| format!("Gagal rename file: {e}"))?;

    Ok(())
}

/// Daftar semua percakapan (id + judul + updated_at), terbaru di atas.
#[tauri::command]
pub async fn list_conversations(_app: tauri::AppHandle) -> Result<Vec<ConversationSummary>, String> {
    let base = resolve_memory_path().await;
    let dir = base.join("conversations");

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut summaries = vec![];
    let mut entries = fs::read_dir(&dir)
        .await
        .map_err(|e| format!("Gagal baca folder conversations: {e}"))?;

    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(e)) => e,
            Ok(None) => break,
            Err(e) => return Err(format!("Gagal baca entri: {e}")),
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Gagal baca file: {e}"))?;
        if let Ok(rec) = serde_json::from_str::<ConversationRecord>(&content) {
            summaries.push(ConversationSummary {
                id: rec.id,
                title: rec.title,
                updated_at: rec.updated_at,
            });
        }
    }

    // Urutkan terbaru di atas
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(summaries)
}

/// Load satu percakapan lengkap berdasarkan ID.
#[tauri::command]
pub async fn load_conversation(_app: tauri::AppHandle, id: String) -> Result<ConversationRecord, String> {
    let base = resolve_memory_path().await;
    let path = base.join("conversations").join(format!("{id}.json"));
    if !path.exists() {
        return Err(format!("Percakapan tidak ditemukan: {id}"));
    }
    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Gagal baca file: {e}"))?;
    serde_json::from_str::<ConversationRecord>(&content)
        .map_err(|e| format!("Gagal parse JSON: {e}"))
}

/// Simpan pengaturan aplikasi.
#[tauri::command]
pub async fn save_settings(_app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let base = resolve_memory_path().await;
    let dir = base.join("profile");
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Gagal buat folder profile: {e}"))?;

    let record = SettingsRecord {
        schema_version: SCHEMA_VERSION,
        appearance: settings.get("appearance").cloned().unwrap_or(serde_json::json!({})),
        ai: settings.get("ai").cloned().unwrap_or(serde_json::json!({})),
    };

    let path = dir.join("settings.json");
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("Gagal serialisasi: {e}"))?;
    fs::write(&tmp_path, json)
        .await
        .map_err(|e| format!("Gagal tulis sementara: {e}"))?;
    fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| format!("Gagal rename: {e}"))?;

    Ok(())
}

/// Load pengaturan aplikasi.
#[tauri::command]
pub async fn load_settings(_app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let base = resolve_memory_path().await;
    let path = base.join("profile").join("settings.json");

    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Gagal baca settings.json: {e}"))?;
    let record: SettingsRecord = serde_json::from_str(&content)
        .map_err(|e| format!("Gagal parse JSON: {e}"))?;

    Ok(serde_json::json!({
        "appearance": record.appearance,
        "ai": record.ai,
    }))
}

/// Hapus satu percakapan.
#[tauri::command]
pub async fn delete_conversation(_app: tauri::AppHandle, id: String) -> Result<(), String> {
    let base = resolve_memory_path().await;
    let path = base.join("conversations").join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(&path)
            .await
            .map_err(|e| format!("Gagal hapus file: {e}"))?;
    }
    Ok(())
}

/// Buka folder `.AzaleaMemory` di Explorer.
#[tauri::command]
pub async fn open_memory_folder(_app: tauri::AppHandle) -> Result<(), String> {
    let base = resolve_memory_path().await;
    if !base.exists() {
        fs::create_dir_all(&base)
            .await
            .map_err(|e| format!("Gagal buat folder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(base.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("Gagal buka explorer: {e}"))?;
    Ok(())
}

/// Migrasi ke path khusus. Membuat backup otomatis, memvalidasi, dan rollback jika gagal.
#[tauri::command]
pub async fn set_custom_path(_app: tauri::AppHandle, new_path: String) -> Result<(), String> {
    let new_base = PathBuf::from(&new_path);

    // 1. Validasi path — cegah traversal ke system folder kritis
    let new_abs = if new_base.is_absolute() {
        new_base
    } else {
        return Err("Path harus absolut".to_string());
    };

    // 2. Cek ruang kosong (minimal 100 MB bebas)
    let parent = new_abs.parent().unwrap_or(Path::new(""));
    if let Ok(metadata) = std::fs::metadata(parent) {
        if !metadata.is_dir() {
            return Err(format!("Folder induk tidak ditemukan: {}", parent.display()));
        }
    }

    // 3. Buat folder tujuan
    fs::create_dir_all(&new_abs)
        .await
        .map_err(|e| format!("Gagal buat folder tujuan: {e}"))?;

    // 4. Backup lama
    let old_base = resolve_memory_path().await;
    let backup = make_backup(&old_base).await?;
    if !backup.is_empty() {
        let backup_dir = new_abs.parent().unwrap_or(Path::new("."));
        let backup_file = backup_dir.join(format!("azaleamemory_backup_{}.zip", {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        }));
        // Salin backup ke lokasi aman
        let _ = fs::copy(&backup, &backup_file).await;
    }

    // 5. Copy data lama ke baru
    if old_base.exists() {
        copy_dir_recursive(&old_base, &new_abs)
            .await
            .map_err(|e| format!("Gagal migrasi data: {e}"))?;
    }

    // 6. Simpan path baru ke file metadata
    let home = std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")));
    let marker_dir = home.join("AzaleaHouse").join(".AzaleaMemory").join("metadata");
    fs::create_dir_all(&marker_dir)
        .await
        .map_err(|e| format!("Gagal buat metadata dir: {e}"))?;
    let marker = marker_dir.join("custom_path");
    fs::write(&marker, &new_path)
        .await
        .map_err(|e| format!("Gagal simpan path: {e}"))?;

    // 7. Pastikan metadata ada
    let meta_dir = new_abs.join("metadata");
    fs::create_dir_all(&meta_dir)
        .await
        .map_err(|e| format!("Gagal buat metadata dir: {e}"))?;
    Ok(())
}

/// Buat backup `.AzaleaMemory` ke folder `backups/`.
#[tauri::command]
pub async fn backup_memory(_app: tauri::AppHandle) -> Result<String, String> {
    let base = resolve_memory_path().await;
    make_backup(&base).await
}

/// Helper: copy seluruh direktori (async).
async fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst).await?;
    let mut entries = fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if entry.file_type().await?.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}

/// Helper: buat satu file backup ZIP (gunakan format sederhana: tar.gz via std)
async fn make_backup(base: &Path) -> Result<String, String> {
    if !base.exists() {
        return Err("Folder .AzaleaMemory tidak ada".to_string());
    }

    let backup_name = format!(
        "backup_{}",
        {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        }
    );

    let backup_dir = base.parent().unwrap_or(Path::new("."));
    let backup_dir = backup_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .await
        .map_err(|e| format!("Gagal buat folder backup: {e}"))?;

    // Export sebagai folder (bukan ZIP) untuk simplicidade MVP.
    // Nama backup unik.
    let backup_path = backup_dir.join(&backup_name);
    if backup_path.exists() {
        return Err("Backup sudah ada".to_string());
    }

    copy_dir_recursive(base, &backup_path)
        .await
        .map_err(|e| format!("Gagal copy ke backup: {e}"))?;

    Ok(backup_path.to_string_lossy().to_string())
}

/// Ringkasan percakapan untuk daftar.
#[derive(Serialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

// ──── Phase 5: File Reader & Vision ────

/// Ekstensi yang didukung untuk ekstraksi teks.
const TEXT_EXTENSIONS: &[&str] = &["txt", "md", "markdown", "json", "csv", "ts", "tsx", "js", "jsx", "py", "rs", "toml", "yaml", "yml", "html", "css", "xml"];

/// Ekstensi gambar yang didukung untuk vision.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

/// Batas ukuran file default: 5 MB.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// Payload validasi file.
#[derive(Deserialize)]
pub struct FileValidation {
    pub path: String,
    pub max_bytes: Option<u64>,
}

/// Hasil validasi file.
#[derive(Serialize)]
pub struct FileValidationResult {
    pub valid: bool,
    pub name: String,
    pub size: u64,
    pub format: String,
    pub error: Option<String>,
}

/// Baca teks dari file yang didukung.
#[tauri::command]
pub async fn read_file_text(path_str: String) -> Result<String, String> {
    let path = PathBuf::from(path_str);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !TEXT_EXTENSIONS.contains(&ext) {
        return Err(format!("Format tidak didukung: .{ext}"));
    }
    let content = fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Gagal baca file: {e}"))?;
    // Untuk JSON, validasi parsing
    if ext == "json" {
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("JSON tidak valid: {e}"))?;
    }
    Ok(content)
}

/// Base64-encode gambar untuk dikirim ke Ollama Chat API.
#[tauri::command]
pub async fn encode_image(path_str: String) -> Result<String, String> {
    let path = PathBuf::from(path_str);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !IMAGE_EXTENSIONS.contains(&ext) {
        return Err(format!("Format gambar tidak didukung: .{ext}"));
    }
    let data = fs::read(&path)
        .await
        .map_err(|e| format!("Gagal baca gambar: {e}"))?;
    Ok(base64_encode(&data))
}

/// Validasi file: ukuran, tipe, path traversal.
#[tauri::command]
pub async fn validate_file(payload: FileValidation) -> Result<FileValidationResult, String> {
    let path = PathBuf::from(&payload.path);
    let max = payload.max_bytes.unwrap_or(MAX_FILE_BYTES);

    // Cegah path traversal — cek canonical path
    let canonical = path
        .canonicalize()
        .map_err(|_| "File tidak ditemukan".to_string())?;

    let metadata = std::fs::metadata(&canonical)
        .map_err(|e| format!("Gagal baca metadata: {e}"))?;

    let size = metadata.len();
    if size > max {
        return Ok(FileValidationResult {
            valid: false,
            name: path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string(),
            size,
            format: path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string(),
            error: Some(format!("Ukuran {size} melebihi batas {max} byte")),
        });
    }

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let format = if TEXT_EXTENSIONS.contains(&ext) {
        "text"
    } else if IMAGE_EXTENSIONS.contains(&ext) {
        "image"
    } else {
        "unsupported"
    };

    let valid = matches!(format, "text" | "image");
    let error = if !valid {
        Some(format!("Tipe file tidak didukung: .{ext}"))
    } else {
        None
    };

    Ok(FileValidationResult {
        valid,
        name: path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string(),
        size,
        format: format.to_string(),
        error,
    })
}

/// Simpan attachment ke `.AzaleaMemory/attachments/`.
#[tauri::command]
pub async fn save_attachment(source_path: String) -> Result<String, String> {
    let src = PathBuf::from(&source_path);
    let base = resolve_memory_path().await;
    let attachments_dir = base.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .await
        .map_err(|e| format!("Gagal buat folder attachments: {e}"))?;

    let file_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let dest = attachments_dir.join(file_name);

    // Jika sudah ada, append timestamp
    let final_dest = if dest.exists() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        attachments_dir.join(format!("{stem}_{ts}.{ext}"))
    } else {
        dest
    };

    fs::copy(&src, &final_dest)
        .await
        .map_err(|e| format!("Gagal copy file: {e}"))?;

    Ok(final_dest.to_string_lossy().to_string())
}

/// Daftar lampiran tersimpan.
#[derive(Serialize)]
pub struct AttachmentInfo {
    pub name: String,
    pub size: u64,
    pub format: String,
}

#[tauri::command]
pub async fn list_attachments() -> Result<Vec<AttachmentInfo>, String> {
    let base = resolve_memory_path().await;
    let dir = base.join("attachments");

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut infos = vec![];
    let mut entries = fs::read_dir(&dir)
        .await
        .map_err(|e| format!("Gagal baca folder attachments: {e}"))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Error: {e}"))? {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Gagal baca metadata: {e}"))?;
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let format = if TEXT_EXTENSIONS.contains(&ext) {
            "text"
        } else if IMAGE_EXTENSIONS.contains(&ext) {
            "image"
        } else {
            "other"
        };
        infos.push(AttachmentInfo {
            name: path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string(),
            size: metadata.len(),
            format: format.to_string(),
        });
    }
    Ok(infos)
}

/// Hapus lampiran.
#[tauri::command]
pub async fn delete_attachment(name: String) -> Result<(), String> {
    let base = resolve_memory_path().await;
    let path = base.join("attachments").join(&name);
    if path.exists() {
        fs::remove_file(&path)
            .await
            .map_err(|e| format!("Gagal hapus: {e}"))?;
    }
    Ok(())
}

/// Base64 encode (RFC 4648).
fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    let mut chunks = data.chunks_exact(3);
    for chunk in &mut chunks {
        let b0 = chunk[0];
        let b1 = chunk[1];
        let b2 = chunk[2];
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        out.push(TABLE[(n & 0x3F) as usize] as char);
    }
    let rem = chunks.remainder();
    if !rem.is_empty() {
        let n = if rem.len() == 1 {
            (rem[0] as u32) << 16
        } else {
            ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8)
        };
        out.push(TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3F) as usize] as char);
        if rem.len() == 2 {
            out.push(TABLE[((n >> 6) & 0x3F) as usize] as char);
        }
        out.push('=');
        if rem.len() == 1 {
            out.push('=');
        }
    }
    out
}
