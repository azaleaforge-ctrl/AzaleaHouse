import type { SVGProps } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
    focusable: false,
  };
}

export function IconChat({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.5 0-3-.4-4.2-1.1L3.5 20l1.4-4A8.3 8.3 0 1 1 21 11.5Z" />
    </svg>
  );
}

export function IconFile({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8l-4.5-4.5Z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  );
}

export function IconImage({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5.5 17.5 4-4 3 3 3-3 3.5 3.5" />
    </svg>
  );
}

export function IconHistory({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 12a8 8 0 1 0 2.3-5.6L3.5 9" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 8v4.3l2.8 1.7" />
    </svg>
  );
}

export function IconSettings({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7h8.6M17.4 7H20" />
      <circle cx="15" cy="7" r="2.4" />
      <path d="M4 12h2.6M11.4 12H20" />
      <circle cx="9" cy="12" r="2.4" />
      <path d="M4 17h8.6M17.4 17H20" />
      <circle cx="15" cy="17" r="2.4" />
    </svg>
  );
}

export function IconPlus({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

export function IconPanelRight({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
      <path d="M16.5 7.5h1.5M16.5 10h1.5" strokeWidth="1.4" />
    </svg>
  );
}

export function IconArrowUp({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 19V5.5M5.5 12 12 5.5 18.5 12" />
    </svg>
  );
}

export function IconStop({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCopy({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 14.5v-9a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

export function IconCheck({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconRefresh({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

export function IconPaperclip({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconSparkles({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M11 5.5 12.6 9.4 16.5 11l-3.9 1.6L11 16.5 9.4 12.6 5.5 11l3.9-1.6L11 5.5Z" />
      <path d="M18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" strokeWidth="1.4" />
    </svg>
  );
}

export function IconChevronDown({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function IconX({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconDownload({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}

export function IconFolder({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function IconInfo({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8h.01" />
    </svg>
  );
}

export function IconLock({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

export function IconMail({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </svg>
  );
}

export function IconTasks({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />
      <path d="m4 5.8 1.4 1.4L8 4.7" strokeWidth="1.5" />
      <path d="m4 11.3 1.4 1.4L8 10.2" strokeWidth="1.5" />
      <path d="m4 16.8 1.4 1.4L8 15.7" strokeWidth="1.5" />
    </svg>
  );
}

export function IconArrowLeft({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M19 12H5M11.5 18.5 5 12l6.5-6.5" />
    </svg>
  );
}

/** Ikon tempat sampah */
export function IconTrash({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 6l1 14a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3l1-14" />
    </svg>
  );
}

/** Ikon peringatan untuk error boundary */
export function IconAlertCircle({ size = 20, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M10.28 4.93a9 9 0 1 1-6.25 0 9 9 0 0 1 6.25-4.93 9 9 0 0 1 0 9.87z" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

/** Logo bunga azalea — lima kelopak, palet senja */
export function LogoMark({ size = 26, className }: IconProps) {
  const petals = ["#ffb27a", "#c9b9f2", "#ff9a5c", "#b2a5e4", "#ffd2ae"];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true" focusable={false}>
      {petals.map((fill, idx) => (
        <ellipse
          key={idx}
          cx="16"
          cy="9"
          rx="4.4"
          ry="6.2"
          fill={fill}
          opacity="0.92"
          transform={`rotate(${idx * 72} 16 16)`}
        />
      ))}
      <circle cx="16" cy="16" r="3.2" fill="#ffe7d2" />
    </svg>
  );
}
