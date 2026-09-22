"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSources, getTimeline } from "@/lib/api";
import { buildSourceColors } from "@/lib/colors";
import { plural, relativeTime } from "@/lib/format";
import { useIngestJob } from "@/lib/hooks";
import type { SourceInfo, TimelineResponse } from "@/lib/types";
import ClusterDetail from "./ClusterDetail";
import { MinusIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon } from "./Icons";
import RefreshButton from "./RefreshButton";
import SourceFilter from "./SourceFilter";
import Timeline, { type Highlight } from "./Timeline";

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];
const ZOOMS = [1, 1.5, 2, 3, 4, 6];
const LIVE_INTERVAL_MS = 60_000;
const HOUR = 3_600_000;

export default function Dashboard() {
  const [hours, setHours] = useState(72);
  const [includeSingles, setIncludeSingles] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [zoomIdx, setZoomIdx] = useState(0);
  const [live, setLive] = useState(true);
  const [highlights, setHighlights] = useState<Map<number, Highlight>>(new Map());
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tick, setTick] = useState(() => Date.now());

  const baseline = useRef<Map<number, number> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sourceColor = useMemo(() => buildSourceColors(sources.map((s) => s.name)), [sources]);

  // undefined = every outlet; [] = none selected
  const sourceParam = useMemo<string[] | undefined>(
    () => (disabled.size === 0 ? undefined : sources.map((s) => s.name).filter((n) => !disabled.has(n))),
    [disabled, sources],
  );
  const nothingSelected = sourceParam !== undefined && sourceParam.length === 0;
  const sourcesKey = sourceParam ? sourceParam.join("|") : "*";

  // ---- theme -------------------------------------------------------------
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("np-theme", next);
    } catch {
      /* private mode */
    }
  };

  // ---- data loading --------------------------------------------------------
  const loadSources = useCallback(async () => {
    try {
      setSources(await getSources());
    } catch {
      /* the timeline request will surface connection problems */
    }
  }, []);

  const applyResponse = useCallback((res: TimelineResponse) => {
    const next = new Map(res.clusters.map((c) => [c.id, c.articleCount]));
    const prev = baseline.current;
    if (prev) {
      const fresh = new Map<number, Highlight>();
      for (const c of res.clusters) {
        if (!prev.has(c.id)) fresh.set(c.id, "new");
        else if (c.articleCount > (prev.get(c.id) ?? 0)) fresh.set(c.id, "grew");
      }
      if (fresh.size) {
        setHighlights(fresh);
        if (hlTimer.current) clearTimeout(hlTimer.current);
        hlTimer.current = setTimeout(() => setHighlights(new Map()), 9000);
      }
    }
    baseline.current = next;
    setData(res);
  }, []);

  const load = useCallback(
    async (silent: boolean) => {
      if (nothingSelected) {
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      if (!silent) setLoading(true);
      try {
        const res = await getTimeline({ hours, minArticles: includeSingles ? 1 : 2, sources: sourceParam }, ctl.signal);
        if (ctl.signal.aborted) return;
        applyResponse(res);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!silent) setError(err instanceof Error ? err.message : "Could not load the timeline.");
        setLoading(false);
      }
    },
    // sourcesKey stands in for sourceParam (stable identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hours, includeSingles, sourcesKey, nothingSelected, applyResponse],
  );

  // Initial + filter-change loads (baseline resets so filter changes never flash "new" markers).
  useEffect(() => {
    baseline.current = null;
    void load(false);
  }, [load]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // Stretch goal: live updates - poll /timeline while the tab is visible.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true);
        void loadSources();
      }
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, load, loadSources]);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  const ingest = useIngestJob(
    useCallback(() => {
      void load(true);
      void loadSources();
    }, [load, loadSources]),
  );

  // ---- derived view state ----------------------------------------------------
  const clusters = useMemo(() => (nothingSelected ? [] : (data?.clusters ?? [])), [data, nothingSelected]);
  const selected = clusters.find((c) => c.id === selectedId) ?? null;

  const dimmedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const dim = new Set<number>();
    for (const c of clusters) {
      const hay = `${c.label} ${c.keywords.join(" ")} ${c.representativeTitle}`.toLowerCase();
      if (!hay.includes(q)) dim.add(c.id);
    }
    return dim;
  }, [query, clusters]);
  const matches = dimmedIds ? clusters.length - dimmedIds.size : null;

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = data ? new Date(data.meta.to).getTime() : Date.now();
    const from = data ? new Date(data.meta.from).getTime() : now - hours * HOUR;
    const earliest = clusters.length ? Math.min(...clusters.map((c) => new Date(c.start).getTime())) : from;
    const start = Math.floor(Math.max(from, earliest - 20 * 60_000) / HOUR) * HOUR;
    const span = Math.max(now - start, HOUR);
    return { rangeStart: start, rangeEnd: now + span * 0.03 };
  }, [data, clusters, hours]);

  const toggleSource = (name: string) =>
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const enabledCount = sources.length - disabled.size;
  const updatedText = data?.meta.dataUpdatedAt ? relativeTime(data.meta.dataUpdatedAt, tick) : null;

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <svg className="brand-mark" width="34" height="26" viewBox="0 0 34 26" aria-hidden>
            <rect x="0" y="2" width="20" height="6" rx="3" fill="var(--bar)" />
            <rect x="9" y="10" width="25" height="6" rx="3" fill="var(--mark-2)" />
            <rect x="4" y="18" width="14" height="6" rx="3" fill="var(--live)" />
          </svg>
          <div>
            <h1>News Pulse</h1>
            <p>Stories from live news feeds, grouped by topic and drawn across time</p>
          </div>
        </div>
        <RefreshButton state={ingest.state} onRun={ingest.run} />
      </header>

      <section className="controls" aria-label="Timeline controls">
        <div className="controls-row">
          <div className="seg" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button key={w.hours} type="button" className={hours === w.hours ? "is-on" : ""} aria-pressed={hours === w.hours} onClick={() => setHours(w.hours)}>
                {w.label}
              </button>
            ))}
          </div>

          <label className="check">
            <input type="checkbox" checked={includeSingles} onChange={(e) => setIncludeSingles(e.target.checked)} />
            Include single-article topics
          </label>

          <label className="search">
            <SearchIcon />
            <input type="search" placeholder="Find a topic" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a topic" />
            {matches !== null && <span className="search-count">{plural(matches, "match", "matches")}</span>}
          </label>

          <div className="controls-end">
            <div className="zoom" role="group" aria-label="Zoom timeline">
              <button type="button" className="icon-btn" onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} aria-label="Zoom out">
                <MinusIcon />
              </button>
              <span>{ZOOMS[zoomIdx]}×</span>
              <button type="button" className="icon-btn" onClick={() => setZoomIdx((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label="Zoom in">
                <PlusIcon />
              </button>
            </div>
            <button type="button" className={`switch ${live ? "is-on" : ""}`} role="switch" aria-checked={live} onClick={() => setLive((v) => !v)}>
              <i /> Live updates
            </button>
            <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
        <SourceFilter
          sources={sources}
          disabled={disabled}
          color={sourceColor}
          onToggle={toggleSource}
          onAll={() => setDisabled(new Set())}
          onNone={() => setDisabled(new Set(sources.map((s) => s.name)))}
        />
      </section>

      <p className="stats" aria-live="polite">
        {data && !nothingSelected ? (
          <>
            <b>{plural(data.meta.returned, "topic")}</b>
            {data.meta.totalClusters > data.meta.returned ? ` (largest ${data.meta.returned} of ${data.meta.totalClusters})` : ""} ·{" "}
            <b>{plural(data.meta.articlesInWindow, "article")}</b> in the last {WINDOWS.find((w) => w.hours === hours)?.label} · {plural(enabledCount, "outlet")}
            {updatedText ? <> · newest article stored {updatedText}</> : null}
          </>
        ) : (
          "\u00a0"
        )}
      </p>

      <main className={`stage ${selected ? "with-detail" : ""}`}>
        <section className="card timeline-card" aria-label="Topic timeline">
          {loading && !data && (
            <div className="state">
              <p className="state-title">Loading the timeline…</p>
              {slow && <p>The server is waking up. Free hosting sleeps when idle, so the first load can take up to a minute.</p>}
            </div>
          )}
          {error && !data && (
            <div className="state state-error">
              <p className="state-title">The timeline could not be loaded</p>
              <p>{error}</p>
              <button type="button" className="btn" onClick={() => void load(false)}>
                Try again
              </button>
            </div>
          )}
          {nothingSelected && (
            <div className="state">
              <p className="state-title">No outlets selected</p>
              <p>Turn on at least one outlet above to see its topics.</p>
              <button type="button" className="btn" onClick={() => setDisabled(new Set())}>
                Show all outlets
              </button>
            </div>
          )}
          {data && !nothingSelected && clusters.length === 0 && (
            <div className="state">
              <p className="state-title">No topics in this window</p>
              <p>
                {data.meta.articlesInWindow === 0
                  ? "There are no articles yet. Choose Refresh data to fetch the latest news."
                  : "Articles exist, but none form a multi-article topic. Try a longer window or include single-article topics."}
              </p>
              {data.meta.articlesInWindow > 0 && !includeSingles && (
                <button type="button" className="btn" onClick={() => setIncludeSingles(true)}>
                  Include single-article topics
                </button>
              )}
            </div>
          )}
          {data && !nothingSelected && clusters.length > 0 && (
            <Timeline
              clusters={clusters}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              zoom={ZOOMS[zoomIdx]}
              selectedId={selectedId}
              highlights={highlights}
              dimmedIds={dimmedIds}
              sourceColor={sourceColor}
              onSelect={setSelectedId}
            />
          )}
          <footer className="legend">
            <span><i className="lg-bar" /> Bar length is how long the topic stayed in the news</span>
            <span><i className="lg-size" /> Taller, darker bars have more articles</span>
            <span><i className="lg-strip" /> The bottom stripe shows which outlets covered it</span>
            <span className="lg-time">Times are in your local time zone</span>
          </footer>
        </section>

        {selected && (
          <ClusterDetail
            clusterId={selected.id}
            version={`${selected.articleCount}`}
            sources={sourceParam}
            color={sourceColor}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  );
}
