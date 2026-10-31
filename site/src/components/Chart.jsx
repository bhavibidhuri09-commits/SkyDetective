const W = 520;
const H = 220;
const LEFT = 48;
const BOTTOM = 34;
const TOP = 10;
const RIGHT = 24;
const OUTLIER_SPREADS = 12;

const ticks = (low, high, count) => Array.from({ length: count + 1 }, (_, i) => low + ((high - low) * i) / count);

// A plain scatter plot; points = [{ x, y }].
export default function Chart({ points, xLabel, yLabel, xFormat, label }) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = (a, b) => (a === b ? [a - 1, b + 1] : [a - (b - a) * 0.06, b + (b - a) * 0.06]);
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  // One glitched image shouldn't flatten the rest: points far above the others sit on the top edge.
  const sorted = [...ys].sort((a, b) => a - b);
  const middle = sorted[sorted.length >> 1];
  const spread = [...ys].map((y) => Math.abs(y - middle)).sort((a, b) => a - b)[sorted.length >> 1];
  const ceiling = spread > 0 ? Math.min(Math.max(...ys), middle + OUTLIER_SPREADS * spread) : Math.max(...ys);
  const [y0, y1] = pad(Math.min(0, ...ys), ceiling);
  const px = (x) => LEFT + ((x - x0) / (x1 - x0)) * (W - LEFT - RIGHT);
  const py = (y) => TOP + (1 - (Math.min(y, y1) - y0) / (y1 - y0)) * (H - TOP - BOTTOM);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks(y0, y1, 4).map((v) => (
        <g key={v}>
          <line x1={LEFT} x2={W - RIGHT} y1={py(v)} y2={py(v)} className="chart-grid" />
          <text x={LEFT - 6} y={py(v) + 3} textAnchor="end">{Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>
        </g>
      ))}
      {ticks(x0, x1, 4).map((v) => (
        <text key={v} x={px(v)} y={H - BOTTOM + 15} textAnchor="middle">{xFormat(v)}</text>
      ))}
      {points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3" className="chart-point" />)}
      <text x={(LEFT + W - RIGHT) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
      <text x={11} y={(TOP + H - BOTTOM) / 2} textAnchor="middle" transform={`rotate(-90 11 ${(TOP + H - BOTTOM) / 2})`}>{yLabel}</text>
    </svg>
  );
}
