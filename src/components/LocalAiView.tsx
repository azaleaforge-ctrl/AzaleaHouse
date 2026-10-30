import { useEffect, useRef, useState } from "react";
import type { LocalHardwareInfo, ModelMeta, ModelPullProgress } from "../lib/tauri";
import type { RuntimeStatus } from "../types";
import { IconArrowLeft, IconRefresh, IconSparkles } from "./Icons";
import { invokePullModel, listenModelPullProgress, invokeScanHardware } from "../lib/tauri";
import "./LocalAiView.css";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Ukuran belum diketahui";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    "pulling manifest": "Membaca manifest model",
    "verifying sha256 digest": "Memverifikasi checksum model",
    "writing manifest": "Mendaftarkan model di Ollama",
    "removing any unused layers": "Membersihkan layer lama",
    success: "Unduhan selesai",
    error: "Unduhan gagal",
  };
  if (status.startsWith("downloading ")) return "Mengunduh layer model";
  return labels[status] ?? status;
}

type ModelTask = "general" | "coding" | "vision" | "reasoning";
type ModelFit = "recommended" | "slow" | "unsupported";

interface CatalogModel {
  id: string;
  name: string;
  task: ModelTask;
  sizeGb: number;
  minRamGb: number;
  recommendedRamGb: number;
  minDiskGb: number;
  recommendedVramGb: number;
  vision: boolean;
  summary: string;
}

const MODEL_CATALOG: CatalogModel[] = [
  { id: "qwen3:0.6b", name: "Qwen3 0.6B", task: "general", sizeGb: 0.6, minRamGb: 3, recommendedRamGb: 4, minDiskGb: 2, recommendedVramGb: 0, vision: false, summary: "Paling ringan untuk chat sederhana, instruksi singkat, dan perangkat terbatas." },
  { id: "llama3.2:1b", name: "Llama 3.2 1B", task: "general", sizeGb: 1.3, minRamGb: 4, recommendedRamGb: 6, minDiskGb: 3, recommendedVramGb: 2, vision: false, summary: "Asisten teks ringan untuk pemakaian harian." },
  { id: "gemma3:1b", name: "Gemma 3 1B", task: "vision", sizeGb: 0.8, minRamGb: 4, recommendedRamGb: 6, minDiskGb: 3, recommendedVramGb: 2, vision: true, summary: "Varian ringkas yang mendukung teks dan gambar." },
  { id: "qwen3:1.7b", name: "Qwen3 1.7B", task: "reasoning", sizeGb: 1.4, minRamGb: 4, recommendedRamGb: 8, minDiskGb: 3, recommendedVramGb: 3, vision: false, summary: "Keseimbangan ukuran dan kemampuan mengikuti instruksi." },
  { id: "llama3.2:3b", name: "Llama 3.2 3B", task: "general", sizeGb: 2.0, minRamGb: 6, recommendedRamGb: 8, minDiskGb: 4, recommendedVramGb: 4, vision: false, summary: "Chat umum dengan kemampuan lebih baik daripada varian 1B." },
  { id: "qwen2.5-coder:3b", name: "Qwen2.5 Coder 3B", task: "coding", sizeGb: 1.9, minRamGb: 6, recommendedRamGb: 10, minDiskGb: 4, recommendedVramGb: 4, vision: false, summary: "Diarahkan untuk bantuan coding dan penjelasan kode." },
  { id: "qwen3:4b", name: "Qwen3 4B", task: "reasoning", sizeGb: 2.6, minRamGb: 8, recommendedRamGb: 12, minDiskGb: 5, recommendedVramGb: 6, vision: false, summary: "Kualitas penalaran lebih kuat dengan kebutuhan memori menengah." },
  { id: "gemma3:4b", name: "Gemma 3 4B", task: "vision", sizeGb: 3.3, minRamGb: 8, recommendedRamGb: 12, minDiskGb: 6, recommendedVramGb: 6, vision: true, summary: "Pilihan multimodal untuk memahami gambar dan teks." },
  { id: "qwen2.5vl:3b", name: "Qwen2.5-VL 3B", task: "vision", sizeGb: 3.3, minRamGb: 8, recommendedRamGb: 12, minDiskGb: 6, recommendedVramGb: 6, vision: true, summary: "Model vision untuk dokumen bergambar, foto, dan tanya-jawab visual." },
  { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", task: "coding", sizeGb: 4.7, minRamGb: 12, recommendedRamGb: 20, minDiskGb: 8, recommendedVramGb: 8, vision: false, summary: "Model coding lebih besar; butuh memori lebih longgar." },
  { id: "qwen3:8b", name: "Qwen3 8B", task: "reasoning", sizeGb: 5.2, minRamGb: 12, recommendedRamGb: 20, minDiskGb: 9, recommendedVramGb: 8, vision: false, summary: "Model general-purpose lebih kuat untuk analisis dan tugas kompleks." },
  { id: "gemma3:12b", name: "Gemma 3 12B", task: "vision", sizeGb: 8.1, minRamGb: 16, recommendedRamGb: 24, minDiskGb: 13, recommendedVramGb: 12, vision: true, summary: "Pilihan multimodal besar; hanya untuk PC dengan memori dan ruang disk cukup." },
];

const TASK_LABELS: Record<ModelTask, string> = {
  general: "Chat umum",
  coding: "Coding",
  vision: "Memahami gambar",
  reasoning: "Penalaran",
};

function bytesToGb(bytes: number): number {
  return bytes / (1024 ** 3);
}

function formatGb(gigabytes: number): string {
  return `${gigabytes.toLocaleString("id-ID", { maximumFractionDigits: 1 })} GB`;
}

function assessModel(model: CatalogModel, hardware: LocalHardwareInfo): ModelFit {
  const totalRam = bytesToGb(hardware.ramTotalBytes);
  const currentlyAvailableRam = bytesToGb(hardware.ramAvailableBytes);
  const freeDisk = bytesToGb(hardware.diskAvailableBytes);
  const gpuRamValues = hardware.gpus
    .map((gpu) => gpu.vramBytes)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const maxVram = gpuRamValues.length ? Math.max(...gpuRamValues.map(bytesToGb)) : 0;
  const usableGpuRam = maxVram >= model.recommendedVramGb;
  const memoryTooLow = totalRam < model.minRamGb;
  const diskTooLow = freeDisk < model.minDiskGb;

  if (memoryTooLow || diskTooLow) return "unsupported";

  // Low currently available RAM is a yellow warning rather than a red block:
  // the user may close other applications before loading the model.
  if (currentlyAvailableRam < model.minRamGb) return "slow";

  // Green is deliberately conservative: sufficient RAM plus either enough VRAM,
  // or a very small model likely to remain usable on CPU-only systems.
  const cpuFriendly = model.sizeGb <= 1.5 && hardware.cpuCores >= 4 && totalRam >= model.recommendedRamGb;
  if (totalRam >= model.recommendedRamGb && (usableGpuRam || cpuFriendly)) return "recommended";

  // Small general-purpose models can still be smooth on capable CPU-only systems.
  if (totalRam >= model.recommendedRamGb + 4 && hardware.logicalProcessors >= 8 && model.sizeGb <= 2.6) {
    return "recommended";
  }
  return "slow";
}

function fitLabel(fit: ModelFit): string {
  if (fit === "recommended") return "REKOMENDASI · LANCAR";
  if (fit === "slow") return "BISA, TAPI LAMBAT";
  return "TIDAK COCOK UNTUK SPEK INI";
}

function fitRank(fit: ModelFit): number {
  return fit === "recommended" ? 0 : fit === "slow" ? 1 : 2;
}

function modelTaskMatches(model: CatalogModel, task: ModelTask): boolean {
  if (task === "general") return model.task === "general" || model.task === "reasoning";
  return model.task === task;
}

export function LocalAiView({
  models,
  modelListError,
  runtimeStatus,
  selectedModel,
  onRefreshModels,
  onUseModel,
  onBackToChat,
}: {
  models: ModelMeta[];
  modelListError: string | null;
  runtimeStatus: RuntimeStatus;
  selectedModel: string;
  onRefreshModels: () => Promise<ModelMeta[]>;
  onUseModel: (modelId: string) => void;
  onBackToChat: () => void;
}) {
  const [modelTag, setModelTag] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<ModelPullProgress | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const pullTargetRef = useRef("");
  const [hardware, setHardware] = useState<LocalHardwareInfo | null>(null);
  const [scanningHardware, setScanningHardware] = useState(false);
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [modelTask, setModelTask] = useState<ModelTask>("general");

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    void listenModelPullProgress((progress) => {
      if (!alive || progress.model !== pullTargetRef.current) return;
      setPullProgress(progress);
      if (progress.error) {
        setNotice({ kind: "error", text: progress.error });
        setPulling(false);
      } else if (progress.status === "success") {
        setNotice({ kind: "success", text: `Model ${progress.model} selesai diunduh dan sudah masuk daftar Ollama.` });
      }
    }).then((unlisten) => {
      if (alive) stop = unlisten;
      else unlisten();
    }).catch((error) => {
      if (alive) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Listener progres model gagal disiapkan." });
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  async function refresh() {
    setNotice(null);
    const refreshed = await onRefreshModels();
    if (!refreshed.length) {
      setNotice({
        kind: "info",
        text: "Belum ada model lokal yang terdeteksi. Pastikan Ollama aktif atau unduh model dari bagian di bawah.",
      });
    } else {
      setNotice({ kind: "success", text: `Daftar Ollama diperbarui: ${refreshed.length} model lokal terdeteksi.` });
    }
  }

  async function scanHardware() {
    setScanningHardware(true);
    setHardwareError(null);
    try {
      const info = await invokeScanHardware();
      setHardware(info);
      setNotice({ kind: "success", text: "Spesifikasi berhasil dibaca secara lokal dari Windows." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Spesifikasi PC tidak dapat diperiksa.";
      setHardwareError(message);
      setNotice({ kind: "error", text: message });
    } finally {
      setScanningHardware(false);
    }
  }

  async function pull(requestedModel?: string) {
    const name = (requestedModel ?? modelTag).trim();
    if (!name) {
      setNotice({ kind: "error", text: "Masukkan nama atau tag model Ollama terlebih dahulu." });
      return;
    }
    const installed = models.some((model) => model.id.toLowerCase() === name.toLowerCase());
    if (installed) {
      setNotice({ kind: "info", text: `Model ${name} sudah terpasang. Pilih model itu dari daftar lokal.` });
      return;
    }

    pullTargetRef.current = name;
    setPulling(true);
    setPullProgress({ model: name, status: "starting", digest: null, completed: null, total: null, percent: null, error: null });
    setNotice({ kind: "info", text: `Memulai unduhan ${name} melalui Ollama. Ukuran model dan waktu selesai bergantung pada model serta koneksi internet.` });
    try {
      await invokePullModel(name);
      const refreshed = await onRefreshModels();
      if (refreshed.some((model) => model.id.toLowerCase() === name.toLowerCase())) {
        setNotice({ kind: "success", text: `Model ${name} berhasil diunduh dan terdeteksi di daftar lokal.` });
        setModelTag("");
      } else {
        setNotice({ kind: "info", text: "Ollama menyelesaikan proses pull, tetapi nama model yang dilaporkan berbeda dari tag yang dimasukkan. Periksa daftar model lokal." });
      }
      setPullProgress((previous) => previous ? { ...previous, status: "success", percent: 100 } : previous);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unduhan model gagal.";
      setNotice({ kind: "error", text: message });
      setPullProgress((previous) => previous ? { ...previous, status: "error", error: message } : previous);
    } finally {
      setPulling(false);
    }
  }

  const pullPercent = pullProgress?.percent;
  const statusIsDone = pullProgress?.status === "success";
  const runtimeIsAvailable = runtimeStatus !== "not_installed" && runtimeStatus !== "runtime_unavailable" && runtimeStatus !== "error";
  const assessedModels = hardware
    ? MODEL_CATALOG.filter((model) => modelTaskMatches(model, modelTask))
        .map((model) => ({ ...model, fit: assessModel(model, hardware) }))
        .sort((a, b) => fitRank(a.fit) - fitRank(b.fit) || a.sizeGb - b.sizeGb)
    : [];
  const bestModel = assessedModels.find((model) => model.fit !== "unsupported") ?? assessedModels[0] ?? null;
  const gpuDescription = hardware?.gpus.length
    ? hardware.gpus.map((gpu) => `${gpu.name}${gpu.vramBytes ? ` · ${formatGb(bytesToGb(gpu.vramBytes))} VRAM` : " · VRAM tidak terbaca akurat"}`).join(" · ")
    : "GPU terpisah tidak terdeteksi";

  return (
    <section className="local-ai-page" aria-label="Pengelolaan AI lokal Ollama">
      <header className="local-ai-header">
        <button type="button" className="btn" onClick={onBackToChat}>
          <IconArrowLeft size={16} />
          Kembali ke Chat
        </button>
        <div className="local-ai-title-wrap">
          <span className="local-ai-eyebrow">Ollama Runtime</span>
          <h1>AI Lokal</h1>
          <p>Kelola model yang tersimpan di komputer dan pilih model yang digunakan untuk chat.</p>
        </div>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={pulling}>
          <IconRefresh size={15} />
          Segarkan daftar
        </button>
      </header>

      <div className="local-ai-status-row">
        <span className={"status-dot " + (runtimeIsAvailable ? "status-dot--ready" : "status-dot--error")} />
        <div>
          <strong>{runtimeIsAvailable ? "Ollama terdeteksi" : "Ollama belum siap"}</strong>
          <span>{runtimeIsAvailable ? "Daftar di bawah diambil dari instalasi Ollama lokal." : "Buka atau pasang Ollama terlebih dahulu, lalu segarkan daftar."}</span>
        </div>
        <a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer">Unduh Ollama</a>
      </div>

      {hardwareError ? <div className="local-ai-notice is-error" role="alert">{hardwareError}</div> : null}
      {notice ? (
        <div className={"local-ai-notice is-" + notice.kind} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.text}
        </div>
      ) : null}
      {modelListError ? <div className="local-ai-notice is-error" role="alert">{modelListError}</div> : null}

      <section className="local-ai-panel local-ai-hardware-panel" aria-label="Pemindaian spesifikasi dan rekomendasi model">
        <div className="local-ai-panel-heading">
          <div>
            <h2><IconSparkles size={16} /> Periksa Spesifikasi PC</h2>
            <p>Data dibaca dari Windows secara lokal. Rekomendasi adalah estimasi konservatif, bukan jaminan kecepatan.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => void scanHardware()} disabled={scanningHardware || pulling}>
            {scanningHardware ? "Memeriksa…" : hardware ? "Periksa Ulang" : "Periksa Spesifikasi"}
          </button>
        </div>

        {!hardware && !scanningHardware ? (
          <div className="local-ai-hardware-empty">
            Periksa perangkat terlebih dahulu untuk menghitung rekomendasi model. Tidak ada spesifikasi yang dikirim ke server.
          </div>
        ) : null}
        {scanningHardware ? (
          <div className="local-ai-hardware-loading" role="status">
            <span className="local-ai-hardware-spinner" />
            Membaca CPU, RAM, GPU/VRAM, dan ruang disk…
          </div>
        ) : null}
        {hardware ? (
          <>
            <div className="local-ai-spec-grid">
              <div className="local-ai-spec-card">
                <span>PROSESOR</span>
                <strong>{hardware.cpuName}</strong>
                <small>{hardware.cpuCores} core · {hardware.logicalProcessors} logical processor</small>
              </div>
              <div className="local-ai-spec-card">
                <span>RAM</span>
                <strong>{formatGb(bytesToGb(hardware.ramTotalBytes))}</strong>
                <small>{formatGb(bytesToGb(hardware.ramAvailableBytes))} tersedia saat dipindai</small>
              </div>
              <div className="local-ai-spec-card">
                <span>GPU / VRAM</span>
                <strong>{hardware.gpus.length ? hardware.gpus[0].name : "Tidak terdeteksi"}</strong>
                <small>{gpuDescription}</small>
              </div>
              <div className="local-ai-spec-card">
                <span>RUANG DISK C:</span>
                <strong>{formatGb(bytesToGb(hardware.diskAvailableBytes))}</strong>
                <small>{hardware.osName}</small>
              </div>
            </div>
            <p className="local-ai-hardware-footnote">
              VRAM dari Windows bisa tidak lengkap untuk beberapa GPU. Jika VRAM tidak tersedia, penilaian memakai RAM, CPU, dan ruang disk. Angka kebutuhan model bergantung pada tag/kuantisasi dan konteks chat.
            </p>
            {bestModel ? (
              <section className={"local-ai-best-model fit-" + bestModel.fit} aria-label="Model paling direkomendasikan">
                <div className="local-ai-best-copy">
                  <span className="local-ai-best-eyebrow">PALING DIREKOMENDASIKAN UNTUK SPEK INI</span>
                  <h3>{bestModel.name} <span className={"local-ai-fit-label fit-" + bestModel.fit}>{fitLabel(bestModel.fit)}</span></h3>
                  <p>{bestModel.summary}</p>
                  <div className="local-ai-best-meta">
                    <span>Unduhan ± {formatGb(bestModel.sizeGb)}</span>
                    <span>RAM minimal estimasi {bestModel.minRamGb} GB</span>
                    <span>RAM nyaman estimasi {bestModel.recommendedRamGb} GB</span>
                    <span>{TASK_LABELS[bestModel.task]}</span>
                  </div>
                </div>
                {models.some((model) => model.id.toLowerCase() === bestModel.id.toLowerCase()) ? (
                  <button type="button" className="btn btn--primary" onClick={() => onUseModel(bestModel.id)}>Gunakan di Chat</button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void pull(bestModel.id)}
                    disabled={pulling || scanningHardware || bestModel.fit === "unsupported"}
                    title={bestModel.fit === "unsupported" ? "Tidak ada model yang memenuhi batas minimum estimasi RAM dan ruang disk." : undefined}
                  >
                    {bestModel.fit === "unsupported" ? "Spek belum memadai" : pulling ? "Mengunduh…" : "Download rekomendasi"}
                  </button>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="local-ai-columns">
        <section className="local-ai-panel">
          <div className="local-ai-panel-heading">
            <div>
              <h2>Model terpasang</h2>
              <p>{models.length} model ditemukan dari Ollama di perangkat ini</p>
            </div>
            <span className="local-ai-count">{models.length}</span>
          </div>

          {models.length === 0 ? (
            <div className="local-ai-empty">
              <IconSparkles size={28} />
              <strong>Belum ada model yang terdeteksi</strong>
              <p>Model tidak dibundel di installer AzaleaHouse. Unduh model di bawah atau refresh setelah memasangnya sendiri melalui Ollama.</p>
            </div>
          ) : (
            <div className="local-ai-model-list">
              {models.map((model) => {
                const active = model.id === selectedModel;
                return (
                  <article className={"local-ai-model-card" + (active ? " is-selected" : "")} key={model.id}>
                    <div className="local-ai-model-main">
                      <div className="local-ai-model-icon"><IconSparkles size={18} /></div>
                      <div className="local-ai-model-info">
                        <strong>{model.name}</strong>
                        <span>{formatBytes(model.size)}</span>
                        <div className="local-ai-badges">
                          {model.vision_supported ? <span>Vision</span> : <span>Teks</span>}
                          {model.thinking_supported ? <span>Thinking terdeteksi</span> : null}
                        </div>
                      </div>
                    </div>
                    <button type="button" className={active ? "btn btn--sm btn--primary" : "btn btn--sm"} onClick={() => onUseModel(model.id)}>
                      {active ? "Sedang dipilih" : "Gunakan di Chat"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="local-ai-catalog-stack">
        <section className="local-ai-panel local-ai-catalog-panel">
          <div className="local-ai-panel-heading">
            <div>
              <h2>Katalog & rekomendasi model</h2>
              <p>Urutan prioritas: hijau direkomendasikan, kuning bisa berjalan lebih lambat, merah tidak cukup sumber daya untuk penggunaan stabil.</p>
            </div>
          </div>
          <div className="local-ai-task-filter" role="group" aria-label="Tujuan penggunaan model">
            {([
              ["general", "Chat umum"],
              ["coding", "Coding"],
              ["vision", "Memahami gambar"],
              ["reasoning", "Penalaran"],
            ] as Array<[ModelTask, string]>).map(([task, label]) => (
              <button key={task} type="button" className={modelTask === task ? "is-active" : ""} onClick={() => setModelTask(task)}>{label}</button>
            ))}
          </div>
          {!hardware ? (
            <div className="local-ai-empty local-ai-catalog-needs-scan">
              <IconSparkles size={26} />
              <strong>Periksa spesifikasi untuk mengurutkan model</strong>
              <p>Setelah pemindaian, model akan diberi label hijau, kuning, atau merah dan model teratas dipisahkan sebagai rekomendasi utama.</p>
              <button type="button" className="btn btn--primary" onClick={() => void scanHardware()} disabled={scanningHardware}>
                {scanningHardware ? "Memeriksa…" : "Periksa Spesifikasi PC"}
              </button>
            </div>
          ) : (
            <div className="local-ai-recommendation-list">
              {assessedModels.map((model, index) => {
                const installed = models.some((localModel) => localModel.id.toLowerCase() === model.id.toLowerCase());
                return (
                  <article key={model.id} className={"local-ai-recommendation-card fit-" + model.fit + (index === 0 ? " is-priority" : "")}>
                    <div className="local-ai-recommendation-main">
                      <div className="local-ai-recommendation-rank">{index + 1}</div>
                      <div className="local-ai-recommendation-copy">
                        <div className="local-ai-recommendation-title">
                          <strong>{model.name}</strong>
                          {index === 0 ? <span className="local-ai-top-tag">PRIORITAS</span> : null}
                        </div>
                        <span>{model.id} · {TASK_LABELS[model.task]} · ± {formatGb(model.sizeGb)}</span>
                        <p>{model.summary}</p>
                        <span className={"local-ai-fit-label fit-" + model.fit}>{fitLabel(model.fit)}</span>
                        {model.fit === "unsupported" ? (
                          <small>Tidak direkomendasikan berdasarkan RAM atau ruang disk yang terdeteksi. Model masih mungkin dipaksa berjalan, tetapi bisa gagal memuat atau memakai swap secara berat.</small>
                        ) : model.fit === "slow" ? (
                          <small>Model kemungkinan bisa dijalankan, tetapi respons lebih lambat karena anggaran RAM/VRAM atau akselerasi GPU terbatas.</small>
                        ) : (
                          <small>Estimasi memori cukup untuk menjalankan model lebih nyaman. Kecepatan sebenarnya tetap bergantung pada model, konteks, dan runtime.</small>
                        )}
                      </div>
                    </div>
                    {installed ? (
                      <button type="button" className="btn btn--sm" onClick={() => onUseModel(model.id)}>Gunakan</button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => void pull(model.id)}
                        disabled={pulling || scanningHardware || model.fit === "unsupported"}
                        title={model.fit === "unsupported" ? "Tidak disarankan: RAM atau ruang disk berada di bawah batas minimum estimasi." : undefined}
                      >
                        {model.fit === "unsupported" ? "Tidak cocok" : pulling ? "Menunggu…" : "Download"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="local-ai-panel local-ai-download-panel">
          <div className="local-ai-panel-heading">
            <div>
              <h2>Tambah model</h2>
              <p>Masukkan nama dari pustaka Ollama atau model reference yang didukung Ollama.</p>
            </div>
          </div>
          <form
            className="local-ai-pull-form"
            onSubmit={(event) => {
              event.preventDefault();
              void pull();
            }}
          >
            <label htmlFor="ollama-model-tag">Nama / tag model</label>
            <input
              id="ollama-model-tag"
              className="input"
              value={modelTag}
              onChange={(event) => setModelTag(event.target.value)}
              placeholder="contoh: qwen3:8b"
              maxLength={180}
              disabled={pulling}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn--primary btn--block" disabled={pulling || !modelTag.trim()}>
              {pulling ? "Mengunduh model…" : "Download model lewat Ollama"}
            </button>
          </form>
          <div className="local-ai-examples">
            <span>Contoh tag</span>
            <button type="button" disabled={pulling} onClick={() => setModelTag("qwen3:8b")}>qwen3:8b</button>
            <button type="button" disabled={pulling} onClick={() => setModelTag("llama3.2:3b")}>llama3.2:3b</button>
            <button type="button" disabled={pulling} onClick={() => setModelTag("gemma3:4b")}>gemma3:4b</button>
          </div>
          <a className="local-ai-library-link" href="https://ollama.com/library" target="_blank" rel="noreferrer">Jelajahi pustaka model Ollama</a>
          <p className="local-ai-download-help">
            Unduhan memerlukan internet dan ruang disk. Model tetap berada di penyimpanan Ollama, bukan disalin ke installer AzaleaHouse. Model yang sudah kamu unduh sendiri melalui Ollama akan muncul setelah daftar disegarkan.
          </p>

          {pulling || pullProgress ? (
            <div className="local-ai-progress" aria-live="polite">
              <div className="local-ai-progress-head">
                <strong>{pullProgress?.model ?? modelTag}</strong>
                {typeof pullPercent === "number" ? <span>{Math.round(pullPercent)}%</span> : <span>{statusIsDone ? "100%" : "Memproses"}</span>}
              </div>
              <div className={"local-ai-progress-track" + (typeof pullPercent !== "number" && !statusIsDone ? " is-indeterminate" : "")}>
                <span style={{ width: typeof pullPercent === "number" ? `${Math.max(0, Math.min(100, pullPercent))}%` : statusIsDone ? "100%" : "35%" }} />
              </div>
              <p>{pullProgress ? statusText(pullProgress.status) : "Menyiapkan unduhan…"}</p>
              {pullProgress?.total && pullProgress.completed !== null ? (
                <span className="local-ai-progress-bytes">{formatBytes(pullProgress.completed ?? 0)} / {formatBytes(pullProgress.total)}</span>
              ) : null}
              <small>Persentase mengikuti layer unduhan yang sedang dilaporkan Ollama, bukan perkiraan waktu selesai memuat model ke RAM.</small>
            </div>
          ) : null}
        </section>
        </div>
      </div>
    </section>
  );
}
