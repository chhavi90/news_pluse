from collections import defaultdict
from datetime import datetime, timezone

import pytest

from scraper.clustering import ArticleRecord, cluster_articles
from scraper.config import Settings
from scraper.devtools.mock_news_server import BODY, OUTLETS, STORIES

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)


def _records():
    """Ground truth: every article remembers which fake story it belongs to."""
    from datetime import timedelta

    records, truth, n = [], {}, 0
    for key, entries in STORIES.items():
        for i, (outlet, hours, title, summary) in enumerate(entries):
            n += 1
            body = BODY["misc"][i] if key == "misc" else " ".join(BODY[key][i % 4:] + BODY[key][: i % 4])
            records.append(ArticleRecord(n, OUTLETS[outlet], title, summary, body, NOW - timedelta(hours=hours)))
            truth[n] = key
    return records, truth


def _purity(result, truth):
    """Share of articles whose cluster contains only articles of one true story (excluding 'misc')."""
    good = total = 0
    for c in result.clusters:
        keys = [truth[a] for a in c.article_ids if truth[a] != "misc"]
        if not keys:
            continue
        top = max(set(keys), key=keys.count)
        good += keys.count(top)
        total += len(keys)
    return good / total


@pytest.mark.parametrize("method", ["tfidf", "keyword"])
def test_related_articles_group_together_and_unrelated_stay_apart(method):
    records, truth = _records()
    result = cluster_articles(records, Settings(cluster_method=method))
    assert _purity(result, truth) >= 0.95, [ (c.label, [truth[a] for a in c.article_ids]) for c in result.clusters]
    by_story = defaultdict(set)
    for c in result.clusters:
        for a in c.article_ids:
            by_story[truth[a]].add(c.id)
    # each real story should be (nearly) contained in one cluster
    for key in ("quake", "fire", "vote", "chip", "cricket"):
        assert len(by_story[key]) <= 2, (method, key, by_story[key])
    misc_cluster_sizes = [len(c.article_ids) for c in result.clusters if any(truth[a] == "misc" for a in c.article_ids)]
    assert max(misc_cluster_sizes) == 1


def test_every_article_belongs_to_exactly_one_cluster_and_ids_are_min_member():
    records, _ = _records()
    result = cluster_articles(records, Settings())
    ids = [a for c in result.clusters for a in c.article_ids]
    assert sorted(ids) == sorted(r.id for r in records)
    assert all(c.id == min(c.article_ids) for c in result.clusters)


def test_labels_are_keyword_based_and_nonempty():
    records, truth = _records()
    result = cluster_articles(records, Settings())
    quake = next(c for c in result.clusters if truth[c.article_ids[0]] == "quake")
    assert any(w in " ".join(quake.keywords) for w in ("earthquake", "tsunami", "coast"))
    assert all(c.label for c in result.clusters)


def test_time_gap_prevents_merging_identical_stories_far_apart():
    from datetime import timedelta

    a = ArticleRecord(1, "A", "Wildfire forces evacuation in forest region", "wildfire evacuation forest", "", NOW)
    b = ArticleRecord(2, "B", "Wildfire forces evacuation in forest region", "wildfire evacuation forest", "", NOW - timedelta(days=5))
    assert len(cluster_articles([a, b], Settings()).clusters) == 2
    c = ArticleRecord(3, "B", a.title, a.summary, "", NOW - timedelta(hours=3))
    assert len(cluster_articles([a, c], Settings()).clusters) == 1


def test_cross_source_story_linking():
    records, truth = _records()
    result = cluster_articles(records, Settings())
    linked = defaultdict(set)
    for rid, story in result.story_ids.items():
        if story is not None:
            linked[story].add(OUTLETS_BY_ID(records, rid))
    assert linked, "expected at least one multi-outlet story"
    assert all(len(sources) >= 2 for sources in linked.values())
    # the two headlines about the interest-rate decision from different outlets are one story
    rate_ids = [i for i, k in truth.items() if k == "rates"][:2]
    assert result.story_ids[rate_ids[0]] == result.story_ids[rate_ids[1]] is not None


def OUTLETS_BY_ID(records, rid):
    return next(r.source for r in records if r.id == rid)


def test_edge_cases_empty_and_single_article():
    assert cluster_articles([], Settings()).clusters == []
    one = cluster_articles([ArticleRecord(7, "A", "Only story", "just one", "", NOW)], Settings())
    assert len(one.clusters) == 1 and one.clusters[0].id == 7
    empty_vocab = cluster_articles([ArticleRecord(1, "A", "the and", "", "", NOW),
                                    ArticleRecord(2, "B", "of to", "", "", NOW)], Settings())
    assert len(empty_vocab.clusters) == 2
