import type { ReactElement } from "react";
import type { RuntimeStatus, View } from "../types";
import { RAM_PLACEHOLDER, runtimeStatusLabels } from "../data/mock";
import {
  IconChat,
  IconFile,
  IconHistory,
  IconImage,
  IconPlus,
  IconSettings,
  IconSparkles,
  LogoMark,
} from "./Icons";

interface NavItem {
  id: View;
  label: string;
  icon: ReactElement;
}

const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Chat", icon: <IconChat /> },
  { id: "local-ai", label: "AI Lokal", icon: <IconSparkles /> },
  { id: "documents", label: "Dokumen", icon: <IconFile /> },
  { id: "images", label: "Gambar", icon: <IconImage /> },
  { id: "history", label: "Riwayat", icon: <IconHistory /> },
  { id: "settings", label: "Pengaturan", icon: <IconSettings /> },
];

export function Sidebar({
  view,
  onNavigate,
  onNewChat,
  runtimeStatus,
  version,
  onOpenVersionCenter,
  onUnloadModel,
}: {
  view: View;
  onNavigate: (v: View) => void;
  onNewChat: () => void;
  runtimeStatus: RuntimeStatus;
  version: string;
  onOpenVersionCenter: () => void;
  onUnloadModel: () => void;
}) {
  const dotClass =
    runtimeStatus === "ready"
      ? "status-dot status-dot--ready"
      : runtimeStatus === "error" || runtimeStatus === "runtime_unavailable"
        ? "status-dot status-dot--error"
        : "status-dot status-dot--loading";

  return (
    <aside className="sidebar" aria-label="Navigasi AzaleaHouse">
      <div className="brand">
        <LogoMark size={30} />
        <div className="brand-text">
          <span className="brand-name">AzaleaHouse</span>
          <span className="brand-sub">Asisten AI Lokal</span>
        </div>
      </div>

      <button type="button" className="btn btn--primary btn--block" onClick={onNewChat}>
        <IconPlus size={17} />
        Chat Baru
      </button>

      <nav className="nav" aria-label="Navigasi utama">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={"nav-item" + (view === item.id ? " is-active" : "")}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <div className="runtime-card" title="Status runtime">
        <span className={dotClass} aria-hidden="true" />
        <div className="runtime-text">
          <span className="runtime-overline">Runtime lokal</span>
          <span className="runtime-label">{runtimeStatusLabels[runtimeStatus]}</span>
          <span className="runtime-meta">{RAM_PLACEHOLDER}</span>
        </div>
        {(runtimeStatus === "ready" || runtimeStatus === "unloaded" || runtimeStatus === "loading") ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={onUnloadModel}
            title="Matikan model dari RAM"
            disabled={runtimeStatus !== "ready" && runtimeStatus !== "unloaded"}
          >
            Matikan
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="version-chip"
        onClick={onOpenVersionCenter}
        aria-haspopup="dialog"
        title="Buka Version Center"
      >
        <LogoMark size={16} />
        <span>AzaleaHouse v{version}</span>
      </button>
    </aside>
  );
}
