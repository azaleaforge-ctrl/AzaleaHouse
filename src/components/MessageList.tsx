import { useEffect, useRef, useState } from "react";
import type { GenState, Message } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { IconCheck, IconCopy, IconRefresh } from "./Icons";

function MessageBubble({
  msg,
  isLastAssistant,
  onRegenerate,
}: {
  msg: Message;
  isLastAssistant: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard tidak tersedia — abaikan */
    }
  };

  const displayContent = msg.streaming ? msg.text : msg.text;

  return (
    <article className={"msg msg--" + msg.role}>
      <div className="msg-meta">
        <span className="msg-author">{msg.role === "assistant" ? "AzaleaHouse" : "Anda"}</span>
        <span className="msg-time">{msg.time}</span>
      </div>
      {msg.text.trim() ? (
        <div
          className="bubble md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent) }}
        />
      ) : msg.streaming ? (
        <div className="thinking-bubble" role="status" aria-live="polite">
          <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
          <span>{msg.activity || "Sedang menyiapkan jawaban…"}</span>
        </div>
      ) : null}
      {msg.attachments && msg.attachments.length > 0 ? (
        <div className="message-attachments" aria-label="Lampiran pesan">
          {msg.attachments.map((attachment, index) => (
            <div className="message-attachment" key={attachment.id ?? attachment.name + "-" + index}>
              <span className="message-attachment-name">{attachment.name}</span>
              <span className="message-attachment-meta">
                {attachment.format === "image" ? "Gambar" : attachment.format === "document" ? "Dokumen" : attachment.format === "text" ? "Teks" : "File"}
                {" · "}{(attachment.size / 1024).toFixed(1)} KB
              </span>
              {attachment.error ? <span className="message-attachment-error">{attachment.error}</span> : null}
              {attachment.id ? <span className="message-attachment-saved">Tersimpan lokal</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {msg.role === "assistant" ? (
        <div className="msg-actions">
          {msg.sources?.length ? (
            <button type="button" className="source-trigger" onClick={() => setSourcesOpen(true)}>
              <span aria-hidden="true">⌕</span> {msg.sources.length} sumber web
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={copy}
            aria-label={copied ? "Tersalin" : "Salin pesan"}
            title={copied ? "Tersalin" : "Salin"}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
          {isLastAssistant ? (
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={onRegenerate}
              aria-label="Buat ulang jawaban"
              title="Buat ulang"
            >
              <IconRefresh size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {sourcesOpen && msg.sources?.length ? (
        <div className="source-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSourcesOpen(false); }}>
          <section className="source-dialog" role="dialog" aria-modal="true" aria-label="Sumber pencarian web">
            <header className="source-dialog-head">
              <h3>Sumber dari internet</h3>
              <button type="button" className="icon-btn" onClick={() => setSourcesOpen(false)} aria-label="Tutup sumber">×</button>
            </header>
            <div className="source-list">
              {msg.sources.map((source, index) => (
                <article className="source-item" key={source.url}>
                  <span className="source-index">{index + 1}</span>
                  <div className="source-item-body">
                    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
                    <p>{source.snippet}</p>
                    <span className="source-url">{source.url}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}

export function MessageList({
  messages,
  genState,
  animAllowed,
  onRegenerate,
}: {
  messages: Message[];
  genState: GenState;
  animAllowed: boolean;
  onRegenerate: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const behavior: ScrollBehavior = firstRender.current || !animAllowed ? "auto" : "smooth";
    firstRender.current = false;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, [messages.length, genState, animAllowed]);

  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === "assistant") return m.id;
    }
    return null;
  })();

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner" role="log" aria-label="Percakapan">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            isLastAssistant={m.id === lastAssistantId && genState === "idle"}
            onRegenerate={onRegenerate}
          />
        ))}
      </div>
    </div>
  );
}
