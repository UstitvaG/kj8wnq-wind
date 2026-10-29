"""
Configuration & domain constants for the Day-Ahead Wind Procurement Support tool.

Key domain assumption (documented for the client/tech-lead):
---------------------------------------------------------------
GB day-ahead power is bought on D-1 for delivery on day D. The main day-ahead
auction (N2EX/EPEX) gate-closes at 11:00 UK local time on D-1. A buyer forming
their purchase view therefore should use the LATEST wind forecast (WINDFOR)
that was *published* at or before that gate-closure time. We call this the
"decision cutoff" and it is configurable below (DECISION_CUTOFF_HOUR_LOCAL).

All times from Elexon are UTC (ISO 8601, "Z"-suffixed). UK local time in
January is UTC+0 (GMT, no BST in winter), so no DST conversion is needed for
the January 2026 scope of this build -- this is called out explicitly so it
is not silently wrong if the scope ever expands to summer months.
"""
import os

ELEXON_BASE_URL = os.getenv("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")

# Decision point: hour (UK local / UTC in Jan) on D-1 by which the forecast
# used for the buy decision must have been published.
DECISION_CUTOFF_HOUR_LOCAL = int(os.getenv("DECISION_CUTOFF_HOUR_LOCAL", "11"))

# Scope of this build, per the requirements doc.
SCOPE_START_DATE = "2026-01-01"  # first delivery day considered
SCOPE_END_DATE = "2026-01-31"    # last delivery day considered

CACHE_DIR = os.getenv("CACHE_DIR", "/app/.cache")

# Simple on-disk cache so repeated requests for the same (static, historical)
# January 2026 window don't re-hit the Elexon API every time the frontend
# polls. Cache entries are content-addressed by the request window.
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", str(6 * 3600)))
