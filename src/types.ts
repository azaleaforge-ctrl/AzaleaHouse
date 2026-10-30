export type View = "chat" | "documents" | "images" | "history" | "settings";

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
export type ModelId = "gemma4:e2b" | "mini-preview";

/** Lampiran file yang dipilih pengguna */
export interface Attachment {
  name: string;
  path: string;
  size: number;
  format: "text" | "image" | "other";
  content?: string;     // teks yang diekstrak (untuk text files)
  base64?: string;      // base64 data (untuk images)
  error?: string;       // error validasi
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
  /** Konten thinking (rantai penalaran) — hanya jika model mendukung & thinking aktif */
  thinking?: string;
  /** Apakah pesan ini masih sedang distreaming */
  streaming?: boolean;
  /** Gambar lampiran (base64) untuk pesan ini */
  images?: string[];
}

/** idle | generating — mock preview atau streaming nyata */
export type GenState = "idle" | "thinking" | "generating";

export interface AppearanceSettings {
  bgAnimation: boolean;
  reducedMotion: boolean;
  /** 0–100, dipetakan ke skala blur 0.4–1.6 */
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
