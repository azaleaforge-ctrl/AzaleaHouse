export type SkillId =
  | "lazy-dev"
  | "quick-response"
  | "file-analysis"
  | "web-research"
  | "document-engine"
  | "reasoning-adapter";

export type ResponseProfile = "quick" | "balanced" | "deep";

export const RESPONSE_PROFILE_PROMPTS: Record<ResponseProfile, string> = {
  quick: "Mode Quick Chat: jawab langsung, ringkas, dan tepat. Berikan detail hanya yang dibutuhkan untuk menyelesaikan pertanyaan. Hindari pembukaan panjang dan jangan menjalankan pencarian atau tool kecuali pengguna memintanya atau jelas diperlukan.",
  balanced: "Mode Balanced: berikan jawaban seimbang untuk percakapan sehari-hari. Jelaskan poin penting dengan cukup detail, gunakan struktur bila membantu, dan jangan bertele-tele.",
  deep: "Mode Deep Analysis: telaah masalah secara menyeluruh sebelum menjawab. Periksa asumsi, alternatif, risiko, dan edge case yang relevan. Susun jawaban akhir secara terstruktur dengan kesimpulan serta ringkasan alasan/metode yang dapat diperiksa. Jangan tampilkan chain-of-thought mentah. Gunakan web research hanya ketika permintaan memang membutuhkan sumber atau informasi eksternal.",
};

export function buildProfilePrompt(profile: ResponseProfile): string {
  return RESPONSE_PROFILE_PROMPTS[profile];
}

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  prompt: string;
}

export const SKILLS: SkillDefinition[] = [
  {
    id: "lazy-dev",
    name: "Lazy Dev",
    description: "Hemat konteks saat analisis dan pekerjaan coding.",
    prompt: "Lakukan pekerjaan secara hemat konteks: fokus hanya pada file dan bagian yang relevan, jangan mengulang pembacaan atau penjelasan, hindari perubahan yang tidak diminta, dan laporkan asumsi atau blocker secara eksplisit.",
  },
  {
    id: "quick-response",
    name: "Quick Response",
    description: "Jawab langsung tanpa uraian yang tidak diperlukan.",
    prompt: "Jawab langsung pada inti permintaan. Gunakan struktur seperlunya, hindari pengulangan, dan jangan menambahkan proses atau fitur yang tidak diminta.",
  },
  {
    id: "file-analysis",
    name: "File Analysis",
    description: "Gunakan isi lampiran yang sudah diekstrak, bukan menebak.",
    prompt: "Untuk lampiran, dasarkan jawaban hanya pada isi yang benar-benar tersedia. Tandai bagian yang gagal diekstrak atau tidak terbaca; jangan mengarang isi dokumen.",
  },
  {
    id: "web-research",
    name: "Web Research",
    description: "Cari informasi aktual dan sertakan sumber ketika hasil pencarian tersedia.",
    prompt: "Saat menerima hasil pencarian web yang disisipkan ke konteks, prioritaskan informasi terbaru, sebutkan tanggal yang tersedia, bedakan fakta sumber dan inferensi, dan sertakan tautan sumber. Jangan mengklaim sudah browsing bila tidak ada hasil pencarian.",
  },
  {
    id: "document-engine",
    name: "Document Engine",
    description: "Susun konten dokumen dengan hierarki dan format konsisten.",
    prompt: "Untuk permintaan dokumen, susun judul, hierarki heading, paragraf, tabel, dan daftar secara konsisten. Jangan mengklaim file telah dibuat atau disimpan kecuali tool dokumen mengembalikan path file yang valid.",
  },
  {
    id: "reasoning-adapter",
    name: "Thinking Adapter",
    description: "Aktifkan instruksi penalaran pada model tanpa mode thinking bawaan.",
    prompt: "Gunakan penalaran internal yang teliti sebelum menjawab. Jangan tampilkan chain-of-thought; berikan kesimpulan, alasan singkat yang dapat diperiksa, dan langkah kerja yang relevan.",
  },
];

export function detectSkills(prompt: string, hasAttachments: boolean, thinking: boolean): SkillId[] {
  const value = prompt.toLowerCase();
  const ids: SkillId[] = ["quick-response"];
  if (/\b(code|coding|bug|debug|repo|repository|typescript|javascript|rust|python|build|error|refactor|implementasi)\b/.test(value)) {
    ids.unshift("lazy-dev");
  }
  if (hasAttachments) ids.push("file-analysis");
  if (/\b(dokumen|buat dokumen|laporan|proposal|docx|pdf|pptx?|word|presentasi|presentation|slide|cover)\b/.test(value)) {
    ids.push("document-engine");
  }
  if (/\b(terbaru|terkini|hari ini|sekarang|latest|today|current|news|berita|harga|kurs|cuaca|jadwal|regulasi|aturan|web|internet|search|online|sumber|riset|research|deepsearch|deep\\s+search|deep\\s+research|telusuri|browsing|202[6-9])\b/.test(value)) {
    ids.push("web-research");
  }
  if (thinking) ids.push("reasoning-adapter");
  return [...new Set(ids)];
}

export function buildSkillsPrompt(ids: SkillId[]): string {
  const selected = SKILLS.filter((skill) => ids.includes(skill.id));
  if (!selected.length) return "";
  return [
    "Panduan skill aktif AzaleaHouse:",
    ...selected.map((skill) => `- ${skill.name}: ${skill.prompt}`),
  ].join("\n");
}
