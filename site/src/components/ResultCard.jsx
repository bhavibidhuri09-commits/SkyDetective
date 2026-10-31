import { useI18n } from "../i18n/I18n.jsx";
import Evidence from "./Evidence.jsx";

export function formatDate(utc, lang) {
  return new Date(utc).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function ObjectFacts({ target }) {
  const { t, orbitClass } = useI18n();
  const info = target.info;
  if (!info) return null;
  return (
    <>
      <dl>
        <dt>{t("type")}</dt>
        <dd>{orbitClass(info.orbit_class)}</dd>
        {info.diameter_km && (<><dt>{t("size")}</dt><dd>{t("km", { n: Math.round(info.diameter_km) })}</dd></>)}
        <dt>{t("sunDist")}</dt>
        <dd>{t("au", { n: info.sun_distance_au.toFixed(2) })}</dd>
        {info.period_years && (<><dt>{t("orbit")}</dt><dd>{t("years", { n: info.period_years.toFixed(1) })}</dd></>)}
        {info.discovered && (
          <><dt>{t("discovered")}</dt><dd>{t("discoveredBy", { date: info.discovered, who: info.discovered_by })}</dd></>
        )}
      </dl>
      <p className="links">
        <a href={info.sbdb_url} target="_blank" rel="noreferrer">{t("jplLink")}</a>
        <a href={info.mpc_url} target="_blank" rel="noreferrer">{t("mpcLink")}</a>
      </p>
    </>
  );
}

// result.kind: "found" | "noneRight" | "noneWrong"
export default function ResultCard({ result, data }) {
  const { t, lang } = useI18n();
  const simulated = data.round.kind === "training";
  const target = result.target;
  const good = result.kind !== "noneWrong";

  let title = t("noneRight");
  if (result.kind === "noneWrong") title = t("noneWrong");
  if (result.kind === "found") {
    const name = target.number ? `(${target.number}) ${target.name}` : target.name;
    title = simulated ? t("foundSim") : t("foundName", { name });
  }

  let body = null;
  if (simulated) body = t("simTxt");
  else if (result.kind === "noneRight") body = t("noneRightTxt");
  else if (result.kind === "noneWrong") body = t("noneWrongTxt");

  return (
    <section className={`result ${good ? "" : "miss"}`} aria-live="polite">
      <span className={`badge ${simulated ? "sim" : "real"}`}>
        {simulated ? t("badgeSim") : t("badgeReal", { date: formatDate(data.level.frames[0].utc, lang) })}
      </span>
      <h3>{title}</h3>
      {result.points > 0 && (
        <p className="points">
          +{result.points}
          {result.bonus > 0 && <span className="chip">{t("speedBonus", { n: result.bonus })}</span>}
          {result.onStreak && <span className="chip">{t("streak")}</span>}
        </p>
      )}
      {body && <p>{body}</p>}
      {data.round.note && (
        <p>
          {data.round.note[lang]}
          {data.round.noteLink && (
            <> <a href={data.round.noteLink.url} target="_blank" rel="noreferrer">{data.round.noteLink.label[lang]}</a></>
          )}
        </p>
      )}
      <Evidence level={data.level} simulated={simulated} target={target} />
      {target && !simulated && <ObjectFacts target={target} />}
    </section>
  );
}
