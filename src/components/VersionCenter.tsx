import { useEffect, useRef } from "react";
import { changelogV016 } from "../data/mock";
import { formatBytes, formatSpeed } from "../lib/format";
import type { UpdateStatus } from "../types";
import type { UpdateInfo, UpdateProgressEvent } from "../lib/tauri";
import { IconDownload, IconInfo, IconLock, IconRefresh, IconX, LogoMark } from "./Icons";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const statusChip: Record<UpdateStatus, { label: string; cls: string }> = {
  idle: { label: "Belum diperiksa", cls: "tag" },
  checking: { label: "Memeriksa…", cls: "tag" },
  up_to_date: { label: "Versi terbaru", cls: "tag tag--ok" },
  update_available: { label: "Update tersedia", cls: "tag tag--info" },
  downloading: { label: "Mengunduh…", cls: "tag tag--info" },
  downloaded: { label: "Unduhan selesai — instalasi terkunci", cls: "tag tag--warn" },
  installing: { label: "Memasang…", cls: "tag tag--info" },
  offline: { label: "Luring", cls: "tag tag--warn" },
  error: { label: "Gagal", cls: "tag tag--warn" },
};

export function VersionCenter({
  open,
  onClose,
  version,
  updateInfo,
  updateStatus,
  downloadProgress,
  onCheck,
  onDownload,
  onCancelDownload,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  updateInfo: UpdateInfo | null;
  updateStatus: UpdateStatus;
  downloadProgress: UpdateProgressEvent | null;
  onCheck: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = card?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables && focusables.length > 0 ? focusables[0] : card)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const list = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const chip = statusChip[updateStatus];

  // Real progress data (dari frontend event) atau demo fallback
  const prog = downloadProgress;
  const progressPct = prog && prog.total > 0 ? Math.round((prog.downloaded / prog.total) * 100) : 0;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Version Center"
        tabIndex={-1}
      >
        <div className="modal-head">
          <LogoMark size={24} />
          <h2 className="modal-title">Version Center</h2>
          <span className="tag">Manual</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup Version Center"
            title="Tutup (Esc)"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="vc-status">
          <div className="vc-status-item">
            <span className="vc-status-label">Terpasang</span>
            <span className="vc-status-value">v{version}</span>
          </div>
          <div className="vc-status-item">
            <span className="vc-status-label">Versi terbaru</span>
            <span className="vc-status-value">
              {updateInfo?.latest_version ? `v${updateInfo.latest_version}` : "—"}
            </span>
          </div>
          <div className="vc-status-item">
            <span className="vc-status-label">Status</span>
            <span className={chip.cls}>{chip.label}</span>
          </div>
          {updateInfo?.error ? (
            <div className="vc-status-item">
              <span className="vc-status-label">Info</span>
              <span className="vc-status-value vc-error">{updateInfo.error}</span>
            </div>
          ) : null}
        </div>

        <div className="vc-privacy">
          <IconInfo size={16} />
          <p>
            AzaleaHouse <strong>tidak pernah</strong> mengunduh atau memasang pembaruan secara
            otomatis. Unduhan hanya berjalan setelah kamu menekan tombolnya.
          </p>
        </div>

        {updateStatus === "downloading" && prog ? (
          <div className="vc-progress">
            <div className="progress">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-meta">
              <span>{progressPct}%</span>
              <span>
                {formatBytes(prog.downloaded)} dari {formatBytes(prog.total)}
              </span>
              <span>{formatSpeed(prog.speed)}</span>
              {prog.eta_seconds !== null && prog.eta_seconds !== undefined && prog.eta_seconds > 0 ? (
                <span>~{Math.round(prog.eta_seconds)}s lagi</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {updateInfo && updateInfo.available && updateStatus === "update_available" ? (
          <div className="vc-changelog">
            <h3 className="vc-subtitle">Catatan rilis v{updateInfo.latest_version}</h3>
            <ul className="changelog">
              {updateInfo.body.split("\n").filter((l) => l.trim()).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ) : updateInfo && !updateInfo.available && updateStatus === "up_to_date" ? (
          <div className="vc-changelog">
            <h3 className="vc-subtitle">Catatan rilis v{version}</h3>
            <ul className="changelog">
              {changelogV016.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="vc-actions">
          {updateStatus === "downloading" ? (
            <button type="button" className="btn" onClick={onCancelDownload}>
              <IconX size={15} />
              Batalkan Unduh
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={onCheck}
              disabled={updateStatus === "checking"}
            >
              <IconRefresh size={15} />
              Periksa Pembaruan
            </button>
          )}
          {updateInfo?.available && updateStatus === "update_available" ? (
            <button type="button" className="btn btn--primary" onClick={onDownload}>
              <IconDownload size={15} />
              Unduh Pembaruan
            </button>
          ) : null}
        </div>
        {updateStatus === "downloaded" ? (
          <div className="vc-privacy" role="status">
            <IconLock size={16} />
            <p>
              Installer telah diunduh, tetapi AzaleaHouse tidak akan menjalankannya sebelum
              verifikasi tanda tangan resmi dikonfigurasi. Ini untuk mencegah installer yang
              belum terverifikasi dieksekusi.
            </p>
          </div>
        ) : null}
        <p className="vc-note">
          Pemeriksaan versi dan unduhan metadata tidak memasang update otomatis. Instalasi tetap
          terkunci sampai integrasi updater resmi dengan tanda tangan tervalidasi selesai.
        </p>
      </div>
    </div>
  );
}
