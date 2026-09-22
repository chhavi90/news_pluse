"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getJob, triggerIngest } from "./api";
import type { JobStatus } from "./types";

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export type IngestPhase = "idle" | "starting" | "running" | "done" | "error";

export interface IngestState {
  phase: IngestPhase;
  stage: string | null;
  message: string | null;
}

const POLL_MS = 1200;
const GIVE_UP_MS = 10 * 60 * 1000;

/** Triggers POST /ingest/trigger, polls GET /ingest/status/:jobId, then calls onDone(). */
export function useIngestJob(onDone: () => void) {
  const [state, setState] = useState<IngestState>({ phase: "idle", stage: null, message: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const finish = useCallback((next: IngestState) => {
    if (!cancelled.current) setState(next);
  }, []);

  const poll = useCallback(
    (jobId: string, startedAt: number, failures: number) => {
      timer.current = setTimeout(async () => {
        if (cancelled.current) return;
        try {
          const job: JobStatus = await getJob(jobId);
          if (job.status === "succeeded") {
            const added = job.stats?.new_articles ?? 0;
            const topics = job.stats?.multi_article_clusters ?? job.stats?.clusters ?? 0;
            finish({
              phase: "done",
              stage: null,
              message: added
                ? `Added ${added} new ${added === 1 ? "article" : "articles"} · ${topics} multi-article ${topics === 1 ? "topic" : "topics"}`
                : "Already up to date - no new articles since the last run",
            });
            onDoneRef.current();
            return;
          }
          if (job.status === "failed") {
            finish({ phase: "error", stage: null, message: job.error || "The refresh failed." });
            return;
          }
          if (Date.now() - startedAt > GIVE_UP_MS) {
            finish({ phase: "error", stage: null, message: "The refresh is taking too long. Try again in a few minutes." });
            return;
          }
          if (!cancelled.current) setState({ phase: "running", stage: job.stage, message: null });
          poll(jobId, startedAt, 0);
        } catch (err) {
          if (failures >= 3) {
            finish({ phase: "error", stage: null, message: err instanceof Error ? err.message : "Lost contact with the API." });
          } else {
            poll(jobId, startedAt, failures + 1);
          }
        }
      }, POLL_MS);
    },
    [finish],
  );

  const run = useCallback(async () => {
    if (state.phase === "starting" || state.phase === "running") return;
    setState({ phase: "starting", stage: null, message: null });
    try {
      const job = await triggerIngest();
      setState({ phase: "running", stage: job.stage, message: job.alreadyRunning ? "A refresh was already in progress - following it." : null });
      poll(job.jobId, Date.now(), 0);
    } catch (err) {
      const wait = err instanceof ApiError && err.status === 429 ? err.message : null;
      finish({ phase: "error", stage: null, message: wait ?? (err instanceof Error ? err.message : "Could not start the refresh.") });
    }
  }, [finish, poll, state.phase]);

  return { state, run };
}
