import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.jsx";
import { loadHowToFrames } from "../game/levels.js";
import { FIND_POINTS, NOTHING_MOVED_POINTS } from "../game/scoring.js";

const PLANT = { seed: 11, peak: 190, sigma: 2.6, jump: 70 };
const CROP = 160; // image pixels shown, so the dot stays visible in a small box
const BLINK_MS = 650;
const TICK_MS = 100;
const LOOP_MS = 20000;
const TAP_AT_MS = 12500; // when the demo tap lands in the "tap" scene
const NOTHING_AT_MS = 18000; // when the demo presses "Nothing moved"
const SCENES = [
  { until: 6000, step: "how1", name: "blink" },
  { until: 11000, step: "how2", name: "spot" },
  { until: 15000, step: "how3", name: "tap" },
  { until: LOOP_MS, step: "how3", name: "nothing" },
];

function cropAround(spots, img) {
  const clamp = (v, max) => Math.round(Math.max(0, Math.min(max - CROP, v - CROP / 2)));
  return {
    x: clamp((spots[0].x + spots[1].x) / 2, img.width),
    y: clamp((spots[0].y + spots[1].y) / 2, img.height),
  };
}

function ring(ctx, p, color, radius) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function draw(canvas, demo, scene, elapsed, showB) {
  const set = scene.name === "nothing" ? demo.clean : demo.planted;
  const img = set[showB ? 1 : 0];
  const crop = cropAround(demo.spots, img);
  const ctx = canvas.getContext("2d");
  ctx.putImageData(img, -crop.x, -crop.y, crop.x, crop.y, CROP, CROP);
  if (scene.name === "blink" || scene.name === "nothing") return;
  const dot = demo.spots[showB ? 1 : 0];
  const here = { x: dot.x - crop.x, y: dot.y - crop.y };
  if (scene.name === "spot") {
    ring(ctx, here, "#ffb547", 12);
  } else if (elapsed < TAP_AT_MS) {
    ring(ctx, here, "#e9e6f2", 6 + (TAP_AT_MS - elapsed) / 150);
  } else {
    ring(ctx, here, "#5fe3a1", 12);
  }
}

export default function HowTo() {
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const [demo, setDemo] = useState(null);
  const [failed, setFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    let live = true;
    loadHowToFrames(PLANT).then((d) => live && setDemo(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!demo || still) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) % LOOP_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [demo, still]);

  const scene = SCENES.find((s) => elapsed < s.until);
  const showB = !still && Math.floor(elapsed / BLINK_MS) % 2 === 1;

  useEffect(() => {
    if (demo && canvasRef.current) draw(canvasRef.current, demo, scene, elapsed, showB);
  }, [demo, scene, elapsed, showB]);

  const steps = (
    <ol className={`how ${still || failed ? "" : "sr-only"}`}>
      <li>{t("how1")}</li>
      <li>{t("how2")}</li>
      <li>{t("how3")}</li>
    </ol>
  );

  if (failed) return steps;

  const pressedNothing = scene.name === "nothing" && elapsed >= NOTHING_AT_MS;

  return (
    <div className="howto">
      <div className="howto-frame">
        <canvas ref={canvasRef} width={CROP} height={CROP} aria-hidden="true" />
      </div>
      {still ? steps : (
        <div className="howto-side">
          {steps}
          <div aria-hidden="true" className="howto-text">
            <span className={`badge ${scene.name === "nothing" ? "real" : "sim"}`}>
              {scene.name === "nothing" ? t("howtoClean") : t("badgeSim")}
            </span>
            <p className="howto-caption">
              <span>{Number(scene.step.slice(-1))}</span> {t(scene.step)}
            </p>
            {scene.name === "tap" && elapsed >= TAP_AT_MS && <p className="howto-points">+{FIND_POINTS}</p>}
            {scene.name === "nothing" && (
              <div className="howto-row">
                <p className={`howto-press ${pressedNothing ? "on" : ""}`}>{t("nothingMoved")}</p>
                {pressedNothing && <p className="howto-points">+{NOTHING_MOVED_POINTS}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
