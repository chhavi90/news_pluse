from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class Article:
    """One normalised news item - the single internal schema for every feed."""

    source: str
    url: str
    canonical_url: str
    title: str
    summary: str
    published_at: datetime
    published_estimated: bool
    url_hash: str
    title_hash: str
    guid: str = ""
    feed_body: str = ""          # body supplied by the feed itself (content:encoded / Atom content)
    content: str = ""            # body extracted from the article page
    content_status: str = "skipped"   # ok | feed | failed | skipped
