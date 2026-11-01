import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18n.jsx";

const BEST_KEY = "sky-detective-best";
// The player test link (?test=1) adds a round-by-round result the player can send. Read once, so going home keeps it.
const TEST_LINK = new URLSearchParams(window.location.search).has("test");

function testReport(stats, mode, lang) {
  const right = stats.log.filter((r) => r.right).length;
  const device = window.matchMedia("(pointer: coarse)").matches ? "phone" : "computer";
  const lines = stats.log.map((r) =>
    `${r.id}: ${r.right ? "right" : "WRONG"}, ${r.wrongTaps} wrong taps, ${r.decoyTaps} on decoy, ${r.seconds}s`);
  return [`Sky Detective test: ${mode}, ${device}, ${lang}`, `${right}/${stats.log.length} rounds right, score ${stats.score}`, ...lines].join("\n");
}

function TestReport({ text }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
  };
  return (
    <section className="test-report">
      <p>{t("testReportTxt")}</p>
      <pre>{text}</pre>
      <div className="controls">
        <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">{t("testWhatsApp")}</a>
        <button className="btn" type="button" onClick={copy}>{t(copied ? "testCopied" : "testCopy")}</button>
      </div>
    </section>
  );
}

export default function EndCard({ stats, mode, onAgain, onHome }) {
  const { t, lang } = useI18n();
  const [best, setBest] = useState(stats.score);

  useEffect(() => {
    // Challenge has different rounds from the case file, so it keeps its own best.
    const key = mode === "challenge" ? `${BEST_KEY}-challenge` : BEST_KEY;
    try {
      const saved = Number(localStorage.getItem(key)) || 0;
      const top = Math.max(saved, stats.score);
      localStorage.setItem(key, String(top));
      setBest(top);
    } catch {
      // storage blocked: show this game's score as the best
    }
  }, [stats.score, mode]);

  const accuracy = stats.answers ? Math.round((100 * stats.correct) / stats.answers) : 0;

  return (
    <section className="end">
      <h2>{t("endTitle")}</h2>
      <div className="big">{stats.score}</div>
      <dl className="end-stats">
        <dt>{t("best")}</dt><dd>{best}</dd>
        <dt>{t("accuracy")}</dt><dd>{accuracy}%</dd>
        <dt>{t("moversFound")}</dt><dd>{stats.moversFound}</dd>
        <dt>{t("roundsPlayed")}</dt><dd>{t("roundsValue", { real: stats.realRounds, sim: stats.simRounds })}</dd>
        <dt>{t("skySearched")}</dt><dd>{t("skyValue", { n: stats.skyDeg2.toFixed(2) })}</dd>
      </dl>
      <p>{t("skyTxt")}</p>
      {TEST_LINK && <TestReport text={testReport(stats, mode, lang)} />}
      <div className="controls">
        <button className="btn primary" type="button" onClick={onAgain}>{t("again")}</button>
        <button className="btn" type="button" onClick={onHome}>{t("home")}</button>
      </div>
    </section>
  );
}
