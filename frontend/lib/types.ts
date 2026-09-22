export interface SourceCount {
  name: string;
  count: number;
}

export interface TimelineCluster {
  id: number;
  label: string;
  keywords: string[];
  representativeTitle: string;
  articleCount: number;
  sourceCount: number;
  sources: SourceCount[];
  crossSourceStories: number;
  start: string;
  end: string;
  durationMinutes: number;
  intensity: number;
}

export interface TimelineResponse {
  meta: {
    generatedAt: string;
    from: string;
    to: string;
    windowHours: number;
    totalClusters: number;
    returned: number;
    maxArticleCount: number;
    articlesInWindow: number;
    dataStart: string | null;
    dataEnd: string | null;
    dataUpdatedAt: string | null;
  };
  clusters: TimelineCluster[];
}

export interface Article {
  id: number;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  publishedEstimated: boolean;
  contentStatus: string;
  storyId: number | null;
}

export interface Story {
  id: number;
  sources: string[];
  articleCount: number;
  alsoInClusters: number[];
}

export interface ClusterDetail {
  id: number;
  label: string;
  keywords: string[];
  representativeTitle: string;
  method: string;
  articleCount: number;
  sourceCount: number;
  sources: SourceCount[];
  start: string | null;
  end: string | null;
  stories: Story[];
  articles: Article[];
}

export interface SourceInfo {
  name: string;
  articleCount: number;
  latestPublishedAt: string | null;
}

export type JobStatusName = "queued" | "running" | "succeeded" | "failed";

export interface JobStatus {
  jobId: string;
  status: JobStatusName;
  stage: string | null;
  error: string | null;
  durationSeconds: number | null;
  stats: {
    new_articles?: number;
    clusters?: number;
    multi_article_clusters?: number;
    total_articles?: number;
    feeds?: Record<string, { status: string; new: number; error?: string }>;
  } | null;
  alreadyRunning?: boolean;
}
