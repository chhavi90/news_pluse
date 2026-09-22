from scraper.database import Database
from scraper.pipeline import PipelineError, run_pipeline


def _count(settings, sql, params=()):
    with Database(settings) as db:
        return db.query(sql, params)


def test_first_run_normalises_all_feeds_and_survives_failures(settings):
    stats = run_pipeline(settings)
    assert stats["feeds"]["Broken Feed"]["status"] == "error"          # dead feed never kills the run
    assert stats["feeds"]["Alpha Daily"]["duplicates"] == 1            # tracking-param duplicate dropped
    assert stats["feeds"]["Beta Times"]["invalid"] == 1                # entry without link rejected
    assert stats["new_articles"] > 25
    rows = {r["title"]: r for r in _count(settings, "SELECT * FROM articles")}
    assert rows["Volunteers restore historic lighthouse on the island"]["published_estimated"] == 1
    assert rows["Community garden opens on former parking lot"]["published_estimated"] == 1
    # a broken page keeps the article, with the feed summary and status 'failed'
    assert rows["Volunteers restore historic lighthouse on the island"]["content_status"] == "failed"
    assert rows["Exclusive interview with a retired diplomat"]["content_status"] == "failed"    # paywall stub too short
    ok = [r for r in rows.values() if r["content_status"] == "ok"]
    assert len(ok) > 20 and all(len(r["content"]) >= 200 for r in ok)
    # cluster tables are populated and consistent
    assert all(r["cluster_id"] is not None for r in rows.values())
    clusters = _count(settings, "SELECT * FROM clusters")
    assert {c["id"] for c in clusters} == {r["cluster_id"] for r in rows.values()}


def test_second_run_is_idempotent(settings):
    first = run_pipeline(settings)
    before = _count(settings, "SELECT COUNT(*) AS n FROM articles")[0]["n"]
    second = run_pipeline(settings)
    after = _count(settings, "SELECT COUNT(*) AS n FROM articles")[0]["n"]
    assert before == after == first["new_articles"]
    assert second["new_articles"] == 0
    assert second["clusters"] == first["clusters"]


def test_recluster_only_needs_no_network(settings):
    run_pipeline(settings)
    settings.feeds_file = settings.feeds_file.with_name("missing.json")
    stats = run_pipeline(settings, recluster_only=True)
    assert stats["clusters"] > 0


def test_all_feeds_failing_raises(settings, tmp_path):
    import json

    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps([{"name": "Nope", "url": "http://127.0.0.1:9/none.xml"}]))
    settings.feeds_file = bad
    settings.request_timeout = 1
    try:
        run_pipeline(settings)
    except PipelineError as exc:
        assert "every feed failed" in str(exc)
    else:
        raise AssertionError("expected PipelineError")


def test_full_text_can_be_disabled(settings):
    settings.fetch_full_text = False
    run_pipeline(settings)
    statuses = {r["content_status"] for r in _count(settings, "SELECT content_status FROM articles")}
    assert statuses <= {"skipped", "feed"}
