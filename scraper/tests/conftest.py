import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scraper.config import Settings
from scraper.devtools.mock_news_server import MockNewsServer, write_feeds_file


@pytest.fixture(scope="session")
def now():
    return datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture()
def mock_server(now):
    server = MockNewsServer(0, now).start()
    yield server
    server.stop()


@pytest.fixture()
def settings(tmp_path, mock_server) -> Settings:
    feeds = tmp_path / "feeds.json"
    write_feeds_file(feeds, mock_server.base_url, include_broken=True)
    return Settings(database_url="", sqlite_path=tmp_path / "test.db", feeds_file=feeds,
                    request_timeout=5, max_workers=4)
