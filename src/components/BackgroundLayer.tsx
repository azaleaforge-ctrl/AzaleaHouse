/**
 * Lapisan latar: gambar senja (layer tersendiri di belakang kaca),
 * kerlip bintang murah, dan scrim agar teks tetap terbaca.
 * Saat `animated` false, tidak ada keyframe/loop yang berjalan sama sekali.
 */
export function BackgroundLayer({ animated }: { animated: boolean }) {
  return (
    <div className="bg" aria-hidden="true">
      <div className={"bg-image" + (animated ? " bg-image--anim" : "")} />
      <div className={"bg-stars" + (animated ? " bg-stars--anim" : "")} />
      <div className="bg-scrim" />
    </div>
  );
}
