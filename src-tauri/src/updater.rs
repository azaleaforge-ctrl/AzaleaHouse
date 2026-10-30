//! Temporary hardened manual-download bridge.
//! This module is not an authenticated updater yet: installer execution is intentionally absent.
//! Replace this bridge with the official Tauri updater plugin after a signing key is generated.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::fs;
use tokio::io::AsyncWriteExt;

const GITHUB_OWNER: &str = "azaleaforge-ctrl";
const GITHUB_REPO_NAME: &str = "AzaleaHouse";
const GITHUB_API: &str = "https://api.github.com/repos";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_INSTALLER_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub struct DownloadToken(pub Arc<AtomicBool>);

impl Default for DownloadToken {
    fn default() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    #[allow(dead_code)]
    published_at: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

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

#[derive(Serialize, Clone)]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: u64,
    pub speed: u64,
    pub eta_seconds: Option<u64>,
}

/// Only accept installer assets served from the release-download path of the fixed repo.
fn parse_official_installer_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL installer tidak valid".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Sumber update ditolak: hanya HTTPS GitHub resmi yang diizinkan".into());
    }

    let segments: Vec<&str> = url
        .path_segments()
        .ok_or_else(|| "Path URL installer tidak valid".to_string())?
        .collect();
    if segments.len() != 6
        || segments[0] != GITHUB_OWNER
        || segments[1] != GITHUB_REPO_NAME
        || segments[2] != "releases"
        || segments[3] != "download"
        || !is_safe_release_tag(segments[4])
        || !is_safe_installer_name(segments[5])
    {
        return Err("Sumber update ditolak: path bukan installer resmi AzaleaHouse".into());
    }
    Ok(url)
}

fn is_safe_release_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 100
        && tag != "."
        && tag != ".."
        && tag.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn is_safe_installer_name(name: &str) -> bool {
    name.len() <= 180
        && name.starts_with("AzaleaHouse_")
        && name.ends_with(".exe")
        && name != "AzaleaHouse_.exe"
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent("AzaleaHouse/0.1")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let url = format!("{GITHUB_API}/{GITHUB_OWNER}/{GITHUB_REPO_NAME}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Request GitHub gagal: {e}"))?;

    let status = resp.status();
    let current = app.package_info().version.to_string();
    if !status.is_success() {
        let message = match status.as_u16() {
            404 => "Belum ada GitHub Release terbaru yang dapat diperiksa.".to_string(),
            403 => "GitHub API membatasi permintaan. Coba lagi nanti.".to_string(),
            401 => "GitHub menolak autentikasi permintaan.".to_string(),
            code => format!("GitHub API mengembalikan HTTP {code}."),
        };
        return Ok(UpdateInfo {
            available: false,
            current_version: current.clone(),
            latest_version: current,
            body: String::new(),
            assets: vec![],
            error: Some(message),
        });
    }

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Respons GitHub bukan metadata rilis yang valid: {e}"))?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    let available = latest != current;

    let assets: Vec<UpdateAsset> = release
        .assets
        .into_iter()
        .filter_map(|asset| {
            let url = parse_official_installer_url(&asset.browser_download_url).ok()?;
            let last_segment = url.path_segments()?.last()?.to_string();
            if last_segment != asset.name {
                return None;
            }
            Some(UpdateAsset { name: asset.name, url: url.to_string(), size: asset.size })
        })
        .collect();

    let error = if available && assets.is_empty() {
        Some("Rilis terbaru tidak menyediakan installer Windows AzaleaHouse yang valid. Instalasi dinonaktifkan sampai verifikasi tanda tangan resmi tersedia.".to_string())
    } else {
        None
    };

    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: latest,
        body: release.body,
        assets,
        error,
    })
}

/// Download is manual and constrained to the official release. The output is not executable
/// through this app until the official signed-updater flow is configured.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    asset_url: String,
    asset_name: String,
    state: State<'_, DownloadToken>,
) -> Result<String, String> {
    let url = parse_official_installer_url(&asset_url)?;
    let segments: Vec<&str> = url.path_segments().ok_or_else(|| "Path URL installer tidak valid".to_string())?.collect();
    if segments.last().copied() != Some(asset_name.as_str()) || !is_safe_installer_name(&asset_name) {
        return Err("Nama file tidak sesuai dengan asset installer resmi".into());
    }

    state.0.store(false, Ordering::SeqCst);
    let cache_dir = crate::fs::resolve_memory_path().await.join("cache");
    fs::create_dir_all(&cache_dir).await.map_err(|e| format!("Gagal buat cache folder: {e}"))?;
    let dest = cache_dir.join(&asset_name);
    let partial = cache_dir.join(format!("{asset_name}.part"));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(0))
        .user_agent("AzaleaHouse/0.1")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let resp = client.get(url).send().await.map_err(|e| format!("Unduh gagal: {e}"))?;
    let resp = resp.error_for_status().map_err(|e| format!("Server menolak unduhan: {e}"))?;
    if !matches!(
        resp.url().host_str().unwrap_or_default(),
        "github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com"
    ) {
        return Err("Redirect unduhan menuju host yang tidak diizinkan".into());
    }

    let total = resp.content_length().unwrap_or(0);
    if total > MAX_INSTALLER_BYTES {
        return Err("Ukuran installer melebihi batas 2 GiB".into());
    }

    let mut file = fs::File::create(&partial).await.map_err(|e| format!("Gagal buat file sementara: {e}"))?;
    let mut downloaded: u64 = 0;
    let mut last_sample_bytes: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    let mut last_speed: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if state.0.load(Ordering::SeqCst) {
            drop(file);
            let _ = fs::remove_file(&partial).await;
            return Err("Unduhan dibatalkan".into());
        }
        let chunk = match chunk_result {
            Ok(chunk) => chunk,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&partial).await;
                return Err(format!("Stream unduhan gagal: {e}"));
            }
        };
        downloaded = match downloaded.checked_add(chunk.len() as u64) {
            Some(size) if size <= MAX_INSTALLER_BYTES => size,
            _ => {
                drop(file);
                let _ = fs::remove_file(&partial).await;
                return Err("Unduhan melewati batas ukuran 2 GiB".into());
            }
        };
        if let Err(e) = file.write_all(&chunk).await {
            drop(file);
            let _ = fs::remove_file(&partial).await;
            return Err(format!("Gagal menulis file sementara: {e}"));
        }

        if last_tick.elapsed().as_millis() >= 500 {
            let elapsed = last_tick.elapsed().as_secs_f64();
            if elapsed > 0.0 {
                last_speed = ((downloaded - last_sample_bytes) as f64 / elapsed) as u64;
            }
            let eta = if last_speed > 0 && total >= downloaded && total > 0 {
                Some((total - downloaded) / last_speed)
            } else {
                None
            };
            let _ = app.emit("azalea:update_progress", UpdateProgress { downloaded, total, speed: last_speed, eta_seconds: eta });
            last_sample_bytes = downloaded;
            last_tick = std::time::Instant::now();
        }
    }

    if let Err(e) = file.flush().await {
        drop(file);
        let _ = fs::remove_file(&partial).await;
        return Err(format!("Flush file gagal: {e}"));
    }
    if let Err(e) = file.sync_all().await {
        drop(file);
        let _ = fs::remove_file(&partial).await;
        return Err(format!("Sinkronisasi file gagal: {e}"));
    }
    drop(file);

    let actual = match fs::metadata(&partial).await {
        Ok(meta) => meta.len(),
        Err(e) => {
            let _ = fs::remove_file(&partial).await;
            return Err(format!("Gagal memeriksa file hasil unduhan: {e}"));
        }
    };
    if (total > 0 && actual != total) || actual == 0 {
        let _ = fs::remove_file(&partial).await;
        return Err(format!("Ukuran file tidak cocok atau kosong: diterima {actual} byte, Content-Length {total} byte"));
    }

    let _ = fs::remove_file(&dest).await;
    if let Err(e) = fs::rename(&partial, &dest).await {
        let _ = fs::remove_file(&partial).await;
        return Err(format!("Gagal menyelesaikan unduhan: {e}"));
    }

    let final_total = if total > 0 { total } else { downloaded };
    let _ = app.emit("azalea:update_progress", UpdateProgress {
        downloaded, total: final_total, speed: last_speed, eta_seconds: Some(0),
    });
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadToken>) -> Result<(), String> {
    state.0.store(true, Ordering::SeqCst);
    Ok(())
}
