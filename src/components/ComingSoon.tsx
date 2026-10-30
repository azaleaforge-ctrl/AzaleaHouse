import type { ReactElement } from "react";

/** Halaman kosong elegan untuk fitur yang belum masuk fase ini */
export function ComingSoon({
  icon,
  title,
  desc,
  phase,
}: {
  icon: ReactElement;
  title: string;
  desc: string;
  phase: string;
}) {
  return (
    <div className="coming-soon">
      <span className="coming-icon" aria-hidden="true">
        {icon}
      </span>
      <h1 className="coming-title">{title}</h1>
      <p className="coming-desc">{desc}</p>
      <span className="tag tag--phase">{phase}</span>
    </div>
  );
}
