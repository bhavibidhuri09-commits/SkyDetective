import { useI18n } from "../i18n/I18n.jsx";

export default function Home({ onStart, onPractice, ready }) {
  const { t } = useI18n();
  return (
    <section className="home">
      <p className="intro">{t("intro")}</p>
      <ol className="how">
        <li>{t("how1")}</li>
        <li>{t("how2")}</li>
        <li>{t("how3")}</li>
      </ol>
      <div className="controls">
        <button className="btn primary" type="button" onClick={onStart} disabled={!ready}>{t("start")}</button>
        <button className="btn" type="button" onClick={onPractice}>{t("practice")}</button>
      </div>
    </section>
  );
}
