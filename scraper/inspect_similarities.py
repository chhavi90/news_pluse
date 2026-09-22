"""Threshold-tuning helper.

    python -m scraper.inspect_similarities [--top 25]

Prints a histogram of pairwise similarities plus the closest article pairs so you can
choose SIMILARITY_THRESHOLD where genuinely related pairs separate from unrelated ones.
"""
from __future__ import annotations

import argparse

import numpy as np

from .clustering import ArticleRecord, build_similarity
from .config import Settings
from .database import Database, from_db


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=25, help="how many closest pairs to print")
    args = parser.parse_args()

    settings = Settings.from_env()
    with Database(settings) as db:
        db.init_schema()
        rows = db.query("SELECT id, source, title, summary, content, published_at FROM articles "
                        "ORDER BY published_at DESC LIMIT ?", (settings.cluster_max_articles,))
    records = [ArticleRecord(r["id"], r["source"], r["title"], r["summary"], r["content"],
                             from_db(r["published_at"])) for r in rows]
    if len(records) < 2:
        print("Not enough articles yet - run `python -m scraper.run` first.")
        return

    _, _, S, gap = build_similarity(records, settings)
    S = np.where(gap <= settings.max_gap_hours, S, 0)
    iu = np.triu_indices(len(records), k=1)
    sims = S[iu]

    print(f"{len(records)} articles, {len(sims)} pairs. Current SIMILARITY_THRESHOLD = {settings.similarity_threshold}\n")
    print("Histogram of pairwise cosine similarity:")
    edges = np.arange(0, 1.05, 0.05)
    counts, _ = np.histogram(sims, bins=edges)
    for lo, hi, c in zip(edges[:-1], edges[1:], counts):
        bar = "#" * min(60, int(np.ceil(np.log2(c + 1) * 4))) if c else ""
        print(f"  {lo:.2f}-{hi:.2f} {c:8d} {bar}")

    order = np.argsort(-sims)[: args.top]
    print(f"\nClosest {args.top} pairs (read these to judge where 'same story' starts):")
    for k in order:
        i, j = iu[0][k], iu[1][k]
        print(f"  {sims[k]:.2f}  [{records[i].source}] {records[i].title[:70]}\n"
              f"        [{records[j].source}] {records[j].title[:70]}")


if __name__ == "__main__":
    main()
