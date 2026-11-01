import { useI18n } from "../i18n/I18n.jsx";

const when = (utc) => `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
const release = (collection) => collection.replace("spherex_", "").toUpperCase();

// The record behind an answer: which images, what changed, why this is the verdict, and where it came from.
export default function Evidence({ level, simulated, target, trick }) {
  const { t } = useI18n();
  const [a, b] = level.frames;
  const hours = level.dt_hours.toFixed(1);
  const faint = level.objects.filter((o) => !level.movers.includes(o.name));

  let verdict = "verdictNone";
  if (trick) verdict = `verdict_${trick}`;
  else if (simulated) verdict = "verdictPlanted";
  else if (target) verdict = "verdictConfirmed";

  let shift = null;
  if (target) {
    const [p, q] = target.frames;
    const px = target.motionPx ?? Math.hypot(q.x - p.x, q.y - p.y);
    const arcsec = target.motionArcsec ?? px * level.arcsec_per_px;
    shift = t("movedValue", { px: Math.round(px), arcsec: Math.round(arcsec), hours });
  }
  const measured = !simulated && target?.frames[0].signal_sigma != null ? target.frames : null;

  return (
    <section className="evidence" aria-label={t("evidenceTitle")}>
      <h4>{t("evidenceTitle")}</h4>
      <p className="evidence-verdict">
        <strong>{t(verdict)}</strong> {t(`${verdict}Txt`, { n: faint.length })}
      </p>
      <dl>
        {[a, b].map((frame, i) => (
          <div key={frame.obs_id}>
            <dt>{t(i === 0 ? "scanA" : "scanB")}</dt>
            <dd>
              {when(frame.utc)}<br />
              <a href={frame.source_url} target="_blank" rel="noreferrer">{frame.obs_id}</a>
              {` · ${frame.detector.replace("SPHEREx-", "")} · ${frame.wavelength_um} µm`}
            </dd>
          </div>
        ))}
        {target && !simulated && target.frames.map((f, i) => (
          <div key={i}>
            <dt>{t("evidencePosition", { scan: t(i === 0 ? "scanA" : "scanB") })}</dt>
            <dd>RA {f.ra.toFixed(4)}°, Dec {f.dec.toFixed(4)}°</dd>
          </div>
        ))}
        <div>
          <dt>{shift ? t("moved") : t("gap")}</dt>
          <dd>{shift ?? t("hoursValue", { hours })}</dd>
        </div>
        {measured && (
          <>
            <div>
              <dt>{t("evidenceSignal")}</dt>
              <dd>{t("evidenceSignalValue", { a: Math.round(measured[0].signal_sigma), b: Math.round(measured[1].signal_sigma) })}</dd>
            </div>
            <div>
              <dt>{t("evidenceGone")}</dt>
              <dd>{t("evidenceGoneValue", { n: Math.round(Math.min(measured[0].vanished, measured[1].vanished) * 100) })}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t("evidenceSource")}</dt>
          <dd>{t(trick ? `evidenceSource_${trick}` : simulated ? "evidenceSourceSim" : "evidenceSourceReal", { release: release(level.collection) })}</dd>
        </div>
      </dl>
      <p className="evidence-limit">{t(trick ? "evidenceLimitTrick" : simulated ? "evidenceLimitSim" : "evidenceLimitReal")}</p>
    </section>
  );
}
