//! AzaleaHouse → Version Center & Manual Updater (Phase 7).
//!
//! Operasi terbatas: cek rilis GitHub, unduh asset secara manual (user trigger),
//! emit progres via event, simpan file ke folder cache.
//! Tidak ada auto-download, tidak ada auto-install. Semua ada di tangan user.
//!
//! Komponen ini menggunakan GitHub REST API yang sudah ada, bukan Tauri updater
//! plugin — karena kami butuh kontrol penuh atas UI/UX (bukan silent background update).
//! Signature verification bisa ditambahkan di iterasi selanjutnya (butuh signing key).
//!
//! Commands:
//!   - `check_update`     : fetch latest GitHub release, return metadata.
//!   - `download_update`  : download asset ke `.AzaleaMemory/cache/`, emit progres.
//!   - `cancel_download`  : cancel ongoing download via token.
//!   - `apply_update`     : launch installer exe (manual user action).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Konfigurasi GitHub — bisa override via env var GITHUB_REPO, default ke repo resmi.
fn github_repo() -> String {
    std::env::var("GITHUB_REPO")
        .unwrap_or_else(|_| "azaleaforge-ctrl/AzaleaHouse".to_string())
}

const GITHUB_API: &str = "https://api.github.com/repos";
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// Token pembatal download (shared state).
pub struct DownloadToken(pub Arc<AtomicBool>);

impl Default for DownloadToken {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[allow(dead_code)]
    published_at: String,
    body: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// Payload balasan cek update.
#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub body: String,
    pub assets: Vec<UpdateAsset>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

/// Event progres download yang di-emit ke frontend.
#[derive(Serialize, Clone)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64, // bytes/s
    pub eta_seconds: Option<u64>,
}

/// Cek rilis terbaru dari GitHub API.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let repo = github_repo();
    if repo == "owner/repo-placeholder" {
        return Ok(UpdateInfo {
            available: false,
            current_version: app.package_info().version.to_string(),
            latest_version: app.package_info().version.to_string(),
            body: "Hubungkan repo GitHub di settings.".to_string(),
            assets: vec![],
            error: Some("GitHub repo belum dikonfigurasi. Hubungi pengembang.".to_string()),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("AzaleaHouse/0.1")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let url = format!("{GITHUB_API}/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Request gagal: {e}"))?;

    let status = resp.status();
    let current = app.package_info().version.to_string();

    if status.as_u16() == 404 || status.as_u16() == 403 || status.as_u16() == 401 {
        return Ok(UpdateInfo {
            available: false,
            current_version: current.clone(),
            latest_version: current,
            body: String::new(),
            assets: vec![],
            error: Some(format!("Akses release gagal (HTTP {}). Periksa repo + token.", status.as_u16())),
        });
    }

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Parse JSON: {e}"))?;

    let latest = release.tag_name.trim_start_matches('v').to_string();
    let available = latest != current;

    let assets = release
        .assets
        .into_iter()
        .map(|a| UpdateAsset {
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
        })
        .collect();

    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: latest,
        body: release.body,
        assets,
        error: None,
    })
}

/// Unduh satu asset ke folder cache dengan progres streaming.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    asset_url: String,
    asset_name: String,
    state: State<'_, DownloadToken>,
) -> Result<String, String> {
    // Reset token pembatal
    state.0.store(false, Ordering::SeqCst);

    let base = crate::fs::resolve_memory_path().await;
    let cache_dir = base.join("cache");
    fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| format!("Gagal buat cache folder: {e}"))?;

    let dest = cache_dir.join(&asset_name);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(0)) // no timeout for large downloads
        .user_agent("AzaleaHouse/0.1")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let resp = client
        .get(&asset_url)
        .send()
        .await
        .map_err(|e| format!("Unduh gagal: {e}"))?;

    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(&dest)
        .await
        .map_err(|e| format!("Gagal buat file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    let mut last_speed: u64 = 0;

    let stream = resp.bytes_stream();
    tokio::pin!(stream);

    while let Some(chunk) = stream.next().await {
        // Cek pembatalan
        if state.0.load(Ordering::SeqCst) {
            let _ = fs::remove_file(&dest).await;
            return Err("Unduh dibatalkan".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Gagal tulis file: {e}"))?;
        downloaded += chunk.len() as u64;

        // Emit progres setiap ~500ms
        if last_tick.elapsed().as_millis() > 500 {
            let elapsed = last_tick.elapsed().as_secs_f64();
            if elapsed > 0.0 {
                last_speed = ((downloaded as f64) / elapsed) as u64;
            }
            let eta = if last_speed > 0 && total > 0 {
                Some((total - downloaded) / last_speed)
            } else {
                None
            };
            let _ = app.emit("azalea:update_progress", UpdateProgress {
                downloaded,
                total,
                speed: last_speed,
                eta_seconds: eta,
            });
            last_tick = std::time::Instant::now();
        }
    }

    file.flush().await.map_err(|e| format!("Flush error: {e}"))?;
    drop(file);

    // Final emit — 100%
    let _ = app.emit("azalea:update_progress", UpdateProgress {
        downloaded: total,
        total,
        speed: last_speed,
        eta_seconds: if last_speed > 0 && total > 0 {
            Some(0)
        } else {
            None
        },
    });

    // Verify file integrity (size match)
    let actual = fs::metadata(&dest)
        .await
        .map_err(|e| format!("Gagal baca metadata: {e}"))?
        .len();
    if actual != total && total > 0 {
        let _ = fs::remove_file(&dest).await;
        return Err(format!("Ukuran file tidak cocok: {actual} vs {total}"));
    }

    Ok(dest.to_string_lossy().to_string())
}

/// Set token pembatal download.
#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadToken>) -> Result<(), String> {
    state.0.store(true, Ordering::SeqCst);
    Ok(())
}

/// Luncurkan installer yang sudah di-download (manual user action).
#[tauri::command]
pub async fn apply_update(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("File installer tidak ditemukan".to_string());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path.to_string_lossy().to_string()])
        .spawn()
        .map_err(|e| format!("Gagal meluncurkan installer: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| format!("Gagal meluncurkan installer: {e}"))?;
    Ok(())
}
