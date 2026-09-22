"use client";

import { scaleTime } from "d3-scale";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDuration, formatRange } from "@/lib/format";
import { useElementWidth } from "@/lib/hooks";
import type { TimelineCluster } from "@/lib/types";
import { LinkIcon } from "./Icons";

export type Highlight = "new" | "grew";

interface Props {
  clusters: TimelineCluster[];
  rangeStart: number;
  rangeEnd: number;
  zoom: number;
  selectedId: number | null;
  highlights: Map<number, Highlight>;
  dimmedIds: Set<number> | null;
  sourceColor: (name: string) => string;
  onSelect: (id: number | null) => void;
}

const PAD_LEFT = 28;
const PAD_RIGHT = 40;
const AXIS_H = 52;
const LANE_H = 64;
const PLOT_PAD = 14;
const MIN_BAR_W = 12;
const INSIDE_LABEL_MIN_W = 130;

type LabelSide = "in" | "right" | "left";

interface Placed {
  cluster: TimelineCluster;
  left: number;
  width: number;
  height: number;
  lane: number;
  side: LabelSide;
}

/**
 * Greedy interval packing: every bar (plus the label that sits beside it when the bar is too
 * narrow to hold one) takes the first lane where it does not collide with anything already there.
 * Labels flip to the left of a bar when there is no room on its right.
 */
function layout(clusters: TimelineCluster[], x: (d: Date) => number, innerWidth: number): { items: Placed[]; lanes: number } {
  const raw = clusters
    .map((c) => {
      const left = x(new Date(c.start));
      const right = x(new Date(c.end));
      const width = Math.max(MIN_BAR_W, right - left);
      const labelW = Math.min(260, c.label.length * 7.4 + 54);
      let side: LabelSide = "in";
      if (width < INSIDE_LABEL_MIN_W) side = left + width + 8 + labelW <= innerWidth - 4 ? "right" : "left";
      const lo = side === "left" ? left - 8 - labelW : left;
      const hi = side === "right" ? left + width + 8 + labelW : left + width;
      return { cluster: c, left, width, height: Math.round(26 + 22 * c.intensity), side, lo, hi };
    })
    .sort((a, b) => a.lo - b.lo || b.hi - a.hi);
  const laneEnds: number[] = [];
  const items: Placed[] = raw.map((r) => {
    let lane = laneEnds.findIndex((end) => end + 10 <= r.lo);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = r.hi;
    return { cluster: r.cluster, left: r.left, width: r.width, height: r.height, lane, side: r.side };
  });
  return { items, lanes: Math.max(1, laneEnds.length) };
}

export default function Timeline({
  clusters,
  rangeStart,
  rangeEnd,
  zoom,
  selectedId,
  highlights,
  dimmedIds,
  sourceColor,
  onSelect,
}: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ cluster: TimelineCluster; x: number; y: number } | null>(null);

  const innerWidth = Math.max(width, Math.round(width * zoom));
  const x = useMemo(
    () => scaleTime().domain([new Date(rangeStart), new Date(rangeEnd)]).range([PAD_LEFT, Math.max(PAD_LEFT + 50, innerWidth - PAD_RIGHT)]),
    [rangeStart, rangeEnd, innerWidth],
  );
  const { items, lanes } = useMemo(() => layout(clusters, (d) => x(d), innerWidth), [clusters, x, innerWidth]);
  const plotHeight = lanes * LANE_H + PLOT_PAD * 2;

  // Axis ticks + day boundaries (browser local time).
  const ticks = useMemo(
    () =>
      x
        .ticks(Math.max(2, Math.floor(innerWidth / 96)))
        .filter((t) => x(t) >= PAD_LEFT + 16 && !(t.getHours() === 0 && t.getMinutes() === 0)),
    [x, innerWidth],
  );
  const tickFormat = useMemo(() => x.tickFormat(), [x]);
  const days = useMemo(() => {
    const out: Date[] = [];
    const d = new Date(rangeStart);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= rangeEnd) {
      if (d.getTime() >= rangeStart) out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [rangeStart, rangeEnd]);

  // Open at the newest end of the timeline whenever the window or zoom changes.
  const scrollKey = `${rangeStart}|${zoom}|${width}`;
  const lastKey = useRef("");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && width > 0 && lastKey.current !== scrollKey) {
      el.scrollLeft = el.scrollWidth;
      lastKey.current = scrollKey;
    }
  }, [scrollKey, width, innerWidth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);

  const nowX = x(new Date());
  const showNow = nowX >= PAD_LEFT && nowX <= innerWidth - PAD_RIGHT + 1;

  return (
    <div className="tl" ref={wrapRef}>
      <div className="tl-scroll" ref={scrollRef} onScroll={() => setTip(null)}>
        <div className="tl-inner" style={{ width: innerWidth }}>
          <div className="tl-axis" style={{ height: AXIS_H }}>
            {days.map((d) => (
              <span key={`d${d.getTime()}`} className="tl-day" style={{ left: x(d) }}>
                {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </span>
            ))}
            {ticks.map((t) => (
              <span key={`t${t.getTime()}`} className="tl-tick" style={{ left: x(t) }}>
                {tickFormat(t)}
              </span>
            ))}
          </div>

          <div className="tl-plot" style={{ height: plotHeight }}>
            {days.map((d) => (
              <span key={`gd${d.getTime()}`} className="tl-grid tl-grid-day" style={{ left: x(d) }} />
            ))}
            {ticks.map((t) => (
              <span key={`gt${t.getTime()}`} className="tl-grid" style={{ left: x(t) }} />
            ))}
            {showNow && (
              <span className="tl-now" style={{ left: nowX }}>
                <em>now</em>
              </span>
            )}

            {items.map(({ cluster: c, left, width: w, height, lane, side }) => {
              const total = c.sources.reduce((s, v) => s + v.count, 0) || 1;
              const hl = highlights.get(c.id);
              const cls = [
                "bar",
                selectedId === c.id ? "is-selected" : "",
                dimmedIds?.has(c.id) ? "is-dim" : "",
                hl ? `is-${hl}` : "",
                side === "left" ? "label-left" : "",
              ].join(" ");
              return (
                <button
                  key={c.id}
                  type="button"
                  className={cls}
                  style={{
                    left,
                    width: w,
                    height,
                    top: PLOT_PAD + lane * LANE_H + (LANE_H - height) / 2,
                    ["--fill" as string]: `${Math.round(14 + 38 * c.intensity)}%`,
                  }}
                  aria-pressed={selectedId === c.id}
                  aria-label={`${c.label}: ${c.articleCount} articles from ${c.sourceCount} outlets, ${formatRange(c.start, c.end)}`}
                  onClick={() => onSelect(selectedId === c.id ? null : c.id)}
                  onMouseMove={(e) => setTip({ cluster: c, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTip(null)}
                  onFocus={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({ cluster: c, x: r.left + r.width / 2, y: r.bottom });
                  }}
                  onBlur={() => setTip(null)}
                >
                  <span className="bar-body">
                    {w >= 30 && <span className="bar-count">{c.articleCount}</span>}
                    {side === "in" && <span className="bar-label">{c.label}</span>}
                  </span>
                  <span className="bar-strip" aria-hidden>
                    {c.sources.map((s) => (
                      <i key={s.name} style={{ flexGrow: s.count / total, background: sourceColor(s.name) }} />
                    ))}
                  </span>
                  {c.crossSourceStories > 0 && (
                    <span className="bar-story" title="The same story was covered by several outlets">
                      <LinkIcon width={12} height={12} />
                    </span>
                  )}
                  {side !== "in" && (
                    <span className="bar-outside">
                      {w < 30 ? `${c.articleCount} · ` : ""}
                      {c.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="tip"
          role="tooltip"
          style={{ left: Math.min(tip.x + 14, (typeof window === "undefined" ? 9999 : window.innerWidth) - 300), top: tip.y + 18 }}
        >
          <strong>{tip.cluster.label}</strong>
          <span className="tip-head">{tip.cluster.representativeTitle}</span>
          <span className="tip-meta">
            {tip.cluster.articleCount} articles · {tip.cluster.sources.map((s) => `${s.name} ${s.count}`).join(", ")}
          </span>
          <span className="tip-meta">
            {formatRange(tip.cluster.start, tip.cluster.end)} · active {formatDuration(tip.cluster.durationMinutes)}
          </span>
        </div>
      )}
    </div>
  );
}
