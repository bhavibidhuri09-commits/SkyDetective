import { useEffect, useLayoutEffect, useRef, useState } from "react";

const GREEN = "#5fe3a1";
const RED = "#ff4f7b";
const MAX_ZOOM = 3;
const DRAG_PX = 4; // a mouse move this far is a pan, not a tap

function ring(ctx, p, color, radius = 14) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

// Shows one frame at a time (the blink) plus answer overlays, and reports
// taps in image pixels so they can be compared with level.json positions.
// When zoomed the canvas scrolls inside its box: touch scrolls natively, a mouse drags.
export default function SkyCanvas({ frames, diff, showB, found, reveal, flash, onTap, stampText, cornerText, label, zoomInLabel, zoomOutLabel }) {
  const ref = useRef(null);
  const scroller = useRef(null);
  const center = useRef(null);
  const drag = useRef(null);
  const [zoom, setZoom] = useState(1);
  const frameIndex = showB ? 1 : 0;

  // Keep the same patch of sky in the middle of the box when the zoom changes.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!center.current) return;
    box.scrollLeft = center.current.x * box.scrollWidth - box.clientWidth / 2;
    box.scrollTop = center.current.y * box.scrollHeight - box.clientHeight / 2;
    center.current = null;
  }, [zoom]);

  const changeZoom = (next) => {
    const box = scroller.current;
    center.current = {
      x: (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth,
      y: (box.scrollTop + box.clientHeight / 2) / box.scrollHeight,
    };
    setZoom(next);
  };

  useEffect(() => {
    const canvas = ref.current;
    const img = diff || frames[frameIndex];
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
    for (const t of [...found, ...reveal]) {
      if (diff) t.frames.forEach((f) => ring(ctx, f, GREEN));
      else ring(ctx, t.frames[frameIndex], GREEN);
    }
    if (flash) ring(ctx, flash, RED);
  }, [frames, diff, frameIndex, found, reveal, flash]);

  const handlePointerDown = (e) => {
    if (e.pointerType !== "mouse" || zoom === 1) {
      drag.current = null;
      return;
    }
    const box = scroller.current;
    drag.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop, moved: false };
  };

  const handlePointerMove = (e) => {
    if (!drag.current || !e.buttons) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.hypot(dx, dy) >= DRAG_PX) drag.current.moved = true;
    if (!drag.current.moved) return;
    scroller.current.scrollLeft = drag.current.left - dx;
    scroller.current.scrollTop = drag.current.top - dy;
  };

  const handleClick = (e) => {
    if (drag.current?.moved) return;
    const canvas = ref.current;
    const box = canvas.getBoundingClientRect();
    onTap((e.clientX - box.left) * (canvas.width / box.width), (e.clientY - box.top) * (canvas.height / box.height));
  };

  return (
    <div className="frame">
      <div className="frame-scroll" ref={scroller} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}>
        <canvas
          ref={ref}
          onClick={handleClick}
          aria-label={label}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
        />
      </div>
      <div className={`stamp ${diff ? "" : showB ? "b" : "a"}`}>{stampText}</div>
      <div className="corner">{cornerText}</div>
      <div className="zoom">
        <button type="button" aria-label={zoomOutLabel} disabled={zoom === 1} onClick={() => changeZoom(zoom - 1)}>−</button>
        <span aria-live="polite">{zoom}×</span>
        <button type="button" aria-label={zoomInLabel} disabled={zoom === MAX_ZOOM} onClick={() => changeZoom(zoom + 1)}>+</button>
      </div>
    </div>
  );
}
