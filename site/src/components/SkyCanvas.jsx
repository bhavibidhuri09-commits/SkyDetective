import { useEffect, useRef } from "react";

const GREEN = "#5fe3a1";
const RED = "#ff4f7b";

function ring(ctx, p, color, radius = 14) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

// Shows one frame at a time (the blink) plus answer overlays, and reports
// taps in image pixels so they can be compared with level.json positions.
export default function SkyCanvas({ frames, showB, found, reveal, flash, onTap, stampText, cornerText, label }) {
  const ref = useRef(null);
  const frameIndex = showB ? 1 : 0;

  useEffect(() => {
    const canvas = ref.current;
    const img = frames[frameIndex];
    if (canvas.width !== img.width) {
      canvas.width = img.width;
      canvas.height = img.height;
    }
    const ctx = canvas.getContext("2d");
    ctx.putImageData(img, 0, 0);
    for (const t of reveal) {
      const [a, b] = t.frames;
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const t of [...found, ...reveal]) ring(ctx, t.frames[frameIndex], GREEN);
    if (flash) ring(ctx, flash, RED);
  }, [frames, frameIndex, found, reveal, flash]);

  const handleClick = (e) => {
    const canvas = ref.current;
    const box = canvas.getBoundingClientRect();
    onTap((e.clientX - box.left) * (canvas.width / box.width), (e.clientY - box.top) * (canvas.height / box.height));
  };

  return (
    <div className="frame">
      <canvas ref={ref} onClick={handleClick} aria-label={label} />
      <div className={`stamp ${showB ? "b" : "a"}`}>{stampText}</div>
      <div className="corner">{cornerText}</div>
    </div>
  );
}
