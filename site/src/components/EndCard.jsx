import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18n.jsx";

const BEST_KEY = "sky-detective-best";

export default function EndCard({ stats, onAgain, onHome }) {
  const { t } = useI18n();
  const [best, setBest] = useState(stats.score);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(BEST_KEY)) || 0;
      const top = Math.max(saved, stats.score);
      localStorage.setItem(BEST_KEY, String(top));
      setBest(top);
    } catch {
      // storage blocked: show this game's score as the best
    }
  }, [stats.score]);

  const accuracy = stats.answers ? Math.round((100 * stats.correct) / stats.answers) : 0;

  return (
    <section className="end">
      <h2>{t("endTitle")}</h2>
      <div className="big">{stats.score}</div>
      <dl className="end-stats">
        <dt>{t("best")}</dt><dd>{best}</dd>
        <dt>{t("accuracy")}</dt><dd>{accuracy}%</dd>
        <dt>{t("moversFound")}</dt><dd>{stats.moversFound}</dd>
        <dt>{t("skySearched")}</dt><dd>{t("skyValue", { n: stats.skyDeg2.toFixed(2) })}</dd>
      </dl>
      <p>{t("skyTxt")}</p>
      <div className="controls">
        <button className="btn primary" type="button" onClick={onAgain}>{t("again")}</button>
        <button className="btn" type="button" onClick={onHome}>{t("home")}</button>
      </div>
    </section>
  );
}
