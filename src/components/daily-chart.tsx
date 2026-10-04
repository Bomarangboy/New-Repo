"use client";

import { useState } from "react";

/**
 * Single-series column chart (inquiries per local day). One series → no legend; the card title
 * names it. Columns ≤ 24px with 4px rounded tops on a shared baseline, hairline gridlines,
 * per-column hover/focus tooltip, and a table view so no value depends on hovering.
 */
export function DailyChart({ data, label }: { data: { date: string; count: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, padL = 32, padR = 8, padT = 12, padB = 26;
  const max = Math.max(...data.map((d) => d.count), 0);
  const step = niceStep(max);
  const top = Math.max(step * Math.ceil(max / step), step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const band = (W - padL - padR) / Math.max(data.length, 1);
  const barW = Math.max(2, Math.min(24, band - 2)); // ≥2px surface gap between adjacent columns
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const labelEvery = Math.ceil(data.length / 8);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const h = hover != null ? data[hover] : null;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}, by day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e3e9f1" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">{t.toLocaleString("en-US")}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * band + (band - barW) / 2;
          const yTop = y(d.count);
          const hgt = H - padB - yTop;
          const r = Math.min(4, barW / 2, hgt);
          return (
            <g key={d.date}>
              {d.count > 0 && (
                <path
                  d={`M${x},${H - padB} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${H - padB} Z`}
                  fill="#0575fe" opacity={hover == null || hover === i ? 1 : 0.45}
                />
              )}
              {/* Hit target is the whole day band, larger than the mark. */}
              <rect
                x={padL + i * band} y={padT} width={band} height={H - padT - padB} fill="transparent" tabIndex={0}
                aria-label={`${fmt(d.date)}: ${d.count} ${d.count === 1 ? "inquiry" : "inquiries"}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                className="outline-none"
              />
              {i % labelEvery === 0 && <text x={padL + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">{fmt(d.date)}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#c9d3df" strokeWidth={1} />
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-1.5 text-xs shadow-lg"
          style={{ left: `${((padL + hover * band + band / 2) / W) * 100}%`, top: 0 }}
          role="status"
        >
          <span className="font-semibold text-ink">{h.count.toLocaleString("en-US")}</span>{" "}
          <span className="text-muted">{h.count === 1 ? "inquiry" : "inquiries"} · {fmt(h.date)}</span>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">View as table</summary>
        <div className="mt-2 max-h-60 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">{label}</th></tr></thead>
            <tbody className="tabular-nums">{data.map((d) => <tr key={d.date} className="border-t border-line"><td className="py-1">{fmt(d.date)}</td><td className="py-1 text-right">{d.count}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function niceStep(max: number): number {
  if (max <= 4) return 1;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
