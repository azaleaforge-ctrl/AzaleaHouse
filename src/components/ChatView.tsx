import { useRef, useState } from "react";
import type { Attachment, GenState, Message, ProfileId, RuntimeStatus } from "../types";
import type { ModelMeta } from "../lib/tauri";
import { suggestions } from "../data/mock";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import {
  IconFile,
  IconMail,
  IconPanelRight,
  IconPlus,
  IconSparkles,
  IconTasks,
  LogoMark,
} from "./Icons";

const SUGGESTION_ICONS = [<IconFile key="f" />, <IconMail key="m" />, <IconSparkles key="s" />, <IconTasks key="t" />];

export function ChatView({
  messages,
  genState,
  animAllowed,
  modelName,
  modelId,
  availableModels,
  onModelChange,
  onOpenLocalAi,
  panelOpen,
  onTogglePanel,
  onNewChat,
  onSend,
  onClearAttachments,
  onStop,
  onRegenerate,
  thinking,
  onToggleThinking,
  thinkingSupported,
  profile,
  onProfileChange,
  runtimeStatus,
  chatError,
  onDismissChatError,
  attachments,
  onRemoveAttachment,
  onAttachFiles,
}: {
  messages: Message[];
  genState: GenState;
  animAllowed: boolean;
  modelName: string;
  modelId: string;
  availableModels: ModelMeta[];
  onModelChange: (modelId: string) => void;
  onOpenLocalAi: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onNewChat: () => void;
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onClearAttachments: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  thinking: boolean;
  onToggleThinking: () => void;
  thinkingSupported: boolean;
  profile: ProfileId;
  onProfileChange: (p: ProfileId) => void;
  runtimeStatus: RuntimeStatus;
  chatError: string | null;
  onDismissChatError: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (name: string) => void;
  onAttachFiles: (files: FileList) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const send = async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const accepted = await onSend(text, attachments);
    if (accepted) {
      setDraft("");
      onClearAttachments();
    }
  };

  const applySuggestion = (prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  };

  const title = messages.length > 0 ? "Percakapan" : "Percakapan baru";
  const runtimeChipLabel =
    runtimeStatus === "ready"
      ? "Siap"
      : runtimeStatus === "unloaded"
        ? "Tidak dimuat"
        : runtimeStatus === "loading"
          ? "Memuat…"
          : "Belum siap";

  return (
    <>
      <header className="chat-header">
        <h1 className="chat-title">{title}</h1>
        <div className="chat-model-picker chip" title="Pilih model AI lokal">
          <span
            className={
              runtimeStatus === "ready"
                ? "status-dot status-dot--ready"
                : runtimeStatus === "error" || runtimeStatus === "runtime_unavailable" || runtimeStatus === "not_installed"
                  ? "status-dot status-dot--error"
                  : "status-dot status-dot--loading"
            }
            aria-hidden="true"
          />
          <select
            className="chat-model-select"
            aria-label="Model AI yang digunakan"
            value={modelId}
            disabled={genState !== "idle" || runtimeStatus === "loading" || runtimeStatus === "unloading"}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {!modelId ? (
              <option value="">Pilih model AI lokal…</option>
            ) : !availableModels.some((model) => model.id === modelId) ? (
              <option value={modelId}>{modelName} · belum terpasang</option>
            ) : null}
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <span className="chip-note">{runtimeChipLabel}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenLocalAi}
          aria-label="Buka pengelola AI lokal"
          title="Kelola model Ollama"
        >
          <IconSparkles size={18} />
        </button>
        <div className="header-spacer" />
        <button
          type="button"
          className={"icon-btn" + (panelOpen ? " is-active" : "")}
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          aria-label={panelOpen ? "Tutup panel pengaturan AI" : "Buka panel pengaturan AI"}
          title="Panel pengaturan AI"
        >
          <IconPanelRight size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onNewChat}
          aria-label="Mulai percakapan baru"
          title="Percakapan baru"
        >
          <IconPlus size={18} />
        </button>
      </header>

      {runtimeStatus === "loading" ? (
        <div className="model-load-status" role="status" aria-live="polite">
          <div className="model-load-progress"><span /></div>
          <span>Memuat atau memeriksa {modelName}… Ollama tidak menyediakan persentase untuk proses memuat model ke RAM.</span>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <div className="empty-state">
          <LogoMark size={56} className="empty-logo" />
          <h2 className="empty-title">AzaleaHouse</h2>
          <p className="empty-tagline">
            Asisten AI yang berjalan sepenuhnya di komputermu — privat, cepat, tanpa cloud.
          </p>
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className="suggestion"
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => applySuggestion(s.prompt)}
              >
                <span className="suggestion-icon" aria-hidden="true">
                  {SUGGESTION_ICONS[i]}
                </span>
                <span>
                  <span className="suggestion-title">{s.title}</span>
                  <span className="suggestion-desc">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <MessageList
          messages={messages}
          genState={genState}
          animAllowed={animAllowed}
          onRegenerate={onRegenerate}
        />
      )}

      {chatError ? (
        <div className="chat-error" role="alert">
          <p>{chatError}</p>
          <button type="button" onClick={onDismissChatError} aria-label="Tutup pesan kesalahan">
            Tutup
          </button>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="attachment-bar">
          {attachments.map((a) => (
            <div key={a.name} className="attachment-chip">
              <span className="attachment-name">{a.name}</span>
              <span className="attachment-size">
                {(a.size / 1024).toFixed(1)} KB
              </span>
              {a.format === "image" && a.base64 ? (
                <img
                  src={`data:${a.mimeType ?? "image/png"};base64,${a.base64}`}
                  alt={a.name}
                  className="attachment-thumb"
                />
              ) : a.error ? (
                <span className="attachment-error">{a.error}</span>
              ) : null}
              {a.storageWarning ? <span className="attachment-warning">{a.storageWarning}</span> : null}
              {a.id ? <span className="attachment-status">Tersimpan lokal</span> : null}
              <button
                type="button"
                className="attachment-remove"
                onClick={() => onRemoveAttachment(a.name)}
                aria-label={`Hapus ${a.name}`}
                title="Hapus lampiran"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={onStop}
        busy={genState !== "idle"}
        hasAttachments={attachments.length > 0}
        thinking={thinking}
        onToggleThinking={onToggleThinking}
        thinkingSupported={thinkingSupported}
        profile={profile}
        onProfileChange={onProfileChange}
        runtimeStatus={runtimeStatus}
        onAttachFiles={onAttachFiles}
      />
    </>
  );
}
