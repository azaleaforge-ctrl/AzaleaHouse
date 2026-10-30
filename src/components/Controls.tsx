import type { CSSProperties } from "react";

/** Saklar on/off — kontrol murni, label disusun oleh pemanggil */
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={"switch" + (checked ? " is-on" : "")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "is-active" : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      aria-valuetext={`${Math.round(pct)}%`}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--fill": `${pct}%` } as CSSProperties}
    />
  );
}

/** Baris label + deskripsi + kontrol, dipakai di panel kanan & halaman Pengaturan */
export function FieldRow({
  label,
  desc,
  control,
  tag,
  stacked,
}: {
  label: string;
  desc?: string;
  control: React.ReactNode;
  tag?: string;
  stacked?: boolean;
}) {
  return (
    <div className={"field-row" + (stacked ? " field-row--stacked" : "")}>
      <div className="row-text">
        <span className="row-label">
          {label}
          {tag ? <span className="tag tag--mini">{tag}</span> : null}
        </span>
        {desc ? <span className="row-desc">{desc}</span> : null}
      </div>
      <div className="row-control">{control}</div>
    </div>
  );
}
