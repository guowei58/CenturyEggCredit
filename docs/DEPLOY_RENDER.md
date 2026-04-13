# Deploy Century Egg Credit on Render (Docker: Node + Python)

This app uses a **Dockerfile** so the server has both **Node.js** (Next.js) and **Python** (XBRL compiler).

## Prerequisites

- GitHub (or GitLab/Bitbucket) repo with this code pushed.
- A Render account: [render.com](https://render.com)

## Step 1 — Push the Dockerfile

Commit and push `Dockerfile` and `.dockerignore` to your default branch (e.g. `main`).

## Step 2 — Create a PostgreSQL database (if you don’t have one)

1. Render Dashboard → **New +** → **PostgreSQL**.
2. Pick a name, region, and plan.
3. After it provisions, open the database → **Connections** → copy the **Internal Database URL** (or **External** if you ever connect from outside Render).

You will set this as `DATABASE_URL` on the web service.

## Step 3 — Create the web service

1. **New +** → **Web Service**.
2. **Connect** your repository (GitHub app install if prompted).
3. Configure:
   - **Name:** e.g. `century-egg-credit`
   - **Region:** same as your database when possible.
   - **Branch:** `main` (or your production branch).
   - **Runtime:** **Docker**
   - **Dockerfile path:** `Dockerfile` (default if file is at repo root).
   - **Instance type:** start with the smallest paid/always-on tier you need (free tiers may sleep—avoid for a real app with auth + DB).

## Step 4 — Environment variables

In the web service → **Environment**, add at least:

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | From your Render Postgres (Internal URL recommended for same-region). |
| `AUTH_SECRET` | Strong random string (e.g. `openssl rand -base64 32`). |
| `NEXTAUTH_URL` | Public URL of this service, e.g. `https://century-egg-credit.onrender.com` |
| `NEXTAUTH_SECRET` | Can match `AUTH_SECRET` or separate secret. |

Copy the rest from your Vercel / `.env.local` (API keys, `SEC_EDGAR_USER_AGENT`, OAuth client IDs/secrets, `SERPER_API_KEY`, etc.). **Do not** commit secrets to git.

**OAuth:** Update Google/GitHub (or other) OAuth **redirect / callback URLs** to use your Render hostname instead of Vercel.

## Step 5 — First deploy

1. Click **Create Web Service** (or **Save** + deploy).
2. Wait for the **Deploy** log to finish. Fix any build errors (see Troubleshooting).

## Step 6 — Run database migrations (once per schema change)

Open the web service → **Shell** (or use a one-off job), from `/app`:

```bash
npx prisma migrate deploy
```

Run this after the first successful deploy and whenever you add migrations.

## Step 7 — Smoke test

- Open `https://<your-service>.onrender.com`
- Sign in, hit a page that uses the DB.
- Test **XBRL compiler**; Python runs inside the container (`PATH` includes the venv that has `python`).

## Optional: custom domain

Render → your service → **Settings** → **Custom Domain** → follow DNS instructions.

Update `NEXTAUTH_URL` to the custom domain when you switch.

## Troubleshooting

- **Build fails on `npm ci`:** ensure `package-lock.json` is committed.
- **Prisma errors at runtime:** confirm `DATABASE_URL` and that `prisma migrate deploy` ran.
- **XBRL `ENOENT` / Python:** the image installs Python in a venv; if you override `PYTHON_PATH`, point it at `/opt/xbrl-venv/bin/python`.
- **Cold starts:** use an always-on instance plan if the app feels slow after idle.

## Leaving Vercel

After Render is stable, remove or downgrade the Vercel project to avoid duplicate hosting cost. Update any links/bookmarks to the new URL.
