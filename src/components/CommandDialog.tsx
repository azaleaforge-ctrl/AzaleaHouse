import { useEffect, useState } from "react";
import type { AiProvider, Message } from "../types";

export type CommandDialogMode = "menu" | "model" | "connect" | "sessions";

export interface CommandModelOption {
  id: string;
  name: string;
}

export function CommandDialog({
  mode,
  provider,
  connected,
  models,
  selectedModel,
  history,
  busy,
  error,
  onClose,
  onModeChange,
  onProviderChange,
  onModelChange,
  onConnect,
  onDisconnect,
  onRefreshModels,
  onOpenSession,
  onDeleteSession,
}: {
  mode: CommandDialogMode | null;
  provider: AiProvider;
  connected: boolean;
  models: CommandModelOption[];
  selectedModel: string;
  history: Message[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onModeChange: (mode: CommandDialogMode) => void;
  onProviderChange: (provider: AiProvider) => void;
  onModelChange: (model: string) => void;
  onConnect: (apiKey: string) => Promise<void>;
  onDisconnect: () => void;
  onRefreshModels: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (mode !== "connect") setApiKey("");
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, onClose]);

  if (!mode) return null;

  return (
    <div className="modal-overlay command-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal command-modal" role="dialog" aria-modal="true" aria-label="Perintah AzaleaHouse">
        <div className="modal-head">
          <h2 className="modal-title">
            {mode === "menu" ? "Perintah" : mode === "model" ? "Pilih model AI" : mode === "connect" ? "Connect 9Router" : "Riwayat sesi"}
          </h2>
          <span className="tag">/</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">×</button>
        </div>

        {mode === "menu" ? (
          <div className="command-list">
            <button type="button" className="command-item" onClick={() => onModeChange("sessions")}>
              <span className="command-name">/sessions</span>
              <span className="command-description">Lihat, buka, atau hapus riwayat percakapan</span>
            </button>
            <button type="button" className="command-item" onClick={() => onModeChange("model")}>
              <span className="command-name">/model</span>
              <span className="command-description">Pilih provider lalu tentukan model yang digunakan</span>
            </button>
            <button type="button" className="command-item" onClick={() => onModeChange("connect")}>
              <span className="command-name">/connect</span>
              <span className="command-description">Hubungkan API key ke gateway 9Router lokal</span>
            </button>
          </div>
        ) : null}

        {mode === "model" ? (
          <div className="command-form">
            <label className="command-label" htmlFor="command-provider">Provider</label>
            <select
              id="command-provider"
              className="select select--full"
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as AiProvider)}
            >
              <option value="local">AI Local · Ollama</option>
              <option value="9router" disabled={!connected}>9Router {!connected ? "· belum terhubung" : ""}</option>
            </select>
            {provider === "9router" && !connected ? (
              <p className="command-hint">Hubungkan 9Router terlebih dahulu melalui /connect.</p>
            ) : (
              <>
                <label className="command-label" htmlFor="command-model">Model tersedia</label>
                <select
                  id="command-model"
                  className="select select--full"
                  value={selectedModel}
                  onChange={(event) => onModelChange(event.target.value)}
                  disabled={models.length === 0}
                >
                  {models.length === 0 ? <option value="">Belum ada model tersedia</option> : null}
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                <div className="command-model-footer">
                  <p className="command-hint">{models.length} model tersedia dari provider yang dipilih.</p>
                  {provider === "9router" ? <button type="button" className="btn" onClick={onRefreshModels}>Refresh models</button> : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {mode === "connect" ? (
          <div className="command-form">
            <p className="command-description command-description--block">
              Endpoint: <code>http://localhost:20128/v1</code>
            </p>
            <label className="command-label" htmlFor="router-api-key">API key 9Router</label>
            <input
              id="router-api-key"
              className="select select--full command-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Masukkan API key secara manual"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="command-hint">API key disimpan sementara di memori aplikasi dan perlu dimasukkan kembali setelah aplikasi dimulai ulang.</p>
            {connected ? (
              <div className="command-connected">
                <span className="status-dot status-dot--ready" /> 9Router terhubung
                <button type="button" className="btn" onClick={onDisconnect}>Disconnect</button>
              </div>
            ) : null}
            {error ? <p className="command-error" role="alert">{error}</p> : null}
            <div className="command-actions">
              <button type="button" className="btn" onClick={onClose}>Batal</button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || apiKey.trim().length === 0}
                onClick={() => void onConnect(apiKey)}
              >
                {busy ? "Memeriksa koneksi…" : "Connect"}
              </button>
            </div>
          </div>
        ) : null}

        {mode === "sessions" ? (
          <div className="command-sessions">
            {history.length === 0 ? (
              <p className="command-hint">Belum ada riwayat percakapan tersimpan.</p>
            ) : history.map((item) => (
              <div className="command-session" key={item.id}>
                <button type="button" className="command-session-open" onClick={() => onOpenSession(item.id)}>
                  <strong>{item.text || "Percakapan baru"}</strong>
                  <span>{item.time}</span>
                </button>
                <button type="button" className="icon-btn" onClick={() => onDeleteSession(item.id)} aria-label={"Hapus " + (item.text || "percakapan")} title="Hapus sesi">×</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
