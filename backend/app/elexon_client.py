"""
Thin, resilient client for the two Elexon Insights/BMRS dataset streams this
product uses:

  - FUELHH  : half-hourly actual generation outturn by fuel type
              window params: settlementDateFrom / settlementDateTo
  - WINDFOR : wind generation forecast, published periodically ahead of
              delivery
              window params: publishDateTimeFrom / publishDateTimeTo

Both are keyless, public endpoints returning {"data": [ {...}, ... ]}.

Design notes for the tech-lead review:
  * We cache raw responses to disk (JSON) keyed by dataset+window, with a
    TTL. January 2026 is historical/static data once the month has fully
    settled, so this keeps the app fast and avoids hammering Elexon on every
    page load, while still refreshing periodically in case of late revisions.
  * Elexon windows are kept to <= 31 days per call here (comfortably under
    documented/typical range limits); callers passing a wider window get it
    chunked automatically.
  * All failures are raised as ElexonAPIError with the offending URL so the
    FastAPI layer can turn them into a clean 502 instead of a stack trace.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timedelta
from typing import Any

import httpx

from .config import CACHE_DIR, CACHE_TTL_SECONDS, ELEXON_BASE_URL

os.makedirs(CACHE_DIR, exist_ok=True)


class ElexonAPIError(RuntimeError):
    def __init__(self, message: str, url: str | None = None):
        super().__init__(message)
        self.url = url


def _cache_path(key: str) -> str:
    digest = hashlib.sha256(key.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{digest}.json")


def _cache_get(key: str) -> Any | None:
    path = _cache_path(key)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            payload = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if time.time() - payload.get("_cached_at", 0) > CACHE_TTL_SECONDS:
        return None
    return payload.get("data")


def _cache_set(key: str, data: Any) -> None:
    path = _cache_path(key)
    try:
        with open(path, "w") as f:
            json.dump({"_cached_at": time.time(), "data": data}, f)
    except OSError:
        pass  # cache is a best-effort optimisation, never fatal


def _get(url: str, params: dict) -> list[dict]:
    cache_key = url + "?" + json.dumps(params, sort_keys=True)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        resp = httpx.get(url, params=params, timeout=30.0)
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPStatusError as exc:
        # Surface Elexon's own error body (e.g. "range must not exceed N days")
        # instead of swallowing it behind a generic status message.
        detail = ""
        try:
            detail = exc.response.text[:500]
        except Exception:
            pass
        raise ElexonAPIError(
            f"Elexon request failed ({exc.response.status_code}) for {exc.request.url}: {detail}",
            url=str(exc.request.url),
        ) from exc
    except httpx.HTTPError as exc:
        raise ElexonAPIError(f"Elexon request failed: {exc}", url=url) from exc
    except json.JSONDecodeError as exc:
        raise ElexonAPIError(f"Elexon returned non-JSON response: {exc}", url=url) from exc

    records = body.get("data", body) if isinstance(body, dict) else body
    if not isinstance(records, list):
        raise ElexonAPIError(f"Unexpected Elexon response shape from {url}", url=url)

    _cache_set(cache_key, records)
    return records


def _daterange_chunks(start: datetime, end: datetime, max_days: int = 31):
  cur = start
  # Use <= and ensure chunks span through the end date inclusively
  while cur <= end:
    chunk_end = min(cur + timedelta(days=max_days), end)
    yield cur, chunk_end
    if cur == end:
      break
    cur = chunk_end + timedelta(seconds=1)


def fetch_fuelhh_wind(settlement_date_from: str, settlement_date_to: str) -> list[dict]:
  """Actual half-hourly wind generation (FUELHH, fuelType == WIND)."""
  # Parse start at midnight, and push end to the end of the settlement date (23:59:59)
  start = datetime.fromisoformat(settlement_date_from).replace(hour=0, minute=0, second=0, microsecond=0)
  end = datetime.fromisoformat(settlement_date_to).replace(hour=23, minute=59, second=59, microsecond=999999)
  
  url = f"{ELEXON_BASE_URL}/datasets/FUELHH"
  all_records: list[dict] = []
  
  for chunk_start, chunk_end in _daterange_chunks(start, end, max_days=7):
    params = {
        "settlementDateFrom": chunk_start.strftime("%Y-%m-%d"),
        "settlementDateTo": chunk_end.strftime("%Y-%m-%d"),
    }
    records = _get(url, params)
    all_records.extend(r for r in records if str(r.get("fuelType", "")).upper() == "WIND")
    
  return all_records


def fetch_windfor(publish_from: str, publish_to: str) -> list[dict]:
  """Wind generation forecast (WINDFOR), windowed by publishTime."""
  start = datetime.fromisoformat(publish_from)
  
  # If publish_to is just a date string (length 10 like '2025-12-31'), make it inclusive of the whole day
  if len(publish_to) == 10:
    end = datetime.fromisoformat(publish_to).replace(hour=23, minute=59, second=59, microsecond=999999)
  else:
    end = datetime.fromisoformat(publish_to)

  url = f"{ELEXON_BASE_URL}/datasets/WINDFOR"
  all_records: list[dict] = []
  
  for chunk_start, chunk_end in _daterange_chunks(start, end, max_days=7):
    params = {
        "publishDateTimeFrom": chunk_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "publishDateTimeTo": chunk_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    records = _get(url, params)
    all_records.extend(records)
    
  return all_records