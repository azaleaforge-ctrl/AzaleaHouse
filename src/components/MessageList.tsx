import { useEffect, useRef, useState } from "react";
import type { GenState, Message } from "../types";
import { renderMarkdown } from "../lib/markdown";
import { IconCheck, IconCopy, IconRefresh } from "./Icons";
import { invokeLoadAttachmentBase64 } from "../lib/tauri";

function MessageBubble({
  msg,
  isLastAssistant,
  onRegenerate,
  onEdit,
  onAskUser,
}: {
  msg: Message;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  onEdit: (messageId: string, text: string) => void;
  onAskUser: (answer: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreviews, setImagePreviews] = useState<Array<{ name: string; src: string }>>([]);
  const [askAnswer, setAskAnswer] = useState("");
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const imageAttachments = (msg.attachments ?? []).filter((item) => item.format === "image");
    const load = async () => {
      const previews = await Promise.all(imageAttachments.map(async (item, index) => {
        const inline = msg.images?.[index];
        const base64 = inline || (item.id ? await invokeLoadAttachmentBase64(item.id) : null);
        if (!base64) return null;
        return { name: item.name, src: "data:" + (item.mimeType || "image/png") + ";base64," + base64 };
      }));
      if (active) setImagePreviews(previews.filter((item): item is { name: string; src: string } => Boolean(item)));
    };
    void load();
    return () => { active = false; };
  }, [msg.id, msg.attachments, msg.images]);
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

  const askUserMatch = msg.text.match(/\\[\\[ASK_USER\\]\\]([\\s\\S]*?)\\[\\[\\/ASK_USER\\]\\]/);
  const askUserQuestion = askUserMatch?.[1]?.trim();
  const displayContent = msg.text.replace(/\\[\\[ASK_USER\\]\\][\\s\\S]*?\\[\\[\\/ASK_USER\\]\\]/g, "").trim();

  return (
    <article className={"msg msg--" + msg.role}>
      <div className="msg-meta">
        <span className="msg-author">{msg.role === "assistant" ? "AzaleaHouse" : "Anda"}</span>
        <span className="msg-time">{msg.time}</span>
      </div>
      {editing ? (
        <div className="message-edit">
          <textarea value={editText} onChange={(event) => setEditText(event.target.value)} rows={Math.max(3, Math.min(10, editText.split("\n").length + 1))} aria-label="Edit pesan" />
          <div className="message-edit-actions">
            <button type="button" className="btn" onClick={() => { setEditText(msg.text); setEditing(false); }}>Batal</button>
            <button type="button" className="btn btn--primary" disabled={!editText.trim()} onClick={() => { setEditing(false); onEdit(msg.id, editText.trim()); }}>Kirim ulang</button>
          </div>
        </div>
      ) : msg.text.trim() ? (
        <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent) }} />
      ) : msg.streaming ? (
        <div className="thinking-bubble" role="status" aria-live="polite">
          <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>
          <span>{msg.activity || "Sedang menyiapkan jawaban…"}</span>
        </div>
      ) : null}
      {askUserQuestion ? (
        <div className="ask-user-card">
          <strong>Perlu jawaban darimu</strong>
          <p>{askUserQuestion}</p>
          <textarea value={askAnswer} onChange={(event) => setAskAnswer(event.target.value)} rows={2} placeholder="Tulis jawaban atau informasi tambahan…" aria-label="Jawaban untuk AI" />
          <div className="ask-user-actions">
            <button type="button" className="btn btn--primary" disabled={!askAnswer.trim()} onClick={() => { onAskUser(askAnswer.trim()); setAskAnswer(""); }}>Kirim jawaban</button>
          </div>
        </div>
      ) : null}
      {imagePreviews.length ? (
        <div className="message-image-grid" aria-label="Gambar dalam pesan">
          {imagePreviews.map((preview) => (
            <button type="button" className="message-image-thumb" key={preview.name} onClick={() => setSelectedImage(preview.src)} aria-label={"Buka gambar " + preview.name}>
              <img src={preview.src} alt={preview.name} />
            </button>
          ))}
        </div>
      ) : null}
      {msg.attachments && msg.attachments.some((attachment) => attachment.format !== "image") ? (
        <div className="message-attachments" aria-label="Lampiran pesan">
          {msg.attachments.filter((attachment) => attachment.format !== "image").map((attachment, index) => (
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
      {msg.role === "user" ? (
        <div className="msg-actions">
          <button type="button" className="message-edit-trigger" onClick={() => { setEditText(msg.text); setEditing(true); }} aria-label="Edit pesan">✎ Edit</button>
        </div>
      ) : null}
      {msg.durationMs !== undefined && msg.role === "assistant" ? (
        <div className="message-duration" title="Durasi pembuatan jawaban">◷ {msg.durationMs < 1000 ? msg.durationMs + " ms" : (msg.durationMs / 1000).toFixed(1) + " detik"}</div>
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
      {selectedImage ? (
        <div className="image-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedImage(null); }}>
          <button type="button" className="image-lightbox-close" onClick={() => setSelectedImage(null)} aria-label="Tutup gambar">×</button>
          <img src={selectedImage} alt="Pratinjau gambar ukuran penuh" />
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
  onEdit,
  onAskUser,
}: {
  messages: Message[];
  genState: GenState;
  animAllowed: boolean;
  onRegenerate: () => void;
  onEdit: (messageId: string, text: string) => void;
  onAskUser: (answer: string) => void;
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
            onEdit={onEdit}
            onAskUser={onAskUser}
          />
        ))}
      </div>
    </div>
  );
}
