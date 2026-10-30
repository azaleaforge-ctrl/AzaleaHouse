import { useEffect, useRef } from "react";
import type { ProfileId, RuntimeStatus } from "../types";
import { profiles } from "../data/mock";
import { Segmented } from "./Controls";
import { IconArrowUp, IconPaperclip, IconSparkles, IconStop } from "./Icons";

const MAX_INPUT_HEIGHT = 180;

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  thinking,
  onToggleThinking,
  thinkingSupported,
  profile,
  onProfileChange,
  runtimeStatus,
  onAttachFiles,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  thinking: boolean;
  onToggleThinking: () => void;
  thinkingSupported: boolean;
  profile: ProfileId;
  onProfileChange: (p: ProfileId) => void;
  runtimeStatus: RuntimeStatus;
  onAttachFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !busy;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const readyLabel =
    runtimeStatus === "ready"
      ? "Model siap"
      : runtimeStatus === "loading"
        ? "Memuat model…"
        : runtimeStatus === "error" || runtimeStatus === "runtime_unavailable"
          ? "Runtime bermasalah"
          : "Model belum siap";

  const readyClass =
    runtimeStatus === "ready"
      ? "readiness readiness--ok"
      : runtimeStatus === "error" || runtimeStatus === "runtime_unavailable"
        ? "readiness readiness--err"
        : "readiness readiness--wait";

  return (
    <div className="composer-wrap">
      <div className="composer">
        <div className="composer-row">
          <label className="icon-btn" aria-label="Lampirkan file" title="Lampirkan file (TXT, PDF, gambar)">
            <IconPaperclip size={18} />
            <input
              type="file"
              hidden
              accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.rs,.toml,.yaml,.yml,.html,.css,.xml,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onAttachFiles(e.target.files);
                  e.target.value = "";
                }
              }}
              aria-label="Pilih file"
            />
          </label>
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder="Tulis pesan untuk AzaleaHouse…"
            aria-label="Pesan"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <button
              type="button"
              className="send-btn send-btn--stop"
              onClick={onStop}
              aria-label="Hentikan generasi"
              title="Hentikan"
            >
              <IconStop size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Kirim pesan"
              title="Kirim (Enter)"
            >
              <IconArrowUp size={18} />
            </button>
          )}
        </div>

        <div className="composer-foot">
          <button
            type="button"
            className={
              "pill-toggle" +
              (thinking && thinkingSupported ? " is-on" : "") +
              (thinkingSupported ? "" : " is-unsupported")
            }
            onClick={thinkingSupported ? onToggleThinking : undefined}
            disabled={!thinkingSupported}
            title={
              thinkingSupported
                ? "Thinking — penalaran internal sebelum menjawab"
                : "Model ini tidak mendukung Thinking"
            }
            aria-pressed={thinkingSupported ? thinking : undefined}
          >
            <IconSparkles size={14} />
            Thinking
          </button>

          <Segmented
            ariaLabel="Profil respons"
            value={profile}
            onChange={onProfileChange}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          />

          <span className={readyClass}>
            <span
              className={
                runtimeStatus === "ready"
                  ? "status-dot status-dot--ready"
                  : runtimeStatus === "error" || runtimeStatus === "runtime_unavailable"
                    ? "status-dot status-dot--error"
                    : "status-dot status-dot--loading"
              }
              aria-hidden="true"
            />
            {readyLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
