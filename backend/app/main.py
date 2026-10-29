from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import analysis, elexon_client
from .config import SCOPE_END_DATE, SCOPE_START_DATE

app = FastAPI(
    title="GB Wind Day-Ahead Procurement Support API",
    description="Latest wind generation forecasts and forecast-accuracy analytics "
    "to support day-ahead thermal power purchase decisions.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # pilot/demo scope; tighten to the client's domain for production
    allow_methods=["*"],
    allow_headers=["*"],
)


def _delivery_days() -> list[str]:
    start = datetime.fromisoformat(SCOPE_START_DATE)
    end = datetime.fromisoformat(SCOPE_END_DATE)
    days = []
    d = start
    while d <= end:
        days.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return days


def _fetch_windfor_for_scope() -> list[dict]:
    # Need forecasts published from a few days before the first delivery day
    # (to catch early, long-horizon forecasts) through the last delivery day.
    pub_from = (datetime.fromisoformat(SCOPE_START_DATE) - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%S")
    pub_to = (datetime.fromisoformat(SCOPE_END_DATE) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    return elexon_client.fetch_windfor(pub_from, pub_to)


def _fetch_actuals_for_scope() -> list[dict]:
    return elexon_client.fetch_fuelhh_wind(SCOPE_START_DATE, (datetime.fromisoformat(SCOPE_END_DATE) + timedelta(days=1)).strftime("%Y-%m-%d"))


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/decision-days")
def decision_days():
    return {"deliveryDates": _delivery_days(), "scope": {"from": SCOPE_START_DATE, "to": SCOPE_END_DATE}}


@app.get("/api/decision/{delivery_date}")
def decision_view(delivery_date: str):
    if delivery_date not in _delivery_days():
        raise HTTPException(400, f"delivery_date must be within scope {SCOPE_START_DATE}..{SCOPE_END_DATE}")
    try:
        cutoff = analysis.decision_cutoff_for_delivery_day(delivery_date)
        windfor = elexon_client.fetch_windfor(
            (cutoff - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S"),
            cutoff.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        actuals = elexon_client.fetch_fuelhh_wind(delivery_date, delivery_date)
    except elexon_client.ElexonAPIError as exc:
        raise HTTPException(502, f"Upstream Elexon API error: {exc}") from exc
    return analysis.build_decision_view(delivery_date, windfor, actuals)


@app.get("/api/accuracy")
def accuracy(limit_days: int | None = None):
    """Aggregate forecast-accuracy metrics across the scope (or the first
    `limit_days` delivery days, for a faster demo response)."""
    days = _delivery_days()
    if limit_days:
        days = days[:limit_days]
    try:
        windfor_all = _fetch_windfor_for_scope()
        actuals_all = _fetch_actuals_for_scope()
    except elexon_client.ElexonAPIError as exc:
        raise HTTPException(502, f"Upstream Elexon API error: {exc}") from exc

    actuals_by_day: dict[str, list[dict]] = {}
    for rec in actuals_all:
        day = (rec.get("startTime") or "")[:10]
        actuals_by_day.setdefault(day, []).append(rec)

    views = []
    for day in days:
        # build_decision_view applies the per-day decision cutoff internally,
        # so it's safe (and simpler) to pass it the whole scope's forecasts.
        views.append(analysis.build_decision_view(day, windfor_all, actuals_by_day.get(day, [])))

    return analysis.accuracy_summary(views)
