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
  const [showThinking, setShowThinking] = useState(false);
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
  const thinkingContent = msg.thinking;

  return (
    <article className={"msg msg--" + msg.role}>
      <div className="msg-meta">
        <span className="msg-author">{msg.role === "assistant" ? "AzaleaHouse" : "Anda"}</span>
        <span className="msg-time">{msg.time}</span>
      </div>
      {thinkingContent ? (
        <div className="thinking-section">
          <button
            type="button"
            className="thinking-toggle"
            onClick={() => setShowThinking(!showThinking)}
            aria-expanded={showThinking}
          >
            <span className="thinking-toggle-label">
              {showThinking ? "▼ Sembunyikan chain-of-thought" : "▶️ Lihat chain-of-thought"}
            </span>
          </button>
          {showThinking ? (
            <pre className="thinking-content">{thinkingContent}</pre>
          ) : null}
        </div>
      ) : null}
      <div
        className={"bubble md" + (msg.streaming ? " is-streaming" : "")}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent) }}
      />
      {msg.role === "assistant" ? (
        <div className="msg-actions">
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
