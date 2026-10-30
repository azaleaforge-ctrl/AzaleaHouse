import { IconHistory, IconTrash } from "./Icons";
import type { Message } from "../types";

export function HistoryView({
  history,
  onOpen,
  onDelete,
  onBack,
}: {
  history: Message[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="history-view">
      <header className="chat-header">
        <h1 className="chat-title">Riwayat Percakapan</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Kembali ke chat"
          title="Kembali ke chat"
        >
          ×
        </button>
      </header>

      {history.length === 0 ? (
        <div className="history-empty">
          <span className="history-empty-icon" aria-hidden="true">
            <IconHistory />
          </span>
          <p className="history-empty-text">Belum ada riwayat percakapan.</p>
          <p className="history-empty-hint">
            Mulai chat untuk menyimpan riwayat otomatis.
          </p>
        </div>
      ) : (
        <ul className="history-list">
          {history.map((item) => (
            <li key={item.id} className="history-item">
              <button
                type="button"
                className="history-item-main"
                onClick={() => onOpen(item.id)}
              >
                <span className="history-item-title">{item.text || "Percakapan baru"}</span>
                <span className="history-item-time">{item.time}</span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => onDelete(item.id)}
                aria-label={`Hapus ${item.text || "percakapan"}`}
                title="Hapus"
              >
                <IconTrash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
