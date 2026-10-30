import { useEffect, useRef, useState } from "react";
import type { ModelMeta, ModelPullProgress } from "../lib/tauri";
import type { RuntimeStatus } from "../types";
import { IconArrowLeft, IconRefresh, IconSparkles } from "./Icons";
import { invokePullModel, listenModelPullProgress } from "../lib/tauri";
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

  async function pull() {
    const name = modelTag.trim();
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

      {notice ? (
        <div className={"local-ai-notice is-" + notice.kind} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">
          {notice.text}
        </div>
      ) : null}
      {modelListError ? <div className="local-ai-notice is-error" role="alert">{modelListError}</div> : null}

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
    </section>
  );
}
