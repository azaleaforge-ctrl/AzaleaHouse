import type { ModelInfo, ProfileId, ProfileInfo, RuntimeStatus } from "../types";

export const APP_NAME = "AzaleaHouse";
export const FALLBACK_VERSION = "0.1.0";
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

export const models: ModelInfo[] = [
  {
    id: "gemma4:e2b",
    name: "Gemma 4 E2B",
    thinkingSupported: true,
    note: "Multimodal · kandidat utama",
  },
  {
    id: "mini-preview",
    name: "Model Mini",
    thinkingSupported: false,
    note: "Tanpa Thinking · untuk uji tampilan",
  },
];

export const profiles: ProfileInfo[] = [
  {
    id: "quick",
    name: "Quick Chat",
    desc: "Fakta singkat, terjemahan, revisi ringkas.",
    outputTokens: 384,
    thinking: false,
  },
  {
    id: "balanced",
    name: "Balanced",
    desc: "Percakapan dan penulisan sehari-hari.",
    outputTokens: 512,
    thinking: false,
  },
  {
    id: "deep",
    name: "Deep Analysis",
    desc: "Analisis berlapis dan tugas kompleks.",
    outputTokens: 1024,
    thinking: true,
  },
];

export const contextOptions = [2048, 4096, 8192, 16384] as const;
export const outputOptions = [256, 384, 512, 1024, 2048] as const;

/** Ekstensi teks yang didukung (Fase 5) */
export const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv",
  "ts", "tsx", "js", "jsx", "py", "rs",
  "toml", "yaml", "yml", "html", "css", "xml",
];

/** Ekstensi gambar yang didukung (Fase 5) */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/** Batas ukuran file attachment */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const RAM_PLACEHOLDER = "RAM ±2,1 GB · pratinjau";

/** Percakapan pratinjau yang panjang agar scroll nyata */
export const mockConversation: { role: "user" | "assistant"; text: string; time: string }[] = [
  {
    role: "user",
    time: "14:02",
    text: "Hai! Kamu ini asisten apa saja sih?",
  },
  {
    role: "assistant",
    time: "14:02",
    text: `Halo! Selamat datang di **AzaleaHouse** — asisten AI lokal yang berjalan sepenuhnya di komputermu.

Yang bisa kubantu antara lain:
- **Percakapan & penulisan** — draf email, ringkasan, dan penyuntingan teks.
- **Analisis dokumen** — tanya apa saja tentang PDF, DOCX, atau CSV yang dilampirkan.
- **Pemahaman gambar** — jelaskan screenshot atau foto sesuai kemampuan model.
- **Dokumen rapi** — susun laporan DOCX/PDF dengan layout yang benar.

Semua data tetap di perangkatmu. Tidak ada yang dikirim ke cloud.`,
  },
  {
    role: "user",
    time: "14:04",
    text: "Keren. Bisa jelaskan kelebihan bekerja remote?",
  },
  {
    role: "assistant",
    time: "14:04",
    text: `## Kelebihan bekerja remote

**Fleksibilitas waktu** — kamu bisa mengatur jam kerja paling produktif.

**Hemat waktu perjalanan** — rata-rata 1–2 jam per hari bisa dipakai untuk hal lain.

**Lingkungan terkontrol** — suasana, suhu, dan musik sesuai seleramu.

> Catatan: remote yang sehat tetap butuh batasan yang jelas antara waktu kerja dan istirahat.

Kalau mau, aku bisa bantu menyusun rutinitas harian kerja remote.`,
  },
  {
    role: "user",
    time: "14:07",
    text: "Buatkan contoh kode fetch sederhana dong.",
  },
  {
    role: "assistant",
    time: "14:07",
    text: `Tentu — ini contoh minimal dengan \`async/await\`:

\`\`\`ts
async function ambilData(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return res.json();
}
\`\`\`

Fungsi di atas melempar \`Error\` bila status bukan 2xx, jadi pemanggil bisa menangani kegagalan dengan rapi.`,
  },
  {
    role: "user",
    time: "14:11",
    text: "Bandingkan dua paket internet ini dong, A dan B.",
  },
  {
    role: "assistant",
    time: "14:11",
    text: `| Aspek | Paket A | Paket B |
|---|---|---|
| Kecepatan | 50 Mbps | 100 Mbps |
| Kuota | 150 GB | 300 GB |
| Harga bulanan | Rp 300.000 | Rp 450.000 |
| Cocok untuk | Browsing & streaming ringan | Keluarga & kerja remote |

**Simpulan:** Paket A cukup untuk penggunaan pribadi; Paket B lebih hemat per GB untuk pemakaian berat.`,
  },
  {
    role: "user",
    time: "14:15",
    text: "Aku mau kirim email penawaran ke klien. Bantu susun strukturnya.",
  },
  {
    role: "assistant",
    time: "14:15",
    text: `Struktur email penawaran yang efektif:

1. **Subjek spesifik** — sebutkan manfaat utama, misal "Penawaran dashboard analitik untuk Toko Sejahtera".
2. **Pembuka satu kalimat** — konteks singkat kenapa kamu menghubungi.
3. **Masalah klien** — tunjukkan kamu paham kebutuhannya.
4. **Solusi & manfaat** — 2–3 poin, fokus pada hasil bukan fitur.
5. **Bukti** — contoh karya, angka, atau testimoni singkat.
6. **Ajakan tindakan** — ajakan yang jelas, misal tawaran panggilan 20 menit.

Mau kubuatkan draf lengkapnya? Sebutkan nama klien dan layanan yang ditawarkan.`,
  },
  {
    role: "user",
    time: "14:19",
    text: "Oh iya, apa itu context window yang sering disebut?",
  },
  {
    role: "assistant",
    time: "14:19",
    text: `**Context window** adalah "ingatan jangka pendek" model — jumlah token maksimum yang bisa diproses dalam satu percakapan.

- Satu token ± 4 karakter atau ± 0,75 kata.
- Semua pesan, instruksi, dan lampiran dihitung ke dalamnya.
- Kalau percakapan melebihi batas, bagian paling lama harus diringkas atau dipotong.

Di AzaleaHouse kamu bisa mengaturnya sendiri di panel kanan — default **4096 token** sebagai baseline yang aman untuk RAM.`,
  },
  {
    role: "user",
    time: "14:23",
    text: "Kalau mode Thinking itu apa?",
  },
  {
    role: "assistant",
    time: "14:23",
    text: `**Thinking Mode** membuat model menulis rantai penalaran internal dulu sebelum menjawab — cocok untuk soal matematika, analisis berlapis, atau keputusan yang butuh pertimbangan.

Kapan mengaktifkannya:
- Perencanaan dan analisis kompleks → **ON**
- Pertanyaan singkat, terjemahan, chat santai → **OFF** (respons lebih cepat)

Hasil akhirnya tetap jawaban bersih; trace internal tidak ikut disimpan ke riwayat percakapan.`,
  },
  {
    role: "user",
    time: "14:26",
    text: "Terima kasih! Sekian dulu untuk sesi pratinjau.",
  },
  {
    role: "assistant",
    time: "14:26",
    text: `Sama-sama! Ini **pratinjau antarmuka** — jawaban di sesi ini adalah teks contoh, belum dari model sungguhan.

Mulai **Fase 2**, percakapan akan dijalankan model lokal dengan streaming sungguhan. Sampai jumpa di percakapan berikutnya!`,
  },
];

/** Balasan mock saat pengguna mengirim pesan (jelas pratinjau lokal, bukan AI) */
export const mockReplies: string[] = [
  `Ini pratinjau antarmuka AzaleaHouse — pesan ini adalah **contoh statis**, belum dihasilkan model. Mulai Fase 2, jawaban akan mengalir langsung dari model lokal lengkap dengan indikator *Sedang berpikir…* dan tombol hentikan yang berfungsi.

Beberapa hal yang sudah bisa dicoba di pratinjau ini:
- Panel pengaturan di kanan: Thinking, context window, temperature.
- Profil respons: Quick Chat, Balanced, dan Deep Analysis.
- Version Center lewat chip versi di kiri bawah.`,
  `Pertanyaan yang bagus! Untuk pratinjau ini aku belum terhubung ke model — semuanya berjalan lokal sebagai demo tampilan.

Rencananya alur nantinya: pesanmu diproses **sepenuhnya lokal**, tanpa dikirim ke layanan cloud. Status model bisa dipantau dari kartu status di sidebar.

> Privasi bukan fitur tambahan — itu fondasi AzaleaHouse.`,
  `Siap! Sambil menunggu integrasi runtime pada Fase 2, coba jelajahi:

1. **Tampilan** — atur animasi latar dan intensitas blur di halaman Pengaturan.
2. **Profil respons** — ganti antara Quick Chat, Balanced, dan Deep Analysis di composer.
3. **Version Center** — klik chip \`AzaleaHouse v0.1.0\` di pojok kiri bawah.

Semua tombol update sengaja dinonaktifkan: unduhan hanya berjalan setelah kamu menekannya, dan itu baru aktif pada Fase 7.`,
];

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

export const changelogV010: string[] = [
  "Rilis pertama pratinjau: shell desktop dengan desain glassmorphism di atas latar senja.",
  "Sidebar lengkap: navigasi, status runtime, dan Version Center.",
  "Percakapan pratinjau dengan perender markdown, tabel, dan blok kode.",
  "Pengaturan tampilan: animasi latar, kurangi gerakan, intensitas blur.",
];

export function profileById(id: ProfileId): ProfileInfo {
  return profiles.find((p) => p.id === id) ?? profiles[1];
}
