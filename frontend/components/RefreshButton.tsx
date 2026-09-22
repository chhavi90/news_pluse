"use client";

import type { IngestState } from "@/lib/hooks";
import { RefreshIcon } from "./Icons";

interface Props {
  state: IngestState;
  onRun: () => void;
}

const STAGE_TEXT: Record<string, string> = {
  queued: "Starting",
  "fetching feeds": "Fetching feeds",
  "grouping topics": "Grouping topics",
};

function stageText(stage: string | null): string {
  if (!stage) return "Working";
  if (STAGE_TEXT[stage]) return STAGE_TEXT[stage];
  if (stage.startsWith("reading")) return "Reading articles";
  return "Working";
}

export default function RefreshButton({ state, onRun }: Props) {
  const busy = state.phase === "starting" || state.phase === "running";
  const note = state.message ?? (busy && state.stage?.startsWith("reading") ? state.stage.replace(/^reading/, "Reading") : null);
  return (
    <div className="refresh">
      <button type="button" className="btn btn-primary" onClick={onRun} disabled={busy} aria-busy={busy}>
        <RefreshIcon className={busy ? "spin" : ""} />
        {busy ? `${stageText(state.stage)}…` : "Refresh data"}
      </button>
      <p className={`refresh-note ${state.phase === "error" ? "is-error" : ""}`} role="status" aria-live="polite">
        {note}
      </p>
    </div>
  );
}
