/**
 * Pembacaan versi aplikasi via Tauri API.
 * Di peramban biasa (tanpa Tauri) langsung memakai nilai fallback.
 */
export async function readAppVersion(fallback: string): Promise<string> {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) return fallback;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return fallback;
  }
}

// ───────────────────────────────
// Ollama runtime bridge (Phase 2)
// ───────────────────────────────

export interface ChatChunkEvent {
  id: string;
  model: string;
  content?: string;
  thinking?: string;
  done?: boolean;
}

export interface ChatErrorEvent {
  id: string;
  code: string;
  message: string;
}

export interface ChatDoneEvent {
  id: string;
  prompt_eval?: { total: number; tokens_per_second: number };
  eval?: { total: number; tokens_per_second: number };
}

export interface ChatStartedEvent {
  id: string;
  model: string;
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Pemanggilan ke `runtime_status` di Rust. */
export async function invokeRuntimeStatus(
  model: string | null,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("runtime_status", { model: model ?? null });
  } catch {
    return null;
  }
}

export interface ModelMeta {
  id: string;
  name: string;
  size: number;
  thinking_supported: boolean;
  vision_supported: boolean;
  note: string;
}

/** Pemanggilan ke `list_models` di Rust. */
export async function invokeListModels(): Promise<ModelMeta[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("list_models");
  } catch {
    return [];
  }
}

/** Payload chat ke Rust. */
export interface ChatStartPayload {
  model: string;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  think: boolean;
  runtimePolicy: "auto" | "manual";
  options: {
    temperature?: number;
    num_ctx?: number;
    num_predict?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    stop?: string[];
    seed?: number | null;
  };
}

/** Panggil `chat_start`, kembalikan stream ID. */
export async function invokeChatStart(
  payload: ChatStartPayload,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("chat_start", { payload });
  } catch {
    return null;
  }
}

/** Panggil `chat_cancel`. */
export async function invokeChatCancel(id: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("chat_cancel", { id });
    return true;
  } catch {
    return false;
  }
}

/** Panggil `unload_model` untuk melepaskan model dari RAM. */
export async function invokeUnloadModel(model: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unload_model", { model });
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────────
// Local storage / .AzaleaMemory (Phase 4)
// ───────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
}

/** Dapatkan path .AzaleaMemory yang sedang dipakai. */
export async function invokeMemoryPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("memory_path");
  } catch {
    return null;
  }
}

/** Pastikan struktur folder ada. */
export async function invokeEnsureMemoryDir(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ensure_memory_dir");
    return true;
  } catch {
    return false;
  }
}

/** Simpan satu percakapan. */
export async function invokeSaveConversation(conversation: {
  id: string;
  title: string;
  updated_at: string;
  messages: StoredMessage[];
}): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_conversation", { conversation });
    return true;
  } catch {
    return false;
  }
}

/** Daftar semua percakapan. */
export async function invokeListConversations(): Promise<ConversationSummary[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ConversationSummary[]>("list_conversations");
  } catch {
    return [];
  }
}

/** Load satu percakapan lengkap. */
export async function invokeLoadConversation(id: string): Promise<{
  id: string;
  title: string;
  updated_at: string;
  messages: StoredMessage[];
} | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("load_conversation", { id });
  } catch {
    return null;
  }
}

/** Hapus satu percakapan. */
export async function invokeDeleteConversation(id: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_conversation", { id });
    return true;
  } catch {
    return false;
  }
}

/** Simpan pengaturan aplikasi. */
export async function invokeSaveSettings(settings: unknown): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { settings });
    return true;
  } catch {
    return false;
  }
}

/** Load pengaturan aplikasi. */
export async function invokeLoadSettings(): Promise<{
  appearance?: Record<string, unknown>;
  ai?: Record<string, unknown>;
} | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("load_settings");
  } catch {
    return null;
  }
}

/** Buka folder .AzaleaMemory di Explorer. */
export async function invokeOpenMemoryFolder(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_memory_folder");
    return true;
  } catch {
    return false;
  }
}

/** Pilih folder induk secara native; null berarti pengguna membatalkan dialog. */
export async function invokePickMemoryParentFolder(): Promise<string | null> {
  if (!isTauri()) throw new Error("Pemilihan folder hanya tersedia di aplikasi desktop.");
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string | null>("pick_memory_parent_folder");
}

/** Migrasi memori ke folder induk pilihan pengguna. */
export async function invokeSetCustomPath(path: string): Promise<boolean> {
  if (!isTauri()) throw new Error("Migrasi memori hanya tersedia di aplikasi desktop.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_custom_path", { new_path: path });
  return true;
}

/** Buat backup .AzaleaMemory. */
export async function invokeBackupMemory(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("backup_memory");
  } catch {
    return null;
  }
}

// ───────────────────────────────
// File Reader & Vision (Phase 5)
// ───────────────────────────────

export interface FileValidationResult {
  valid: boolean;
  name: string;
  size: number;
  format: string;
  error: string | null;
}

export interface AttachmentInfo {
  name: string;
  size: number;
  format: string;
}

/** Validasi file sebelum proses. */
export async function invokeValidateFile(
  path: string,
  maxBytes?: number,
): Promise<FileValidationResult | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<FileValidationResult>("validate_file", {
      payload: { path, max_bytes: maxBytes ?? null },
    });
  } catch {
    return null;
  }
}

/** Baca teks dari file yang didukung (TXT, MD, JSON, CSV, dll). */
export async function invokeReadFileText(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("read_file_text", { path_str: path });
  } catch {
    return null;
  }
}

/** Base64-encode gambar untuk vision pipeline. */
export async function invokeEncodeImage(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("encode_image", { path_str: path });
  } catch {
    return null;
  }
}

/** Salin file ke .AzaleaMemory/attachments/. */
export async function invokeSaveAttachment(sourcePath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("save_attachment", { source_path: sourcePath });
  } catch {
    return null;
  }
}

/** Daftar lampiran tersimpan. */
export async function invokeListAttachments(): Promise<AttachmentInfo[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<AttachmentInfo[]>("list_attachments");
  } catch {
    return [];
  }
}

/** Hapus lampiran. */
export async function invokeDeleteAttachment(name: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_attachment", { name });
    return true;
  } catch {
    return false;
  }
}

/** Listener untuk event streaming chat. */
export function listenChatEvents(handlers: {
  onStarted: (e: ChatStartedEvent) => void;
  onChunk: (e: ChatChunkEvent) => void;
  onError: (e: ChatErrorEvent) => void;
  onDone: (e: ChatDoneEvent) => void;
}): Promise<() => void> {
  const { onStarted, onChunk, onError, onDone } = handlers;
  return (async () => {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");

    const u1 = await listen<ChatStartedEvent>("azalea:chat_started", (e) =>
      onStarted(e.payload),
    );
    const u2 = await listen<ChatChunkEvent>("azalea:chat_chunk", (e) =>
      onChunk(e.payload),
    );
    const u3 = await listen<ChatErrorEvent>("azalea:chat_error", (e) =>
      onError(e.payload),
    );
    const u4 = await listen<ChatDoneEvent>("azalea:chat_done", (e) =>
      onDone(e.payload),
    );

    return () => { u1(); u2(); u3(); u4(); };
  })();
}

// ───────────────────────────────
// Version Center & Manual Updater (Phase 7)
// ───────────────────────────────

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

export interface UpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string;
  body: string;
  assets: UpdateAsset[];
  error: string | null;
}

export interface UpdateProgressEvent {
  downloaded: number;
  total: number;
  speed: number;
  eta_seconds: number | null;
}

/** Periksa update dari GitHub. */
export async function invokeCheckUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<UpdateInfo>("check_update");
  } catch {
    return null;
  }
}

/** Unduh update (manual trigger). Emit `azalea:update_progress`. */
export async function invokeDownloadUpdate(
  assetUrl: string,
  assetName: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("download_update", {
      asset_url: assetUrl,
      asset_name: assetName,
    });
  } catch {
    return null;
  }
}

/** Batalkan unduhan. */
export async function invokeCancelDownload(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("cancel_download");
    return true;
  } catch {
    return false;
  }
}

/** Listener untuk progres download update. */
export function listenUpdateProgress(
  onProgress: (e: UpdateProgressEvent) => void,
): () => void {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) return () => {};
  let unsub: (() => void) | null = null;
  const setup = async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const unli = await listen("azalea:update_progress", (event) => {
      onProgress(event.payload as UpdateProgressEvent);
    });
    unsub = () => unli();
  };
  void setup();
  return () => {
    if (unsub) unsub();
    else setup().then(() => { if (unsub) unsub(); });
  };
}

/** Preload model agar tetap di RAM (keep-alive 1h). */
export async function invokeLoadModel(
  model: string,
  runtimePolicy: "auto" | "manual",
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("load_model", { model, runtimePolicy });
    return true;
  } catch {
    return false;
  }
}
