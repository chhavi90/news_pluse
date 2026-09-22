"""Turn the messy variety of RSS/Atom entries into one consistent Article schema."""
from __future__ import annotations

import hashlib
import html
import re
import warnings
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning
from dateutil import parser as dateparser

from .models import Article

warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)

# --------------------------------------------------------------------------
# URLs
# --------------------------------------------------------------------------
_TRACKING_PREFIXES = ("utm_", "at_", "ns_", "mc_")
_TRACKING_KEYS = {
    "fbclid", "gclid", "ocid", "cmpid", "cmp", "ref", "referrer", "rss", "partner",
    "smid", "smtyp", "taid", "cid", "source", "intcmp", "wt.mc_id",
}


def canonicalize_url(url: str) -> str:
    """Strip tracking noise so the same article always has the same key.

    ``http://feeds.bbci.co.uk/x?at_medium=RSS`` and ``https://www.bbc.co.uk/x`` style
    variations collapse to one canonical form (scheme, ``www.``, fragments, tracking
    parameters and trailing slashes are ignored).
    """
    parts = urlsplit(url.strip())
    host = (parts.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if not k.lower().startswith(_TRACKING_PREFIXES) and k.lower() not in _TRACKING_KEYS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", host, path, urlencode(sorted(query)), ""))


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def url_hash(url: str) -> str:
    return sha256(canonicalize_url(url))


def title_hash(title: str) -> str:
    normalised = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    return sha256(normalised)


# --------------------------------------------------------------------------
# Text
# --------------------------------------------------------------------------
def clean_text(raw: Any, limit: Optional[int] = None) -> str:
    """HTML -> plain text with collapsed whitespace."""
    if not raw:
        return ""
    text = str(raw)
    if "<" in text and ">" in text:
        text = BeautifulSoup(text, "lxml").get_text(" ")
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if limit and len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------
_TZINFOS = {
    "EST": -5 * 3600, "EDT": -4 * 3600, "CST": -6 * 3600, "CDT": -5 * 3600,
    "MST": -7 * 3600, "MDT": -6 * 3600, "PST": -8 * 3600, "PDT": -7 * 3600,
    "IST": 5 * 3600 + 1800, "BST": 3600, "CET": 3600, "CEST": 7200,
    "GMT": 0, "UTC": 0, "UT": 0, "Z": 0,
}
_DATE_FIELDS = ("published", "updated", "created", "pubDate", "pubdate", "date", "dc_date")
_STRUCT_FIELDS = ("published_parsed", "updated_parsed", "created_parsed")


def _sane(dt: datetime, now: datetime) -> Optional[datetime]:
    """Reject nonsense dates; forgive small clock skew."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    if dt < now - timedelta(days=3650):
        return None
    if dt > now + timedelta(days=1):
        return None
    if dt > now:
        return now
    return dt


def parse_date(entry: Any, now: Optional[datetime] = None) -> Optional[datetime]:
    """Best-effort publication date in UTC, or None when the feed gives nothing usable."""
    now = now or datetime.now(timezone.utc)
    for key in _STRUCT_FIELDS:              # feedparser already normalises these to UTC
        struct = entry.get(key)
        if struct:
            try:
                dt = _sane(datetime(*struct[:6], tzinfo=timezone.utc), now)
                if dt:
                    return dt
            except (TypeError, ValueError):
                pass
    for key in _DATE_FIELDS:                # fall back to raw strings in odd formats
        raw = entry.get(key)
        if not raw or not isinstance(raw, str):
            continue
        try:
            dt = _sane(dateparser.parse(raw, fuzzy=True, tzinfos=_TZINFOS), now)
        except (ValueError, OverflowError, TypeError):
            continue
        if dt:
            return dt
    return None


# --------------------------------------------------------------------------
# Entry -> Article
# --------------------------------------------------------------------------
def _entry_link(entry: Any) -> str:
    link = entry.get("link") or ""
    if not link:
        for candidate in entry.get("links", []) or []:
            href = candidate.get("href")
            if href and candidate.get("rel", "alternate") == "alternate":
                link = href
                break
    if not link:
        ident = entry.get("id") or ""
        if str(ident).startswith("http"):
            link = ident
    return str(link).strip()


def normalize_entry(entry: Any, source: str, now: Optional[datetime] = None) -> Optional[Article]:
    """Map one feedparser entry to an Article; return None if it is unusable."""
    now = now or datetime.now(timezone.utc)
    title = clean_text(entry.get("title"))
    link = _entry_link(entry)
    if not title or not link.startswith(("http://", "https://")):
        return None

    # <description>, <summary>, <content:encoded> and Atom <content> all end up here.
    summary = clean_text(entry.get("summary") or entry.get("description"), limit=1200)
    feed_body = ""
    content_blocks = entry.get("content") or []
    if content_blocks:
        feed_body = clean_text(" ".join(str(c.get("value", "")) for c in content_blocks))
    if not summary and feed_body:
        summary = feed_body[:600]
    if feed_body and feed_body == summary:
        feed_body = ""

    published = parse_date(entry, now)
    return Article(
        source=source,
        url=link,
        canonical_url=canonicalize_url(link),
        title=title,
        summary=summary,
        published_at=published or now,
        published_estimated=published is None,
        url_hash=url_hash(link),
        title_hash=title_hash(title),
        guid=str(entry.get("id") or "")[:500],
        feed_body=feed_body,
    )
