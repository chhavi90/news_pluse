"""Topic grouping.

Two interchangeable strategies (selected with ``CLUSTER_METHOD``):

``tfidf``    (default)  TF-IDF vectors -> cosine similarity -> average-linkage
             hierarchical clustering cut at a similarity threshold.  Pairs of
             articles published too far apart are treated as unrelated, because a
             news "topic" is bounded in time.

``keyword``  The beginner-friendly option from the brief: lower-case, drop stop
             words, and join articles that share enough meaningful words.

On top of either strategy, ``link_stories`` performs the stretch goal
"cross-source story merging": it links articles from *different outlets* that
describe the same real-world event and gives them a shared ``story_id`` (even if
the grouping step left them in separate clusters).
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

from .config import Settings

TOKEN_PATTERN = r"(?u)\b[^\W\d_]{3,}\b"   # words of 3+ letters; digits are ignored on purpose
WORD_RE = re.compile(r"[^\W\d_]{3,}")

# Words that are frequent in *news* copy but say nothing about the topic.
NEWS_STOPWORDS = frozenset("""
said says say saying told tell tells according report reports reported reporting reportedly
new news latest live update updates video watch listen read reading continue appeared first
year years day days week weeks month months today yesterday tomorrow tonight morning
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
also could would should will one two three four five just like get gets got make makes made
back amid says still now us
""".split())


# --------------------------------------------------------------------------
# data structures
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class ArticleRecord:
    id: int
    source: str
    title: str
    summary: str
    content: str
    published_at: datetime


@dataclass
class ClusterResult:
    id: int                       # smallest article id in the cluster
    article_ids: list[int]
    label: str
    keywords: list[str]
    representative_id: int
    method: str


@dataclass
class ClusteringOutput:
    clusters: list[ClusterResult] = field(default_factory=list)
    story_ids: dict[int, Optional[int]] = field(default_factory=dict)


class _UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


# --------------------------------------------------------------------------
# vectors + similarity (shared by both strategies and by story linking)
# --------------------------------------------------------------------------
def _document(r: ArticleRecord, body_chars: int) -> str:
    # The headline is the strongest topic signal, so it is repeated (= double weight).
    return f"{r.title}. {r.title}. {r.summary} {r.content[:body_chars]}"


def build_similarity(records: list[ArticleRecord], settings: Settings):
    """Return ``(X, terms, S, gap_hours)``.

    X: L2-normalised TF-IDF matrix (or None if the corpus has no usable words)
    S: dense cosine-similarity matrix, gap_hours: pairwise publication gap in hours
    """
    n = len(records)
    t = np.array([r.published_at.timestamp() for r in records], dtype=np.float64)
    gap_hours = (np.abs(t[:, None] - t[None, :]) / 3600.0).astype(np.float32)

    source_words = {w for r in records for w in re.findall(r"[a-z]{3,}", r.source.lower())}
    stop = list(ENGLISH_STOP_WORDS | NEWS_STOPWORDS | source_words)
    docs = [_document(r, settings.body_chars_for_vectors) for r in records]
    try:
        vec = TfidfVectorizer(stop_words=stop, token_pattern=TOKEN_PATTERN, ngram_range=(1, 2),
                              sublinear_tf=True, dtype=np.float32)
        X = vec.fit_transform(docs)
        terms = vec.get_feature_names_out()
        S = (X @ X.T).toarray().astype(np.float32)
        np.clip(S, 0.0, 1.0, out=S)
    except ValueError:                       # "empty vocabulary" - every article is its own topic
        X, terms = None, np.array([])
        S = np.eye(n, dtype=np.float32)
    np.fill_diagonal(S, 1.0)
    return X, terms, S, gap_hours


# --------------------------------------------------------------------------
# strategy A: keyword overlap
# --------------------------------------------------------------------------
def _fold(word: str) -> str:
    """Cheap plural folding: 'sanctions' -> 'sanction' (good enough for grouping)."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def _keyword_set(r: ArticleRecord, stop: frozenset[str]) -> set[str]:
    words = WORD_RE.findall(f"{r.title} {r.summary}".lower())
    return {_fold(w) for w in words if w not in stop and _fold(w) not in stop}


def _keyword_groups(records: list[ArticleRecord], settings: Settings):
    """Return ``(groups, keyword_sets)`` where groups is a list of index lists."""
    source_words = {w for r in records for w in re.findall(r"[a-z]{3,}", r.source.lower())}
    stop = frozenset(ENGLISH_STOP_WORDS | NEWS_STOPWORDS | source_words)
    sets = [_keyword_set(r, stop) for r in records]
    n = len(records)
    df = Counter(tok for s in sets for tok in s)
    generic_cutoff = max(10, int(0.15 * n))              # words in >15% of articles carry no signal
    index: dict[str, list[int]] = defaultdict(list)
    for i, s in enumerate(sets):
        for tok in s:
            if df[tok] <= generic_cutoff:
                index[tok].append(i)

    ts = [r.published_at.timestamp() for r in records]
    max_gap = settings.max_gap_hours * 3600
    uf = _UnionFind(n)
    for i, s in enumerate(sets):
        shared: Counter[int] = Counter()
        for tok in s:
            if df[tok] > generic_cutoff:
                continue
            for j in index[tok]:
                if j > i:
                    shared[j] += 1
        for j, count in shared.items():
            if count < settings.keyword_min_shared:
                continue
            if count / len(s | sets[j]) < settings.keyword_min_jaccard:
                continue
            if abs(ts[i] - ts[j]) > max_gap:
                continue
            uf.union(i, j)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[uf.find(i)].append(i)
    return list(groups.values()), sets


def _keyword_label(idx: list[int], sets: list[set[str]], records: list[ArticleRecord]) -> list[str]:
    """Most common shared words across the cluster's headlines/summaries."""
    df = Counter(tok for i in idx for tok in sets[i])
    title_hits = Counter()
    for i in idx:
        title_words = {_fold(w) for w in WORD_RE.findall(records[i].title.lower())}
        for tok in sets[i] & title_words:
            title_hits[tok] += 1
    min_df = 2 if len(idx) > 1 else 1
    ranked = sorted((t for t in df if df[t] >= min_df), key=lambda t: (-df[t], -title_hits[t], t))
    return ranked[:6]


# --------------------------------------------------------------------------
# strategy B: TF-IDF + average-linkage clustering
# --------------------------------------------------------------------------
def _tfidf_groups(S: np.ndarray, gap_hours: np.ndarray, settings: Settings) -> list[list[int]]:
    n = S.shape[0]
    if n == 1:
        return [[0]]
    sim = np.where(gap_hours <= settings.max_gap_hours, S, 0.0)   # far-apart articles are unrelated
    dist = np.clip(1.0 - sim, 0.0, 1.0).astype(np.float64)
    np.fill_diagonal(dist, 0.0)
    tree = linkage(squareform(dist, checks=False), method="average")
    labels = fcluster(tree, t=1.0 - settings.similarity_threshold, criterion="distance")
    groups: dict[int, list[int]] = defaultdict(list)
    for i, lab in enumerate(labels):
        groups[int(lab)].append(i)
    return list(groups.values())


def _tfidf_label(X, terms, idx: list[int], top: int = 6) -> list[str]:
    """Top TF-IDF terms of the cluster centroid, skipping terms that overlap one already chosen."""
    if X is None or len(terms) == 0:
        return []
    centroid = np.asarray(X[idx].mean(axis=0)).ravel()
    chosen: list[str] = []
    for j in np.argsort(-centroid)[:60]:
        if centroid[j] <= 0:
            break
        term = str(terms[j])
        words = set(term.split())
        if any(words & set(c.split()) for c in chosen):
            continue
        chosen.append(term)
        if len(chosen) == top:
            break
    return chosen


def _representative(X, idx: list[int], records: list[ArticleRecord]) -> int:
    """Article closest to the cluster centroid = the most 'typical' headline."""
    if len(idx) == 1 or X is None:
        return records[min(idx, key=lambda i: (records[i].published_at, records[i].id))].id
    centroid = np.asarray(X[idx].mean(axis=0)).ravel()
    scores = np.asarray(X[idx] @ centroid).ravel()
    return records[idx[int(np.argmax(scores))]].id


def _pretty(keywords: list[str], fallback_title: str) -> str:
    if not keywords:
        words = fallback_title.split()
        return " ".join(words[:6]) + ("…" if len(words) > 6 else "")
    return " · ".join(k.title() for k in keywords[:3])


# --------------------------------------------------------------------------
# stretch goal: cross-source story linking
# --------------------------------------------------------------------------
def link_stories(records: list[ArticleRecord], S: np.ndarray, gap_hours: np.ndarray,
                 settings: Settings) -> dict[int, Optional[int]]:
    """Give articles from different outlets about the same event one shared story_id."""
    n = len(records)
    src_codes = {s: k for k, s in enumerate(sorted({r.source for r in records}))}
    src = np.array([src_codes[r.source] for r in records])
    mask = (
        (S >= settings.story_similarity_threshold)
        & (src[:, None] != src[None, :])
        & (gap_hours <= settings.story_max_gap_hours)
    )
    uf = _UnionFind(n)
    for i, j in np.argwhere(np.triu(mask, k=1)):
        uf.union(int(i), int(j))
    members: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        members[uf.find(i)].append(i)
    out: dict[int, Optional[int]] = {r.id: None for r in records}
    for idx in members.values():
        if len({records[i].source for i in idx}) < 2:
            continue                                 # a "story" needs at least two outlets
        story_id = min(records[i].id for i in idx)
        for i in idx:
            out[records[i].id] = story_id
    return out


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------
def cluster_articles(records: list[ArticleRecord], settings: Settings) -> ClusteringOutput:
    if not records:
        return ClusteringOutput()
    X, terms, S, gap_hours = build_similarity(records, settings)

    kw_sets = None
    if settings.cluster_method == "keyword":
        groups, kw_sets = _keyword_groups(records, settings)
    else:
        groups = _tfidf_groups(S, gap_hours, settings)

    clusters: list[ClusterResult] = []
    for idx in groups:
        idx = sorted(idx, key=lambda i: (records[i].published_at, records[i].id))
        rep_id = _representative(X, idx, records)
        rep_title = next(r.title for r in records if r.id == rep_id)
        if kw_sets is not None:
            keywords = _keyword_label(idx, kw_sets, records)
        else:
            keywords = _tfidf_label(X, terms, idx)
        clusters.append(ClusterResult(
            id=min(records[i].id for i in idx),
            article_ids=[records[i].id for i in idx],
            label=_pretty(keywords, rep_title),
            keywords=keywords,
            representative_id=rep_id,
            method=settings.cluster_method,
        ))
    clusters.sort(key=lambda c: c.id)
    return ClusteringOutput(clusters=clusters, story_ids=link_stories(records, S, gap_hours, settings))
