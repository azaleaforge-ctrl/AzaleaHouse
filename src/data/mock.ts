import type { ModelInfo, ProfileId, ProfileInfo, RuntimeStatus } from "../types";

export const APP_NAME = "AzaleaHouse";
export const FALLBACK_VERSION = "0.2.2";
export const MEMORY_PATH = "%LOCALAPPDATA%\\AzaleaHouse\\.AzaleaMemory\\";

/** Label Indonesia untuk kosakata status runtime (PRD 9.1) */
export const runtimeStatusLabels: Record<RuntimeStatus, string> = {
  not_installed: "Runtime belum terpasang",
  runtime_unavailable: "Runtime tidak tersedia",
  model_not_downloaded: "Model belum diunduh",
  unloaded: "Model tidak dimuat",
  loading: "Memuat model…",
  ready: "Siap",
  thinking: "Sedang berpikir…",
  generating: "Sedang menghasilkan…",
  unloading: "Melepas model…",
  error: "Terjadi kesalahan",
};

/** Model inventory is read from the user's local Ollama instance at runtime. */
export const models: ModelInfo[] = [];

export const profiles: ProfileInfo[] = [
  {
    id: "quick",
    name: "Quick Chat",
    desc: "Fakta singkat, terjemahan, revisi ringkas.",
    outputTokens: 1024,
    thinking: false,
  },
  {
    id: "balanced",
    name: "Balanced",
    desc: "Percakapan dan penulisan sehari-hari.",
    outputTokens: 2048,
    thinking: false,
  },
  {
    id: "deep",
    name: "Deep Analysis",
    desc: "Analisis berlapis dan tugas kompleks.",
    outputTokens: 2048,
    thinking: true,
  },
];

export const contextOptions = [2048, 4096, 8192, 16384] as const;
export const outputOptions = [256, 384, 512, 1024, 2048, 4096] as const;

/** Ekstensi teks yang didukung (Fase 5) */
export const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv", "tsv",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs",
  "toml", "yaml", "yml", "html", "htm", "css", "xml",
  "sql", "sh", "ps1", "java", "c", "h", "cpp", "go",
  "php", "rb", "swift", "kt", "ini", "log", "env",
  "vue", "svelte", "astro", "diff",
];

/** Ekstensi gambar yang didukung (Fase 5) */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

/** Batas ukuran file attachment */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const RAM_PLACEHOLDER = "RAM ±2,1 GB · pratinjau";

export interface Suggestion {
  title: string;
  desc: string;
  prompt: string;
}

export const suggestions: Suggestion[] = [
  {
    title: "Ringkas dokumen",
    desc: "Lampirkan PDF lalu minta poin-poin pentingnya.",
    prompt: "Bantu aku meringkas dokumen ini — poin pentingnya apa saja?",
  },
  {
    title: "Tulis draf email",
    desc: "Susun email profesional dengan struktur yang rapi.",
    prompt: "Buatkan draf email profesional untuk menghubungi klien baru.",
  },
  {
    title: "Jelaskan konsep",
    desc: "Minta penjelasan sederhana untuk topik yang sulit.",
    prompt: "Jelaskan konsep context window pada model AI dengan bahasa sederhana.",
  },
  {
    title: "Rencanakan tugas",
    desc: "Pecah proyek besar menjadi langkah yang jelas.",
    prompt: "Bantu aku menyusun rencana kerja mingguan untuk proyek redesign website.",
  },
];

export const changelogV022: string[] = [
  "Perbaikan Version Center: request unduhan tidak lagi memakai batas waktu total nol yang langsung menggagalkan koneksi.",
  "Koneksi unduhan memiliki batas waktu koneksi dan idle-read yang terpisah agar unduhan installer besar dapat berjalan stabil.",
  "Pesan kegagalan jaringan diperjelas untuk membantu diagnosis koneksi, DNS, firewall, dan proxy.",
  "Regression test ditambahkan untuk memastikan HTTP client tetap menunggu respons yang datang terlambat.",
  "Validasi installer resmi, pemeriksaan ukuran dan header PE, serta pemasangan manual tetap dipertahankan.",
];

export const changelogV021: string[] = [
  "Provider AI 9Router: endpoint lokal OpenAI-compatible, API key manual, daftar model dari /v1/models, refresh model, dan pergantian provider.",
  "Perintah slash /sessions, /model, dan /connect dengan dialog terpusat; sesi dapat dibuka dan dihapus.",
  "Generasi dapat dihentikan melalui tombol Stop atau tombol Escape.",
  "Enam skill otomatis: Lazy Dev, Quick Response, File Analysis, Web Research, Document Engine, dan Thinking Adapter.",
  "Tools: Web Search, Vision Bridge, ekspor DOCX/PDF/PPTX, dan Image Studio untuk endpoint image generation yang kompatibel.",
  "Version Center dapat menjalankan installer yang telah diunduh setelah pemeriksaan file dan konfirmasi manual.",
];

export const changelogV020: string[] = [
  "Perbaikan chat AI lokal: jawaban yang dihentikan karena batas output token dapat dilanjutkan otomatis hingga tiga kali.",
  "Batas output default ditingkatkan dari 512 menjadi 2.048 token; preferensi lama dimigrasikan satu kali dan tetap dapat diubah dari Settings.",
  "Ditambahkan pilihan batas output hingga 4.096 token serta penanganan yang jelas jika jawaban masih mencapai batas generasi.",
  "Ollama dan model AI tetap berjalan secara lokal. Pengelolaan runtime otomatis dari AzaleaHouse belum termasuk dalam rilis ini; Ollama harus sudah tersedia secara lokal.",
];

export function profileById(id: ProfileId): ProfileInfo {
  return profiles.find((p) => p.id === id) ?? profiles[1];
}
