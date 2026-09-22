# Submission checklist

## Requirement coverage (from the assessment PDF)

| Requirement | Where it is |
|---|---|
| **1a** 3+ real RSS feeds, list them in README | `scraper/feeds.json` (BBC, NPR, Guardian, Al Jazeera); README section 3 |
| Feed format inconsistencies -> one schema | `scraper/normalize.py` (`normalize_entry`, `parse_date`); tests in `scraper/tests/test_normalize.py` |
| Fetch full article body, fail gracefully | `scraper/fetcher.py` (trafilatura + BeautifulSoup fallback); `content_status` column |
| No duplicate articles, re-runnable | canonical-URL + headline hashes, unique DB indexes, `test_second_run_is_idempotent` |
| **1b** Topic grouping (A or B) + label | `scraper/clustering.py` - TF-IDF (default) **and** keyword overlap (`CLUSTER_METHOD`) |
| Store cluster id, label, articles, timestamps | tables `clusters` + `articles` (`db/schema.*.sql`) |
| README: approach, thresholds, limitation | README section 3 |
| **2** `GET /clusters`, `/clusters/:id`, `/timeline`, `POST /ingest/trigger`, `GET /ingest/status/:jobId` | `backend/src/routes/` |
| Timeline data shape (start/end, size metric) | `GET /timeline` -> `start`, `end`, `durationMinutes`, `articleCount`, `intensity` |
| Error handling / validation / status codes | `backend/src/lib/http.js`, `app.js`; `backend/test/api.test.js` |
| Config via env vars, hosted DB connection | `backend/.env.example`, `DATABASE_URL` (Postgres) or SQLite |
| **3** Timeline visualisation (spans, not a list) | `frontend/components/Timeline.tsx` |
| Cluster detail view (headline, source, time, link) | `frontend/components/ClusterDetail.tsx` |
| Filter by source | `SourceFilter.tsx` + `sources` API parameter |
| "Refresh data" button (trigger, poll, update) | `RefreshButton.tsx`, `lib/hooks.ts` (`useIngestJob`) |
| **Stretch:** auto-refresh | *Live updates* switch in `Dashboard.tsx` (60 s polling) |
| **Stretch:** visual cluster sizing | bar height + shade by `intensity` |
| **Stretch:** cross-source story merging | `link_stories` in `clustering.py`; UI link badges |
| **4** Deployment, env vars on platform, README note | `Dockerfile`, `render.yaml`, `docs/DEPLOYMENT.md`, README section 5 |
| **5** 2-3 min video | `docs/VIDEO_SCRIPT.md` (you record it) |

## Things only you can do (in this order)
1. [ ] Run it locally once (README section 1) and look at the timeline with real news.
2. [ ] Run `python -m scraper.inspect_similarities`; if related stories are split or unrelated ones merged, adjust `SIMILARITY_THRESHOLD` and note what you saw.
3. [ ] Push to GitHub (public repo, or private with the reviewer invited).
4. [ ] Deploy: Neon -> Render -> Vercel -> GitHub Actions secret (`docs/DEPLOYMENT.md`).
5. [ ] Open the live URL in a private window and check: timeline loads, bar click works, filter works, *Refresh data* finishes.
6. [ ] Put the three URLs at the top of README.md and commit.
7. [ ] Record the video (`docs/VIDEO_SCRIPT.md`), upload as unlisted, copy the link.
8. [ ] Send the email (`docs/SUBMISSION_EMAIL.md`) **before the 3-day deadline** - counting from when you received the assessment.

## Final submission contents
- [ ] GitHub repo link (folders `/scraper`, `/backend`, `/frontend`)
- [ ] Live frontend URL
- [ ] Live backend API URL (`/health` and `/timeline` open in a browser)
- [ ] README (setup, architecture, grouping approach + limitation, sources)
- [ ] Video link
