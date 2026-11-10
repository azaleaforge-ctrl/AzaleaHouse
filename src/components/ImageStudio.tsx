import { useEffect, useState } from "react";
import { invokeList9RouterImageModels, invokeList9RouterVideoModels, invokeRouterGenerateImage, invokeRouterGenerateVideo, type RouterModel, type GeneratedVideo } from "../lib/tauri";

export function ImageStudio({
  connected,
  initialPrompt,
  onOpenConnect,
}: {
  connected: boolean;
  initialPrompt: string;
  onOpenConnect: () => void;
}) {
  const [mode, setMode] = useState<"image" | "video">("image");
  const [model, setModel] = useState("");
  const [videoModels, setVideoModels] = useState<RouterModel[]>([]);
  const [videoModel, setVideoModel] = useState("");
  const [videoModelsBusy, setVideoModelsBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [videoJobStatus, setVideoJobStatus] = useState("idle");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<GeneratedVideo | null>(null);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoReferenceImage, setVideoReferenceImage] = useState<string | undefined>(undefined);
  const [videoReferenceName, setVideoReferenceName] = useState("");
  const [videoDuration, setVideoDuration] = useState(8);
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3">("16:9");
  const [videoResolution, setVideoResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [models, setModels] = useState<RouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">("1024x1024");
  const [image, setImage] = useState<{ mimeType: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrompt.trim()) setPrompt(initialPrompt.trim());
  }, [initialPrompt]);

  const refreshImageModels = async () => {
    if (!connected) {
      setModels([]);
      setModel("");
      return;
    }
    setLoadingModels(true);
    setError(null);
    try {
      const available = await invokeList9RouterImageModels();
      setModels(available);
      setModel((current) => available.some((item) => item.id === current) ? current : (available[0]?.id ?? ""));
    } catch (reason) {
      setModels([]);
      setModel("");
      setError(reason instanceof Error ? reason.message : "Katalog model gambar tidak dapat dimuat.");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    void refreshImageModels();
  }, [connected]);

  const refreshVideoModels = async () => {
    if (!connected) { setVideoModels([]); setVideoModel(""); return; }
    setVideoModelsBusy(true);
    setVideoError(null);
    try {
      const available = await invokeList9RouterVideoModels();
      setVideoModels(available);
      setVideoModel((current) => available.some((item) => item.id === current) ? current : (available[0]?.id ?? ""));
    } catch (reason) {
      setVideoModels([]);
      setVideoModel("");
      setVideoError(reason instanceof Error ? reason.message : "Katalog model video tidak dapat dimuat.");
    } finally { setVideoModelsBusy(false); }
  };

  useEffect(() => { void refreshVideoModels(); }, [connected]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ status: string; progress?: number | null }>("azalea:video_progress", (event) => {
        if (active) {
          setVideoJobStatus(event.payload.status);
          setVideoProgress(typeof event.payload.progress === "number" ? Math.max(0, Math.min(100, event.payload.progress)) : null);
        }
      }),
    ).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => { active = false; unlisten?.(); };
  }, []);

  const generateVideo = async () => {
    if (!connected) { onOpenConnect(); return; }
    if (!videoModel || !videoPrompt.trim()) return;
    setVideoBusy(true); setVideoError(null); setVideoResult(null); setVideoProgress(null); setVideoJobStatus("pending");
    try {
      const result = await invokeRouterGenerateVideo({ model: videoModel, prompt: videoPrompt.trim(), duration: videoDuration, aspectRatio: videoAspectRatio, resolution: videoResolution, image: videoReferenceImage });
      setVideoResult(result);
    } catch (reason) {
      setVideoError(reason instanceof Error ? reason.message : "Video generation gagal.");
    } finally { setVideoBusy(false); }
  };


  const generate = async () => {
    if (!connected) {
      onOpenConnect();
      return;
    }
    if (!model || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setImage(null);
    try {
      const result = await invokeRouterGenerateImage({ model, prompt: prompt.trim(), size });
      setImage(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image generation gagal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-screen image-studio">
      <div className="settings-inner">
        <header className="settings-header">
          <div>
            <h1 className="settings-title">Image Studio</h1>
            <p className="row-desc">Tool image generation melalui endpoint OpenAI-compatible 9Router.</p>
          </div>
        </header>
        <div className="studio-mode-tabs" role="tablist" aria-label="Jenis generasi">
          <button type="button" role="tab" aria-selected={mode === "image"} className={mode === "image" ? "studio-mode-tab active" : "studio-mode-tab"} onClick={() => setMode("image")}>Image generation</button>
          <button type="button" role="tab" aria-selected={mode === "video"} className={mode === "video" ? "studio-mode-tab active" : "studio-mode-tab"} onClick={() => setMode("video")}>Motion / video</button>
        </div>

        {mode === "image" ? (
          <>
        <section className="settings-section">
          <div className="image-studio-connection">
            <span className={"status-dot " + (connected ? "status-dot--ready" : "status-dot--error")} />
            <strong>{connected ? "9Router terhubung" : "9Router belum terhubung"}</strong>
            {!connected ? <button type="button" className="btn btn--primary" onClick={onOpenConnect}>Connect 9Router</button> : null}
          </div>

          <label className="command-label" htmlFor="image-model">Model image generation</label>
          <select
            id="image-model"
            className="select select--full"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={!connected || models.length === 0}
          >
            {models.length === 0 ? <option value="">{loadingModels ? "Memuat katalog image model…" : "Tidak ada model gambar yang tersedia"}</option> : null}
            {models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select>
          <button type="button" className="btn btn--ghost" disabled={!connected || loadingModels} onClick={() => void refreshImageModels()}>{loadingModels ? "Memuat model…" : "Refresh image models"}</button>
          <p className="row-desc">Daftar diambil langsung dari endpoint khusus /v1/models/image milik 9Router, bukan hasil tebakan dari nama model chat.</p>

          {initialPrompt.trim() ? (
            <button type="button" className="btn btn--ghost" onClick={() => setPrompt(initialPrompt.trim())}>Gunakan deskripsi AI terakhir</button>
          ) : null}
          <label className="command-label" htmlFor="image-prompt">Prompt gambar atau cover</label>
          <textarea
            id="image-prompt"
            className="image-prompt"
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Jelaskan gambar, gaya visual, komposisi, warna, rasio, dan teks yang perlu muncul…"
            maxLength={20000}
          />

          <label className="command-label" htmlFor="image-size">Ukuran gambar</label>
          <select id="image-size" className="select select--full" value={size} onChange={(event) => setSize(event.target.value as typeof size)}>
            <option value="1024x1024">Persegi · 1024 × 1024</option>
            <option value="1024x1536">Potret · 1024 × 1536</option>
            <option value="1536x1024">Landscape · 1536 × 1024</option>
          </select>

          {error ? <p className="command-error" role="alert">{error}</p> : null}
          <button type="button" className="btn btn--primary" disabled={!connected || !model || !prompt.trim() || busy} onClick={() => void generate()}>
            {busy ? "Membuat gambar…" : "Generate image"}
          </button>
        </section>

        {image ? (
          <section className="settings-section">
            <h2 className="panel-title">Hasil gambar</h2>
            <img className="generated-image" src={"data:" + image.mimeType + ";base64," + image.base64} alt="Gambar hasil generasi AzaleaHouse" />
            <a className="btn" href={"data:" + image.mimeType + ";base64," + image.base64} download="AzaleaHouse-generated-image.png">Simpan gambar</a>
          </section>
        ) : null}
          </>
        ) : (
          <section className="settings-section video-studio">
            <div className="image-studio-connection">
              <span className={"status-dot " + (connected ? "status-dot--ready" : "status-dot--error")} />
              <strong>{connected ? "9Router terhubung" : "9Router belum terhubung"}</strong>
              {!connected ? <button type="button" className="btn btn--primary" onClick={onOpenConnect}>Connect 9Router</button> : null}
              <button type="button" className="btn btn--ghost" disabled={!connected || videoModelsBusy} onClick={() => void refreshVideoModels()}>{videoModelsBusy ? "Memuat…" : "Refresh video models"}</button>
            </div>
            <label className="command-label" htmlFor="video-model">Model video</label>
            <select id="video-model" className="select select--full" value={videoModel} onChange={(event) => setVideoModel(event.target.value)} disabled={!connected || videoModels.length === 0 || videoModelsBusy}>
              {videoModels.length === 0 ? <option value="">{videoModelsBusy ? "Memuat katalog video…" : "Tidak ada model video yang tersedia"}</option> : null}
              {videoModels.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
            </select>
            <p className="row-desc">9Router membuat video secara asynchronous dan memeriksa status sampai hasil siap. Model, akses, dan kuota bergantung pada provider yang terhubung.</p>
            <label className="command-label" htmlFor="video-prompt">Deskripsi motion / video</label>
            <textarea id="video-prompt" className="image-prompt" rows={5} value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} maxLength={4000} placeholder="Contoh: Kamera bergerak perlahan mendekati rumah di tepi pantai, ombak bergerak dan awan melintas…" />
            <label className="command-label" htmlFor="video-reference-image">Gambar referensi (opsional · image-to-video)</label>
            <input id="video-reference-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) { setVideoReferenceImage(undefined); setVideoReferenceName(""); return; }
              if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
                setVideoError("Pilih gambar PNG, JPEG, atau WebP dengan ukuran maksimum 20 MiB.");
                event.currentTarget.value = "";
                return;
              }
              const reader = new FileReader();
              reader.onload = () => { setVideoReferenceImage(typeof reader.result === "string" ? reader.result : undefined); setVideoReferenceName(file.name); setVideoError(null); };
              reader.onerror = () => setVideoError("Gambar referensi tidak dapat dibaca.");
              reader.readAsDataURL(file);
            }} />
            {videoReferenceName ? <p className="row-desc">Frame awal: {videoReferenceName} <button type="button" className="btn btn--ghost" onClick={() => { setVideoReferenceImage(undefined); setVideoReferenceName(""); }}>Hapus</button></p> : null}
            <div className="video-studio-options">
              <label><span>Durasi</span><select className="select select--full" value={videoDuration} onChange={(event) => setVideoDuration(Number(event.target.value))}><option value={5}>5 detik</option><option value={8}>8 detik</option><option value={10}>10 detik</option><option value={12}>12 detik</option><option value={15}>15 detik</option></select></label>
              <label><span>Rasio</span><select className="select select--full" value={videoAspectRatio} onChange={(event) => setVideoAspectRatio(event.target.value as typeof videoAspectRatio)}>{(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"] as const).map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
              <label><span>Resolusi</span><select className="select select--full" value={videoResolution} onChange={(event) => setVideoResolution(event.target.value as typeof videoResolution)}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
            </div>
            {videoError ? <p className="command-error" role="alert">{videoError}</p> : null}
            <button type="button" className="btn btn--primary" disabled={!connected || !videoModel || !videoPrompt.trim() || videoBusy} onClick={() => void generateVideo()}>{videoBusy ? "Membuat video dan menunggu hasil…" : "Generate motion video"}</button>
            {videoBusy ? (
              <div className="video-job-progress" role="status" aria-live="polite">
                <div className="video-job-progress-label"><span>{videoJobStatus === "pending" ? "Menunggu antrean" : "Membuat video…"}</span><strong>{videoProgress === null ? "…" : videoProgress + "%"}</strong></div>
                <progress max={100} value={videoProgress ?? undefined} />
                <p>Jangan kirim ulang selama tugas berjalan. 9Router memproses video secara asynchronous.</p>
              </div>
            ) : null}
          </section>
        )}
        {mode === "video" && videoResult ? (
          <section className="settings-section">
            <h2 className="panel-title">Hasil motion video</h2>
            <video className="generated-video" controls playsInline src={videoResult.url} />
            <p className="row-desc">{videoResult.model} · {videoResult.duration ?? videoDuration} detik</p>
            <a className="btn" href={videoResult.url} target="_blank" rel="noopener noreferrer">Buka / unduh video MP4</a>
          </section>
        ) : null}
      </div>
    </div>
  );
}
