//! AzaleaHouse → Ollama runtime bridge (Phase 2).
//!
//! Semua operasi privileged ke model lokal melewati command API Tauri yang terbatas:
//!   - `runtime_status`  : pemeriksaan kesehatan + status model (mapping eksplisit).
//!   - `list_models`     : model yang tersedia di mesin lokal saja.
//!   - `chat_start`      : streaming percakapan (SSE) ke frontend via event.
//!   - `chat_cancel`     : pembatalan berdasarkan token, tidak menghang.
//!   - `load_model`      : preload / keep-alive (1 jam) sesuai kebijakan.
//!
//! Backend tidak pernah menerima perintah shell string bebas; satu-satunya proses
//! eksternal adalah probe `where ollama` (path resmi) untuk memberi petunjuk.

use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::sync::{Mutex, oneshot};

/// Endpoint Ollama yang dipakai. Di masa mendatang bisa jadi konfigurasi user,
/// tapi untuk MVP selalu ke localhost default.
const OLLAMA_BASE: &str = "http://127.0.0.1:11434";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
// Limit inactivity between streamed reads, not the total generation duration.
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MODEL_OPERATION_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Satus runtime yang sama dengan kosakata di frontend (PRD 9.1).
pub type RuntimeStatus = String;

pub const STATUS_NOT_INSTALLED: &str = "not_installed";
pub const STATUS_UNAVAILABLE: &str = "runtime_unavailable";
pub const STATUS_MODEL_NOT_DOWNLOADED: &str = "model_not_downloaded";
pub const STATUS_UNLOADED: &str = "unloaded";
#[allow(dead_code)]
pub const STATUS_LOADING: &str = "loading";
pub const STATUS_READY: &str = "ready";
#[allow(dead_code)]
pub const STATUS_THINKING: &str = "thinking";
#[allow(dead_code)]
pub const STATUS_GENERATING: &str = "generating";
#[allow(dead_code)]
pub const STATUS_UNLOADING: &str = "unloading";
pub const STATUS_ERROR: &str = "error";

/// Ringkasan model dari `/api/tags` + dukungan fitur yang terdeteksi.
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct ModelMeta {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub thinking_supported: bool,
    pub vision_supported: bool,
    pub note: String,
}

/// Progress reported by Ollama's /api/pull stream. Percent refers to the
/// currently reported layer when total/completed exist, not estimated RAM load time.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPullProgress {
    pub model: String,
    pub status: String,
    pub digest: Option<String>,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub percent: Option<f32>,
    pub error: Option<String>,
}

/// Payload chat dari frontend. Diterima sebagai DTO ketat (bukan string mentah).
#[derive(Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessageIn>,
    pub think: bool,
    #[serde(rename = "runtimePolicy", default = "default_runtime_policy")]
    pub runtime_policy: String,
    pub options: ChatOptions,
}

fn default_runtime_policy() -> String {
    "auto".to_owned()
}

fn keep_alive_for_policy(runtime_policy: &str) -> serde_json::Value {
    if runtime_policy == "manual" {
        // Ollama API supports a negative number to keep the model loaded indefinitely.
        serde_json::json!(-1)
    } else {
        serde_json::json!("1h")
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessageIn {
    pub role: String,
    pub content: String,
    /// Base64-encoded images (untuk vision pipeline). Kosong untuk teks saja.
    #[serde(default)]
    pub images: Option<Vec<String>>,
}

#[derive(Deserialize, Clone, Default)]
pub struct ChatOptions {
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub num_ctx: Option<u32>,
    #[serde(default)]
    pub num_predict: Option<i32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub top_k: Option<i32>,
    #[serde(default)]
    pub repeat_penalty: Option<f32>,
    #[serde(default)]
    pub stop: Option<Vec<String>>,
    #[serde(default)]
    pub seed: Option<i32>,
}

/// Event yang di-_emit_ ke frontend per potongan.
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct ChatChunk {
    pub id: String,
    pub model: String,
    pub thinking: Option<String>,
    pub content: Option<String>,
}
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct ChatDone {
    pub id: String,
    pub prompt_eval: Option<PromptEval>,
    pub eval: Option<EvalStats>,
}
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct PromptEval {
    pub total: u32,
    pub tokens_per_second: f32,
}
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct EvalStats {
    pub total: u32,
    pub tokens_per_second: f32,
}
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub struct ChatError {
    pub id: String,
    pub code: String,
    pub message: String,
}

/// Shared registry lets each worker remove its entry on every completion path.
pub struct ActiveStreams(pub Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>);

/// Serializes model load/unload transitions against the start of a new chat.
pub struct RuntimeOperationLock(pub Arc<Mutex<()>>);

fn has_active_chat_streams(active_stream_count: usize) -> bool {
    active_stream_count > 0
}

/// Short bounded requests: runtime status and model-list metadata.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .no_gzip()
        .build()
        .expect("reqwest client")
}

/// Streaming requests have no total deadline; timeout applies only when no bytes
/// arrive for the configured interval. Long model generation is therefore allowed.
fn stream_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(STREAM_IDLE_TIMEOUT)
        .no_gzip()
        .build()
        .expect("reqwest streaming client")
}

/// Loading/unloading a local model can take a while; still bound stalled reads.
fn model_operation_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(MODEL_OPERATION_IDLE_TIMEOUT)
        .no_gzip()
        .build()
        .expect("reqwest model-operation client")
}

async fn remove_active_stream(
    active_streams: &Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    id: &str,
) {
    active_streams.lock().await.remove(id);
}

/// Periksa apakah binary `ollama` ada di PATH (untuk petunjuk, bukan eksekusi).
fn probe_ollama_on_path() -> bool {
    let res = std::process::Command::new("cmd")
        .args(["/C", "where ollama"])
        .output()
        .ok();
    matches!(res, Some(o) if o.status.success())
}

#[tauri::command]
pub async fn runtime_status(model: Option<String>) -> RuntimeStatus {
    let http = client();

    // 1) Apakah layanan Ollama mendengar?
    let probe = http.get(format!("{OLLAMA_BASE}/api/ps")).send().await;
    match probe {
        Ok(resp) => {
            // Service up. Cek apakah model kami sudah termuat di RAM.
            if let Ok(ps) = resp.json::<serde_json::Value>().await {
                let running = ps
                    .get("models")
                    .and_then(|m| m.as_array())
                    .map(|arr| {
                        arr.iter().any(|x| {
                            x.get("name")
                                .and_then(|n| n.as_str())
                                .map(|name| {
                                    let wanted = model.as_deref().unwrap_or_default();
                                    name == wanted || name.starts_with(&format!("{wanted}:"))
                                })
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                if running {
                    return STATUS_READY.to_owned();
                }
                if let Some(m) = model {
                    // Service up tapi model belum di-pull → belum bisa dimuat.
                    let tags = http.get(format!("{OLLAMA_BASE}/api/tags")).send().await;
                    if let Ok(t) = tags {
                        if let Ok(val) = t.json::<serde_json::Value>().await {
                            let has = val
                                .get("models")
                                .and_then(|m| m.as_array())
                                .map(|arr| {
                                    arr.iter().any(|x| {
                                        x.get("name")
                                            .and_then(|n| n.as_str())
                                            .map(|name| {
                                                name == m.as_str()
                                                    || name.starts_with(&format!("{}:", m.as_str()))
                                            })
                                            .unwrap_or(false)
                                    })
                                })
                                .unwrap_or(false);
                            if !has {
                                return STATUS_MODEL_NOT_DOWNLOADED.to_owned();
                            }
                        }
                    }
                }
                return STATUS_UNLOADED.to_owned();
            }
            STATUS_ERROR.to_owned()
        }
        Err(ref e) if is_conn_refused(e) => {
            if probe_ollama_on_path() {
                STATUS_UNAVAILABLE.to_owned()
            } else {
                STATUS_NOT_INSTALLED.to_owned()
            }
        }
        Err(_) => STATUS_ERROR.to_owned(),
    }
}

fn is_conn_refused(e: &reqwest::Error) -> bool {
    if let Some(ce) = e.source().and_then(|s| s.downcast_ref::<std::io::Error>()) {
        return ce.kind() == std::io::ErrorKind::ConnectionRefused
            || ce.to_string().to_lowercase().contains("connection refused");
    }
    false
}

#[tauri::command]
pub async fn list_models() -> Result<Vec<ModelMeta>, String> {
    let http = client();
    let resp = http
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi Ollama: {e}"))?;

    let val: serde_json::Value = resp.json().await.map_err(|e| format!("Respons tidak valid: {e}"))?;
    let arr = val.get("models").and_then(|m| m.as_array()).ok_or("Tidak ada model")?;

    let mut out = Vec::new();
    for m in arr {
        let name = m.get("name").and_then(|n| n.as_str()).unwrap_or("?").to_owned();
        let size = m.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
        let (thinking, vision, note) = infer_caps(&name);
        out.push(ModelMeta {
            id: name.clone(),
            name,
            size,
            thinking_supported: thinking,
            vision_supported: vision,
            note,
        });
    }
    Ok(out)
}


/// Permanently delete an installed model from the user's local Ollama store.
/// Only exact model names currently returned by /api/tags are accepted.
#[tauri::command]
pub async fn delete_model(model: String) -> Result<(), String> {
    let model = model.trim().to_owned();
    if !valid_model_reference(&model) {
        return Err("Nama model tidak valid.".to_owned());
    }

    let http = client();
    let tags_response = http
        .get(format!("{OLLAMA_BASE}/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Gagal membaca model terpasang di Ollama: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Ollama gagal mengembalikan daftar model: {error}"))?;
    let tags: serde_json::Value = tags_response
        .json()
        .await
        .map_err(|error| format!("Respons daftar model Ollama tidak valid: {error}"))?;
    let installed = tags
        .get("models")
        .and_then(|models| models.as_array())
        .is_some_and(|models| {
            models.iter().any(|entry| {
                entry.get("name").and_then(|name| name.as_str()) == Some(model.as_str())
            })
        });
    if !installed {
        return Err(format!("Model {model} tidak ditemukan pada daftar model Ollama terpasang."));
    }

    let response = http
        .delete(format!("{OLLAMA_BASE}/api/delete"))
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .map_err(|error| format!("Gagal mengirim permintaan hapus model ke Ollama: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Ollama menolak penghapusan model (HTTP {status}): {body}"));
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
        if let Some(message) = value.get("error").and_then(|value| value.as_str()) {
            return Err(format!("Ollama gagal menghapus model: {message}"));
        }
    }
    Ok(())
}

fn valid_model_reference(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.len() <= 180
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains("//")
        && !name.contains("..")
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '_' | '-' | '.' | ':' | '/' | '@')
        })
}

fn emit_model_pull_error(app: &tauri::AppHandle, model: &str, message: &str) {
    let _ = app.emit(
        "azalea:model_pull_progress",
        ModelPullProgress {
            model: model.to_owned(),
            status: "error".to_owned(),
            digest: None,
            completed: None,
            total: None,
            percent: None,
            error: Some(message.to_owned()),
        },
    );
}

fn process_model_pull_line(
    app: &tauri::AppHandle,
    model: &str,
    line: &[u8],
) -> Result<bool, String> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(false);
    }
    let value: serde_json::Value = serde_json::from_slice(line)
        .map_err(|error| format!("Respons progres Ollama tidak valid: {error}"))?;
    if let Some(message) = value.get("error").and_then(|field| field.as_str()) {
        emit_model_pull_error(app, model, message);
        return Err(message.to_owned());
    }

    let status = value
        .get("status")
        .and_then(|field| field.as_str())
        .unwrap_or("Memproses unduhan")
        .to_owned();
    let digest = value.get("digest").and_then(|field| field.as_str()).map(str::to_owned);
    let completed = value.get("completed").and_then(|field| field.as_u64());
    let total = value.get("total").and_then(|field| field.as_u64());
    let percent = match (completed, total) {
        (Some(done), Some(total)) if total > 0 => {
            Some((done.min(total) as f64 / total as f64 * 100.0) as f32)
        }
        _ => None,
    };
    let is_success = status.eq_ignore_ascii_case("success");

    let _ = app.emit(
        "azalea:model_pull_progress",
        ModelPullProgress {
            model: model.to_owned(),
            status,
            digest,
            completed,
            total,
            percent: if is_success { Some(100.0) } else { percent },
            error: None,
        },
    );
    Ok(is_success)
}

/// Download/pull a user-selected model through Ollama's local API.
/// No shell command is constructed; pulling begins only after an explicit UI action.
#[tauri::command]
pub async fn pull_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    let model = model.trim().to_owned();
    if !valid_model_reference(&model) {
        return Err(
            "Nama model tidak valid. Gunakan referensi Ollama seperti qwen3:8b atau hf.co/pemilik/model:tag."
                .to_owned(),
        );
    }

    let response = stream_client()
        .post(format!("{OLLAMA_BASE}/api/pull"))
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|error| {
            let message = if is_conn_refused(&error) {
                "Ollama tidak dapat dihubungi. Pastikan Ollama sudah berjalan.".to_owned()
            } else {
                format!("Gagal memulai unduhan model dari Ollama: {error}")
            };
            emit_model_pull_error(&app, &model, &message);
            message
        })?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let message = extract_ollama_error(&text)
            .unwrap_or_else(|| format!("Ollama menolak unduhan model (HTTP {status}): {text}"));
        emit_model_pull_error(&app, &model, &message);
        return Err(message);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::<u8>::new();
    let mut received_success = false;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let message = format!("Unduhan model terputus: {error}. Ollama dapat melanjutkan bagian yang sudah diunduh saat dicoba lagi.");
                emit_model_pull_error(&app, &model, &message);
                return Err(message);
            }
        };
        buffer.extend_from_slice(&chunk);

        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline).collect();
            match process_model_pull_line(&app, &model, &line[..line.len().saturating_sub(1)]) {
                Ok(true) => received_success = true,
                Ok(false) => {}
                Err(message) => return Err(message),
            }
        }
    }

    if !buffer.is_empty() {
        match process_model_pull_line(&app, &model, &buffer) {
            Ok(true) => received_success = true,
            Ok(false) => {}
            Err(message) => return Err(message),
        }
    }

    if !received_success {
        let message = "Unduhan model berhenti sebelum Ollama mengonfirmasi status success.".to_owned();
        emit_model_pull_error(&app, &model, &message);
        return Err(message);
    }
    Ok(())
}

/// Heuristik dukungan fitur berdasarkan nama model — diverifikasi manual di Phase 0.
/// Nilainya bersumber dari daftar model Ollama, bukan dianggap otomatis.
fn infer_caps(name: &str) -> (bool, bool, String) {
    let lower = name.to_ascii_lowercase();
    let thinking = lower.contains("gemma4")
        || lower.contains("deepseek-r1")
        || lower.contains("qwen3")
        || lower.contains("qwq")
        || lower.contains("o1");
    let vision = lower.contains("gemma4")
        || lower.contains("gemma3")
        || lower.contains("llava")
        || lower.contains("phi-3.5-vision")
        || lower.contains("qwen2.5vl")
        || lower.contains("qwen3-vl")
        || lower.contains("minicpm-v")
        || lower.contains("moondream")
        || lower.contains("granite3.2-vision");
    let note = if thinking && vision {
        "multimodal · mendukung thinking".to_owned()
    } else if thinking {
        "teks · mendukung thinking".to_owned()
    } else {
        "teks".to_owned()
    };
    (thinking, vision, note)
}

#[tauri::command]
pub async fn chat_start(
    app: tauri::AppHandle,
    state: State<'_, ActiveStreams>,
    lifecycle: State<'_, RuntimeOperationLock>,
    payload: ChatRequest,
) -> Result<String, String> {
    // Do not race with model load/unload. Register the new stream while holding the gate.
    let lifecycle_guard = lifecycle.0.lock().await;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let id = format!("{}-{}", payload.model, nanos);
    let model_label = payload.model.clone();

    // Shared registry lets the worker clean up its active ID on every path.
    let active_streams = state.0.clone();
    let (tx, rx) = oneshot::channel::<()>();
    {
        let mut map = active_streams.lock().await;
        if let Some(previous) = map.remove(&id) {
            let _ = previous.send(());
        }
        map.insert(id.clone(), tx);
    }
    drop(lifecycle_guard);

    // Emit the started event before the worker can emit chunks/errors, preserving
    // event ordering for the frontend's stream-ID filter.
    if let Err(error) = app.emit(
        "azalea:chat_started",
        serde_json::json!({ "id": id, "model": model_label }),
    ) {
        if let Some(tx) = active_streams.lock().await.remove(&id) {
            let _ = tx.send(());
        }
        return Err(format!("Gagal memulai stream: {error}"));
    }

    tokio::spawn(chat_worker(
        app.clone(),
        id.clone(),
        payload,
        rx,
        active_streams.clone(),
    ));
    Ok(id)
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, ActiveStreams>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().await;
    if let Some(tx) = map.remove(&id) {
        let _ = tx.send(());
        Ok(())
    } else {
        Err("Stream tidak dikenali atau sudah selesai.".to_owned())
    }
}

#[tauri::command]
pub async fn load_model(
    model: String,
    runtime_policy: String,
    lifecycle: State<'_, RuntimeOperationLock>,
    active_streams: State<'_, ActiveStreams>,
) -> Result<(), String> {
    let _lifecycle_guard = lifecycle.0.lock().await;
    if has_active_chat_streams(active_streams.0.lock().await.len()) {
        return Err("Model tidak dapat dimuat ulang selama chat sedang berjalan.".to_owned());
    }
    // POST /api/generate dengan keep_alive agar model tetap di RAM.
    let http = model_operation_client();
    let body = serde_json::json!({
        "model": model,
        "prompt": "",
        "stream": false,
        "keep_alive": keep_alive_for_policy(&runtime_policy),
    });
    let resp = http
        .post(format!("{OLLAMA_BASE}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gagal preload model: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {status} saat preload model"))
    }
}

#[tauri::command]
pub async fn unload_model(
    model: String,
    lifecycle: State<'_, RuntimeOperationLock>,
    active_streams: State<'_, ActiveStreams>,
) -> Result<(), String> {
    // Serialize with chat_start so a new request cannot begin between the activity
    // check and Ollama's unload request.
    let _lifecycle_guard = lifecycle.0.lock().await;
    if has_active_chat_streams(active_streams.0.lock().await.len()) {
        return Err("Model tidak dapat dilepas selama chat sedang berjalan.".to_owned());
    }
    // POST /api/generate dengan keep_alive=0 untuk mengeluarkan model dari RAM.
    let http = model_operation_client();
    let body = serde_json::json!({
        "model": model,
        "prompt": "",
        "stream": false,
        "keep_alive": 0i32,
    });
    let resp = http
        .post(format!("{OLLAMA_BASE}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gagal melepaskan model: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {status} saat melepaskan model"))
    }
}

/// Process one Ollama stream record and return true on the final done marker.
async fn process_chat_stream_line(app: &tauri::AppHandle, id: &str, line: &str) -> bool {
    let Some(object) = parse_ollama_stream_line(line) else { return false; };
    if object.get("done").and_then(|value| value.as_bool()).unwrap_or(false) {
        let _ = emit_done(app, id, &object).await;
        return true;
    }
    let model = object.get("model").and_then(|value| value.as_str()).unwrap_or("").to_owned();
    let message = object.get("message").and_then(|value| value.as_object());
    let content = message.and_then(|value| value.get("content")).and_then(|value| value.as_str()).map(str::to_owned);
    let thinking = message.and_then(|value| value.get("thinking")).and_then(|value| value.as_str()).map(str::to_owned);
    if content.is_none() && thinking.is_none() && object.get("done").is_none() { return false; }
    let _ = app.emit("azalea:chat_chunk", serde_json::json!({
        "id": id, "model": model, "content": content, "thinking": thinking
    }));
    false
}

async fn chat_worker(
    app: tauri::AppHandle,
    id: String,
    payload: ChatRequest,
    cancel: oneshot::Receiver<()>,
    active_streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
) {
    let http = stream_client();
    let req_opts = payload.options;
    let keep_alive = keep_alive_for_policy(&payload.runtime_policy);
    let mut body_obj = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "stream": true,
        "keep_alive": keep_alive,
        "options": serde_json::json!({
            "num_ctx": req_opts.num_ctx,
            "num_predict": req_opts.num_predict,
            "temperature": req_opts.temperature,
            "top_p": req_opts.top_p,
            "top_k": req_opts.top_k,
            "repeat_penalty": req_opts.repeat_penalty,
            "stop": req_opts.stop,
            "seed": req_opts.seed,
        }),
    });

    // Gemma 4 only receives the thinking token when the user explicitly enabled it.
    if payload.think {
        body_obj["system"] = serde_json::Value::String("<|think|>".to_owned());
    }

    // Cancellation must also work while Ollama is loading the model or waiting for
    // the initial HTTP response headers, not only after the body starts streaming.
    tokio::pin!(cancel);
    let result = tokio::select! {
        biased;
        _ = &mut cancel => {
            let _ = app.emit(
                "azalea:chat_chunk",
                serde_json::json!({ "id": id, "done": true }),
            );
            remove_active_stream(&active_streams, &id).await;
            return;
        }
        response = http
            .post(format!("{OLLAMA_BASE}/api/chat"))
            .json(&body_obj)
            .send() => response,
    };

    let resp = match result {
        Ok(response) => response,
        Err(ref error) if is_conn_refused(error) => {
            let _ = emit_error(
                &app,
                &id,
                "ERR_NOT_RUNNING",
                "Runtime Ollama tidak berjalan. Jalankan Ollama lalu coba lagi.",
            )
            .await;
            remove_active_stream(&active_streams, &id).await;
            return;
        }
        Err(error) => {
            let _ = emit_error(
                &app,
                &id,
                "ERR_REQUEST",
                &format!("Permintaan ke Ollama gagal: {error}"),
            )
            .await;
            remove_active_stream(&active_streams, &id).await;
            return;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let message = extract_ollama_error(&text).unwrap_or(text);
        let code = if status == 400 && message.to_lowercase().contains("thinking") {
            "ERR_THINKING_UNSUPPORTED"
        } else {
            "ERR_HTTP"
        };
        let _ = emit_error(&app, &id, code, &message).await;
        remove_active_stream(&active_streams, &id).await;
        return;
    }

    let stream = resp.bytes_stream();
    let mut buffer = Vec::new();
    let mut received_done_marker = false;
    let mut cancelled = false;
    let mut stream_error_emitted = false;

    tokio::pin!(stream);
    loop {
        let next = tokio::select! {
            biased;
            _ = &mut cancel => {
                cancelled = true;
                break;
            }
            item = stream.next() => item,
        };

        match next {
            Some(Ok(bytes)) => {
                buffer.extend_from_slice(&bytes);
                while let Some(line) = split_line(&mut buffer) {
                    if process_chat_stream_line(&app, &id, &line).await {
                        received_done_marker = true;
                        break;
                    }
                }
                if received_done_marker {
                    break;
                }
            }
            Some(Err(error)) => {
                let _ = emit_error(
                    &app,
                    &id,
                    "ERR_STREAM",
                    &format!("Stream respons terputus: {error}"),
                )
                .await;
                stream_error_emitted = true;
                break;
            }
            None => {
                if !buffer.iter().all(u8::is_ascii_whitespace) {
                    let final_line = String::from_utf8_lossy(&buffer);
                    if process_chat_stream_line(&app, &id, &final_line).await {
                        received_done_marker = true;
                    }
                }
                break;
            }
        }
    }

    if !received_done_marker && !cancelled && !stream_error_emitted {
        let _ = emit_error(
            &app,
            &id,
            "ERR_STREAM_INCOMPLETE",
            "Stream Ollama berakhir sebelum respons selesai. Sebagian teks mungkin belum lengkap.",
        )
        .await;
    }

    // Frontend ignores this marker after cancellation/error because it clears its active ID.
    let _ = app.emit(
        "azalea:chat_chunk",
        serde_json::json!({ "id": id, "done": true }),
    );
    remove_active_stream(&active_streams, &id).await;
}

async fn emit_error(app: &tauri::AppHandle, id: &str, code: &str, message: &str) {
    let _ = app.emit(
        "azalea:chat_error",
        serde_json::json!({ "id": id, "code": code, "message": message }),
    );
}

async fn emit_done(app: &tauri::AppHandle, id: &str, obj: &serde_json::Value) {
    let pe = obj.get("prompt_eval_count").and_then(|v| v.as_u64());
    let ec = obj.get("eval_count").and_then(|v| v.as_u64());
    let dur = obj.get("eval_duration_seconds").and_then(|v| v.as_f64());
    let prompt_eval = pe.and_then(|t| {
        dur.map(|d| PromptEval { total: t as u32, tokens_per_second: if d > 0.0 { (t as f32) / d as f32 } else { 0.0 } })
    });
    let eval = ec.and_then(|t| {
        dur.map(|d| EvalStats { total: t as u32, tokens_per_second: if d > 0.0 { (t as f32) / d as f32 } else { 0.0 } })
    });
    let _ = app.emit(
        "azalea:chat_done",
        serde_json::json!({ "id": id, "prompt_eval": prompt_eval, "eval": eval }),
    );
}

fn extract_ollama_error(text: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| v.get("error").cloned())
        .and_then(|e| {
            if e.is_string() {
                e.as_str().map(str::to_owned)
            } else if e.is_object() {
                e.get("message").and_then(|m| m.as_str().map(str::to_owned))
            } else {
                Some(e.to_string())
            }
        })
}

/// Parse one line from Ollama's newline-delimited JSON chat stream.
///
/// Ollama's /api/chat endpoint emits one JSON object per line, not SSE frames.
/// Accept an optional data: prefix as a compatibility measure, but do not
/// require it: requiring that prefix silently dropped every normal Ollama chunk.
fn parse_ollama_stream_line(line: &str) -> Option<serde_json::Value> {
    let trimmed = line.trim();
    let payload = trimmed.strip_prefix("data:").map(str::trim).unwrap_or(trimmed);
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(payload).ok()
}

/// Potong satu baris (hingga \n termasuk) dari buffer, kembalikan isi barisannya.
fn split_line(buf: &mut Vec<u8>) -> Option<String> {
    let nl = buf.iter().position(|&b| b == b'\n')?;
    let line = String::from_utf8(buf[..nl].to_vec()).ok();
    buf.drain(..=nl);
    line
}


#[cfg(test)]
mod streaming_tests {
    use super::{parse_ollama_stream_line, split_line};

    #[test]
    fn parser_reads_plain_ollama_ndjson_chunk() {
        let value = parse_ollama_stream_line(r#"{"model":"gemma4:E2B","message":{"role":"assistant","content":"Halo"},"done":false}"#).expect("valid NDJSON");
        assert_eq!(value["model"].as_str(), Some("gemma4:E2B"));
        assert_eq!(value["message"]["content"].as_str(), Some("Halo"));
        assert_eq!(value["done"].as_bool(), Some(false));
    }

    #[test]
    fn parser_detects_plain_ollama_done_marker() {
        let value = parse_ollama_stream_line(r#"{"model":"gemma4:E2B","done":true,"prompt_eval_count":12,"eval_count":5}"#).expect("valid final record");
        assert_eq!(value["done"].as_bool(), Some(true));
    }

    #[test]
    fn parser_keeps_compatibility_with_data_prefixed_json() {
        let value = parse_ollama_stream_line(r#"data: {"done":true,"model":"qwen3:8b"}"#).expect("valid prefixed JSON");
        assert_eq!(value["done"].as_bool(), Some(true));
        assert_eq!(value["model"].as_str(), Some("qwen3:8b"));
    }

    #[test]
    fn parser_ignores_empty_non_json_and_done_sentinel_lines() {
        assert!(parse_ollama_stream_line("").is_none());
        assert!(parse_ollama_stream_line("event: message").is_none());
        assert!(parse_ollama_stream_line("data:").is_none());
        assert!(parse_ollama_stream_line("[DONE]").is_none());
        assert!(parse_ollama_stream_line("data: [DONE]").is_none());
    }

    #[test]
    fn line_splitter_keeps_partial_final_json_until_newline_arrives() {
        let mut buffer = b"{\"done\":false}\n{\"done\":true}".to_vec();
        assert_eq!(split_line(&mut buffer).as_deref(), Some(r#"{"done":false}"#));
        assert_eq!(buffer, b"{\"done\":true}");
        let final_line = String::from_utf8_lossy(&buffer);
        let parsed = parse_ollama_stream_line(&final_line).expect("valid final JSON record");
        assert_eq!(parsed["done"].as_bool(), Some(true));
    }
}

#[cfg(test)]
mod runtime_lifecycle_tests {
    use super::{has_active_chat_streams, keep_alive_for_policy};

    #[test]
    fn runtime_transition_is_allowed_when_no_chat_is_active() {
        assert!(!has_active_chat_streams(0));
    }

    #[test]
    fn runtime_transition_is_blocked_when_a_chat_is_active() {
        assert!(has_active_chat_streams(1));
        assert!(has_active_chat_streams(3));
    }

    #[test]
    fn automatic_policy_keeps_model_loaded_for_one_hour() {
        assert_eq!(keep_alive_for_policy("auto"), serde_json::json!("1h"));
    }

    #[test]
    fn manual_policy_keeps_model_loaded_indefinitely() {
        assert_eq!(keep_alive_for_policy("manual"), serde_json::json!(-1));
    }
}


#[cfg(test)]
mod model_manager_tests {
    use super::valid_model_reference;

    #[test]
    fn accepts_common_ollama_model_references_without_shell_syntax() {
        assert!(valid_model_reference("qwen3:8b"));
        assert!(valid_model_reference("llama3.2:3b"));
        assert!(valid_model_reference("hf.co/unsloth/model:Q4_K_M"));
        assert!(!valid_model_reference(""));
        assert!(!valid_model_reference("../model"));
        assert!(!valid_model_reference("model;shutdown"));
        assert!(!valid_model_reference("model name"));
        assert!(!valid_model_reference("/absolute/model"));
    }
}
