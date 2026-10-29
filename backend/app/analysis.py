from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import DECISION_CUTOFF_HOUR_LOCAL


def _parse_dt(value: str) -> datetime:
  return datetime.fromisoformat(value.replace("Z", "+00:00"))


def decision_cutoff_for_delivery_day(delivery_date: str) -> datetime:
  """The latest publishTime a forecast could have and still be usable for
  a day-ahead buy decision for `delivery_date` (made on D-1)."""
  d = datetime.fromisoformat(delivery_date).replace(tzinfo=timezone.utc)
  d_minus_1 = d - timedelta(days=1)
  return d_minus_1.replace(
      hour=DECISION_CUTOFF_HOUR_LOCAL, minute=0, second=0, microsecond=0
  )


def latest_forecast_per_period(
    windfor_records: list[dict], cutoff: datetime
) -> dict[datetime, dict]:
  """For each settlement-period startTime (as a UTC datetime), keep the forecast
  with the latest publishTime that is still <= cutoff.
  """
  best: dict[datetime, dict] = {}
  for rec in windfor_records:
    start_time_str = rec.get("startTime")
    publish_time = rec.get("publishTime")
    if not start_time_str or not publish_time:
      continue
    if _parse_dt(publish_time) > cutoff:
      continue

    # Parse key to normalized UTC datetime object
    dt_start = _parse_dt(start_time_str)
    existing = best.get(dt_start)
    if existing is None or _parse_dt(publish_time) > _parse_dt(
        existing["publishTime"]
    ):
      best[dt_start] = rec
  return best


def build_decision_view(
    delivery_date: str,
    windfor_records: list[dict],
    actual_records: list[dict],
) -> dict[str, Any]:
  """Assemble the per-period forecast-vs-actual table for one delivery day."""
  cutoff = decision_cutoff_for_delivery_day(delivery_date)
  forecasts = latest_forecast_per_period(windfor_records, cutoff)

  # CRITICAL FIX: Filter raw FUELHH records specifically for wind generation.
  # Handles BMRS fields safely across variations ("fuelType" / "fuel").
  wind_actuals = [
      r for r in actual_records
      if str(r.get("fuelType", "")).upper() == "WIND"
      or str(r.get("fuel", "")).upper() == "WIND"
      or ("fuelType" not in r and "fuel" not in r)
  ]

  # Parse actual records dictionary keys into UTC datetime objects
  actuals_by_start = {
      _parse_dt(r["startTime"]): r for r in wind_actuals if r.get("startTime")
  }

  # Set union of datetime keys guarantees robust merging regardless of raw string formatting
  periods = sorted(set(forecasts) | set(actuals_by_start))
  rows = []
  for start_time in periods:
    fc = forecasts.get(start_time)
    ac = actuals_by_start.get(start_time)
    forecast_mw = fc.get("generation") if fc else None
    actual_mw = ac.get("generation") if ac else None
    error_mw = (
        (actual_mw - forecast_mw)
        if (forecast_mw is not None and actual_mw is not None)
        else None
    )

    horizon_hours = None
    if fc:
      # start_time is already a datetime object—no re-parsing needed!
      horizon_hours = round(
          (
              start_time - _parse_dt(fc["publishTime"])
          ).total_seconds()
          / 3600,
          1,
      )

    rows.append(
        {
            "startTime": start_time.isoformat(),
            "forecastMw": forecast_mw,
            "actualMw": actual_mw,
            "errorMw": error_mw,
            "forecastPublishTime": fc.get("publishTime") if fc else None,
            "forecastHorizonHours": horizon_hours,
        }
    )

  return {
      "deliveryDate": delivery_date,
      "decisionCutoff": cutoff.isoformat(),
      "periods": rows,
  }


def _percentile(values: list[float], percentile: float) -> float | None:
  """Linearly interpolated percentile; returns None for an empty sample."""
  if not values:
    return None
  ordered = sorted(values)
  position = (len(ordered) - 1) * percentile
  lower = int(position)
  upper = min(lower + 1, len(ordered) - 1)
  fraction = position - lower
  return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _metrics(
    errors: list[float], forecasts: list[float], actuals: list[float]
) -> dict:
  n = len(errors)
  if n == 0:
    return {
        "count": 0,
        "mae": None,
        "rmse": None,
        "mape": None,
        "bias": None,
        "downsideP90": None,
        "downsideShare": None,
    }
  mae = sum(abs(e) for e in errors) / n
  rmse = (sum(e * e for e in errors) / n) ** 0.5
  bias = sum(errors) / n
  mape_terms = [
      abs(e) / a for e, a in zip(errors, actuals) if a and a > 50
  ]
  mape = (sum(mape_terms) / len(mape_terms) * 100) if mape_terms else None
  downside_shortfalls = [max(0.0, -e) for e in errors]
  downside_p90 = _percentile(downside_shortfalls, 0.90)
  downside_share = sum(1 for e in errors if e < 0) / n * 100
  return {
      "count": n,
      "mae": round(mae, 1),
      "rmse": round(rmse, 1),
      "mape": round(mape, 2) if mape is not None else None,
      "bias": round(bias, 1),
      "downsideP90": round(downside_p90, 1) if downside_p90 is not None else None,
      "downsideShare": round(downside_share, 1),
  }


def accuracy_summary(daily_views: list[dict]) -> dict[str, Any]:
  """Aggregate accuracy across a set of per-day decision views."""
  all_errors, all_fc, all_ac = [], [], []
  daily_rows = []
  horizon_buckets: dict[str, list[float]] = defaultdict(list)
  horizon_fc: dict[str, list[float]] = defaultdict(list)
  horizon_ac: dict[str, list[float]] = defaultdict(list)

  for view in daily_views:
    day_errors, day_fc, day_ac = [], [], []
    for p in view["periods"]:
      if p["errorMw"] is None:
        continue
      day_errors.append(p["errorMw"])
      day_fc.append(p["forecastMw"])
      day_ac.append(p["actualMw"])
      all_errors.append(p["errorMw"])
      all_fc.append(p["forecastMw"])
      all_ac.append(p["actualMw"])

      if p["forecastHorizonHours"] is not None:
        bucket = _horizon_bucket(p["forecastHorizonHours"])
        horizon_buckets[bucket].append(p["errorMw"])
        horizon_fc[bucket].append(p["forecastMw"])
        horizon_ac[bucket].append(p["actualMw"])

    daily_rows.append(
        {"deliveryDate": view["deliveryDate"], **_metrics(day_errors, day_fc, day_ac)}
    )

  horizon_rows = [
      {"bucket": b, **_metrics(horizon_buckets[b], horizon_fc[b], horizon_ac[b])}
      for b in sorted(horizon_buckets, key=lambda x: float(x.split("-")[0]))
  ]

  return {
      "overall": _metrics(all_errors, all_fc, all_ac),
      "byDay": daily_rows,
      "byHorizon": horizon_rows,
  }


def _horizon_bucket(hours: float) -> str:
  lower = int(hours // 6) * 6
  return f"{lower}-{lower + 6}"