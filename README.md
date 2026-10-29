# GB Wind Day-Ahead Procurement Support

A pilot web app for a UK energy utility's day-ahead power buying desk. It answers the
two questions the team needs answered before buying thermal top-up power from the
day-ahead market:

1. **What's the latest wind generation forecast available at the moment I have to decide?**
2. **How accurate has that forecast historically been, so I can size my purchase with the error in mind?**

Scope (per the brief): national GB wind only, Elexon's public `WINDFOR` (forecast) and
`FUELHH` (actual outturn, `fuelType == WIND`) datasets, decisions for **January 2026**
delivery days.

> **AI tool disclosure:** Claude (Anthropic) was used to help design and write the
> backend analysis logic, the FastAPI service, the React frontend, and this README.
> API behaviour was verified against Elexon's published Insights API documentation;
> all domain assumptions below were made explicitly and are documented so they can be
> checked and adjusted by the team.

---

## The core domain decision: what counts as "the forecast I had"

GB day-ahead power (N2EX/EPEX) gate-closes at **11:00 UK time on D-1** for delivery
on day D. Elexon publishes multiple `WINDFOR` forecast updates per day, each stamped
with a `publishTime`. A buyer deciding at the gate closure could only have seen
forecasts published **before** that time.

So for each delivery day D, the app:

1. Computes the decision cutoff = `11:00` on `D-1` (configurable via
   `DECISION_CUTOFF_HOUR_LOCAL`).
2. For every half-hour settlement period in D, takes the **most recently published**
   `WINDFOR` record for that period with `publishTime <= cutoff`.
3. That is "the forecast the buyer actually had." Everything in the UI and the
   accuracy metrics is built from this — not from hindsight-best forecasts.

(January falls under GMT, UTC+0, so no DST handling was needed for this scope; this
is called out in `backend/app/config.py` in case the scope is later extended to
summer months.)

---

## Repository structure

```
wind-procurement-app/
├── backend/                     # Python/FastAPI service
│   ├── app/
│   │   ├── main.py              # API routes
│   │   ├── analysis.py          # decision-cutoff logic + accuracy metrics (MAE/RMSE/MAPE/bias)
│   │   ├── elexon_client.py     # Elexon API client, date-window chunking, disk cache
│   │   └── config.py            # domain constants (decision cutoff hour, scope dates)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                    # React (Vite) SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── DecisionView.jsx # forecast-vs-actual chart for one delivery day
│   │   │   └── AccuracyView.jsx # aggregate accuracy metrics across January 2026
│   │   ├── api.js               # backend API client
│   │   └── App.jsx
│   ├── nginx.conf               # SPA + /api reverse proxy, used in the Docker image
│   └── Dockerfile
├── docker-compose.yml           # runs both services together
├── .env.example
└── README.md
```

## API endpoints (backend)

| Method | Path                         | Purpose                                                            |
|--------|-------------------------------|----------------------------------------------------------------------|
| GET    | `/api/health`                 | liveness check                                                       |
| GET    | `/api/decision-days`          | list of delivery days in scope (Jan 2026)                            |
| GET    | `/api/decision/{delivery_date}` | per-half-hour forecast vs. actual for one delivery day, plus the decision cutoff used |
| GET    | `/api/accuracy`               | overall MAE/RMSE/MAPE/bias plus downside shortfall statistics, broken down by day and by forecast horizon |

Interactive docs are available at `/docs` (FastAPI's built-in Swagger UI) once the
backend is running.

---

## Running locally

### Option A — Docker Compose (recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000 (docs at http://localhost:8000/docs)

### Option B — manually

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd frontend
npm install
npm run dev
# open http://localhost:5173 — Vite proxies /api to localhost:8000
```

No API key is required — Elexon's Insights API dataset-stream endpoints used here
are public.

---

## Deployment notes

- **Frontend**: static Vite build (`npm run build` → `frontend/dist`) — deploys
  directly to **Vercel** as a static site. Set `VITE_API_BASE_URL` to the deployed
  backend's URL as a Vercel environment variable if frontend and backend are on
  different hosts.
- **Backend**: a standard FastAPI/Uvicorn app — deploys to **Heroku** (or Render/
  Fly.io) using the included `backend/Dockerfile`, or via a `Procfile`
  (`web: uvicorn app.main:app --host 0.0.0.0 --port $PORT`) if deploying without
  Docker on Heroku.

**Deployed app:** _add the live Vercel/Heroku link here after deploying._

---

## Key design/engineering decisions (for the tech-lead review)

- **Decision-time correctness over hindsight accuracy.** The single most important
  modelling choice in this app is only ever using forecasts the buyer could actually
  have seen by the gate-closure cutoff — see above. A naive "forecast vs actual"
  comparison using the *best available* forecast would overstate accuracy and
  understate the real risk the buying desk faces.
- **Caching, not a database.** January 2026 is a fixed historical window once
  settled; a lightweight content-addressed disk cache (`elexon_client.py`) avoids
  re-fetching identical windows on every request without the operational overhead
  of standing up a database for a pilot.
- **Resilience.** Elexon calls are wrapped in `ElexonAPIError` and surfaced as a
  clean `502` with a message, rather than a raw exception, so the frontend can show
  a readable error state.
- **Metrics chosen:** MAE and RMSE (both in MW), signed bias (actual minus forecast),
  MAPE (excluding near-zero actual wind), the share of periods where actual wind was
  below forecast, and the 90th percentile of non-negative wind shortfall
  (`max(0, forecast - actual)`). The downside percentile includes zero-shortfall periods
  and describes the observed sample; it is not a calibrated forecast interval or a buy instruction.
- **Horizon bucketing.** Forecast error is also broken down by how many hours ahead
  of delivery the forecast was published (6-hour buckets), since forecast skill
  degrades with horizon — this lets the team see, quantitatively, how much less to
  trust a forecast made far in advance vs. one made close to the cutoff.

## Known limitations / next steps (16-hour scope)

- Single national aggregate forecast only, per the brief (no regional/BMU-level
  breakdown, no solar, no demand-side data).
- The interface reconstructs historical January 2026 decisions; it does not yet offer a live/upcoming delivery-day forecast workflow.
- No authentication/multi-user support — this is a pilot/demo.
- No automated test suite beyond the manual verification done during development;
  a natural next step would be `pytest` coverage for `analysis.py`'s cutoff and
  metric logic using fixture data.
- The on-disk cache is per-container; a production deployment with multiple backend
  replicas would want a shared cache (e.g. Redis) instead.
