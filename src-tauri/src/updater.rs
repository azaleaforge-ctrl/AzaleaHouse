//! Temporary hardened manual-download bridge.
//! This module is not an authenticated updater yet: installer execution is intentionally absent.
//! Replace this bridge with the official Tauri updater plugin after a signing key is generated.

use std::cmp::Ordering as VersionOrdering;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::watch;

const GITHUB_OWNER: &str = "azaleaforge-ctrl";
const GITHUB_REPO_NAME: &str = "AzaleaHouse";
const GITHUB_API: &str = "https://api.github.com/repos";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_INSTALLER_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub struct DownloadToken {
    active: Arc<AtomicBool>,
    cancel_sender: Arc<StdMutex<Option<watch::Sender<bool>>>>,
}

impl Default for DownloadToken {
    fn default() -> Self {
        Self {
            active: Arc::new(AtomicBool::new(false)),
            cancel_sender: Arc::new(StdMutex::new(None)),
        }
    }
}

/// Clears the single-download lease even when the async command exits with an error.
struct DownloadGuard {
    active: Arc<AtomicBool>,
    cancel_sender: Arc<StdMutex<Option<watch::Sender<bool>>>>,
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        let mut sender = self.cancel_sender.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *sender = None;
        drop(sender);
        self.active.store(false, Ordering::Release);
    }
}

async fn wait_for_cancel(mut receiver: watch::Receiver<bool>) {
    loop {
        if *receiver.borrow_and_update() {
            return;
        }
        if receiver.changed().await.is_err() {
            // The active command owns the sender until it exits. A closed channel must
            // not be interpreted as a cancellation request.
            std::future::pending::<()>().await;
        }
    }
}

fn parse_release_version(value: &str) -> Result<Version, String> {
    let normalized = value.strip_prefix('v').unwrap_or(value);
    Version::parse(normalized).map_err(|_| format!("Tag rilis '{value}' bukan versi semantik yang valid."))
}

fn version_is_newer(latest: &str, current: &str) -> Result<bool, String> {
    let latest = parse_release_version(latest)?;
    let current = parse_release_version(current)?;
    Ok(latest.cmp(&current) == VersionOrdering::Greater)
}

fn installer_matches_release(name: &str, release_version: &str, size: u64) -> bool {
    size > 0
        && size <= MAX_INSTALLER_BYTES
        && is_safe_installer_name(name)
        && name.starts_with(&format!("AzaleaHouse_{release_version}_"))
}

async fn validate_pe_installer(path: &std::path::Path) -> Result<(), String> {
    let mut file = fs::File::open(path).await
        .map_err(|error| format!("Gagal membuka hasil unduhan untuk validasi: {error}"))?;
    let mut dos_header = [0u8; 64];
    file.read_exact(&mut dos_header).await
        .map_err(|_| "File hasil unduhan terlalu kecil untuk menjadi installer Windows.".to_string())?;
    if &dos_header[..2] != b"MZ" {
        return Err("File hasil unduhan bukan executable Windows (header MZ tidak ditemukan).".to_string());
    }

    let pe_offset = u32::from_le_bytes(dos_header[0x3c..0x40].try_into().unwrap()) as u64;
    // Real Windows installers have a small PE header offset. A generous limit rejects
    // malformed headers without reading the whole installer into memory.
    if pe_offset < 64 || pe_offset > 1024 * 1024 {
        return Err("Header executable Windows tidak valid.".to_string());
    }
    file.seek(std::io::SeekFrom::Start(pe_offset)).await
        .map_err(|error| format!("Gagal memeriksa header executable: {error}"))?;
    let mut signature = [0u8; 4];
    file.read_exact(&mut signature).await
        .map_err(|_| "Header PE installer tidak lengkap.".to_string())?;
    if &signature != b"PE\0\0" {
        return Err("File hasil unduhan tidak memiliki signature PE Windows yang valid.".to_string());
    }
    Ok(())
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
    let latest = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name).to_string();
    let available = match version_is_newer(&latest, &current) {
        Ok(is_newer) => is_newer,
        Err(error) => {
            return Ok(UpdateInfo {
                available: false,
                current_version: current,
                latest_version: latest,
                body: release.body,
                assets: vec![],
                error: Some(error),
            });
        }
    };

    let assets: Vec<UpdateAsset> = release
        .assets
        .into_iter()
        .filter_map(|asset| {
            if !installer_matches_release(&asset.name, &latest, asset.size) {
                return None;
            }
            let url = parse_official_installer_url(&asset.browser_download_url).ok()?;
            let segments: Vec<&str> = url.path_segments()?.collect();
            if segments.last().copied() != Some(asset.name.as_str()) {
                return None;
            }
            let url_tag = segments.get(4)?.strip_prefix('v').unwrap_or(segments[4]);
            if url_tag != latest {
                return None;
            }
            Some(UpdateAsset { name: asset.name, url: url.to_string(), size: asset.size })
        })
        .collect();

    let error = if available && assets.is_empty() {
        Some("Rilis terbaru tidak menyediakan installer Windows yang cocok dengan versi tag dan batas ukuran yang diharapkan. Instalasi tetap terkunci sampai verifikasi tanda tangan resmi tersedia.".to_string())
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

    // Only one download may be active. Use a per-attempt watch channel so a
    // later download cannot reset a cancellation flag for an older request.
    let (cancel_sender, cancel_receiver) = watch::channel(false);
    {
        let mut current_sender = state.cancel_sender.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.active.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err("Unduhan pembaruan lain masih berjalan.".to_string());
        }
        *current_sender = Some(cancel_sender);
    }
    let _download_guard = DownloadGuard {
        active: state.active.clone(),
        cancel_sender: state.cancel_sender.clone(),
    };

    let cache_dir = crate::fs::resolve_memory_path().await.join("cache");
    fs::create_dir_all(&cache_dir).await.map_err(|e| format!("Gagal buat cache folder: {e}"))?;
    let dest = cache_dir.join(&asset_name);
    let partial = cache_dir.join(format!("{asset_name}.part"));

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(0))
        .no_gzip()
        .user_agent("AzaleaHouse/0.1")
        .build()
        .map_err(|e| format!("Client error: {e}"))?;

    let send_result = tokio::select! {
        biased;
        _ = wait_for_cancel(cancel_receiver.clone()) => return Err("Unduhan dibatalkan".to_string()),
        result = client.get(url).send() => result,
    };
    let resp = send_result.map_err(|e| format!("Unduh gagal: {e}"))?;
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
    let _ = app.emit("azalea:update_progress", UpdateProgress {
        downloaded: 0, total, speed: 0, eta_seconds: None,
    });

    loop {
        let chunk_result = tokio::select! {
            biased;
            _ = wait_for_cancel(cancel_receiver.clone()) => {
                drop(file);
                let _ = fs::remove_file(&partial).await;
                return Err("Unduhan dibatalkan".to_string());
            }
            item = stream.next() => match item {
                Some(item) => item,
                None => break,
            },
        };
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

    if *cancel_receiver.borrow() {
        drop(file);
        let _ = fs::remove_file(&partial).await;
        return Err("Unduhan dibatalkan".to_string());
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

    if let Err(error) = validate_pe_installer(&partial).await {
        let _ = fs::remove_file(&partial).await;
        return Err(error);
    }

    // Recheck cancellation before committing the temporary file.
    if *cancel_receiver.borrow() {
        let _ = fs::remove_file(&partial).await;
        return Err("Unduhan dibatalkan".to_string());
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
    let sender = state.cancel_sender.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
    if let Some(sender) = sender {
        let _ = sender.send(true);
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::{
        installer_matches_release, is_safe_installer_name, is_safe_release_tag,
        parse_official_installer_url, validate_pe_installer, version_is_newer, MAX_INSTALLER_BYTES,
    };

    const VALID_URL: &str = "https://github.com/azaleaforge-ctrl/AzaleaHouse/releases/download/v0.1.0/AzaleaHouse_0.1.0_x64-setup.exe";

    #[test]
    fn accepts_only_official_release_installer() {
        assert!(parse_official_installer_url(VALID_URL).is_ok());
    }

    #[test]
    fn rejects_non_https_and_external_hosts() {
        assert!(parse_official_installer_url(
            "http://github.com/azaleaforge-ctrl/AzaleaHouse/releases/download/v0.1.0/AzaleaHouse_0.1.0_x64-setup.exe"
        ).is_err());
        assert!(parse_official_installer_url(
            "https://github.com.evil.example/azaleaforge-ctrl/AzaleaHouse/releases/download/v0.1.0/AzaleaHouse_0.1.0_x64-setup.exe"
        ).is_err());
    }

    #[test]
    fn rejects_other_repositories_and_query_strings() {
        assert!(parse_official_installer_url(
            "https://github.com/other-owner/other-repo/releases/download/v0.1.0/AzaleaHouse_0.1.0_x64-setup.exe"
        ).is_err());
        assert!(parse_official_installer_url(
            "https://github.com/azaleaforge-ctrl/AzaleaHouse/releases/download/v0.1.0/AzaleaHouse_0.1.0_x64-setup.exe?redirect=evil"
        ).is_err());
    }

    #[test]
    fn compares_versions_numerically_and_does_not_downgrade() {
        assert_eq!(version_is_newer("0.1.4", "0.1.3"), Ok(true));
        assert_eq!(version_is_newer("0.2.0", "0.10.0"), Ok(false));
        assert_eq!(version_is_newer("0.1.3", "0.1.3"), Ok(false));
        assert_eq!(version_is_newer("0.1.2", "0.1.3"), Ok(false));
        assert_eq!(version_is_newer("v0.1.4-beta.1", "0.1.3"), Ok(true));
        assert!(version_is_newer("latest", "0.1.3").is_err());
    }

    #[test]
    fn release_assets_must_match_tag_version_and_size() {
        assert!(installer_matches_release("AzaleaHouse_0.1.4_x64-setup.exe", "0.1.4", 1024));
        assert!(!installer_matches_release("AzaleaHouse_0.1.3_x64-setup.exe", "0.1.4", 1024));
        assert!(!installer_matches_release("AzaleaHouse_0.1.4_x64-setup.exe", "0.1.4", 0));
        assert!(!installer_matches_release("AzaleaHouse_0.1.4_x64-setup.exe", "0.1.4", MAX_INSTALLER_BYTES + 1));
    }

    #[tokio::test]
    async fn rejects_non_pe_file_even_when_nonempty() {
        let path = std::env::temp_dir().join(format!("azaleahouse-invalid-installer-{}.exe", std::process::id()));
        tokio::fs::write(&path, b"this is not a windows executable").await.expect("write test file");
        let result = validate_pe_installer(&path).await;
        let _ = tokio::fs::remove_file(&path).await;
        assert!(result.is_err());
    }

    #[test]
    fn rejects_path_traversal_and_non_installer_assets() {
        assert!(!is_safe_installer_name("../AzaleaHouse_0.1.0_x64-setup.exe"));
        assert!(!is_safe_installer_name("AzaleaHouse_latest.json"));
        assert!(!is_safe_installer_name("AzaleaHouse_.exe"));
        assert!(is_safe_release_tag("v0.1.0"));
        assert!(!is_safe_release_tag("../latest"));
    }
}
