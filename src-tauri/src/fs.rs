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

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tokio::fs;

/// Versi skema penyimpanan — dinaikkan bila format berubah.
const SCHEMA_VERSION: u32 = 1;

/// One-time canonical directory selection created by the native folder picker.
/// The migration command consumes this grant before using the destination.
#[derive(Default)]
pub struct MemoryPathSelection(pub tokio::sync::Mutex<Option<PathBuf>>);

/// Struktur folder standar di dalam `.AzaleaMemory`.
const SUBDIRS: &[&str] = &["profile", "conversations", "memories", "indexes", "attachments", "backups", "cache", "metadata"];

/// Conversation IDs become filenames; accept only a conservative slug alphabet.
fn is_safe_conversation_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachments: Option<serde_json::Value>,
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
    if !is_safe_conversation_id(&conversation.id) {
        return Err("ID percakapan tidak valid".to_string());
    }
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

    // New ISO timestamps sort lexicographically. Prefer them to legacy HH:mm-only
    // records, whose missing date makes an accurate cross-day sort impossible.
    summaries.sort_by(|a, b| {
        let a_has_date = a.updated_at.len() >= 19
            && a.updated_at.as_bytes().get(4) == Some(&b'-')
            && a.updated_at.contains('T');
        let b_has_date = b.updated_at.len() >= 19
            && b.updated_at.as_bytes().get(4) == Some(&b'-')
            && b.updated_at.contains('T');
        b_has_date
            .cmp(&a_has_date)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    Ok(summaries)
}

/// Load satu percakapan lengkap berdasarkan ID.
#[tauri::command]
pub async fn load_conversation(_app: tauri::AppHandle, id: String) -> Result<ConversationRecord, String> {
    if !is_safe_conversation_id(&id) {
        return Err("ID percakapan tidak valid".to_string());
    }
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
    if !is_safe_conversation_id(&id) {
        return Err("ID percakapan tidak valid".to_string());
    }
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

/// Opens a fixed native Windows folder picker; no caller-supplied command is executed.
#[tauri::command]
pub async fn pick_memory_parent_folder(
    selection: tauri::State<'_, MemoryPathSelection>,
) -> Result<Option<String>, String> {
    *selection.0.lock().await = None;
    #[cfg(target_os = "windows")]
    {
        let output = tokio::task::spawn_blocking(|| {
            std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-STA",
                    "-Command",
                    r#"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Pilih folder induk untuk penyimpanan AzaleaHouse'; $dialog.ShowNewFolderButton = $true; $result = $dialog.ShowDialog(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }"#,
                ])
                .output()
        })
        .await
        .map_err(|e| format!("Dialog folder gagal dijalankan: {e}"))?
        .map_err(|e| format!("Tidak dapat membuka dialog folder: {e}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if detail.is_empty() {
                "Dialog pemilihan folder gagal.".to_string()
            } else {
                format!("Dialog pemilihan folder gagal: {detail}")
            });
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if selected.is_empty() {
            return Ok(None);
        }
        let canonical = fs::canonicalize(&selected).await
            .map_err(|e| format!("Folder yang dipilih tidak dapat diakses: {e}"))?;
        if !fs::metadata(&canonical).await
            .map_err(|e| format!("Gagal memeriksa folder yang dipilih: {e}"))?
            .is_dir()
        {
            return Err("Pilihan bukan folder yang valid.".to_string());
        }
        *selection.0.lock().await = Some(canonical.clone());
        Ok(Some(canonical.to_string_lossy().to_string()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Pemilihan lokasi memori kustom hanya tersedia pada Windows.".to_string())
    }
}

fn available_space_bytes(path: &Path) -> Option<u64> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut available = 0u64;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                directory_name: *const u16,
                free_bytes_available: *mut u64,
                total_bytes: *mut u64,
                total_free_bytes: *mut u64,
            ) -> i32;
        }
        let success = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut())
        };
        if success != 0 { Some(available) } else { None }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        None
    }
}

async fn collect_file_manifest(
    root: &Path,
    current: &Path,
    manifest: &mut BTreeMap<PathBuf, u64>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .await
        .map_err(|e| format!("Gagal membaca folder {}: {e}", current.display()))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| format!("Gagal membaca isi folder: {e}"))? {
        let path = entry.path();
        let kind = entry.file_type().await.map_err(|e| format!("Gagal memeriksa file {}: {e}", path.display()))?;
        if kind.is_symlink() {
            return Err(format!("Migrasi dibatalkan karena symbolic link tidak diizinkan: {}", path.display()));
        } else if kind.is_dir() {
            Box::pin(collect_file_manifest(root, &path, manifest)).await?;
        } else if kind.is_file() {
            let relative = path.strip_prefix(root)
                .map_err(|_| "Path file keluar dari folder sumber.".to_string())?
                .to_path_buf();
            let metadata = entry.metadata().await
                .map_err(|e| format!("Gagal membaca metadata file {}: {e}", path.display()))?;
            manifest.insert(relative, metadata.len());
        }
    }
    Ok(())
}

async fn is_empty_directory(path: &Path) -> Result<bool, String> {
    let mut entries = fs::read_dir(path).await.map_err(|e| format!("Gagal memeriksa folder tujuan: {e}"))?;
    Ok(entries.next_entry().await.map_err(|e| format!("Gagal membaca folder tujuan: {e}"))?.is_none())
}

/// Migrate to a chosen parent folder while preserving the fixed .AzaleaMemory root name.
/// The source remains intact; the active path changes only after the copied tree validates.
#[tauri::command]
pub async fn set_custom_path(
    _app: tauri::AppHandle,
    new_path: String,
    selection: tauri::State<'_, MemoryPathSelection>,
) -> Result<(), String> {
    let granted_parent = selection.0.lock().await.take()
        .ok_or_else(|| "Pilih folder tujuan melalui dialog Windows sebelum migrasi.".to_string())?;
    let requested_parent = fs::canonicalize(PathBuf::from(new_path.trim())).await
        .map_err(|e| format!("Folder tujuan tidak dapat diakses: {e}"))?;
    if requested_parent != granted_parent {
        return Err("Tujuan migrasi tidak sama dengan folder yang dipilih lewat dialog.".to_string());
    }
    let selected_parent = granted_parent;
    if !fs::metadata(&selected_parent).await.map_err(|e| format!("Gagal memeriksa folder tujuan: {e}"))?.is_dir() {
        return Err("Lokasi tujuan harus berupa folder.".to_string());
    }

    let old_base = resolve_memory_path().await;
    let old_canonical = fs::canonicalize(&old_base).await
        .map_err(|e| format!("Folder memori sumber tidak dapat diakses: {e}"))?;
    let new_abs = selected_parent.join(".AzaleaMemory");
    if new_abs == old_canonical {
        return Ok(());
    }
    if new_abs.starts_with(&old_canonical) || old_canonical.starts_with(&new_abs) {
        return Err("Lokasi tujuan tidak boleh berada di dalam atau menaungi folder memori aktif.".to_string());
    }

    if new_abs.exists() {
        let kind = fs::symlink_metadata(&new_abs).await
            .map_err(|e| format!("Gagal memeriksa lokasi tujuan: {e}"))?.file_type();
        if kind.is_symlink() || !kind.is_dir() {
            return Err("Tujuan .AzaleaMemory sudah ada tetapi bukan folder biasa.".to_string());
        }
        let canonical_destination = fs::canonicalize(&new_abs).await
            .map_err(|e| format!("Gagal memeriksa lokasi tujuan: {e}"))?;
        if canonical_destination.starts_with(&old_canonical) || old_canonical.starts_with(&canonical_destination) {
            return Err("Lokasi tujuan bertumpang tindih dengan folder memori aktif.".to_string());
        }
        if !is_empty_directory(&canonical_destination).await? {
            return Err("Folder tujuan sudah berisi data. Pilih folder kosong atau lokasi lain.".to_string());
        }
    }

    let mut initial_manifest = BTreeMap::new();
    collect_file_manifest(&old_canonical, &old_canonical, &mut initial_manifest).await?;
    let source_bytes = initial_manifest.values().try_fold(0u64, |sum, size| sum.checked_add(*size))
        .ok_or_else(|| "Ukuran data memori terlalu besar untuk diverifikasi.".to_string())?;
    // Target volume may need both the original tree and its safety backup.
    let required_bytes = source_bytes.saturating_mul(2).saturating_add(100 * 1024 * 1024);
    let available = available_space_bytes(&selected_parent)
        .ok_or_else(|| "Ruang kosong pada volume tujuan tidak dapat diverifikasi.".to_string())?;
    if available < required_bytes {
        return Err(format!("Ruang kosong tidak cukup. Diperlukan sekitar {} MB termasuk cadangan.", required_bytes.saturating_add(1024 * 1024 - 1) / (1024 * 1024)));
    }

    // Backup is created before the migration and remains in the source tree.
    make_backup(&old_canonical).await?;
    let mut source_manifest = BTreeMap::new();
    collect_file_manifest(&old_canonical, &old_canonical, &mut source_manifest).await?;

    fs::create_dir_all(&new_abs).await
        .map_err(|e| format!("Gagal membuat folder tujuan: {e}"))?;
    if let Err(error) = copy_dir_recursive(&old_canonical, &new_abs).await {
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err(format!("Migrasi gagal; folder sumber tetap aktif. Detail: {error}"));
    }

    let mut destination_manifest = BTreeMap::new();
    if let Err(error) = collect_file_manifest(&new_abs, &new_abs, &mut destination_manifest).await {
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err(format!("Validasi hasil migrasi gagal; folder sumber tetap aktif. Detail: {error}"));
    }
    if source_manifest != destination_manifest {
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err("Validasi hasil migrasi gagal karena daftar atau ukuran file berbeda. Folder sumber tetap aktif.".to_string());
    }

    let marker_dir = default_memory_path().join("metadata");
    if let Err(error) = fs::create_dir_all(&marker_dir).await {
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err(format!("Gagal menyiapkan metadata lokasi memori: {error}"));
    }
    let marker = marker_dir.join("custom_path");
    let temporary_marker = marker_dir.join("custom_path.tmp");
    if let Err(error) = fs::write(&temporary_marker, new_abs.to_string_lossy().as_bytes()).await {
        let _ = fs::remove_file(&temporary_marker).await;
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err(format!("Gagal menulis metadata lokasi memori: {error}"));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<u16> = temporary_marker.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let to: Vec<u16> = marker.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(existing_name: *const u16, new_name: *const u16, flags: u32) -> i32;
        }
        // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH.
        let success = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) };
        if success == 0 {
            let error = std::io::Error::last_os_error();
            let _ = fs::remove_file(&temporary_marker).await;
            let _ = fs::remove_dir_all(&new_abs).await;
            return Err(format!("Lokasi memori lama tetap aktif karena metadata tidak dapat diperbarui: {error}"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    if let Err(error) = fs::rename(&temporary_marker, &marker).await {
        let _ = fs::remove_file(&temporary_marker).await;
        let _ = fs::remove_dir_all(&new_abs).await;
        return Err(format!("Lokasi memori lama tetap aktif karena metadata tidak dapat diperbarui: {error}"));
    }
    Ok(())
}

/// Buat backup `.AzaleaMemory` ke folder `backups/`.
#[tauri::command]
pub async fn backup_memory(_app: tauri::AppHandle) -> Result<String, String> {
    let base = resolve_memory_path().await;
    make_backup(&base).await
}

/// Copy a memory tree for backup, excluding its top-level backups directory to avoid recursion.
async fn copy_memory_for_backup(src: &Path, dst: &Path, is_root: bool) -> std::io::Result<()> {
    fs::create_dir_all(dst).await?;
    let mut entries = fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let file_name = entry.file_name();
        if is_root && file_name.to_string_lossy() == "backups" {
            continue;
        }
        let dst_path = dst.join(file_name);
        let kind = entry.file_type().await?;
        if kind.is_symlink() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("Symbolic link tidak diizinkan dalam backup: {}", src_path.display())));
        } else if kind.is_dir() {
            Box::pin(copy_memory_for_backup(&src_path, &dst_path, false)).await?;
        } else if kind.is_file() {
            fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}

/// Copy direktori tanpa mengikuti symbolic link.
async fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst).await?;
    let mut entries = fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let kind = entry.file_type().await?;
        if kind.is_symlink() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("Symbolic link tidak diizinkan: {}", src_path.display())));
        } else if kind.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else if kind.is_file() {
            fs::copy(&src_path, &dst_path).await?;
        }
    }
    Ok(())
}

/// Buat backup berbentuk direktori salinan; bukan arsip ZIP.
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
                .map(|d| d.as_millis())
                .unwrap_or(0)
        }
    );

    let backup_dir = base.join("backups");
    fs::create_dir_all(&backup_dir)
        .await
        .map_err(|e| format!("Gagal buat folder backup: {e}"))?;

    // Export sebagai folder (bukan ZIP) untuk simplicidade MVP.
    // Nama backup unik.
    let backup_path = backup_dir.join(&backup_name);
    if backup_path.exists() {
        return Err("Backup sudah ada".to_string());
    }

    if let Err(error) = copy_memory_for_backup(base, &backup_path, true).await {
        let _ = fs::remove_dir_all(&backup_path).await;
        return Err(format!("Gagal membuat backup: {error}"));
    }

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
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "csv", "tsv", "ts", "tsx", "js", "jsx",
    "mjs", "cjs", "py", "rs", "toml", "yaml", "yml", "html", "htm", "css",
    "xml", "sql", "sh", "ps1", "java", "c", "h", "cpp", "go", "php", "rb",
    "swift", "kt", "ini", "log", "env", "vue", "svelte", "astro", "diff",
];

/// Ekstensi gambar yang didukung untuk vision.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

/// Batas ukuran satu lampiran: 5 MB.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAttachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub storage_path: String,
}

fn attachment_mime_for_extension(extension: &str) -> &'static str {
    match extension {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "json" => "application/json",
        "csv" | "tsv" => "text/csv",
        "md" | "markdown" => "text/markdown",
        "html" | "htm" => "text/html",
        "xml" => "application/xml",
        _ => "text/plain",
    }
}

fn attachment_signature_is_valid(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "docx" | "xlsx" => bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06"),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => !bytes.contains(&0),
    }
}

/// Persist only bytes supplied by a user-selected file; no arbitrary source path is accepted.
#[tauri::command]
pub async fn save_attachment_bytes(
    name: String,
    mime_type: Option<String>,
    base64_data: String,
) -> Result<SavedAttachment, String> {
    if !is_safe_attachment_name(&name)
        || name.len() > 255
        || name.chars().any(|character| character.is_control() || character == '/' || character == '\\')
    {
        return Err("Nama lampiran tidak valid.".to_string());
    }
    let extension = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !SUPPORTED_ATTACHMENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("Format lampiran tidak didukung: .{extension}"));
    }
    if base64_data.len() > 7 * 1024 * 1024 {
        return Err("Data lampiran melewati batas transfer.".to_string());
    }
    let bytes = STANDARD.decode(base64_data.as_bytes())
        .map_err(|_| "Data lampiran bukan base64 yang valid.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Ukuran lampiran harus lebih dari 0 dan tidak boleh melebihi 5 MB.".to_string());
    }
    if !attachment_signature_is_valid(&extension, &bytes) {
        return Err("Isi file tidak cocok dengan ekstensi yang dipilih atau bukan file yang didukung.".to_string());
    }

    let _provided_mime = mime_type.unwrap_or_default();
    let mime_type = attachment_mime_for_extension(&extension).to_string();
    let base = resolve_memory_path().await;
    let directory = base.join("attachments");
    fs::create_dir_all(&directory).await
        .map_err(|error| format!("Gagal menyiapkan folder lampiran lokal: {error}"))?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let id = format!("att_{}_{}", timestamp, std::process::id());
    let destination = directory.join(format!("{id}.{extension}"));
    let temporary = directory.join(format!("{id}.part"));
    fs::write(&temporary, &bytes).await
        .map_err(|error| format!("Gagal menyimpan lampiran: {error}"))?;
    if let Err(error) = fs::rename(&temporary, &destination).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(format!("Gagal menyelesaikan penyimpanan lampiran: {error}"));
    }

    Ok(SavedAttachment {
        id,
        name,
        size: bytes.len() as u64,
        mime_type,
        storage_path: destination.to_string_lossy().to_string(),
    })
}

/// Load stored attachment bytes by a generated ID, never by caller-supplied path.
#[tauri::command]
pub async fn load_attachment_base64(id: String) -> Result<String, String> {
    let suffix = id.strip_prefix("att_").unwrap_or("");
    if suffix.is_empty()
        || suffix.len() > 48
        || !suffix.bytes().all(|byte| byte.is_ascii_digit() || byte == b'_')
    {
        return Err("ID lampiran tidak valid.".to_string());
    }
    let directory = resolve_memory_path().await.join("attachments");
    let mut entries = fs::read_dir(&directory).await
        .map_err(|error| format!("Folder lampiran tidak dapat dibaca: {error}"))?;
    while let Some(entry) = entries.next_entry().await
        .map_err(|error| format!("Gagal membaca daftar lampiran: {error}"))?
    {
        let path = entry.path();
        if path.file_stem().and_then(|stem| stem.to_str()) != Some(id.as_str()) {
            continue;
        }
        let file_type = entry.file_type().await
            .map_err(|error| format!("Gagal memeriksa lampiran: {error}"))?;
        if !file_type.is_file() || file_type.is_symlink() {
            return Err("Lampiran tersimpan bukan file biasa.".to_string());
        }
        let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        if !SUPPORTED_ATTACHMENT_EXTENSIONS.contains(&extension.as_str()) {
            return Err("Format lampiran tersimpan tidak diizinkan.".to_string());
        }
        let metadata = entry.metadata().await
            .map_err(|error| format!("Gagal membaca ukuran lampiran: {error}"))?;
        if metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
            return Err("Ukuran lampiran tersimpan tidak valid.".to_string());
        }
        let bytes = fs::read(&path).await
            .map_err(|error| format!("Gagal membaca lampiran tersimpan: {error}"))?;
        return Ok(STANDARD.encode(bytes));
    }
    Err("Lampiran tersimpan tidak ditemukan.".to_string())
}

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

/// Reserved for the explicit file-selection grant flow; not currently exposed to the WebView.
#[allow(dead_code)]
async fn checked_local_file(path_str: &str, allowed_extensions: &[&str], max_bytes: u64) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path_str).await
        .map_err(|_| "File tidak ditemukan atau tidak dapat diakses.".to_string())?;
    let metadata = fs::metadata(&canonical).await
        .map_err(|e| format!("Gagal membaca metadata file: {e}"))?;
    if !metadata.is_file() {
        return Err("Path yang dipilih bukan file biasa.".to_string());
    }
    if metadata.len() > max_bytes {
        return Err(format!("Ukuran file melebihi batas {} MB.", max_bytes / (1024 * 1024)));
    }
    let extension = canonical.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !allowed_extensions.contains(&extension.as_str()) {
        return Err(format!("Format file tidak didukung: .{extension}"));
    }
    Ok(canonical)
}

#[allow(dead_code)]
fn is_safe_attachment_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." || name.contains(':') || name.contains('\0') {
        return false;
    }
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(std::path::Component::Normal(_))) && components.next().is_none()
}

#[allow(dead_code)]
const SUPPORTED_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "csv", "tsv", "ts", "tsx", "js", "jsx",
    "mjs", "cjs", "py", "rs", "toml", "yaml", "yml", "html", "htm", "css",
    "xml", "sql", "sh", "ps1", "java", "c", "h", "cpp", "go", "php", "rb",
    "swift", "kt", "ini", "log", "env", "vue", "svelte", "astro", "diff",
    "pdf", "docx", "xlsx", "png", "jpg", "jpeg", "webp",
];

/// Baca teks dari file yang didukung.
#[tauri::command]
#[allow(dead_code)]
pub async fn read_file_text(path_str: String) -> Result<String, String> {
    let path = checked_local_file(&path_str, TEXT_EXTENSIONS, MAX_FILE_BYTES).await?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let content = fs::read_to_string(&path).await
        .map_err(|e| format!("Gagal membaca file teks: {e}"))?;
    if ext == "json" {
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("JSON tidak valid: {e}"))?;
    }
    Ok(content)
}

/// Base64-encode gambar untuk dikirim ke Ollama Chat API.
#[tauri::command]
#[allow(dead_code)]
pub async fn encode_image(path_str: String) -> Result<String, String> {
    let path = checked_local_file(&path_str, IMAGE_EXTENSIONS, MAX_FILE_BYTES).await?;
    let data = fs::read(&path).await.map_err(|e| format!("Gagal membaca gambar: {e}"))?;
    Ok(base64_encode(&data))
}

/// Validasi file: ukuran, tipe, path traversal.
#[tauri::command]
#[allow(dead_code)]
pub async fn validate_file(payload: FileValidation) -> Result<FileValidationResult, String> {
    let requested_path = PathBuf::from(&payload.path);
    let max = payload.max_bytes.unwrap_or(MAX_FILE_BYTES).min(MAX_FILE_BYTES);
    let canonical = fs::canonicalize(&requested_path).await
        .map_err(|_| "File tidak ditemukan atau tidak dapat diakses.".to_string())?;
    let metadata = fs::metadata(&canonical).await
        .map_err(|e| format!("Gagal membaca metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("Path yang dipilih bukan file biasa.".to_string());
    }
    let size = metadata.len();
    let ext = canonical.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let format = if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        "text"
    } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        "image"
    } else {
        "unsupported"
    };
    let valid = matches!(format, "text" | "image") && size <= max;
    let error = if size > max {
        Some(format!("Ukuran {size} melebihi batas {max} byte"))
    } else if !matches!(format, "text" | "image") {
        Some(format!("Tipe file tidak didukung: .{ext}"))
    } else {
        None
    };
    Ok(FileValidationResult {
        valid,
        name: canonical.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string(),
        size,
        format: format.to_string(),
        error,
    })
}

/// Simpan attachment ke `.AzaleaMemory/attachments/`.
#[tauri::command]
#[allow(dead_code)]
pub async fn save_attachment(source_path: String) -> Result<String, String> {
    let src = checked_local_file(&source_path, SUPPORTED_ATTACHMENT_EXTENSIONS, MAX_FILE_BYTES).await?;
    let base = resolve_memory_path().await;
    let attachments_dir = base.join("attachments");
    fs::create_dir_all(&attachments_dir).await
        .map_err(|e| format!("Gagal membuat folder lampiran: {e}"))?;
    let file_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let dest = attachments_dir.join(file_name);
    let final_dest = if dest.exists() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("");
        attachments_dir.join(format!("{stem}_{ts}.{ext}"))
    } else {
        dest
    };
    fs::copy(&src, &final_dest).await.map_err(|e| format!("Gagal menyalin lampiran: {e}"))?;
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
#[allow(dead_code)]
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
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        let format = if TEXT_EXTENSIONS.contains(&ext.as_str()) {
            "text"
        } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
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
#[allow(dead_code)]
pub async fn delete_attachment(name: String) -> Result<(), String> {
    if !is_safe_attachment_name(&name) {
        return Err("Nama lampiran tidak valid.".to_string());
    }
    let attachments_dir = resolve_memory_path().await.join("attachments");
    if !attachments_dir.exists() {
        return Ok(());
    }
    let canonical_dir = fs::canonicalize(&attachments_dir).await
        .map_err(|e| format!("Gagal memeriksa folder lampiran: {e}"))?;
    let candidate = canonical_dir.join(&name);
    let canonical_target = match fs::canonicalize(&candidate).await {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Gagal memeriksa lampiran: {error}")),
    };
    if !canonical_target.starts_with(&canonical_dir) || canonical_target == canonical_dir {
        return Err("Akses ditolak: lampiran berada di luar folder yang diizinkan.".to_string());
    }
    if !fs::metadata(&canonical_target).await.map_err(|e| format!("Gagal membaca metadata lampiran: {e}"))?.is_file() {
        return Err("Hanya file lampiran yang dapat dihapus.".to_string());
    }
    fs::remove_file(&canonical_target).await.map_err(|e| format!("Gagal menghapus lampiran: {e}"))?;
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


#[cfg(test)]
mod conversation_storage_tests {
    use super::{is_safe_attachment_name, is_safe_conversation_id};

    #[test]
    fn accepts_app_generated_session_ids() {
        assert!(is_safe_conversation_id("msg-mh7abc-12"));
        assert!(is_safe_conversation_id("conversation_20261030"));
    }

    #[test]
    fn rejects_path_traversal_and_invalid_ids() {
        assert!(!is_safe_conversation_id(""));
        assert!(!is_safe_conversation_id("../settings"));
        assert!(!is_safe_conversation_id("folder\\\\file"));
        assert!(!is_safe_conversation_id("id with spaces"));
        assert!(!is_safe_conversation_id(&"a".repeat(129)));
    }

    #[test]
    fn rejects_attachment_path_components() {
        assert!(is_safe_attachment_name("notes.txt"));
        assert!(!is_safe_attachment_name("../outside.txt"));
        assert!(!is_safe_attachment_name("..\\outside.txt"));
        assert!(!is_safe_attachment_name("C:\\outside.txt"));
        assert!(!is_safe_attachment_name("C:outside.txt"));
        assert!(!is_safe_attachment_name("notes.txt:stream"));
        assert!(!is_safe_attachment_name(""));
    }
}
