import { useState, type ReactNode } from 'react';
import { fmt } from '../lib/money';

/** Round up to a "nice" number (1, 2, 2.5, 5 × 10^n). */
function nice(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Axis ticks from 0 up past `max`, with round step sizes. */
function ticksFor(max: number): number[] {
  const step = nice(max / 4);
  const out = [0];
  while (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const compact = (cents: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const W = 640;
const H = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };

/** Grouped vertical bars with a per-group hover tooltip. */
export function GroupedBarChart({
  labels,
  series,
  selected,
  onSelect,
}: {
  labels: string[];
  series: Series[];
  /** Highlighted bar group (e.g. the month being shown below the chart). */
  selected?: number | null;
  onSelect?: (i: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ticks = ticksFor(Math.max(0, ...series.flatMap((s) => s.values)));
  const max = ticks[ticks.length - 1];
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const groupW = innerW / Math.max(1, labels.length);
  const barW = Math.min(28, (groupW * 0.7) / series.length);
  const gap = 2;
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH;

  return (
    <div className="chart">
      <Legend series={series} />
      <div className="chart-area">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {labels.map((label, i) => {
            const cx = PAD.left + groupW * i + groupW / 2;
            const totalW = series.length * barW + (series.length - 1) * gap;
            return (
              <g key={i}>
                {(hover === i || selected === i) && <rect className="hover-band" x={PAD.left + groupW * i} y={PAD.top} width={groupW} height={innerH} />}
                {series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const x = cx - totalW / 2 + si * (barW + gap);
                  const top = y(v);
                  const h = PAD.top + innerH - top;
                  const r = Math.min(4, barW / 2, h);
                  // Rounded top corners only; the base stays square on the baseline.
                  const d = h <= 0 ? '' : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
                  return <path key={s.name} d={d} fill={s.color} />;
                })}
                <text className="axis" x={cx} y={H - 8} textAnchor="middle">
                  {label}
                </text>
                <rect
                  className={onSelect ? 'hit tappable' : 'hit'}
                  x={PAD.left + groupW * i}
                  y={PAD.top}
                  width={groupW}
                  height={innerH + PAD.bottom}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    setHover(i);
                    onSelect?.(i);
                  }}
                />
              </g>
            );
          })}
          <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        </svg>
        {hover !== null && (
          <Tooltip x={((PAD.left + groupW * hover + groupW / 2) / W) * 100} title={labels[hover]}>
            {series.map((s) => (
              <div key={s.name} className="tt-row">
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.name}</span>
                <b>{fmt(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Single-series line chart with a crosshair tooltip. Handles negative values. */
export function LineChart({ labels, values, name, color }: { labels: string[]; values: number[]; name: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const upper = ticksFor(Math.max(0, ...values));
  const lower = Math.min(0, ...values) < 0 ? ticksFor(-Math.min(...values)).map((t) => -t) : [0];
  const hi = upper[upper.length - 1];
  const lo = lower[lower.length - 1];
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * innerH;
  const ticks = [...lower.slice(1).reverse(), ...upper];
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  // At most 5 month labels, so they never overlap on a phone.
  const labelEvery = Math.ceil(labels.length / 5);

  return (
    <div className="chart">
      <div className="chart-area">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={name}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((px - PAD.left) / innerW) * (labels.length - 1));
            setHover(Math.max(0, Math.min(labels.length - 1, i)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'baseline' : 'grid'} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <text key={l} className="axis" x={x(i)} y={H - 8} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && (
            <>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
              <circle cx={x(hover)} cy={y(values[hover])} r={5} fill={color} className="marker" />
            </>
          )}
        </svg>
        {hover !== null && (
          <Tooltip x={(x(hover) / W) * 100} title={labels[hover]}>
            <div className="tt-row">
              <span>{name}</span>
              <b>{fmt(values[hover])}</b>
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.name}>
          <span className="swatch" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, title, children }: { x: number; title: string; children: ReactNode }) {
  const style = x > 60 ? { right: `${100 - x + 2}%` } : { left: `${x + 2}%` };
  return (
    <div className="tooltip" style={style}>
      <div className="tt-title">{title}</div>
      {children}
    </div>
  );
}
