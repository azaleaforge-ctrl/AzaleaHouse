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

/// Payload chat dari frontend. Diterima sebagai DTO ketat (bukan string mentah).
#[derive(Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessageIn>,
    pub think: bool,
    pub options: ChatOptions,
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

/// Heuristik dukungan fitur berdasarkan nama model — diverifikasi manual di Phase 0.
/// Nilainya bersumber dari daftar model Ollama, bukan dianggap otomatis.
fn infer_caps(name: &str) -> (bool, bool, String) {
    let lower = name.to_ascii_lowercase();
    let thinking = lower.contains("gemma4")
        || lower.contains("deepseek-r1")
        || lower.contains("gemma3:27b")
        || lower.contains("o1");
    let vision = lower.contains("gemma4")
        || lower.contains("gemma3:27b")
        || lower.contains("llava")
        || lower.contains("phi-3.5-vision");
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
    payload: ChatRequest,
) -> Result<String, String> {
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
pub async fn load_model(model: String) -> Result<(), String> {
    // POST /api/generate dengan keep_alive agar model tetap di RAM.
    let http = model_operation_client();
    let body = serde_json::json!({
        "model": model,
        "prompt": "",
        "stream": false,
        "keep_alive": "1h",
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
pub async fn unload_model(model: String) -> Result<(), String> {
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

async fn chat_worker(
    app: tauri::AppHandle,
    id: String,
    payload: ChatRequest,
    cancel: oneshot::Receiver<()>,
    active_streams: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
) {
    let http = stream_client();
    let req_opts = payload.options;
    let mut body_obj = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "stream": true,
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
                    if let Some(object) = parse_sse_line(&line) {
                        if object.get("done").and_then(|value| value.as_bool()).unwrap_or(false) {
                            received_done_marker = true;
                            let _ = emit_done(&app, &id, &object).await;
                            break;
                        }

                        let model = object
                            .get("model")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .to_owned();
                        let message = object.get("message").and_then(|value| value.as_object());
                        let content = message
                            .and_then(|value| value.get("content"))
                            .and_then(|value| value.as_str())
                            .map(str::to_owned);
                        let thinking = message
                            .and_then(|value| value.get("thinking"))
                            .and_then(|value| value.as_str())
                            .map(str::to_owned);

                        if content.is_none() && thinking.is_none() && object.get("done").is_none() {
                            continue;
                        }
                        let _ = app.emit(
                            "azalea:chat_chunk",
                            serde_json::json!({
                                "id": id,
                                "model": model,
                                "content": content,
                                "thinking": thinking
                            }),
                        );
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
            None => break,
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

/// Ambil `data:` JSON object dari satu baris SSE.
fn parse_sse_line(line: &str) -> Option<serde_json::Value> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with("data:") {
        return None;
    }
    let payload = trimmed["data:".len()..].trim();
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
    use super::{parse_sse_line, split_line};

    #[test]
    fn parser_ignores_non_data_and_empty_done_frames() {
        assert!(parse_sse_line("event: message").is_none());
        assert!(parse_sse_line("data:").is_none());
        assert!(parse_sse_line("data: [DONE]").is_none());
    }

    #[test]
    fn parser_reads_json_sse_data() {
        let value = parse_sse_line(r#"data: {"done":true,"model":"gemma4:e2b"}"#)
            .expect("valid data frame");
        assert_eq!(value.get("done").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            value.get("model").and_then(|v| v.as_str()),
            Some("gemma4:e2b")
        );
    }

    #[test]
    fn line_splitter_keeps_partial_data_until_newline_arrives() {
        let mut buffer = b"data: first\ndata: partial".to_vec();
        assert_eq!(split_line(&mut buffer).as_deref(), Some("data: first"));
        assert_eq!(buffer, b"data: partial");
        buffer.extend_from_slice(b"\n");
        assert_eq!(split_line(&mut buffer).as_deref(), Some("data: partial"));
        assert!(buffer.is_empty());
    }
}
