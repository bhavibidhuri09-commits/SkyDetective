import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.jsx";
import { loadDiff, loadRound } from "../game/levels.js";
import { randomPlant } from "../game/plantMover.js";
import {
  FIND_POINTS, MISS_POINTS, NOTHING_MOVED_POINTS, correctPoints, emptyStats, targetAt,
} from "../game/scoring.js";
import SkyCanvas from "./SkyCanvas.jsx";
import ResultCard, { formatDate } from "./ResultCard.jsx";

const BLINK_SPEEDS = [
  { name: "speedSlow", ms: 1000 },
  { name: "speedNormal", ms: 650 },
  { name: "speedFast", ms: 400 },
];
let practiceCount = 0;

function practiceRound() {
  practiceCount += 1;
  return { id: `practice-${practiceCount}`, kind: "training", folder: "training-bg", plant: randomPlant(),
           title: { en: "Practice", hi: "अभ्यास" } };
}

export default function Game({ mode, rounds, onEnd, onHome }) {
  const { t, lang } = useI18n();
  const practice = mode === "practice";
  const [round, setRound] = useState(() => (practice ? practiceRound() : rounds[0]));
  const [index, setIndex] = useState(0);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [foundIds, setFoundIds] = useState([]);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const [hint, setHint] = useState("hint");
  const [flash, setFlash] = useState(null);
  const [showB, setShowB] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [diff, setDiff] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffFailed, setDiffFailed] = useState(false);
  const [stats, setStats] = useState(emptyStats);
  const startedAt = useRef(Date.now());
  const currentRound = useRef(round);

  useEffect(() => {
    let live = true;
    currentRound.current = round;
    setData(null);
    setLoadError(false);
    setDiff(null);
    setShowDiff(false);
    setDiffFailed(false);
    loadRound(round)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFoundIds([]);
        setDone(false);
        setResult(null);
        setHint("hint");
        setShowB(false);
        setPlaying(true);
        startedAt.current = Date.now();
      })
      .catch(() => live && setLoadError(true));
    return () => { live = false; };
  }, [round]);

  useEffect(() => {
    if (!playing || !data || showDiff) return undefined;
    const timer = setInterval(() => setShowB((b) => !b), BLINK_SPEEDS[speed].ms);
    return () => clearInterval(timer);
  }, [playing, data, speed, showDiff]);

  if (loadError) return <p className="hint">{t("loadError")}</p>;
  if (!data) return <p className="hint">{t("loading")}</p>;

  const seconds = () => (Date.now() - startedAt.current) / 1000;

  function finishRound() {
    setDone(true);
    if (data.round.kind === "real") {
      setStats((s) => ({ ...s, realRounds: s.realRounds + 1, skyDeg2: s.skyDeg2 + data.level.size_deg ** 2 }));
    } else {
      setStats((s) => ({ ...s, simRounds: s.simRounds + 1 }));
    }
  }

  function handleTap(x, y) {
    if (done) return;
    const hit = targetAt(data.targets, foundIds, x, y);
    if (!hit) {
      setStats((s) => ({ ...s, answers: s.answers + 1, streak: 0, score: Math.max(0, s.score + MISS_POINTS) }));
      setFlash({ x, y });
      setHint("miss");
      setTimeout(() => setFlash(null), 900);
      return;
    }
    const award = correctPoints(FIND_POINTS, seconds(), stats.streak);
    const nowFound = [...foundIds, hit.id];
    setFoundIds(nowFound);
    setStats((s) => ({ ...s, answers: s.answers + 1, correct: s.correct + 1, moversFound: s.moversFound + 1,
                       streak: s.streak + 1, score: s.score + award.points }));
    setResult({ kind: "found", target: hit, ...award });
    if (nowFound.length === data.targets.length) finishRound();
    else setHint("hintMore");
  }

  function handleNothingMoved() {
    if (done) return;
    const missed = data.targets.filter((tg) => !foundIds.includes(tg.id));
    if (data.targets.length === 0) {
      const award = correctPoints(NOTHING_MOVED_POINTS, seconds(), stats.streak, false);
      setStats((s) => ({ ...s, answers: s.answers + 1, correct: s.correct + 1, streak: s.streak + 1,
                         score: s.score + award.points }));
      setResult({ kind: "noneRight", ...award });
    } else {
      setStats((s) => ({ ...s, answers: s.answers + 1, streak: 0 }));
      setResult({ kind: "noneWrong", target: missed[0], points: 0 });
    }
    finishRound();
  }

  function toggleDiff() {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    if (diff) {
      setShowDiff(true);
      return;
    }
    const forRound = data.round;
    loadDiff(forRound)
      .then((img) => {
        if (forRound !== currentRound.current) return;
        setDiff(img);
        setShowDiff(true);
      })
      .catch(() => setDiffFailed(true));
  }

  function nextRound() {
    if (practice) {
      setRound(practiceRound());
      return;
    }
    if (index === rounds.length - 1) {
      onEnd(stats);
      return;
    }
    setIndex(index + 1);
    setRound(rounds[index + 1]);
  }

  const frame = data.level.frames[showB ? 1 : 0];
  const when = `${formatDate(frame.utc, lang)} ${frame.utc.slice(11, 16)} UTC`;
  const found = data.targets.filter((tg) => foundIds.includes(tg.id));
  const reveal = done ? data.targets : [];
  const remaining = data.targets.length - foundIds.length;
  const last = !practice && index === rounds.length - 1;

  return (
    <>
      <div className="status">
        <div>
          {practice ? t("practiceTag") : <>{t("case")} <strong>{index + 1}</strong>/{rounds.length}</>}
        </div>
        <div>{t("score")} <strong>{stats.score}</strong></div>
      </div>
      <h2 className="round-title">{round.title[lang]}</h2>
      {/* Team decision: players see whether a round is real or simulated before they answer. */}
      <span className={`badge ${data.round.kind === "training" ? "sim" : "real"}`}>
        {data.round.kind === "training"
          ? t("badgeSim")
          : t("badgeReal", { date: formatDate(data.level.frames[0].utc, lang) })}
      </span>

      <SkyCanvas
        key={round.id}
        frames={data.frames}
        diff={showDiff ? diff : null}
        zoomInLabel={t("zoomIn")}
        zoomOutLabel={t("zoomOut")}
        showB={showB}
        found={done ? [] : found}
        reveal={reveal}
        flash={flash}
        onTap={handleTap}
        label={round.title[lang]}
        stampText={showDiff ? t("diffStamp") : `${showB ? t("scanB") : t("scanA")} · ${when}`}
        cornerText={`λ ${frame.wavelength_um} µm · ${frame.detector.replace("SPHEREx-", "")}`}
      />
      <p className="hint">
        {showDiff ? <>{t("diffTxt")}{data.round.diffNote && <> {data.round.diffNote[lang]}</>}</> : t(hint, { n: remaining })}
      </p>

      <div className="controls">
        <button className="btn" type="button" onClick={() => setPlaying(!playing)} disabled={showDiff}>
          {playing ? t("pause") : t("play")}
        </button>
        <button className="btn" type="button" onClick={() => setSpeed((speed + 1) % BLINK_SPEEDS.length)} disabled={showDiff}>
          {t("speed", { name: t(BLINK_SPEEDS[speed].name) })}
        </button>
        {done && data.round.kind === "real" && !diffFailed && (
          <button className="btn" type="button" onClick={toggleDiff}>
            {showDiff ? t("diffHide") : t("diffShow")}
          </button>
        )}
        <button className="btn" type="button" onClick={handleNothingMoved} disabled={done}>
          {t("nothingMoved")}
        </button>
        {done && (
          <button className="btn primary" type="button" onClick={nextRound}>
            {practice ? t("anotherPractice") : last ? t("finish") : t("next")}
          </button>
        )}
      </div>

      {result && <ResultCard result={result} data={data} />}

      {practice && (
        <button className="btn ghost" type="button" onClick={onHome}>{t("home")}</button>
      )}
    </>
  );
}
