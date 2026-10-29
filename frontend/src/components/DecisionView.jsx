import React, { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api.js'

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })
}

function fmtClock(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
}

export default function DecisionView() {
  const [days, setDays] = useState([])
  const [scope, setScope] = useState(null)
  const [selected, setSelected] = useState('')
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.decisionDays()
      .then((d) => {
        setDays(d.deliveryDates || [])
        setScope(d.scope || null)
        setSelected(d.deliveryDates?.[0] || '')
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setError(null)
    setView(null)
    api.decisionView(selected)
      .then(setView)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selected])

  const chartData = useMemo(() => {
    if (!view) return []
    return view.periods.map((p) => ({
      time: fmtClock(p.startTime),
      Forecast: p.forecastMw,
      Actual: p.actualMw,
      forecastPublishTime: p.forecastPublishTime,
      forecastHorizonHours: p.forecastHorizonHours,
    }))
  }, [view])

  const summary = useMemo(() => {
    if (!view) return null
    const forecastPeriods = view.periods.filter((p) => p.forecastMw !== null && p.forecastMw !== undefined)
    const matchedPeriods = view.periods.filter((p) => p.errorMw !== null && p.errorMw !== undefined)
    const totalForecastMwh = matchedPeriods.reduce((s, p) => s + p.forecastMw, 0) / 2
    const totalActualMwh = matchedPeriods.reduce((s, p) => s + p.actualMw, 0) / 2
    const netErrorMwh = matchedPeriods.reduce((s, p) => s + p.errorMw, 0) / 2
    const publishTimes = forecastPeriods.map((p) => p.forecastPublishTime).filter(Boolean).sort()
    const missingForecast = Math.max(0, 48 - forecastPeriods.length)
    const missingActual = Math.max(0, 48 - matchedPeriods.length)
    return {
      totalForecastMwh, totalActualMwh, netErrorMwh,
      forecastCount: forecastPeriods.length,
      matchedCount: matchedPeriods.length,
      missingForecast, missingActual,
      earliestPublish: publishTimes[0] || null,
      latestPublish: publishTimes[publishTimes.length - 1] || null,
      shortfallPeriods: matchedPeriods.filter((p) => p.errorMw < 0).length,
    }
  }, [view])

  return (
    <>
      <div className="decision-cutoff">
        <div className="cutoff-topline">
          <span className="eyebrow">Decision-time snapshot · Historical reconstruction</span>
          <span className="scope-pill">{scope ? `${scope.from} — ${scope.to}` : 'Historical scope'}</span>
        </div>
        <div className="cutoff-title">What was knowable at the buying cutoff?</div>
        <p className="cutoff-description">
          Select a delivery date to reconstruct the latest wind forecast published by the 11:00 UTC cutoff on D−1.
          Actual generation is shown only for comparison after delivery.
        </p>
        <div className="decision-controls">
          <label htmlFor="delivery-date">Delivery date</label>
          <select id="delivery-date" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {days.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {view && <div className="cutoff-stamp"><span>Decision cutoff</span><strong>{fmtTime(view.decisionCutoff)}</strong></div>}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="loading">Loading the decision-time forecast and settled outturn…</div>}

      {view && !loading && summary && (
        <>
          <div className="panel">
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">Delivery profile</div>
                <h2>{view.deliveryDate} · National wind generation</h2>
              </div>
              <span className="scope-pill">30-minute periods · MW</span>
            </div>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="label">Forecast energy · matched periods</div>
                <div className="value">{summary.totalForecastMwh.toLocaleString('en-GB', { maximumFractionDigits: 0 })} <small>MWh</small></div>
                <div className="metric-foot">{summary.forecastCount}/48 periods with forecasts</div>
              </div>
              <div className="metric-card">
                <div className="label">Actual energy observed</div>
                <div className="value">{summary.matchedCount ? `${summary.totalActualMwh.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ` : '—'}<small>{summary.matchedCount ? 'MWh' : 'pending'}</small></div>
                <div className="metric-foot">{summary.matchedCount}/48 periods matched</div>
              </div>
              <div className="metric-card metric-card-wide">
                <div className="label">Net error · actual − forecast</div>
                <div className={`value ${summary.netErrorMwh < 0 ? 'value-risk' : 'value-neutral'}`}>
                  {summary.matchedCount ? `${summary.netErrorMwh > 0 ? '+' : ''}${summary.netErrorMwh.toFixed(0)} ` : '—'}<small>{summary.matchedCount ? 'MWh' : ''}</small>
                </div>
                <div className="metric-foot">
                  {summary.matchedCount
                    ? summary.netErrorMwh < 0 ? 'Actual wind below forecast · potential thermal shortfall' : summary.netErrorMwh > 0 ? 'Actual wind above forecast · potential thermal overbuy' : 'Actual energy matched forecast'
                    : 'Waiting for matched actuals'}
                </div>
              </div>
            </div>
            <div className="data-quality-row">
              <div><span className="status-dot" /> Latest forecast publication in profile <strong>{fmtTime(summary.latestPublish)}</strong></div>
              <div>Forecast gaps <strong>{summary.missingForecast}</strong></div>
              <div>Unmatched actual periods <strong>{summary.missingActual}</strong></div>
            </div>
            <p className="note">
              Sign convention matters: negative error means actual wind was below forecast (wind over-forecast risk),
              which can leave a larger residual thermal requirement. Positive error means actual wind exceeded forecast.
              This is a historical reconstruction for the selected date, not a live forecast for an upcoming delivery day.
            </p>
          </div>

          <div className="panel">
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">Settlement-period comparison</div>
                <h2>Forecast vs actual · half-hourly</h2>
              </div>
              <div className="chart-key"><span className="key-dash" /> Forecast <span className="key-solid" /> Actual</div>
            </div>
            <p className="note">Dashed amber = forecast available at the decision cutoff. Solid light line = settled actual outturn.</p>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 4, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 5" stroke="var(--gridline)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} minTickGap={30} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: 'var(--text-dim)' }} />
                <Tooltip contentStyle={{ background: '#20242a', border: '1px solid #454b55', borderRadius: 3 }} labelStyle={{ color: '#edf0f4' }} formatter={(value, name) => [value == null ? 'No data' : `${Number(value).toLocaleString('en-GB')} MW`, name]} />
                <Legend />
                <Line type="monotone" dataKey="Forecast" stroke="var(--forecast)" strokeDasharray="7 5" dot={false} strokeWidth={2.2} connectNulls={false} />
                <Line type="monotone" dataKey="Actual" stroke="var(--actual)" dot={false} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <div className="panel-heading-row">
              <div><div className="eyebrow">Audit trail</div><h2>Forecast publication coverage</h2></div>
            </div>
            <p className="note">Each row shows the selected forecast's publication time for that settlement period. A publication later than the cutoff must never be used in this historical decision view.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Period start (UTC)</th><th>Forecast (MW)</th><th>Published (UTC)</th><th>Horizon (h)</th><th>Actual (MW)</th><th>Error (MW)</th></tr></thead>
                <tbody>
                  {view.periods.map((p) => (
                    <tr key={p.startTime}>
                      <td>{fmtTime(p.startTime)}</td>
                      <td>{p.forecastMw ?? '—'}</td>
                      <td>{fmtTime(p.forecastPublishTime)}</td>
                      <td>{p.forecastHorizonHours ?? '—'}</td>
                      <td>{p.actualMw ?? '—'}</td>
                      <td className={p.errorMw < 0 ? 'negative-number' : p.errorMw > 0 ? 'positive-number' : ''}>{p.errorMw == null ? '—' : `${p.errorMw > 0 ? '+' : ''}${p.errorMw}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
