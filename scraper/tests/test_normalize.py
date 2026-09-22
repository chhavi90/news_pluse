from datetime import datetime, timedelta, timezone

import feedparser

from scraper.normalize import (canonicalize_url, clean_text, normalize_entry, parse_date,
                               title_hash, url_hash)

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)


def _entry(xml: str):
    return feedparser.parse(xml).entries[0]


def _rss(item: str) -> str:
    return ("<?xml version='1.0'?><rss version='2.0' xmlns:dc='http://purl.org/dc/elements/1.1/' "
            "xmlns:content='http://purl.org/rss/1.0/modules/content/'><channel>" + item + "</channel></rss>")


def test_canonical_url_ignores_tracking_scheme_and_www():
    a = canonicalize_url("http://www.bbc.com/news/articles/abc123?at_medium=RSS&at_campaign=rss#top")
    b = canonicalize_url("https://bbc.com/news/articles/abc123/")
    assert a == b
    assert url_hash("http://x.com/a?utm_source=y") == url_hash("https://x.com/a")
    assert url_hash("https://x.com/a?id=1") != url_hash("https://x.com/a?id=2")   # real params are kept


def test_title_hash_ignores_case_and_punctuation():
    assert title_hash("Hello, World!") == title_hash("hello world")


def test_clean_text_strips_html_and_entities():
    assert clean_text("<p>Fish &amp; chips <b>now</b></p>\n  ok") == "Fish & chips now ok"


def test_rfc822_and_named_timezone_dates():
    e = _entry(_rss("<item><title>t</title><link>http://a.com/1</link>"
                    "<pubDate>Sat, 19 Sep 2026 10:00:00 EST</pubDate></item>"))
    assert parse_date(e, NOW) == datetime(2026, 9, 19, 15, 0, tzinfo=timezone.utc)


def test_dublin_core_iso_date():
    e = _entry(_rss("<item><title>t</title><link>http://a.com/1</link>"
                    "<dc:date>2026-09-19T08:30:00+05:30</dc:date></item>"))
    assert parse_date(e, NOW) == datetime(2026, 9, 19, 3, 0, tzinfo=timezone.utc)


def test_garbage_or_missing_date_returns_none_and_article_is_flagged():
    e = _entry(_rss("<item><title>Headline</title><link>http://a.com/1</link>"
                    "<dc:date>definitely not a date</dc:date></item>"))
    assert parse_date(e, NOW) is None
    article = normalize_entry(e, "Src", NOW)
    assert article.published_estimated is True and article.published_at == NOW


def test_far_future_dates_are_rejected():
    e = _entry(_rss("<item><title>t</title><link>http://a.com/1</link>"
                    "<pubDate>Sat, 19 Sep 2031 10:00:00 GMT</pubDate></item>"))
    assert parse_date(e, NOW) is None


def test_content_encoded_and_description_both_map_to_schema():
    e = _entry(_rss("<item><title>T</title><link>http://a.com/1</link>"
                    "<description>Short blurb</description>"
                    "<content:encoded><![CDATA[<p>The long body of the story goes here.</p>]]></content:encoded></item>"))
    a = normalize_entry(e, "Src", NOW)
    assert a.summary == "Short blurb"
    assert a.feed_body == "The long body of the story goes here."


def test_only_content_encoded_becomes_summary():
    e = _entry(_rss("<item><title>T</title><link>http://a.com/1</link>"
                    "<content:encoded><![CDATA[<p>Body only.</p>]]></content:encoded></item>"))
    a = normalize_entry(e, "Src", NOW)
    assert a.summary == "Body only."


def test_entry_without_link_or_title_is_rejected():
    assert normalize_entry(_entry(_rss("<item><title>No link</title></item>")), "S", NOW) is None
    assert normalize_entry(_entry(_rss("<item><link>http://a.com/x</link></item>")), "S", NOW) is None


def test_atom_entry_with_updated_only():
    xml = ("<feed xmlns='http://www.w3.org/2005/Atom'><entry><title>Atom title</title>"
           "<link href='http://a.com/atom'/><updated>2026-09-19T01:02:03Z</updated>"
           "<summary>Sum</summary></entry></feed>")
    a = normalize_entry(_entry(xml), "S", NOW)
    assert a.published_at == datetime(2026, 9, 19, 1, 2, 3, tzinfo=timezone.utc)
    assert a.published_estimated is False
