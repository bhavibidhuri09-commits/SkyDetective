import { useI18n } from "../i18n/I18n.jsx";
import HowTo from "./HowTo.jsx";

export default function Home({ onStart, onChallenge, onPractice, ready }) {
  const { t } = useI18n();
  return (
    <section className="home">
      <p className="intro">{t("intro")}</p>
      <HowTo />
      <div className="controls">
        <button className="btn primary" type="button" onClick={onStart} disabled={!ready}>{t("start")}</button>
        <button className="btn" type="button" onClick={onChallenge} disabled={!ready}>{t("challenge")}</button>
        <button className="btn" type="button" onClick={onPractice}>{t("practice")}</button>
      </div>
      <p className="hint">{t("challengeNote")}</p>
    </section>
  );
}
