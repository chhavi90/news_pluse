"""Command line entry point.

    python -m scraper.run                 # scrape + extract + cluster
    python -m scraper.run --recluster     # only re-run the clustering step
    python -m scraper.run --no-fulltext   # skip fetching full article pages (fast)
    python -m scraper.run --method keyword
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from .config import Settings
from .pipeline import PipelineError, run_pipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scraper.run", description="News Pulse ingestion + clustering pipeline")
    parser.add_argument("--recluster", action="store_true", help="skip downloading; only regroup stored articles")
    parser.add_argument("--no-fulltext", action="store_true", help="do not fetch full article pages")
    parser.add_argument("--method", choices=["tfidf", "keyword"], help="override CLUSTER_METHOD")
    parser.add_argument("--threshold", type=float, help="override SIMILARITY_THRESHOLD")
    parser.add_argument("--json", action="store_true", help="print a machine-readable RESULT_JSON line at the end")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    # Windows consoles default to a legacy code page; never let a headline crash the logger.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", stream=sys.stdout)
    logging.getLogger("trafilatura").setLevel(logging.ERROR)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    settings = Settings.from_env()
    if args.no_fulltext:
        settings.fetch_full_text = False
    if args.method:
        settings.cluster_method = args.method
    if args.threshold is not None:
        settings.similarity_threshold = args.threshold

    try:
        stats = run_pipeline(settings, recluster_only=args.recluster)
    except PipelineError as exc:
        logging.getLogger("newspulse").error("pipeline failed: %s", exc)
        return 1
    except Exception:  # noqa: BLE001 - last-resort guard so the caller always gets a clean exit code
        logging.getLogger("newspulse").exception("unexpected failure")
        return 2

    logging.getLogger("newspulse").info("done: %s", json.dumps(stats))
    if args.json:
        print("RESULT_JSON:" + json.dumps(stats), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
