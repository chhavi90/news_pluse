import type { ClusterDetail, JobStatus, SourceInfo, TimelineResponse } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Cannot reach the API at ${API_BASE}. Check that the backend is running and NEXT_PUBLIC_API_URL is correct.`, 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; retryAfterSeconds?: number } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.retryAfterSeconds);
  }
  return body as T;
}

export interface TimelineQuery {
  hours: number;
  minArticles: number;
  /** undefined = every outlet */
  sources?: string[];
}

export function getTimeline(q: TimelineQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ hours: String(q.hours), minArticles: String(q.minArticles) });
  if (q.sources) params.set("sources", q.sources.join(","));
  return request<TimelineResponse>(`/timeline?${params}`, { signal });
}

export function getCluster(id: number, sources?: string[], signal?: AbortSignal) {
  const params = sources ? `?sources=${encodeURIComponent(sources.join(","))}` : "";
  return request<ClusterDetail>(`/clusters/${id}${params}`, { signal });
}

export async function getSources(signal?: AbortSignal) {
  return (await request<{ sources: SourceInfo[] }>("/sources", { signal })).sources;
}

export function triggerIngest() {
  return request<JobStatus>("/ingest/trigger", { method: "POST" });
}

export function getJob(jobId: string, signal?: AbortSignal) {
  return request<JobStatus>(`/ingest/status/${jobId}`, { signal });
}
