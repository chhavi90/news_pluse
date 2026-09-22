"use client";

import { plural } from "@/lib/format";
import type { SourceInfo } from "@/lib/types";

interface Props {
  sources: SourceInfo[];
  disabled: Set<string>;
  color: (name: string) => string;
  onToggle: (name: string) => void;
  onAll: () => void;
  onNone: () => void;
}

export default function SourceFilter({ sources, disabled, color, onToggle, onAll, onNone }: Props) {
  if (!sources.length) return <div className="chips chips-empty">No outlets yet</div>;
  return (
    <div className="chips" role="group" aria-label="Filter by news outlet">
      {sources.map((s) => {
        const on = !disabled.has(s.name);
        return (
          <button
            key={s.name}
            type="button"
            className={`chip ${on ? "is-on" : ""}`}
            aria-pressed={on}
            title={`${plural(s.articleCount, "article")} stored`}
            onClick={() => onToggle(s.name)}
          >
            <i className="chip-dot" style={{ background: color(s.name) }} />
            {s.name}
            <span className="chip-count">{s.articleCount}</span>
          </button>
        );
      })}
      <span className="chips-actions">
        <button type="button" className="link-btn" onClick={onAll} disabled={disabled.size === 0}>
          All
        </button>
        <button type="button" className="link-btn" onClick={onNone} disabled={disabled.size === sources.length}>
          None
        </button>
      </span>
    </div>
  );
}
