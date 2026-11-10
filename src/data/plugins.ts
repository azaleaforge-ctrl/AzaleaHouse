export type PluginId =
  | "web-search"
  | "vision-bridge"
  | "docx-export"
  | "pdf-export"
  | "pptx-export"
  | "image-generation";

export interface PluginDefinition {
  id: PluginId;
  name: string;
  description: string;
}

export const PLUGINS: PluginDefinition[] = [
  {
    id: "web-search",
    name: "Web Search",
    description: "Pencarian web untuk informasi terkini dan sumber publik.",
  },
  {
    id: "vision-bridge",
    name: "Vision Bridge",
    description: "Model multimodal pendamping untuk membaca gambar bagi model utama yang hanya teks.",
  },
  {
    id: "docx-export",
    name: "DOCX Export",
    description: "Membuat dokumen Word lokal yang bisa diedit.",
  },
  {
    id: "pdf-export",
    name: "PDF Export",
    description: "Menyimpan pratinjau dokumen melalui dialog cetak Windows.",
  },
  {
    id: "pptx-export",
    name: "PPTX Export",
    description: "Membuat presentasi PowerPoint lokal dari outline Markdown.",
  },
  {
    id: "image-generation",
    name: "Image Generation",
    description: "Membuat gambar atau cover melalui endpoint image generation provider.",
  },
];

export function pluginAvailability(
  id: PluginId,
  connected: boolean,
  visionModel: string,
): { active: boolean; detail: string } {
  switch (id) {
    case "web-search":
      return { active: true, detail: "Tersedia saat kata kunci pencarian terdeteksi." };
    case "vision-bridge":
      return connected && Boolean(visionModel)
        ? { active: true, detail: "Vision helper terpilih." }
        : { active: false, detail: "Hubungkan 9Router dan pilih model vision helper." };
    case "docx-export":
      return { active: true, detail: "Tersedia di Studio Dokumen." };
    case "pdf-export":
      return { active: true, detail: "Tersedia melalui cetak ke PDF." };
    case "pptx-export":
      return { active: true, detail: "Tersedia di Studio Dokumen." };
    case "image-generation":
      return connected
        ? { active: true, detail: "Memerlukan model yang mendukung /images/generations." }
        : { active: false, detail: "Hubungkan 9Router terlebih dahulu." };
  }
}
