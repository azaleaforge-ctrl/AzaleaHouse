export type View = "chat" | "local-ai" | "documents" | "images" | "history" | "settings";

/** Kosakata status runtime — PRD 9.1 */
export type RuntimeStatus =
  | "not_installed"
  | "runtime_unavailable"
  | "model_not_downloaded"
  | "unloaded"
  | "loading"
  | "ready"
  | "thinking"
  | "generating"
  | "unloading"
  | "error";

export type ProfileId = "quick" | "balanced" | "deep";
export type ModelId = string;

/** Metadata lampiran yang dapat dipulihkan bersama sesi chat. */
export interface MessageAttachment {
  id?: string;
  name: string;
  size: number;
  format: "text" | "image" | "document" | "other";
  mimeType?: string;
  content?: string;
  error?: string;
  storagePath?: string;
}

/** Lampiran aktif yang dipilih pengguna; base64 hanya runtime, bukan disimpan di transcript. */
export interface Attachment extends MessageAttachment {
  path: string;
  base64?: string;
  storageWarning?: string;
}
export type RuntimePolicy = "auto" | "manual";

export interface ModelInfo {
  id: ModelId;
  name: string;
  thinkingSupported: boolean;
  note: string;
}

export interface ProfileInfo {
  id: ProfileId;
  name: string;
  desc: string;
  outputTokens: number;
  thinking: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  /** Apakah pesan ini masih sedang distreaming */
  streaming?: boolean;
  /** Gambar lampiran (base64) untuk vision; hanya disimpan selama runtime. */
  images?: string[];
  /** Metadata/teks lampiran yang ikut tersimpan bersama percakapan. */
  attachments?: MessageAttachment[];
}

/** Status generasi respons model lokal. */
export type GenState = "idle" | "generating";

export interface AppearanceSettings {
  bgAnimation: boolean;
  reducedMotion: boolean;
  /** Tema visual dengan wallpaper berbeda per mode. */
  theme: "dark" | "light";
  /** 0–100; 0 mematikan blur dan 100 memakai blur paling kuat. */
  blurIntensity: number;
}

export interface AiSettings {
  thinking: boolean;
  model: ModelId;
  runtimePolicy: RuntimePolicy;
  contextWindow: number;
  maxOutputTokens: number;
  temperature: number;
  profile: ProfileId;
  topP: number;
  topK: number;
  repeatPenalty: number;
  stopSequences: string;
  seed: number | null;
}

export interface AppearanceSettings {
  bgAnimation: boolean;
  reducedMotion: boolean;
  theme: "dark" | "light";
  blurIntensity: number;
}

/** Pengaturan updater (Phase 7) */
export interface UpdateSettings {
  autoCheck: boolean;
  channel: "stable" | "beta";
}

export interface AppSettings {
  appearance: AppearanceSettings;
  ai: AiSettings;
  update?: UpdateSettings;
}

/** Status Version Center — PRD 15.4 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "update_available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "offline"
  | "error";
