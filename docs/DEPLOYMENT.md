# Deployment guide (free tiers)

You will create three things: a **database** (Neon), the **API** (Render), and the **frontend** (Vercel). Optionally add a **GitHub Actions cron** so data refreshes itself. Do them in this order because each step needs a value from the previous one.

## 0. Put the project on GitHub
```bash
cd news-pulse
git init
git add .
git commit -m "News Pulse"
# create an empty repo on github.com, then:
git branch -M main
git remote add origin https://github.com/<your-username>/news-pulse.git
git push -u origin main
```
`.gitignore` already excludes `.env` files, `node_modules`, `.venv` and local databases - **never commit real secrets**.

## 1. Database - Neon (PostgreSQL)
1. Sign up at https://neon.tech, create a project (any region near you).
2. Copy the **connection string** (looks like `postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require`).
3. Keep it handy as `DATABASE_URL`. Tables are created automatically by the API/pipeline on first start - nothing to run manually.

(Supabase or Railway Postgres work the same way. If a provider's TLS certificate is rejected, add `DATABASE_SSL=no-verify` to the Render variables.)

## 2. Backend API + Python pipeline - Render
1. https://render.com -> **New +** -> **Blueprint** -> select your GitHub repo (it reads [`render.yaml`](../render.yaml)).
   *Alternative:* **New +** -> **Web Service** -> your repo -> Runtime **Docker**, Dockerfile path `./Dockerfile`, Instance type **Free**, Health check path `/health`.
2. Set the environment variables when asked:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `CORS_ORIGINS` | your Vercel URL (you can put a placeholder now and update it after step 3), e.g. `https://news-pulse.vercel.app` - comma-separate several, wildcards like `https://*.vercel.app` are allowed |
3. Deploy. When it is live, open `https://<your-service>.onrender.com/health` - you should see `{"status":"ok","database":"postgres",...}`.
4. Trigger a first data load: `curl -X POST https://<your-service>.onrender.com/ingest/trigger` (or use the Refresh button in the UI later), then check `.../timeline`.

Notes
* The Docker image contains both Node and Python because `POST /ingest/trigger` runs `python -m scraper.run` as a subprocess.
* Free instances have 512 MB RAM. The blueprint sets `CLUSTER_MAX_ARTICLES=1200` and `MAX_WORKERS=4` to stay well inside it. If a refresh ever fails with an out-of-memory message in the job log, lower those numbers further.
* Free instances sleep after ~15 min idle; the first request then takes up to a minute (the UI shows a hint).

## 3. Frontend - Vercel
1. https://vercel.com -> **Add New... -> Project** -> import the GitHub repo.
2. **Root Directory:** `frontend`. Framework preset: Next.js (auto-detected).
3. **Environment Variables:** `NEXT_PUBLIC_API_URL` = `https://<your-service>.onrender.com` (no trailing slash).
4. Deploy, then copy the Vercel URL back into Render's `CORS_ORIGINS` and redeploy the API if you used a placeholder.

`NEXT_PUBLIC_*` variables are baked in at build time - after changing it, redeploy the frontend.

## 4. Scheduled refresh - GitHub Actions (recommended)
1. GitHub repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**.
2. Name `DATABASE_URL`, value = the Neon connection string.
3. The workflow [`ingest.yml`](../.github/workflows/ingest.yml) then runs every 30 minutes and can be started manually from the **Actions** tab (**Ingest news -> Run workflow**).

This keeps the data fresh even while the free API instance is asleep; the frontend's *Live updates* toggle picks the new data up on its next poll.

## 5. Final checklist
- [ ] `https://<api>/health` returns `ok`
- [ ] `https://<api>/timeline` returns clusters (after the first ingest)
- [ ] The Vercel URL opens cold, shows the timeline, filters work, **Refresh data** completes
- [ ] No `.env` file or connection string is in the repository (`git log -p | grep -i postgresql://` should print nothing)
- [ ] README has the live URLs and your video link
