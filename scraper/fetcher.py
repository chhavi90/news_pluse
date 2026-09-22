"""Network layer: download feeds, download article pages, pull out the main text."""
from __future__ import annotations

import logging
from typing import Any

import feedparser
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import Settings

log = logging.getLogger("newspulse.fetch")

MAX_PAGE_BYTES = 2_000_000


class FeedError(RuntimeError):
    """A feed could not be downloaded or parsed at all."""


def build_session(settings: Settings) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": settings.user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
    })
    retry = Retry(total=2, backoff_factor=0.6, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",))
    adapter = HTTPAdapter(max_retries=retry, pool_maxsize=32)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def fetch_feed(session: requests.Session, url: str, settings: Settings) -> list[Any]:
    """Download one RSS/Atom feed and return its entries (newest first, capped)."""
    try:
        resp = session.get(url, timeout=settings.request_timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise FeedError(f"download failed: {exc}") from exc
    parsed = feedparser.parse(resp.content)
    if not parsed.entries:
        reason = getattr(parsed, "bozo_exception", None)
        raise FeedError(f"no entries parsed ({reason or 'empty feed'})")
    return list(parsed.entries[: settings.max_items_per_feed])


def _download_page(session: requests.Session, url: str, settings: Settings) -> str:
    with session.get(url, timeout=settings.request_timeout, stream=True) as resp:
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "").lower()
        if ctype and "html" not in ctype and "xml" not in ctype:
            raise ValueError(f"not an HTML page ({ctype})")
        chunks, size = [], 0
        for chunk in resp.iter_content(65536):
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_PAGE_BYTES:
                break
        raw = b"".join(chunks)
        charset = resp.encoding if "charset" in ctype else None
    return raw.decode(charset or "utf-8", errors="replace")


def _bs4_extract(page_html: str) -> str:
    """Fallback extractor: paragraphs of the <article>/<main>/<body>."""
    soup = BeautifulSoup(page_html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "aside", "form", "noscript", "header"]):
        tag.decompose()
    root = soup.find("article") or soup.find("main") or soup.body or soup
    paragraphs = [p.get_text(" ", strip=True) for p in root.find_all("p")]
    return "\n".join(p for p in paragraphs if len(p) > 40)


def extract_main_text(page_html: str, url: str = "") -> str:
    """trafilatura first (best quality), BeautifulSoup as a safety net."""
    text = ""
    try:
        import trafilatura

        text = trafilatura.extract(page_html, url=url or None, include_comments=False,
                                   include_tables=False, favor_precision=True) or ""
    except Exception as exc:  # trafilatura should never take the run down
        log.debug("trafilatura failed for %s: %s", url, exc)
    if len(text) < 200:
        try:
            fallback = _bs4_extract(page_html)
            if len(fallback) > len(text):
                text = fallback
        except Exception as exc:
            log.debug("bs4 fallback failed for %s: %s", url, exc)
    return text.strip()


def fetch_article_body(session: requests.Session, url: str, settings: Settings) -> tuple[str, str]:
    """Return ``(text, status)`` where status is ``ok`` or ``failed``. Never raises."""
    try:
        page_html = _download_page(session, url, settings)
        text = extract_main_text(page_html, url)
        if len(text) < settings.min_body_chars:
            return "", "failed"
        return text[: settings.max_body_chars], "ok"
    except Exception as exc:
        log.info("could not extract %s (%s)", url, str(exc)[:120])
        return "", "failed"
