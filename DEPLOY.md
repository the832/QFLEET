# Deploying QFleet: frontend on Vercel, backend on Railway

```
Browser ──► Vercel (frontend/, static React build) ──fetch──► Railway (Dockerfile: FastAPI + quantum optimiser)
   │                                                               │
   └──── sign-in ────► Neon Auth (Better Auth)                     └──► Neon Postgres · OSRM roads · IBM Quantum
```

Deploy the **backend first** (you need its URL for the frontend), then the frontend, then connect the two.

## 1 · Backend on Railway

Railway builds the root `Dockerfile` using `railway.json` (health check `/api/health`, 1 replica, restart on failure,
never sleeps) and injects `PORT` itself.

1. Push the repo to GitHub. Railway › New Project › Deploy from GitHub repo › pick it (root directory: repo root).
   CLI alternative from the repo root: `railway login`, `railway init`, `railway up`.
2. **Variables** (Railway › service › Variables):

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | Neon › Connect › connection string (`postgresql://…?sslmode=require…`). Tables and two demo organisations are created on first start. |
| `NEON_AUTH_URL` | yes for sign-in | Neon › Settings › Better Auth › Auth URL (`https://…neonauth…/neondb/auth`). |
| `ALLOWED_ORIGINS` | yes | Your Vercel site, e.g. `https://qfleet.vercel.app` (comma-separate several; add a custom domain here too). |
| `ALLOWED_ORIGIN_REGEX` | optional | Vercel preview URLs, e.g. `https://qfleet-[a-z0-9-]+\.vercel\.app` |
| `IBM_QUANTUM_TOKEN` | optional | IBM Quantum API key: enables "Real IBM QPU" (signed-in users only). |
| `IBM_QUANTUM_INSTANCE` | optional | IBM Quantum instance CRN, if your account has several. |
| `QFLEET_MAX_CONCURRENT_SOLVES` | optional | Parallel optimisations on the public routing endpoints (default 3; extra requests get HTTP 429). |

   Don't set `PORT`.
3. **Settings › Networking › Generate Domain** → e.g. `https://qfleet-backend.up.railway.app`.
   Check `https://<backend>/api/health` returns `{"ok":true}`.
4. **Resources:** at least **2 vCPU / 2 GB RAM** (Hobby plan or above); keep **1 replica** (autopilot state, quantum
   hardware jobs and solver pools live in that process). The first quantum plan after a deploy takes ~10 s while the
   annealing kernels compile; then ~2 s.

The Railway service also serves a copy of the web app at its own URL, a handy fallback if Vercel is down.

## 2 · Frontend on Vercel

1. Vercel › Add New › Project › import the same GitHub repo.
2. **Root Directory: `frontend`.** Vercel then picks up `frontend/vercel.json` (Vite build → `dist`, SPA fallback,
   long-cache headers for hashed assets).
3. **Environment variable** (Production, and Preview if you use previews):
   `VITE_API_URL = https://qfleet-backend.up.railway.app` (your Railway domain, no trailing slash).
   It is baked in at build time: **redeploy after changing it**.
4. Deploy → e.g. `https://qfleet.vercel.app`.

## 3 · Connect them (required)

1. Railway `ALLOWED_ORIGINS` must contain the exact Vercel URL (step 1.2), otherwise the browser blocks every API call
   (CORS error in the console). Changing it restarts the backend.
2. **Neon Auth trusted domains:** Neon Console › Auth › Configuration › Domains › add the **Vercel** URL
   (and any custom domain). The browser signs in from the frontend's origin; without this sign-in fails with
   `INVALID_ORIGIN`. Localhost works without it.
3. Open the Vercel site → sign in with Google → *Supply* › *Overview* should load live data from Railway.

## 4 · Before a demo

Reset the demo data (same Neon database): `cd backend && railway run .venv/bin/python -m app.reset_demo`
(`railway run` runs locally with the service's variables), then restart the Railway service.

## 5 · Local equivalents

```bash
./dev.sh                                                    # hot reload: UI :5173 → API :8787 (no VITE_API_URL needed)
docker build -t qfleet . && docker run --env-file backend/.env -p 8787:8787 qfleet    # the Railway image, locally
VITE_API_URL=http://localhost:8787 npm --prefix frontend run build                      # a Vercel-style build
```

## 6 · Security notes

* Supply Network APIs require a valid Neon Auth JWT (EdDSA, verified against the project JWKS; issuer and audience
  checked) and enforce roles server-side (main operator vs branch operator). Tokens are sent as `Authorization: Bearer`,
  so no cookies cross between Vercel and Railway.
* CORS only admits the origins you list; everything else is blocked.
* Public routing/quantum demo endpoints are limited: at most 80 orders / 12 vehicles per request, plus a concurrency cap.
  Real IBM QPU runs require sign-in.
* The backend container runs as a non-root user; no secrets are baked into the image or the frontend bundle
  (`VITE_API_URL` is a public address, not a secret).
* Rotate the Neon database password if it was ever shared in chat or screenshots.
