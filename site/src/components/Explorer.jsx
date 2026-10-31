import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.jsx";
import { loadCatalog, loadFrame, runQueue, searchExposures } from "../explore/archive.js";
import {
  coversField, flagNames, fluxAt, glowAt, parseAngle, spreadInTime, stackAll, stackVisits, subtract, toImage,
} from "../explore/frames.js";
import { makeGrid } from "../explore/wcs.js";
import { buildReport, mjdToUtc, saveReport } from "../explore/report.js";
import SkyCanvas from "./SkyCanvas.jsx";
import Chart from "./Chart.jsx";

const NONE = [];
const FIELDS = [0.1, 0.25, 0.5, 1];
const FRAME_COUNTS = [8, 12, 24];
const DETECTORS = [
  { id: 1, range: "0.75–1.1" }, { id: 2, range: "1.1–1.6" }, { id: 3, range: "1.6–2.4" },
  { id: 4, range: "2.4–3.8" }, { id: 5, range: "3.8–4.4" }, { id: 6, range: "4.4–5.0" },
];
const SPEEDS = [
  { name: "speedSlow", ms: 1000 }, { name: "speedNormal", ms: 500 }, { name: "speedFast", ms: 250 },
];
const NATIVE_DEG_PER_PX = 3.075 / 3600; // half a SPHEREx pixel
const MAX_NPIX = 585;
const LOAD_AT_ONCE = 4;
const SPECTRUM_FIELD = 0.05;
const SPECTRUM_PER_DETECTOR = 10;
const CATALOG_COLORS = { gaia: "#5fc8ff", wise: "#ff4f7b" };
const OPINIONS = ["moving", "stationary", "artifact", "unsure"];

// Boxes are centred near the 2025 position where a star's own motion matters. WISE 0855 uses the
// coordinates in the challenge statement. motion = catalogue position, its year and mas/yr on the sky.
export const TARGETS = [
  { id: "barnard", name: "Barnard's Star", ra: "269.4464", dec: "4.7665", det: 3, fov: 0.25,
    motion: { ra: 269.45208, dec: 4.69336, year: 2000, pmRa: -798.58, pmDec: 10328.12 } },
  { id: "epsindi", name: "Epsilon Indi B", ra: "331.0950", dec: "-56.8010", det: 3, fov: 0.25,
    motion: { ra: 331.04383, dec: -56.78269, year: 2000, pmRa: 3978, pmDec: -2540 } },
  { id: "wise0855", name: "WISE 0855", ra: "08h55m10.831s", dec: "-7d14m42.53s", det: 6, fov: 0.25,
    motion: { ra: 133.79513, dec: -7.24515, year: 2010.5, pmRa: -8118.9, pmDec: 680.7 } },
  { id: "rwaur", name: "RW Aurigae", ra: "76.9564", dec: "30.4014", det: 3, fov: 0.25 },
  { id: "rdra", name: "R Draconis", ra: "248.1675", dec: "66.7550", det: 1, fov: 0.25 },
];

const toYear = (mjd) => 2000 + (mjd - 51544.5) / 365.25;
const toDate = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

function expectedSky(motion, mjd) {
  const years = toYear(mjd) - motion.year;
  const dec = motion.dec + (motion.pmDec * years) / 3600000;
  const ra = motion.ra + (motion.pmRa * years) / 3600000 / Math.cos((motion.dec * Math.PI) / 180);
  return [ra, dec];
}

// Brightness at a point in each frame, using a saturated star's glow when its core has no data.
function measure(frames, grid, col, row, sky) {
  const usable = frames.map((f) => ({ frame: f, core: fluxAt(f, grid, col, row) }));
  const points = usable.filter((u) => u.core !== null).length >= frames.length / 2
    ? usable.map((u) => ({ frame: u.frame, flux: u.core, saturated: false }))
    : usable.map((u) => ({ frame: u.frame, flux: glowAt(u.frame, grid, col, row), saturated: true }));
  return points.filter((p) => p.flux !== null).map((p) => ({
    wavelength: p.frame.wavelengthOf(sky.ra, sky.dec),
    flux: p.flux,
    mjd: p.frame.mjdMid,
    saturated: p.saturated,
  }));
}

export default function Explorer({ initial, onHome }) {
  const { t } = useI18n();
  const [raText, setRaText] = useState(initial?.ra ?? "");
  const [decText, setDecText] = useState(initial?.dec ?? "");
  const [fov, setFov] = useState(FIELDS.includes(initial?.fov) ? initial.fov : 0.25);
  const [detector, setDetector] = useState(initial?.det >= 1 && initial?.det <= 6 ? initial.det : 3);
  const [frameCount, setFrameCount] = useState(12);
  const [formError, setFormError] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | searching | loading | done | none | failed
  const [totals, setTotals] = useState(null);
  const [grid, setGrid] = useState(null);
  const [frames, setFrames] = useState(NONE);
  const [wanted, setWanted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [runId, setRunId] = useState(0);
  const [source, setSource] = useState("exposure");
  const [mode, setMode] = useState("video");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [pickA, setPickA] = useState(0);
  const [pickB, setPickB] = useState(-1);
  const [catalogs, setCatalogs] = useState({});
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [motion, setMotion] = useState(null);
  const [showExpected, setShowExpected] = useState(true);
  const [pin, setPin] = useState(null);
  const [opinion, setOpinion] = useState("unsure");
  const [note, setNote] = useState("");
  const [chart, setChart] = useState("spectrum");
  const [extraPoints, setExtraPoints] = useState(NONE);
  const [spectrumState, setSpectrumState] = useState("idle"); // idle | loading | done
  const [spectrumProgress, setSpectrumProgress] = useState(0);
  const run = useRef(0);
  const exposures = useRef(NONE);
  const images = useRef(new WeakMap());

  const start = useCallback(async (raValue, decValue, fovValue, detValue, count) => {
    const ra = parseAngle(raValue, true);
    const dec = parseAngle(decValue, false);
    if (ra === null || dec === null) {
      setFormError(true);
      return;
    }
    setFormError(false);
    const id = ++run.current;
    const live = () => id === run.current;
    setRunId(id);
    setMotion(TARGETS.find((target) => target.ra === raValue && target.dec === decValue)?.motion ?? null);
    setPhase("searching");
    setFrames(NONE);
    setPin(null);
    setIndex(0);
    setPickA(0);
    setPickB(-1);
    setCatalogs({});
    setCatalogFailed(false);
    setExtraPoints(NONE);
    setSpectrumState("idle");
    setSkipped(0);
    setTotals(null);
    window.history.replaceState(null, "", `?ra=${encodeURIComponent(raValue)}&dec=${encodeURIComponent(decValue)}&fov=${fovValue}&det=${detValue}`);
    const npix = Math.min(MAX_NPIX, Math.round(fovValue / NATIVE_DEG_PER_PX));
    const view = makeGrid(ra, dec, fovValue, npix);
    setGrid(view);
    let found;
    try {
      found = await searchExposures(ra, dec);
    } catch {
      if (live()) setPhase("failed");
      return;
    }
    if (!live()) return;
    exposures.current = found.exposures;
    const onDetector = found.exposures.filter((e) => e.detector === detValue);
    const whole = onDetector.filter((e) => coversField(e.region, ra, dec, fovValue / 2));
    const usable = whole.length >= 3 ? whole : onDetector;
    setTotals({ all: found.exposures.length, here: onDetector.length, failed: found.failed.length > 0 });
    if (!usable.length) {
      setPhase("none");
      return;
    }
    const chosen = spreadInTime(usable, count);
    setWanted(chosen.length);
    setPhase("loading");
    const cutoutSize = fovValue * Math.SQRT2 * 1.05;
    await runQueue(chosen, LOAD_AT_ONCE, async (exposure) => {
      const frame = await loadFrame(exposure, view, cutoutSize);
      if (live()) setFrames((list) => [...list, frame].sort((a, b) => a.mjdMid - b.mjdMid));
    }, () => !live(), () => live() && setSkipped((n) => n + 1));
    if (live()) setPhase("done");
  }, []);

  useEffect(() => {
    if (initial?.ra && initial?.dec) start(initial.ra, initial.dec, fov, detector, frameCount);
    return () => { run.current += 1; };
    // Only a link with coordinates starts by itself, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const npix = grid?.npix ?? 0;
  const visits = useMemo(() => (source === "visit" && frames.length ? stackVisits(frames, npix) : NONE), [source, frames, npix]);
  const sequence = source === "visit" ? visits : frames;
  const safeIndex = sequence.length ? index % sequence.length : 0;
  const lastPick = sequence.length - 1;
  const a = sequence[Math.min(pickA, lastPick)];
  const b = sequence[pickB < 0 ? lastPick : Math.min(pickB, lastPick)];

  const shown = useMemo(() => {
    if (!sequence.length) return null;
    if (mode === "add") return stackAll(frames, npix);
    if (mode === "subtract") return a && b ? subtract(a, b, npix) : null;
    return sequence[safeIndex];
  }, [mode, sequence, safeIndex, frames, npix, a, b]);

  const image = useMemo(() => {
    if (!shown) return null;
    let img = images.current.get(shown);
    if (!img) {
      img = toImage(shown, npix);
      images.current.set(shown, img);
    }
    return img;
  }, [shown, npix]);
  const canvasFrames = useMemo(() => (image ? [image] : NONE), [image]);

  useEffect(() => {
    if (!playing || mode !== "video" || sequence.length < 2) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % sequence.length), SPEEDS[speed].ms);
    return () => clearInterval(timer);
  }, [playing, mode, sequence.length, speed]);

  const toggleCatalog = async (cat) => {
    if (catalogs[cat]) {
      setCatalogs(({ [cat]: _, ...rest }) => rest);
      return;
    }
    const id = run.current;
    setCatalogFailed(false);
    try {
      const sources = await loadCatalog(cat, grid.ra, grid.dec, grid.fovDeg * 0.75);
      if (id === run.current) setCatalogs((c) => ({ ...c, [cat]: sources.map((s) => grid.fromSky(s.ra, s.dec)) }));
    } catch {
      if (id === run.current) setCatalogFailed(true);
    }
  };

  const expectedAt = motion && showExpected && shown?.mjdMid && mode === "video" ? shown.mjdMid : null;

  const overlay = useCallback((ctx) => {
    if (expectedAt) {
      const spot = grid.fromSky(...expectedSky(motion, expectedAt));
      ctx.strokeStyle = "#5fe3a1";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    Object.entries(catalogs).forEach(([cat, spots]) => {
      ctx.strokeStyle = CATALOG_COLORS[cat];
      ctx.lineWidth = 1;
      spots.forEach((s) => {
        ctx.beginPath();
        ctx.arc(s.x, s.y, cat === "gaia" ? 3 : 4.5, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
    if (pin) {
      ctx.strokeStyle = "#ffb547";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pin.col - 10, pin.row);
      ctx.lineTo(pin.col - 4, pin.row);
      ctx.moveTo(pin.col + 4, pin.row);
      ctx.lineTo(pin.col + 10, pin.row);
      ctx.moveTo(pin.col, pin.row - 10);
      ctx.lineTo(pin.col, pin.row - 4);
      ctx.moveTo(pin.col, pin.row + 4);
      ctx.lineTo(pin.col, pin.row + 10);
      ctx.stroke();
    }
  }, [catalogs, pin, expectedAt, motion, grid]);

  const handleTap = (x, y) => {
    const col = Math.max(0, Math.min(npix - 1, Math.round(x)));
    const row = Math.max(0, Math.min(npix - 1, Math.round(y)));
    const [ra, dec] = grid.toSky(col, row);
    setPin({ col, row, ra, dec });
    setExtraPoints(NONE);
    setSpectrumState("idle");
  };

  const pointsHere = useMemo(() => {
    if (!pin) return NONE;
    return measure(frames, grid, pin.col, pin.row, pin);
  }, [pin, frames, grid]);

  const loadFullSpectrum = async () => {
    const id = run.current;
    const pinned = pin;
    const small = makeGrid(pinned.ra, pinned.dec, SPECTRUM_FIELD, Math.round(SPECTRUM_FIELD / NATIVE_DEG_PER_PX));
    const centre = Math.round((small.npix - 1) / 2);
    const chosen = DETECTORS.flatMap((d) => spreadInTime(
      exposures.current.filter((e) => e.detector === d.id && e.detector !== detector),
      SPECTRUM_PER_DETECTOR,
    ));
    setSpectrumState("loading");
    setSpectrumProgress(0);
    setWantedSpectrum(chosen.length);
    await runQueue(chosen, LOAD_AT_ONCE, async (exposure) => {
      const frame = await loadFrame(exposure, small, SPECTRUM_FIELD * Math.SQRT2 * 1.05);
      if (id !== run.current) return;
      const found = measure([frame], small, centre, centre, pinned);
      if (found.length) setExtraPoints((list) => [...list, ...found]);
      setSpectrumProgress((n) => n + 1);
    }, () => id !== run.current, () => setSpectrumProgress((n) => n + 1));
    if (id === run.current) setSpectrumState("done");
  };
  const [wantedSpectrum, setWantedSpectrum] = useState(0);

  const submit = (e) => {
    e.preventDefault();
    start(raText, decText, fov, detector, frameCount);
  };

  const chooseTarget = (target) => {
    setRaText(target.ra);
    setDecText(target.dec);
    setFov(target.fov);
    setDetector(target.det);
    start(target.ra, target.dec, target.fov, target.det, frameCount);
  };

  let stamp = "";
  if (shown) {
    if (mode === "add") stamp = t("addStamp", { n: frames.length });
    else if (mode === "subtract") stamp = t("subtractStamp");
    else if (shown.stack) stamp = t("visitStamp", { date: toDate(shown.mjdMid), n: shown.count });
    else stamp = `${toDate(shown.mjdMid)} · ${safeIndex + 1}/${sequence.length}`;
  }
  const atCentre = shown && !shown.stack && !shown.difference && grid ? shown.wavelengthOf(grid.ra, grid.dec) : null;
  const corner = atCentre ? `λ ${atCentre.toFixed(3)} µm · D${detector}` : `D${detector}`;
  const flagFrame = pin && shown?.flags ? shown : null;
  const pinFlags = flagFrame ? flagNames(flagFrame.flagsHeader, flagFrame.flags[pin.row * npix + pin.col]) : NONE;
  const allPoints = [...pointsHere, ...extraPoints];
  const shownFrame = shown && !shown.stack && !shown.difference ? shown : null;
  const saveCandidate = () => saveReport(buildReport({
    grid, pin, frames, detector: frames[0].detector, opinion: t(`opinion_${opinion}`), note, pageUrl: window.location.href,
  }));
  const label = (frame) => (frame.stack
    ? `${toDate(frame.mjdMid)} (${frame.count})`
    : `${toDate(frame.mjdMid)} · ${frame.wavelengthOf(grid.ra, grid.dec)?.toFixed(2)} µm`);
  const busy = phase === "searching" || phase === "loading";

  return (
    <section className="explorer">
      <h2 className="round-title">{t("explorerTitle")}</h2>
      <p className="intro">{t("explorerIntro")}</p>

      <div className="chips" role="group" aria-label={t("targetsLabel")}>
        {TARGETS.map((target) => (
          <button key={target.id} className="chip-btn" type="button" onClick={() => chooseTarget(target)}>{target.name}</button>
        ))}
      </div>

      <form className="coords" onSubmit={submit}>
        <label>{t("raLabel")}<input value={raText} onChange={(e) => setRaText(e.target.value)} placeholder="08h55m10.8s" spellCheck="false" autoComplete="off" /></label>
        <label>{t("decLabel")}<input value={decText} onChange={(e) => setDecText(e.target.value)} placeholder="-7d14m42.5s" spellCheck="false" autoComplete="off" /></label>
        <label>{t("fovLabel")}
          <select value={fov} onChange={(e) => setFov(Number(e.target.value))}>
            {FIELDS.map((f) => <option key={f} value={f}>{f}°</option>)}
          </select>
        </label>
        <label>{t("detectorLabel")}
          <select value={detector} onChange={(e) => setDetector(Number(e.target.value))}>
            {DETECTORS.map((d) => <option key={d.id} value={d.id}>D{d.id}: {d.range} µm</option>)}
          </select>
        </label>
        <label>{t("framesLabel")}
          <select value={frameCount} onChange={(e) => setFrameCount(Number(e.target.value))}>
            {FRAME_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn primary" type="submit">{t("showSky")}</button>
      </form>
      {formError && <p className="hint form-error">{t("coordsError")}</p>}

      <p className="hint" aria-live="polite">
        {phase === "idle" && t("explorerIdle")}
        {phase === "searching" && t("searching")}
        {phase === "loading" && t("loadingFrames", { n: frames.length, total: wanted })}
        {phase === "done" && t("loadedFrames", { n: frames.length, here: totals?.here ?? 0, all: totals?.all ?? 0 })}
        {phase === "none" && t("noCoverage", { n: totals?.all ?? 0 })}
        {phase === "failed" && t("archiveFailed")}
        {skipped > 0 && ` ${t("framesSkipped", { n: skipped })}`}
        {totals?.failed && ` ${t("searchPartial")}`}
      </p>

      {image && (
        <>
          <SkyCanvas
            key={runId}
            frames={canvasFrames}
            showB={false}
            found={NONE}
            reveal={NONE}
            flash={null}
            overlay={overlay}
            onTap={handleTap}
            label={t("explorerTitle")}
            stampText={stamp}
            cornerText={corner}
            zoomInLabel={t("zoomIn")}
            zoomOutLabel={t("zoomOut")}
          />

          <div className="segmented" role="group" aria-label={t("viewLabel")}>
            {["video", "add", "subtract"].map((m) => (
              <button key={m} type="button" className={mode === m ? "on" : ""} aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`mode_${m}`)}</button>
            ))}
          </div>

          {mode !== "add" && (
            <div className="segmented" role="group" aria-label={t("sourceLabel")}>
              {["exposure", "visit"].map((s) => (
                <button key={s} type="button" className={source === s ? "on" : ""} aria-pressed={source === s} onClick={() => { setSource(s); setIndex(0); setPickA(0); setPickB(-1); }}>{t(`source_${s}`)}</button>
              ))}
            </div>
          )}

          {mode === "video" && sequence.length > 0 && (
            <div className="controls">
              <button className="btn" type="button" onClick={() => setPlaying(!playing)}>{playing ? t("pauseVideo") : t("playVideo")}</button>
              <button className="btn" type="button" onClick={() => setSpeed((speed + 1) % SPEEDS.length)}>{t("speed", { name: t(SPEEDS[speed].name) })}</button>
              <input className="scrub" type="range" min="0" max={sequence.length - 1} value={safeIndex} aria-label={t("frameSlider")} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
            </div>
          )}

          {mode === "subtract" && (
            <div className="coords">
              <label>{t("pickA")}
                <select value={Math.min(pickA, lastPick)} onChange={(e) => setPickA(Number(e.target.value))}>
                  {sequence.map((f, i) => <option key={i} value={i}>{label(f)}</option>)}
                </select>
              </label>
              <label>{t("pickB")}
                <select value={pickB < 0 ? lastPick : Math.min(pickB, lastPick)} onChange={(e) => setPickB(Number(e.target.value))}>
                  {sequence.map((f, i) => <option key={i} value={i}>{label(f)}</option>)}
                </select>
              </label>
            </div>
          )}

          <p className="hint">{t(`hint_${mode === "video" ? source : mode}`)}</p>

          <div className="provenance">
            {shownFrame && (
              <p>
                {t("thisImage")}: <a href={shownFrame.url} target="_blank" rel="noreferrer">{shownFrame.obsId}</a>
                {` · ${shownFrame.collection.replace("spherex_", "").toUpperCase()} · ${mjdToUtc(shownFrame.mjdMid).slice(0, 16).replace("T", " ")} UTC`}
              </p>
            )}
            <details>
              <summary>{t("imagesUsed", { n: frames.length })}</summary>
              <ul>
                {frames.map((f) => (
                  <li key={f.obsId}>
                    <a href={f.url} target="_blank" rel="noreferrer">{f.obsId}</a>
                    {` · ${f.collection.replace("spherex_", "").toUpperCase()} · ${mjdToUtc(f.mjdMid).slice(0, 16).replace("T", " ")} UTC · ${f.wavelengthOf(grid.ra, grid.dec)?.toFixed(3)} µm`}
                  </li>
                ))}
              </ul>
              <p>{t("imagesNote")}</p>
            </details>
          </div>

          <div className="overlays">
            <span>{t("overlayLabel")}</span>
            {motion && (
              <label style={{ color: "#5fe3a1" }}>
                <input type="checkbox" checked={showExpected} onChange={() => setShowExpected(!showExpected)} /> {t("overlay_expected")}
              </label>
            )}
            {["gaia", "wise"].map((cat) => (
              <label key={cat} style={{ color: CATALOG_COLORS[cat] }}>
                <input type="checkbox" checked={Boolean(catalogs[cat])} onChange={() => toggleCatalog(cat)} /> {t(`overlay_${cat}`)}
              </label>
            ))}
          </div>
          {catalogFailed && <p className="hint form-error">{t("catalogFailed")}</p>}

          {pin ? (
            <section className="result">
              <h3>{t("pinTitle", { ra: pin.ra.toFixed(4), dec: pin.dec.toFixed(4) })}</h3>
              {flagFrame && (
                <p>{t("flagsHere")}: {pinFlags.length ? pinFlags.join(", ") : t("flagsNone")}</p>
              )}
              <div className="segmented" role="group" aria-label={t("chartLabel")}>
                {["spectrum", "time"].map((c) => (
                  <button key={c} type="button" className={chart === c ? "on" : ""} aria-pressed={chart === c} onClick={() => setChart(c)}>{t(`chart_${c}`)}</button>
                ))}
              </div>
              {allPoints.length > 0 ? (
                <Chart
                  points={allPoints.map((p) => ({ x: chart === "spectrum" ? p.wavelength : toYear(p.mjd), y: p.flux }))}
                  xLabel={chart === "spectrum" ? t("axisWavelength") : t("axisDate")}
                  yLabel={t("axisFlux")}
                  xFormat={(v) => (chart === "spectrum" ? v.toFixed(2) : v.toFixed(1))}
                  label={t(`chart_${chart}`)}
                />
              ) : <p>{t("noFlux")}</p>}
              <p>{t(`chartNote_${chart}`)}</p>
              {allPoints.some((p) => p.saturated) && <p>{t("chartNote_saturated")}</p>}
              {spectrumState === "idle" && (
                <button className="btn" type="button" onClick={loadFullSpectrum}>{t("fullSpectrum")}</button>
              )}
              {spectrumState === "loading" && <p>{t("fullSpectrumLoading", { n: spectrumProgress, total: wantedSpectrum })}</p>}
              <div className="candidate">
                <h4>{t("candidateTitle")}</h4>
                <label>{t("opinionLabel")}
                  <select value={opinion} onChange={(e) => setOpinion(e.target.value)}>
                    {OPINIONS.map((o) => <option key={o} value={o}>{t(`opinion_${o}`)}</option>)}
                  </select>
                </label>
                <label>{t("noteLabel")}
                  <textarea rows="3" maxLength="1000" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
                </label>
                <button className="btn" type="button" onClick={saveCandidate}>{t("saveReport")}</button>
                <p>{t("candidateNote")}</p>
              </div>
            </section>
          ) : <p className="hint">{t("pinHint")}</p>}
        </>
      )}

      {!busy && (
        <button className="btn ghost" type="button" onClick={onHome}>{t("home")}</button>
      )}
    </section>
  );
}
