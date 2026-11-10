import { useEffect, useState } from "react";
import type { RouterModel } from "../lib/tauri";
import { invokeRouterGenerateImage } from "../lib/tauri";

export function ImageStudio({
  connected,
  models,
  initialPrompt,
  onOpenConnect,
}: {
  connected: boolean;
  models: RouterModel[];
  initialPrompt: string;
  onOpenConnect: () => void;
}) {
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">("1024x1024");
  const [image, setImage] = useState<{ mimeType: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrompt.trim()) setPrompt(initialPrompt.trim());
  }, [initialPrompt]);

  useEffect(() => {
    if (models.length === 0) {
      setModel("");
      return;
    }
    if (!models.some((item) => item.id === model)) setModel(models[0].id);
  }, [models, model]);

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
            {models.length === 0 ? <option value="">Hubungkan provider untuk memuat model</option> : null}
            {models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select>
          <p className="row-desc">Pilih model yang mendukung endpoint /images/generations. Tidak semua model 9Router mendukung pembuatan gambar.</p>

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
      </div>
    </div>
  );
}
