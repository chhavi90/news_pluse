"use client";

import { useEffect, useState } from "react";
import { ApiError, getCluster } from "@/lib/api";
import { formatDuration, formatRange, formatStamp, plural, relativeTime } from "@/lib/format";
import type { ClusterDetail as Detail } from "@/lib/types";
import { CloseIcon, ExternalIcon, LinkIcon } from "./Icons";

interface Props {
  clusterId: number;
  /** re-fetch when this changes (article count after a refresh) */
  version: string;
  sources?: string[];
  color: (name: string) => string;
  onClose: () => void;
}

export default function ClusterDetail({ clusterId, version, sources, color, onClose }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sourcesKey = sources?.join("|") ?? "*";

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    getCluster(clusterId, sources, ctl.signal)
      .then((d) => {
        setDetail(d);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "This topic was regrouped by the last refresh. Pick it again on the timeline."
            : err instanceof Error
              ? err.message
              : "Could not load this topic.",
        );
        setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterId, version, sourcesKey]);

  const storyById = new Map((detail?.stories ?? []).map((s) => [s.id, s]));

  return (
    <aside className="detail" aria-label="Topic details">
      <button type="button" className="icon-btn detail-close" onClick={onClose} aria-label="Close topic details">
        <CloseIcon />
      </button>

      {loading && !detail && <div className="skeleton" aria-busy>Loading articles…</div>}
      {error && <p className="detail-error">{error}</p>}

      {detail && !error && (
        <>
          <header className="detail-head">
            <h2>{detail.label}</h2>
            {detail.representativeTitle && <p className="detail-lead">{detail.representativeTitle}</p>}
            <dl className="detail-facts">
              <div>
                <dt>Active</dt>
                <dd>{detail.start && detail.end ? formatRange(detail.start, detail.end) : "-"}</dd>
              </div>
              <div>
                <dt>Coverage</dt>
                <dd>
                  {plural(detail.articleCount, "article")} from {plural(detail.sourceCount, "outlet")}
                  {detail.start && detail.end && detail.articleCount > 1
                    ? `, over ${formatDuration(Math.round((new Date(detail.end).getTime() - new Date(detail.start).getTime()) / 60000))}`
                    : ""}
                </dd>
              </div>
            </dl>
            {detail.keywords.length > 0 && (
              <ul className="kw" aria-label="Keywords">
                {detail.keywords.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            )}
            {detail.stories.length > 0 && (
              <p className="detail-stories">
                <LinkIcon width={14} height={14} /> {plural(detail.stories.length, "story", "stories")} covered by more than one outlet
              </p>
            )}
            {sources && <p className="detail-filtered">Showing articles from the selected outlets only.</p>}
          </header>

          <ol className="articles">
            {detail.articles.map((a) => {
              const story = a.storyId !== null ? storyById.get(a.storyId) : undefined;
              const others = story?.sources.filter((s) => s !== a.source) ?? [];
              return (
                <li key={a.id} className={`article ${others.length ? "has-story" : ""}`}>
                  <span className="article-dot" style={{ background: color(a.source) }} />
                  <div className="article-meta">
                    <span className="pill" style={{ ["--pill" as string]: color(a.source) }}>
                      {a.source}
                    </span>
                    <time dateTime={a.publishedAt} title={new Date(a.publishedAt).toString()}>
                      {formatStamp(a.publishedAt)} · {relativeTime(a.publishedAt)}
                    </time>
                    {a.publishedEstimated && <span className="flag" title="The feed gave no usable date, so the time we first saw it is shown">approx. time</span>}
                  </div>
                  <a className="article-title" href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.title}
                    <ExternalIcon width={13} height={13} />
                  </a>
                  {a.summary && <p className="article-summary">{a.summary}</p>}
                  {others.length > 0 && (
                    <p className="article-story">
                      <LinkIcon width={12} height={12} /> Same story also from {others.join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </aside>
  );
}
