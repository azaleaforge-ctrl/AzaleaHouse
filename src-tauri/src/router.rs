//! OpenAI-compatible provider bridge for the local 9Router gateway.
//! API credentials are held only in process memory and are never written to logs or settings.
use std::collections::HashMap;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use reqwest::Url;
use tokio::sync::{oneshot, Mutex};

const ROUTER_BASE: &str = "http://localhost:20128/v1";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
// Long-running provider reasoning and generation must not be cut off by a short idle deadline.
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct RouterCredentials(pub Arc<Mutex<Option<String>>>);

impl Default for RouterCredentials {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RouterModel {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub context_length: Option<u64>,
    #[serde(default)]
    pub owned_by: Option<String>,
}

#[derive(Deserialize)]
struct ModelList {
    #[serde(default)]
    data: Vec<RouterModel>,
}

#[derive(Clone, Deserialize)]
pub struct RouterMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(default, rename = "imageMimeTypes")]
    pub image_mime_types: Option<Vec<String>>,
}

#[derive(Clone, Deserialize, Default)]
pub struct RouterOptions {}

#[derive(Deserialize)]
pub struct RouterChatRequest {
    pub model: String,
    pub messages: Vec<RouterMessage>,
    #[serde(default)]
    pub think: bool,
    #[serde(default)]
    pub options: RouterOptions,
    #[serde(default, rename = "skillsPrompt")]
    pub skills_prompt: Option<String>,
}

fn validate_api_key(value: &str) -> Result<String, String> {
    let key = value.trim();
    if key.is_empty() {
        return Err("API key 9Router belum diisi.".to_owned());
    }
    if key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("Format API key tidak valid.".to_owned());
    }
    Ok(key.to_owned())
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(timeout)
        .no_gzip()
        .user_agent("AzaleaHouse/0.2.3")
        .build()
        .map_err(|error| format!("Tidak dapat menyiapkan koneksi 9Router: {error}"))
}

async fn fetch_models_with_key(api_key: &str) -> Result<Vec<RouterModel>, String> {
    let response = http_client(REQUEST_TIMEOUT)?
        .get(format!("{ROUTER_BASE}/models"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("9Router tidak dapat dihubungi di {ROUTER_BASE}: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.chars().take(500).collect::<String>();
        return Err(format!("9Router menolak koneksi (HTTP {status}). Periksa API key dan status gateway. {detail}"));
    }

    let payload: ModelList = response
        .json()
        .await
        .map_err(|error| format!("Daftar model 9Router tidak valid: {error}"))?;
    let mut models = payload.data;
    models.retain(|model| !model.id.trim().is_empty());
    models.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    if models.is_empty() {
        return Err("9Router tersambung, tetapi endpoint /models tidak mengembalikan model.".to_owned());
    }
    Ok(models)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn connect_9router(
    api_key: String,
    credentials: State<'_, RouterCredentials>,
) -> Result<Vec<RouterModel>, String> {
    let key = validate_api_key(&api_key)?;
    // Verify credentials before making the connection available to model selection.
    let models = fetch_models_with_key(&key).await?;
    *credentials.0.lock().await = Some(key);
    Ok(models)
}

#[tauri::command]
pub async fn list_9router_models(
    credentials: State<'_, RouterCredentials>,
) -> Result<Vec<RouterModel>, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect untuk memasukkan API key.".to_owned())?;
    fetch_models_with_key(&key).await
}

/// Read the dedicated 9Router image catalog instead of guessing image capability from chat model names.
async fn fetch_image_models_with_key(key: &str) -> Result<Vec<RouterModel>, String> {
    let response = http_client(REQUEST_TIMEOUT)?
        .get(format!("{ROUTER_BASE}/models/image"))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| format!("Katalog model gambar 9Router gagal dihubungi: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Katalog model gambar 9Router mengembalikan HTTP {status}: {}", detail.chars().take(900).collect::<String>()));
    }
    let payload: ModelList = response.json().await
        .map_err(|error| format!("Katalog model gambar 9Router tidak valid: {error}"))?;
    let mut models = payload.data;
    models.retain(|model| !model.id.trim().is_empty());
    models.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    Ok(models)
}

#[tauri::command]
pub async fn list_9router_image_models(
    credentials: State<'_, RouterCredentials>,
) -> Result<Vec<RouterModel>, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect untuk memasukkan API key.".to_owned())?;
    fetch_image_models_with_key(&key).await
}

async fn fetch_video_models_with_key(key: &str) -> Result<Vec<RouterModel>, String> {
    let response = http_client(REQUEST_TIMEOUT)?
        .get(format!("{ROUTER_BASE}/models/video"))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| format!("Katalog model video 9Router gagal dihubungi: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(vec![RouterModel {
            id: "xai/grok-imagine-video".to_owned(),
            name: Some("Grok Imagine Video".to_owned()),
            context_length: None,
            owned_by: Some("xai".to_owned()),
        }]);
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Katalog model video 9Router mengembalikan HTTP {status}: {}", detail.chars().take(900).collect::<String>()));
    }
    let payload: ModelList = response.json().await
        .map_err(|error| format!("Katalog model video 9Router tidak valid: {error}"))?;
    let mut models = payload.data;
    models.retain(|model| !model.id.trim().is_empty());
    models.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    Ok(models)
}

#[tauri::command]
pub async fn list_9router_video_models(
    credentials: State<'_, RouterCredentials>,
) -> Result<Vec<RouterModel>, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect untuk memasukkan API key.".to_owned())?;
    fetch_video_models_with_key(&key).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterVideoRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub duration: Option<u8>,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedVideo {
    pub url: String,
    pub model: String,
    pub duration: Option<u8>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn router_generate_video(
    app: tauri::AppHandle,
    credentials: State<'_, RouterCredentials>,
    payload: RouterVideoRequest,
) -> Result<GeneratedVideo, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Hubungkan provider terlebih dahulu.".to_owned())?;
    let model = payload.model.trim();
    let prompt = payload.prompt.trim();
    if model.is_empty() || model.len() > 512 || model.chars().any(char::is_control) {
        return Err("Model video tidak valid.".to_owned());
    }
    if prompt.is_empty() || prompt.len() > 4000 || prompt.chars().any(char::is_control) {
        return Err("Prompt video kosong, terlalu panjang, atau mengandung karakter kontrol (maksimum 4.000 karakter).".to_owned());
    }
    let duration = payload.duration.unwrap_or(8);
    if !(1..=15).contains(&duration) {
        return Err("Durasi video harus antara 1 sampai 15 detik.".to_owned());
    }
    let aspect_ratio = match payload.aspect_ratio.as_deref().unwrap_or("16:9") {
        "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" => payload.aspect_ratio.as_deref().unwrap_or("16:9"),
        _ => return Err("Aspect ratio video tidak didukung.".to_owned()),
    };
    let resolution = match payload.resolution.as_deref().unwrap_or("720p") {
        "480p" | "720p" | "1080p" => payload.resolution.as_deref().unwrap_or("720p"),
        _ => return Err("Resolusi video tidak didukung.".to_owned()),
    };

    let client = http_client(Duration::from_secs(30))?;
    let mut video_body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution
    });
    if let Some(image) = payload.image.as_deref() {
        let image = image.trim();
        if image.len() > 28 * 1024 * 1024
            || !(image.starts_with("data:image/png;base64,")
                || image.starts_with("data:image/jpeg;base64,")
                || image.starts_with("data:image/webp;base64,"))
        {
            return Err("Gambar referensi video harus PNG, JPEG, atau WebP dan berukuran maksimum 20 MiB.".to_owned());
        }
        video_body["image"] = serde_json::json!({ "url": image });
    }
    let response = client
        .post(format!("{ROUTER_BASE}/videos/generations"))
        .bearer_auth(&key)
        .json(&video_body)
        .send()
        .await
        .map_err(|error| format!("Pengiriman tugas video ke 9Router gagal: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("9Router menolak pembuatan video (HTTP {status}): {}", detail.chars().take(1200).collect::<String>()));
    }
    let connection_id = response.headers()
        .get("x-9router-connection-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let created: serde_json::Value = response.json().await
        .map_err(|error| format!("Respons awal pembuatan video tidak valid: {error}"))?;
    let request_id = created.get("request_id").and_then(|value| value.as_str())
        .ok_or_else(|| {
            if created.get("video").and_then(|video| video.get("url")).is_some() {
                "9Router mengembalikan video langsung; format ini belum didukung oleh jalur asynchronous.".to_owned()
            } else {
                format!("9Router tidak mengembalikan request_id: {}", created)
            }
        })?;
    if request_id.is_empty() || request_id.len() > 256 || !request_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("ID tugas video dari 9Router tidak valid.".to_owned());
    }

    let _ = app.emit("azalea:video_progress", serde_json::json!({
        "requestId": request_id, "status": "pending", "progress": 0
    }));
    for attempt in 0..180u32 {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let mut poll = client
            .get(format!("{ROUTER_BASE}/videos/{request_id}"))
            .bearer_auth(&key);
        if let Some(ref connection_id) = connection_id {
            poll = poll.header("x-connection-id", connection_id);
        }
        let poll_response = poll.send().await
            .map_err(|error| format!("Pemeriksaan status video gagal: {error}"))?;
        let poll_status = poll_response.status();
        if !poll_status.is_success() {
            let detail = poll_response.text().await.unwrap_or_default();
            return Err(format!("Pemeriksaan status video mengembalikan HTTP {poll_status}: {}", detail.chars().take(900).collect::<String>()));
        }
        let state: serde_json::Value = poll_response.json().await
            .map_err(|error| format!("Status tugas video tidak valid: {error}"))?;
        let job_status = state.get("status").and_then(|value| value.as_str()).unwrap_or("unknown");
        let progress = state.get("progress").and_then(|value| value.as_u64()).map(|value| value.min(100));
        let _ = app.emit("azalea:video_progress", serde_json::json!({
            "requestId": request_id, "status": job_status, "progress": progress
        }));
        match job_status {
            "failed" | "error" | "cancelled" => {
                let detail = state.get("error")
                    .and_then(|error| error.get("message").or(Some(error)))
                    .map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string()))
                    .unwrap_or_else(|| "Provider gagal membuat video.".to_owned());
                return Err(format!("Pembuatan video gagal: {detail}"));
            }
            "done" | "completed" | "succeeded" => {
                let url = state.get("video").and_then(|video| video.get("url")).and_then(|value| value.as_str())
                    .or_else(|| state.get("url").and_then(|value| value.as_str()))
                    .ok_or_else(|| "Tugas video selesai tetapi URL MP4 tidak tersedia.".to_owned())?;
                let safe_url = validate_public_image_url(url).await?;
                let actual_duration = state.get("video").and_then(|video| video.get("duration"))
                    .and_then(|value| value.as_u64()).map(|value| value.min(u8::MAX as u64) as u8);
                let _ = app.emit("azalea:video_progress", serde_json::json!({
                    "requestId": request_id, "status": "done", "progress": 100
                }));
                return Ok(GeneratedVideo {
                    url: safe_url.to_string(),
                    model: model.to_owned(),
                    duration: actual_duration.or(Some(duration)),
                });
            }
            _ => {}
        }
    }
    Err("Pembuatan video melewati batas tunggu 15 menit. Tugas mungkin masih berjalan di 9Router; periksa dashboard sebelum mengirim ulang agar tidak membuat tagihan ganda.".to_owned())
}

#[tauri::command]
pub async fn disconnect_9router(credentials: State<'_, RouterCredentials>) -> Result<(), String> {
    *credentials.0.lock().await = None;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn router_chat_start(
    app: tauri::AppHandle,
    active: State<'_, crate::ollama::ActiveStreams>,
    credentials: State<'_, RouterCredentials>,
    payload: RouterChatRequest,
) -> Result<String, String> {
    if payload.model.trim().is_empty() || payload.model.len() > 512 {
        return Err("Model 9Router tidak valid.".to_owned());
    }

    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect untuk memasukkan API key.".to_owned())?;

    let id = format!(
        "9router-{}-{}",
        payload.model,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    );
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let active_streams = active.0.clone();
    active_streams.lock().await.insert(id.clone(), cancel_tx);

    if let Err(error) = app.emit(
        "azalea:chat_started",
        serde_json::json!({ "id": id, "model": payload.model }),
    ) {
        active_streams.lock().await.remove(&id);
        return Err(format!("Gagal memulai stream 9Router: {error}"));
    }

    tokio::spawn(router_worker(
        app,
        id.clone(),
        payload,
        key,
        cancel_rx,
        active_streams,
    ));
    Ok(id)
}


#[derive(Debug, Default, PartialEq, Serialize, Clone)]
struct ProviderTokenUsage {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
}

fn parse_token_usage(value: &serde_json::Value) -> Option<ProviderTokenUsage> {
    let usage = value.get("usage")?;
    // Normalize OpenAI, Anthropic-translated and Gemini usage field names.
    let prompt = usage.get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokenCount"))
        .or_else(|| usage.get("inputTokenCount"))
        .and_then(|v| v.as_u64());
    let completion = usage.get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("candidatesTokenCount"))
        .or_else(|| usage.get("outputTokenCount"))
        .and_then(|v| v.as_u64());
    let total = usage.get("total_tokens")
        .or_else(|| usage.get("totalTokenCount"))
        .and_then(|v| v.as_u64());
    let prompt_details = usage.get("prompt_tokens_details")
        .or_else(|| usage.get("input_tokens_details"));
    let cache_read = prompt_details.and_then(|v| v.get("cached_tokens"))
        .or_else(|| usage.get("cache_read_input_tokens"))
        .or_else(|| usage.get("cache_read_tokens"))
        .or_else(|| usage.get("cacheReadInputTokens"))
        .or_else(|| usage.get("cachedContentTokenCount"))
        .and_then(|v| v.as_u64()).unwrap_or(0);
    let cache_creation = prompt_details.and_then(|v| v.get("cache_creation_tokens"))
        .or_else(|| usage.get("cache_creation_input_tokens"))
        .or_else(|| usage.get("cache_creation_tokens"))
        .or_else(|| usage.get("cacheCreationInputTokens"))
        .and_then(|v| v.as_u64()).unwrap_or(0);
    let input_tokens = prompt.unwrap_or(0);
    let output_tokens = completion.unwrap_or(0);
    if prompt.is_none() && completion.is_none() && total.is_none() && cache_read == 0 && cache_creation == 0 {
        return None;
    }
    Some(ProviderTokenUsage {
        input_tokens,
        output_tokens,
        total_tokens: total.unwrap_or(input_tokens.saturating_add(output_tokens)),
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_creation,
    })
}

#[derive(Debug, Default, PartialEq)]
struct ParsedCompletionChunk {
    content: Option<String>,
    has_thinking: bool,
    finished: bool,
    usage: Option<ProviderTokenUsage>,
}

fn content_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    let parts = value.as_array()?;
    let text = parts.iter().filter_map(|part| {
        part.as_str().or_else(|| part.get("text").and_then(|value| value.as_str()))
    }).collect::<Vec<_>>().join("");
    if text.is_empty() { None } else { Some(text) }
}

/// Normalize the common OpenAI-compatible completion shapes:
/// streaming delta.content, non-streaming message.content, and text-part arrays.
/// Reasoning is detected only to drive a neutral UI status; raw chain-of-thought
/// is deliberately never forwarded to the conversation UI.
fn parse_completion_chunk(value: &serde_json::Value) -> Result<ParsedCompletionChunk, String> {
    if let Some(error) = value.get("error") {
        let detail = error.as_str().map(str::to_owned).unwrap_or_else(|| error.to_string());
        return Err(format!("9Router: {detail}"));
    }

    let choice = value.get("choices").and_then(|choices| choices.get(0));
    let delta = choice.and_then(|choice| choice.get("delta"));
    let message = choice.and_then(|choice| choice.get("message"));
    let content_value = delta.and_then(|delta| delta.get("content"))
        .or_else(|| message.and_then(|message| message.get("content")))
        .or_else(|| choice.and_then(|choice| choice.get("text")));
    let content = content_value.and_then(content_text)
        .filter(|text| !text.trim().is_empty());

    let has_thinking = [
        delta.and_then(|delta| delta.get("reasoning")),
        delta.and_then(|delta| delta.get("reasoning_content")),
        delta.and_then(|delta| delta.get("reasoning_summary")),
        message.and_then(|message| message.get("reasoning_summary")),
    ].into_iter().flatten().any(|value| {
        value.as_str().is_some_and(|text| !text.trim().is_empty())
            || value.as_array().is_some_and(|parts| !parts.is_empty())
    });

    let finished = choice.and_then(|choice| choice.get("finish_reason"))
        .and_then(|reason| reason.as_str())
        .is_some_and(|reason| !reason.is_empty());

    Ok(ParsedCompletionChunk { content, has_thinking, finished, usage: parse_token_usage(value) })
}

fn build_chat_completion_body(
    model: &str,
    messages: Vec<serde_json::Value>,
    _options: &RouterOptions,
) -> serde_json::Value {
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    body
}

fn process_sse_line(
    app: &tauri::AppHandle,
    id: &str,
    model: &str,
    line: &[u8],
    has_content: &mut bool,
    saw_finish_reason: &mut bool,
) -> Result<Option<bool>, String> {
    let line = String::from_utf8_lossy(line).trim().to_owned();
    let Some(data) = line.strip_prefix("data:") else { return Ok(None) };
    let data = data.trim();
    if data.is_empty() { return Ok(None); }
    if data == "[DONE]" { return Ok(Some(true)); }

    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|error| format!("Data stream 9Router tidak valid: {error}"))?;
    let parsed = parse_completion_chunk(&value)?;
    if parsed.finished {
        *saw_finish_reason = true;
    }
    if let Some(content) = parsed.content {
        *has_content = true;
        let _ = app.emit("azalea:chat_chunk", serde_json::json!({
            "id": id,
            "model": model,
            "content": content,
            "usage": parsed.usage
        }));
    } else if let Some(usage) = parsed.usage {
        let _ = app.emit("azalea:chat_chunk", serde_json::json!({
            "id": id,
            "model": model,
            "usage": usage
        }));
    } else if parsed.has_thinking {
        let _ = app.emit("azalea:chat_chunk", serde_json::json!({
            "id": id,
            "model": model,
            "thinking": true
        }));
    }
    Ok(None)
}

async fn router_worker(
    app: tauri::AppHandle,
    id: String,
    payload: RouterChatRequest,
    api_key: String,
    cancel: oneshot::Receiver<()>,
    active_streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
) {
    let mut messages = Vec::new();
    if let Some(prompt) = payload.skills_prompt.as_deref().filter(|prompt| !prompt.trim().is_empty()) {
        messages.push(serde_json::json!({ "role": "system", "content": prompt }));
    }
    if payload.think {
        messages.push(serde_json::json!({
            "role": "system",
            "content": "Gunakan proses analisis internal yang teliti. Jangan mengeluarkan atau menampilkan chain-of-thought mentah. Berikan jawaban akhir dengan kesimpulan dan ringkasan alasan/metode singkat yang dapat diperiksa."
        }));
    }
    for message in payload.messages {
        if let Some(images) = message.images.as_ref().filter(|images| !images.is_empty()) {
            let mut content = vec![serde_json::json!({ "type": "text", "text": message.content })];
            for (index, image) in images.iter().take(5).enumerate() {
                let mime = message.image_mime_types.as_ref()
                    .and_then(|types| types.get(index))
                    .map(String::as_str)
                    .filter(|mime| matches!(*mime, "image/png" | "image/jpeg" | "image/webp" | "image/gif"))
                    .unwrap_or("image/png");
                content.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": format!("data:{mime};base64,{image}") }
                }));
            }
            messages.push(serde_json::json!({ "role": message.role, "content": content }));
        } else {
            messages.push(serde_json::json!({ "role": message.role, "content": message.content }));
        }
    }

    // Provider models own their output budget. No local Ollama token cap is sent.
    let mut body = build_chat_completion_body(&payload.model, messages, &payload.options);

    let cancel = cancel;
    tokio::pin!(cancel);

    let result = async {
        let client = http_client(STREAM_IDLE_TIMEOUT)?;
        let request = client
            .post(format!("{ROUTER_BASE}/chat/completions"))
            .bearer_auth(&api_key)
            .json(&body)
            .send();
        tokio::pin!(request);
        let mut response = tokio::select! {
            biased;
            _ = &mut cancel => return Ok::<(), String>(()),
            response = &mut request => response
                .map_err(|error| format!("Koneksi chat 9Router gagal: {error}"))?,
        };

        if response.status() == reqwest::StatusCode::BAD_REQUEST {
            let detail = response.text().await.unwrap_or_default();
            let lower = detail.to_ascii_lowercase();
            if lower.contains("stream_options") || lower.contains("include_usage") {
                if let Some(object) = body.as_object_mut() {
                    object.remove("stream_options");
                }
                let retry = client
                    .post(format!("{ROUTER_BASE}/chat/completions"))
                    .bearer_auth(&api_key)
                    .json(&body)
                    .send();
                tokio::pin!(retry);
                response = tokio::select! {
                    biased;
                    _ = &mut cancel => return Ok::<(), String>(()),
                    response = &mut retry => response
                        .map_err(|error| format!("Retry chat 9Router tanpa stream usage gagal: {error}"))?,
                };
            } else {
                return Err(format!("9Router mengembalikan HTTP 400: {}", detail.chars().take(1000).collect::<String>()));
            }
        }

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            let detail = detail.chars().take(1000).collect::<String>();
            return Err(format!("9Router mengembalikan HTTP {status}: {detail}"));
        }

        let content_type = response.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();

        // Some OpenAI-compatible gateways silently downgrade stream=true and
        // return one regular JSON completion. Accept that shape instead of
        // finishing with an empty assistant bubble.
        if !content_type.contains("text/event-stream") {
            let raw = response.bytes().await
                .map_err(|error| format!("Respons chat 9Router gagal dibaca: {error}"))?;
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) {
                let parsed = parse_completion_chunk(&value)?;
                let content = parsed.content.ok_or_else(|| {
                    "9Router mengembalikan respons tanpa teks jawaban. Periksa model dan format respons gateway.".to_owned()
                })?;
                let _ = app.emit("azalea:chat_chunk", serde_json::json!({
                    "id": id, "model": payload.model, "content": content, "usage": parsed.usage
                }));
                return Ok(());
            }

            // A few gateways omit the SSE Content-Type header. If the body is
            // not a JSON completion, attempt the documented data: line format.
            let text = String::from_utf8_lossy(&raw);
            let mut has_content = false;
            let mut saw_finish_reason = false;
            let mut saw_done = false;
            for line in text.split_inclusive('\n') {
                if process_sse_line(&app, &id, &payload.model, line.as_bytes(), &mut has_content, &mut saw_finish_reason)?.is_some() {
                    saw_done = true;
                }
            }
            if has_content && (saw_done || saw_finish_reason) {
                return Ok(());
            }
            return Err("Respons 9Router bukan JSON completion atau SSE selesai yang dapat dibaca.".to_owned());
        }

        let mut stream = response.bytes_stream();
        let mut pending = Vec::<u8>::new();
        let mut has_content = false;
        let mut saw_finish_reason = false;
        let mut cancelled = false;
        let mut finished = false;

        loop {
            let item = tokio::select! {
                biased;
                _ = &mut cancel => {
                    cancelled = true;
                    break;
                }
                item = stream.next() => item,
            };
            let Some(item) = item else { break };
            let bytes = item.map_err(|error| format!("Stream 9Router terhenti: {error}"))?;
            pending.extend_from_slice(&bytes);

            while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                let line = pending.drain(..=newline).collect::<Vec<_>>();
                if process_sse_line(&app, &id, &payload.model, &line, &mut has_content, &mut saw_finish_reason)?.is_some() {
                    finished = true;
                    break;
                }
            }
            if finished { break; }
        }

        if !finished && !pending.is_empty() {
            if process_sse_line(&app, &id, &payload.model, &pending, &mut has_content, &mut saw_finish_reason)?.is_some() {
                finished = true;
            }
        }
        // OpenAI-compatible gateways may emit finish_reason before a final usage-only
        // chunk, followed by [DONE]. Continue reading so that cache/input/output
        // counters are not lost. A finish_reason alone is accepted at EOF.
        if !finished && saw_finish_reason {
            finished = true;
        }

        if !cancelled && !finished {
            return Err(if has_content {
                "Stream 9Router terputus sebelum model mengirim penanda selesai (finish_reason/[DONE]). Jawaban parsial dipertahankan, tetapi tidak ditandai selesai. Coba lanjutkan atau ulangi permintaan.".to_owned()
            } else {
                "Stream 9Router berakhir tanpa teks dan tanpa penanda selesai. Model mungkin hanya mengirim status reasoning, atau gateway mengembalikan format stream yang tidak kompatibel.".to_owned()
            });
        }
        Ok::<(), String>(())
    }.await;

    match result {
        Ok(()) => {
            let _ = app.emit("azalea:chat_chunk", serde_json::json!({
                "id": id, "model": payload.model, "done": true
            }));
            let _ = app.emit("azalea:chat_done", serde_json::json!({ "id": id }));
        }
        Err(message) => {
            let _ = app.emit("azalea:chat_error", serde_json::json!({
                "id": id, "code": "router_stream_error", "message": message
            }));
        }
    }
    active_streams.lock().await.remove(&id);
}


#[derive(Serialize, Clone)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

fn decode_html(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn strip_html(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    decode_html(&output).split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_attribute(tag: &str, name: &str) -> Option<String> {
    let pattern = format!("{name}=\"");
    let start = tag.find(&pattern)? + pattern.len();
    let end = tag[start..].find('"')? + start;
    Some(decode_html(&tag[start..end]))
}

fn normalize_search_url(raw: &str) -> Option<String> {
    let candidate = if raw.starts_with("//") {
        format!("https:{raw}")
    } else {
        raw.to_owned()
    };
    let parsed = Url::parse(&candidate).ok()?;
    if parsed.host_str() == Some("duckduckgo.com") && parsed.path().starts_with("/l/") {
        if let Some((_, target)) = parsed.query_pairs().find(|(key, _)| key == "uddg") {
            let target = Url::parse(&target).ok()?;
            if target.scheme() == "https" {
                return Some(target.to_string());
            }
        }
    }
    if parsed.scheme() == "https"
        && parsed.host_str().is_some()
        && parsed.host_str() != Some("duckduckgo.com")
    {
        return Some(parsed.to_string());
    }
    None
}

#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<WebSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() || query.len() > 512 || query.chars().any(char::is_control) {
        return Err("Kata kunci pencarian tidak valid.".to_owned());
    }

    let mut url = Url::parse("https://html.duckduckgo.com/html/")
        .map_err(|error| format!("URL pencarian tidak valid: {error}"))?;
    url.query_pairs_mut().append_pair("q", query);

    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 AzaleaHouse/0.2.4")
        .build()
        .map_err(|error| format!("Tidak dapat menyiapkan pencarian web: {error}"))?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Pencarian web gagal: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Mesin pencari menolak permintaan: {error}"))?;

    let html = response.text().await
        .map_err(|error| format!("Hasil pencarian tidak dapat dibaca: {error}"))?;
    let mut results = Vec::new();
    let mut cursor = 0usize;

    while results.len() < 6 {
        let Some(relative) = html[cursor..].find("class=\"result__a\"") else { break };
        let marker = cursor + relative;
        let Some(anchor_start) = html[..marker].rfind("<a") else {
            cursor = marker + 1;
            continue;
        };
        let Some(tag_end_offset) = html[marker..].find('>') else { break };
        let tag_end = marker + tag_end_offset + 1;
        let tag = &html[anchor_start..tag_end];
        let Some(href) = extract_attribute(tag, "href").and_then(|href| normalize_search_url(&href)) else {
            cursor = tag_end;
            continue;
        };
        let Some(anchor_end_offset) = html[tag_end..].find("</a>") else { break };
        let anchor_end = tag_end + anchor_end_offset;
        let title = strip_html(&html[tag_end..anchor_end]);
        let snippet = html[anchor_end..]
            .find("class=\"result__snippet\"")
            .and_then(|offset| {
                let marker = anchor_end + offset;
                let start = html[marker..].find('>')? + marker + 1;
                let end = html[start..].find("</")? + start;
                Some(strip_html(&html[start..end]))
            })
            .unwrap_or_default();

        if !title.is_empty() && !results.iter().any(|item: &WebSearchResult| item.url == href) {
            results.push(WebSearchResult { title, url: href, snippet });
        }
        cursor = anchor_end + 4;
    }

    Ok(results)
}



#[cfg(test)]
mod chat_stream_tests {
    use super::{parse_completion_chunk, ParsedCompletionChunk, ProviderTokenUsage};
    use serde_json::json;

    #[test]
    fn provider_request_does_not_include_a_local_output_token_limit() {
        let options = super::RouterOptions {};
        let body = super::build_chat_completion_body(
            "provider/model",
            vec![json!({"role": "user", "content": "hello"})],
            &options,
        );
        assert_eq!(body.get("stream").and_then(|value| value.as_bool()), Some(true));
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("max_completion_tokens").is_none());
        assert!(body.get("temperature").is_none());
        assert!(body.get("top_p").is_none());
    }

    #[test]
    fn parses_openai_streaming_delta_content() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"delta": {"content": "Halo"}, "finish_reason": null}]
        })).expect("valid delta");
        assert_eq!(parsed, ParsedCompletionChunk {
            content: Some("Halo".to_owned()),
            has_thinking: false,
            finished: false,
            usage: None,
        });
    }

    #[test]
    fn parses_text_parts_from_array_content() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"delta": {"content": [
                {"type": "text", "text": "Halo"},
                {"type": "text", "text": " dunia"}
            ]}}]
        })).expect("valid array content");
        assert_eq!(parsed.content.as_deref(), Some("Halo dunia"));
    }

    #[test]
    fn parses_non_streaming_message_content() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"message": {"role": "assistant", "content": "Jawaban"}, "finish_reason": "stop"}]
        })).expect("valid non-stream response");
        assert_eq!(parsed.content.as_deref(), Some("Jawaban"));
        assert!(parsed.finished);
    }

    #[test]
    fn detects_reasoning_without_returning_raw_reasoning_text() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"delta": {"reasoning_content": "private reasoning text"}}]
        })).expect("valid reasoning chunk");
        assert!(parsed.has_thinking);
        assert_eq!(parsed.content, None);
    }

    #[test]
    fn does_not_treat_a_partial_stream_as_finished() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"delta": {"content": "Jawaban terpotong"}, "finish_reason": null}]
        })).expect("valid partial chunk");
        assert!(parsed.content.is_some());
        assert!(!parsed.finished);
    }

    #[test]
    fn parses_gemini_style_usage_and_cache_fields() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [],
            "usage": {
                "promptTokenCount": 900,
                "candidatesTokenCount": 200,
                "totalTokenCount": 1100,
                "cachedContentTokenCount": 300
            }
        })).expect("valid Gemini usage chunk");
        assert_eq!(parsed.usage, Some(ProviderTokenUsage {
            input_tokens: 900,
            output_tokens: 200,
            total_tokens: 1100,
            cache_read_tokens: 300,
            cache_creation_tokens: 0,
        }));
    }

    #[test]
    fn accepts_only_https_public_named_hosts_for_generated_image_urls() {
        assert!(super::parse_public_image_url("https://cdn.example.com/output.png").is_ok());
        assert!(super::parse_public_image_url("http://cdn.example.com/output.png").is_err());
        assert!(super::parse_public_image_url("https://127.0.0.1/private.png").is_err());
        assert!(super::parse_public_image_url("https://localhost/private.png").is_err());
        assert!(super::parse_public_image_url("https://internal.local/image.png").is_err());
        assert!(!super::is_public_ip("10.0.0.1".parse().unwrap()));
        assert!(!super::is_public_ip("169.254.1.1".parse().unwrap()));
        assert!(!super::is_public_ip("192.168.1.1".parse().unwrap()));
        assert!(super::is_public_ip("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn detects_image_mime_from_file_signatures() {
        assert_eq!(super::sniff_image_mime(b"\x89PNG\r\n\x1a\nimage", "image/jpeg"), "image/png");
        assert_eq!(super::sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0x00], "image/png"), "image/jpeg");
        assert_eq!(super::sniff_image_mime(b"GIF89aimage", "image/png"), "image/gif");
    }

    #[test]
    fn normalizes_common_image_content_types() {
        assert_eq!(super::normalize_image_mime(Some("image/jpeg")), "image/jpeg");
        assert_eq!(super::normalize_image_mime(Some("image/webp; charset=binary")), "image/webp");
        assert_eq!(super::normalize_image_mime(Some("application/octet-stream")), "image/png");
    }
    #[test]
    fn parses_provider_input_output_and_cache_usage() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [],
            "usage": {
                "prompt_tokens": 1200,
                "completion_tokens": 340,
                "total_tokens": 1540,
                "prompt_tokens_details": { "cached_tokens": 250, "cache_creation_tokens": 80 }
            }
        })).expect("valid usage-only final chunk");
        assert_eq!(parsed.usage, Some(ProviderTokenUsage {
            input_tokens: 1200,
            output_tokens: 340,
            total_tokens: 1540,
            cache_read_tokens: 250,
            cache_creation_tokens: 80,
        }));
    }
    #[test]
    fn recognizes_finish_reason_and_provider_errors() {
        let parsed = parse_completion_chunk(&json!({
            "choices": [{"delta": {}, "finish_reason": "stop"}]
        })).expect("valid finish");
        assert!(parsed.finished);
        let error = parse_completion_chunk(&json!({"error": {"message": "model unavailable"}}))
            .expect_err("provider error must fail the stream");
        assert!(error.contains("model unavailable"));
    }
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterVisionRequest {
    pub model: String,
    pub prompt: String,
    pub images: Vec<String>,
    #[serde(default)]
    pub image_mime_types: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn router_vision_describe(
    credentials: State<'_, RouterCredentials>,
    payload: RouterVisionRequest,
) -> Result<String, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect terlebih dahulu.".to_owned())?;
    if payload.model.trim().is_empty() || payload.model.len() > 512 {
        return Err("Model vision helper tidak valid.".to_owned());
    }
    if payload.images.is_empty() || payload.images.len() > 5 {
        return Err("Vision helper memerlukan 1 sampai 5 gambar per permintaan.".to_owned());
    }
    if payload.prompt.len() > 20_000 {
        return Err("Instruksi analisis gambar terlalu panjang.".to_owned());
    }

    let mut content = vec![serde_json::json!({
        "type": "text",
        "text": if payload.prompt.trim().is_empty() {
            "Deskripsikan gambar secara akurat. Sebutkan teks yang terbaca, objek, susunan, dan detail penting. Bedakan hal yang terlihat dari dugaan."
        } else {
            payload.prompt.as_str()
        }
    })];

    for (index, image) in payload.images.iter().enumerate() {
        if image.is_empty() || image.len() > 24 * 1024 * 1024 {
            return Err("Ukuran gambar tidak valid atau melebihi 24 MiB dalam Base64.".to_owned());
        }
        let mime = payload.image_mime_types.get(index)
            .map(String::as_str)
            .unwrap_or("image/png");
        let mime = match mime {
            "image/jpeg" | "image/webp" | "image/gif" | "image/png" => mime,
            _ => "image/png",
        };
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": format!("data:{mime};base64,{image}") }
        }));
    }

    let body = serde_json::json!({
        "model": payload.model,
        "messages": [{
            "role": "user",
            "content": content
        }],
        "stream": false
    });

    let response = http_client(STREAM_IDLE_TIMEOUT)?
        .post(format!("{ROUTER_BASE}/chat/completions"))
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Vision helper 9Router gagal dihubungi: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "Model vision helper menolak gambar (HTTP {status}): {}",
            detail.chars().take(900).collect::<String>()
        ));
    }

    let value: serde_json::Value = response.json().await
        .map_err(|error| format!("Respons vision helper tidak valid: {error}"))?;
    let message = value.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .ok_or_else(|| "Vision helper tidak mengembalikan deskripsi gambar.".to_owned())?;

    let description = if let Some(text) = message.as_str() {
        text.to_owned()
    } else if let Some(parts) = message.as_array() {
        parts.iter()
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };
    if description.trim().is_empty() {
        return Err("Vision helper mengembalikan deskripsi kosong.".to_owned());
    }
    Ok(description)
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterImageRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub size: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub mime_type: String,
    pub base64: String,
}

fn parse_public_image_url(raw: &str) -> Result<(Url, String, u16), String> {
    let url = Url::parse(raw).map_err(|_| "URL hasil gambar dari provider tidak valid.".to_owned())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err("URL gambar harus menggunakan HTTPS tanpa kredensial di URL.".to_owned());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("URL gambar hanya boleh memakai port HTTPS standar (443).".to_owned());
    }
    let host = url.host_str().ok_or_else(|| "URL gambar tidak memiliki host.".to_owned())?.to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local")
        || host.ends_with(".internal") || host.ends_with(".lan") || host.ends_with(".test")
        || host.ends_with(".invalid")
    {
        return Err("Host URL gambar lokal/private tidak diizinkan.".to_owned());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if !is_public_ip(ip) {
            return Err("URL gambar mengarah ke alamat IP non-publik.".to_owned());
        }
    }
    let port = url.port_or_known_default().unwrap_or(443);
    Ok((url, host, port))
}

fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(addr) => {
            let o = addr.octets();
            let carrier_grade_nat = o[0] == 100 && (64..=127).contains(&o[1]);
            let protocol_assignment = o[0] == 192 && o[1] == 0 && o[2] == 0;
            let benchmark = o[0] == 198 && (o[1] == 18 || o[1] == 19);
            let documentation = (o[0] == 192 && o[1] == 0 && o[2] == 2)
                || (o[0] == 198 && o[1] == 51 && o[2] == 100)
                || (o[0] == 203 && o[1] == 0 && o[2] == 113);
            !(addr.is_private() || addr.is_loopback() || addr.is_link_local()
                || addr.is_broadcast() || addr.is_unspecified() || addr.is_multicast()
                || carrier_grade_nat || protocol_assignment || benchmark || documentation
                || o[0] == 0 || o[0] >= 240)
        }
        std::net::IpAddr::V6(addr) => {
            if let Some(mapped) = addr.to_ipv4_mapped() {
                return is_public_ip(std::net::IpAddr::V4(mapped));
            }
            !(addr.is_loopback() || addr.is_unspecified() || addr.is_multicast()
                || addr.is_unique_local() || addr.is_unicast_link_local())
        }
    }
}

async fn resolve_public_image_url(raw: &str) -> Result<(Url, String, std::net::SocketAddr), String> {
    let (url, host, port) = parse_public_image_url(raw)?;
    let addresses = if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        vec![std::net::SocketAddr::new(ip, port)]
    } else {
        tokio::net::lookup_host((host.as_str(), port)).await
            .map_err(|_| "DNS URL gambar tidak dapat diverifikasi; unduhan dibatalkan.".to_owned())?
            .collect::<Vec<_>>()
    };
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("URL gambar mengarah ke alamat jaringan non-publik atau DNS tidak aman.".to_owned());
    }
    let address = addresses.into_iter().next().ok_or_else(|| "URL gambar tidak memiliki alamat tujuan.".to_owned())?;
    Ok((url, host, address))
}

async fn validate_public_image_url(raw: &str) -> Result<Url, String> {
    let (url, _, _) = resolve_public_image_url(raw).await?;
    Ok(url)
}

fn public_image_client(host: &str, address: std::net::SocketAddr) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, address)
        .user_agent("AzaleaHouse/0.2.4")
        .build()
        .map_err(|error| format!("Tidak dapat menyiapkan unduhan hasil gambar: {error}"))
}

async fn read_response_limited(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|length| length > limit as u64) {
        return Err(format!("Payload gambar provider melebihi batas {} MiB.", limit / (1024 * 1024)));
    }
    let mut stream = response.bytes_stream();
    let mut output = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Data gambar gagal dibaca: {error}"))?;
        if output.len().saturating_add(chunk.len()) > limit {
            return Err(format!("Payload gambar provider melebihi batas {} MiB.", limit / (1024 * 1024)));
        }
        output.extend_from_slice(&chunk);
    }
    if output.is_empty() {
        return Err("File gambar provider kosong.".to_owned());
    }
    Ok(output)
}

fn normalize_image_mime(raw: Option<&str>) -> &'static str {
    match raw.map(|value| value.split(';').next().unwrap_or("").trim().to_ascii_lowercase()).as_deref() {
        Some("image/jpeg") => "image/jpeg",
        Some("image/webp") => "image/webp",
        Some("image/gif") => "image/gif",
        _ => "image/png",
    }
}

fn sniff_image_mime(bytes: &[u8], fallback: &'static str) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
    else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) { "image/jpeg" }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { "image/gif" }
    else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { "image/webp" }
    else { fallback }
}
fn is_codex_image_model(model: &str) -> bool {
    let id = model.to_ascii_lowercase();
    id.starts_with("cx/")
        || id.contains("codex")
        || id.contains("gpt-5.4-image")
        || id.contains("gpt-image")
}

fn codex_image_result(value: &serde_json::Value) -> Option<(String, Option<String>)> {
    fn visit(value: &serde_json::Value) -> Option<(String, Option<String>)> {
        if let Some(object) = value.as_object() {
            if object.get("type").and_then(|v| v.as_str()) == Some("image_generation_call") {
                if let Some(result) = object.get("result").and_then(|v| v.as_str()) {
                    if !result.trim().is_empty() {
                        let format = object.get("output_format").and_then(|v| v.as_str()).map(str::to_owned);
                        return Some((result.to_owned(), format));
                    }
                }
            }
            for child in object.values() {
                if let Some(found) = visit(child) { return Some(found); }
            }
        } else if let Some(array) = value.as_array() {
            for child in array {
                if let Some(found) = visit(child) { return Some(found); }
            }
        }
        None
    }
    visit(value)
}

fn decode_codex_image_result(encoded: &str, output_format: Option<&str>) -> Result<GeneratedImage, String> {
    let mut encoded = encoded.trim();
    let mut mime = match output_format.map(str::to_ascii_lowercase).as_deref() {
        Some("jpeg") | Some("jpg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/png",
    };
    if let Some((header, data)) = encoded.split_once(',') {
        if header.starts_with("data:image/") {
            mime = normalize_image_mime(Some(header.trim_start_matches("data:")));
            encoded = data;
        }
    }
    if encoded.is_empty() || encoded.len() > 32 * 1024 * 1024 {
        return Err("Hasil gambar Codex kosong atau melebihi batas Base64 32 MiB.".to_owned());
    }
    let bytes = STANDARD.decode(encoded)
        .map_err(|_| "Data gambar Codex bukan Base64 yang valid.".to_owned())?;
    if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
        return Err("Ukuran gambar Codex kosong atau melebihi batas 24 MiB.".to_owned());
    }
    let detected = sniff_image_mime(&bytes, mime);
    Ok(GeneratedImage { mime_type: detected.to_owned(), base64: STANDARD.encode(bytes) })
}

fn codex_image_result_from_sse(raw: &[u8]) -> Result<GeneratedImage, String> {
    let text = String::from_utf8_lossy(raw);
    let mut last_error: Option<String> = None;
    for line in text.lines() {
        let Some(data) = line.trim().strip_prefix("data:") else { continue };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" { continue; }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else { continue };
        if let Some((encoded, format)) = codex_image_result(&value) {
            return decode_codex_image_result(&encoded, format.as_deref());
        }
        if let Some(error) = value.get("error") {
            last_error = Some(error.as_str().map(str::to_owned).unwrap_or_else(|| error.to_string()));
        }
        if let Some(error) = value.pointer("/response/error") {
            last_error = Some(error.get("message").and_then(|v| v.as_str())
                .map(str::to_owned).unwrap_or_else(|| error.to_string()));
        }
    }
    Err(last_error.unwrap_or_else(|| "Stream Codex tidak menyertakan hasil image_generation_call final. Pastikan akun 9Router memiliki akses image generation Codex.".to_owned()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn router_generate_image(
    credentials: State<'_, RouterCredentials>,
    payload: RouterImageRequest,
) -> Result<GeneratedImage, String> {
    let key = credentials.0.lock().await.clone()
        .ok_or_else(|| "9Router belum tersambung. Gunakan /connect terlebih dahulu.".to_owned())?;
    if payload.model.trim().is_empty() || payload.model.len() > 512 {
        return Err("Model image generation tidak valid.".to_owned());
    }
    let prompt = payload.prompt.trim();
    if prompt.is_empty() || prompt.len() > 20_000 || prompt.chars().any(char::is_control) {
        return Err("Prompt gambar kosong, terlalu panjang, atau mengandung karakter kontrol.".to_owned());
    }
    let size = match payload.size.as_deref().unwrap_or("1024x1024") {
        "1024x1024" => "1024x1024",
        "1024x1536" => "1024x1536",
        "1536x1024" => "1536x1024",
        _ => return Err("Ukuran gambar tidak didukung.".to_owned()),
    };

    let client = http_client(Duration::from_secs(10 * 60))?;
    let codex_model = is_codex_image_model(&payload.model);
    let mut request_body = serde_json::json!({
        "model": payload.model,
        "prompt": prompt,
        "size": size,
        "n": 1,
        "response_format": "b64_json"
    });
    if codex_model {
        // The 9Router Codex image adapter streams Responses API events.
        request_body["stream"] = serde_json::json!(true);
        request_body["output_format"] = serde_json::json!("png");
    }
    let mut response = client
        .post(format!("{ROUTER_BASE}/images/generations"))
        .bearer_auth(&key)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("Permintaan image generation gagal: {error}"))?;
    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        let detail = response.text().await.unwrap_or_default();
        let lower = detail.to_ascii_lowercase();
        if lower.contains("response_format") || lower.contains("unknown field") || lower.contains("unsupported parameter") {
            request_body.as_object_mut().map(|body| body.remove("response_format"));
            response = client
                .post(format!("{ROUTER_BASE}/images/generations"))
                .bearer_auth(&key)
                .json(&request_body)
                .send()
                .await
                .map_err(|error| format!("Percobaan kedua image generation gagal: {error}"))?;
        } else {
            return Err(format!("Endpoint image generation 9Router menolak permintaan (HTTP 400): {}", detail.chars().take(1200).collect::<String>()));
        }
    }

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "Endpoint image generation 9Router menolak model atau permintaan (HTTP {status}): {}",
            detail.chars().take(1200).collect::<String>()
        ));
    }

    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if content_type.contains("text/event-stream") {
        let raw = read_response_limited(response, 40 * 1024 * 1024).await?;
        return codex_image_result_from_sse(&raw);
    }
    if content_type.starts_with("image/") || content_type == "application/octet-stream" {
        let raw = read_response_limited(response, 24 * 1024 * 1024).await?;
        let fallback = normalize_image_mime(Some(content_type.as_str()));
        let mime = sniff_image_mime(&raw, fallback);
        return Ok(GeneratedImage { mime_type: mime.to_owned(), base64: STANDARD.encode(raw) });
    }

    let raw = read_response_limited(response, 40 * 1024 * 1024).await?;
    let value: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Respons image generation tidak valid: {error}"))?;
    if let Some((encoded, format)) = codex_image_result(&value) {
        return decode_codex_image_result(&encoded, format.as_deref());
    }
    let first = value.get("data")
        .and_then(|data| data.get(0))
        .ok_or_else(|| "Endpoint image generation tidak mengembalikan gambar. Pastikan model mendukung /images/generations.".to_owned())?;

    let mime_type = normalize_image_mime(first.get("mime_type").and_then(|value| value.as_str()));
    let encoded = if let Some(encoded) = first.get("b64_json").and_then(|value| value.as_str()) {
        if encoded.is_empty() || encoded.len() > 32 * 1024 * 1024 {
            return Err("Hasil gambar kosong atau melebihi batas ukuran 32 MiB.".to_owned());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| "Hasil Base64 gambar dari provider tidak valid.".to_owned())?;
        if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
            return Err("Ukuran gambar hasil provider kosong atau melebihi 24 MiB.".to_owned());
        }
        let detected_mime = sniff_image_mime(&bytes, mime_type);
        return Ok(GeneratedImage { mime_type: detected_mime.to_owned(), base64: STANDARD.encode(bytes) });
    } else if let Some(url) = first.get("url").and_then(|value| value.as_str()) {
        let (mut current_url, mut current_host, mut current_address) = resolve_public_image_url(url).await?;
        let mut image_client = public_image_client(&current_host, current_address)?;
        let mut image_response = image_client.get(current_url.clone()).send().await
            .map_err(|error| format!("URL hasil gambar tidak dapat diunduh: {error}"))?;
        for _ in 0..5 {
            if !image_response.status().is_redirection() { break; }
            let location = image_response.headers().get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Server hasil gambar mengirim redirect tanpa lokasi.".to_owned())?;
            let redirect_url = current_url.join(location)
                .map_err(|_| "URL redirect hasil gambar tidak valid.".to_owned())?;
            let (validated_url, redirect_host, redirect_address) = resolve_public_image_url(redirect_url.as_str()).await?;
            current_url = validated_url;
            current_host = redirect_host;
            current_address = redirect_address;
            image_client = public_image_client(&current_host, current_address)?;
            image_response = image_client.get(current_url.clone()).send().await
                .map_err(|error| format!("Redirect hasil gambar gagal diunduh: {error}"))?;
        }
        if !image_response.status().is_success() {
            return Err(format!("Server hasil gambar mengembalikan HTTP {} setelah redirect.", image_response.status()));
        }
        if image_response.content_length().is_some_and(|length| length > 24 * 1024 * 1024) {
            return Err("File gambar provider melebihi batas 24 MiB.".to_owned());
        }
        let remote_mime = normalize_image_mime(image_response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()));
        let bytes = read_response_limited(image_response, 24 * 1024 * 1024).await?;
        let detected_mime = sniff_image_mime(&bytes, remote_mime);
        return Ok(GeneratedImage { mime_type: detected_mime.to_owned(), base64: STANDARD.encode(bytes) });
    } else {
        return Err("Respons provider tidak berisi b64_json atau URL gambar. Periksa apakah model benar-benar mendukung image generation.".to_owned());
    };

    Ok(GeneratedImage { mime_type: mime_type.to_owned(), base64: encoded })
}
