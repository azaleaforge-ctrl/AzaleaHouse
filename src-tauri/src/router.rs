//! OpenAI-compatible provider bridge for the local 9Router gateway.
//! API credentials are held only in process memory and are never written to logs or settings.
use std::collections::HashMap;
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
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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
}

#[derive(Clone, Deserialize, Default)]
pub struct RouterOptions {
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default, rename = "num_predict")]
    pub max_tokens: Option<i32>,
    #[serde(default)]
    pub top_p: Option<f32>,
}

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
        .user_agent("AzaleaHouse/0.2.1")
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
            "content": "Gunakan penalaran internal yang teliti sebelum menjawab. Jangan tampilkan chain-of-thought; berikan hasil, alasan ringkas, dan langkah yang dapat diverifikasi."
        }));
    }
    for message in payload.messages {
        if let Some(images) = message.images.as_ref().filter(|images| !images.is_empty()) {
            let mut content = vec![serde_json::json!({ "type": "text", "text": message.content })];
            for image in images.iter().take(5) {
                content.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": { "url": format!("data:image/png;base64,{image}") }
                }));
            }
            messages.push(serde_json::json!({ "role": message.role, "content": content }));
        } else {
            messages.push(serde_json::json!({ "role": message.role, "content": message.content }));
        }
    }

    let mut body = serde_json::json!({
        "model": payload.model,
        "messages": messages,
        "stream": true
    });
    if let Some(value) = payload.options.temperature {
        body["temperature"] = serde_json::json!(value.clamp(0.0, 2.0));
    }
    if let Some(value) = payload.options.max_tokens {
        body["max_tokens"] = serde_json::json!(value.clamp(1, 32768));
    }
    if let Some(value) = payload.options.top_p {
        body["top_p"] = serde_json::json!(value.clamp(0.0, 1.0));
    }

    let result = async {
        let response = http_client(STREAM_IDLE_TIMEOUT)?
            .post(format!("{ROUTER_BASE}/chat/completions"))
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Koneksi chat 9Router gagal: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            let detail = detail.chars().take(1000).collect::<String>();
            return Err(format!("9Router mengembalikan HTTP {status}: {detail}"));
        }

        let mut stream = response.bytes_stream();
        let mut pending = Vec::<u8>::new();
        let mut cancel = cancel;
        let mut completed = false;

        loop {
            let item = tokio::select! {
                biased;
                _ = &mut cancel => {
                    completed = true;
                    break;
                }
                item = stream.next() => item,
            };
            let Some(item) = item else { break };
            let bytes = item.map_err(|error| format!("Stream 9Router terhenti: {error}"))?;
            pending.extend_from_slice(&bytes);

            while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                let line = pending.drain(..=newline).collect::<Vec<_>>();
                if let Some(done) = process_sse_line(&app, &id, &payload.model, &line)? {
                    completed = done;
                    if done { break; }
                }
            }
            if completed { break; }
        }

        if !completed && !pending.is_empty() {
            let _ = process_sse_line(&app, &id, &payload.model, &pending)?;
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

fn process_sse_line(
    app: &tauri::AppHandle,
    id: &str,
    model: &str,
    line: &[u8],
) -> Result<Option<bool>, String> {
    let line = String::from_utf8_lossy(line).trim().to_owned();
    let Some(data) = line.strip_prefix("data:") else { return Ok(None) };
    let data = data.trim();
    if data.is_empty() { return Ok(None); }
    if data == "[DONE]" { return Ok(Some(true)); }

    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|error| format!("Data stream 9Router tidak valid: {error}"))?;
    if let Some(message) = value.get("error") {
        let detail = message.as_str().map(str::to_owned).unwrap_or_else(|| message.to_string());
        return Err(format!("9Router: {detail}"));
    }

    let delta = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("delta"));
    let content = delta
        .and_then(|delta| delta.get("content"))
        .and_then(|content| content.as_str())
        .map(str::to_owned);
    let thinking = delta
        .and_then(|delta| delta.get("reasoning"))
        .or_else(|| delta.and_then(|delta| delta.get("reasoning_content")))
        .and_then(|thinking| thinking.as_str())
        .map(str::to_owned);
    let finish = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(|reason| reason.as_str())
        .is_some();

    if content.is_some() || thinking.is_some() {
        let _ = app.emit("azalea:chat_chunk", serde_json::json!({
            "id": id,
            "model": model,
            "content": content,
            "thinking": thinking
        }));
    }
    Ok(if finish { Some(true) } else { None })
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
        .user_agent("Mozilla/5.0 AzaleaHouse/0.2.1")
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
