import React, { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api.js'

function intensity(value, max) {
  if (value == null || !Number.isFinite(Number(value))) return 0
  if (!max) return 1
  const ratio = Number(value) / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

export default function AccuracyView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.accuracy()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) return <div className="error-box">{error}</div>
  if (loading) return <div className="loading">Calculating decision-time error from January 2026 history…</div>
  if (!data) return null

  const { overall, byDay, byHorizon } = data
  const maxMae = Math.max(0, ...byHorizon.map((row) => Number(row.mae) || 0))
  const p90 = overall.downsideP90
  const downsideShare = overall.downsideShare

  return (
    <>
      <div className="decision-cutoff accuracy-hero">
        <div className="cutoff-topline"><span className="eyebrow">Forecast validation · Decision-time only</span><span className="scope-pill">01–31 Jan 2026</span></div>
        <div className="cutoff-title">How much error should the buyer plan around?</div>
        <p className="cutoff-description">These metrics use the latest forecast that was available by the configured day-ahead cutoff, not a later forecast selected with hindsight. They describe historical performance; they are not a guarantee for the next delivery day.</p>
      </div>

      <div className="panel">
        <div className="panel-heading-row">
          <div><div className="eyebrow">Historical baseline</div><h2>Decision-point forecast accuracy</h2></div>
          <span className="scope-pill">{overall.count} matched periods</span>
        </div>
        <div className="metrics-grid">
          <div className="metric-card"><div className="label">MAE</div><div className="value">{overall.mae ?? '—'} <small>MW</small></div><div className="metric-foot">Average absolute error</div></div>
          <div className="metric-card"><div className="label">RMSE</div><div className="value">{overall.rmse ?? '—'} <small>MW</small></div><div className="metric-foot">Penalises larger misses</div></div>
          <div className="metric-card"><div className="label">MAPE</div><div className="value">{overall.mape ?? '—'}<small>%</small></div><div className="metric-foot">Excludes near-zero actual wind</div></div>
          <div className="metric-card"><div className="label">Signed bias</div><div className={`value ${(overall.bias ?? 0) < 0 ? 'value-risk' : 'value-neutral'}`}>{overall.bias == null ? '—' : `${overall.bias > 0 ? '+' : ''}${overall.bias}`} <small>MW</small></div><div className="metric-foot">Actual − forecast</div></div>
        </div>
        <div className="risk-summary">
          <div><div className="label">P90 wind shortfall</div><div className="risk-number">{p90 == null ? '—' : `${p90} MW`}</div><p className="note">90th percentile of positive forecast-minus-actual shortfalls. On the observed sample, 90% of periods had a shortfall no greater than this value; periods with actual above forecast contribute zero shortfall.</p></div>
          <div className="risk-divider" />
          <div><div className="label">Periods with wind below forecast</div><div className="risk-number">{downsideShare == null ? '—' : `${downsideShare}%`}</div><p className="note">Share of matched half-hourly periods where actual wind generation was below the forecast.</p></div>
        </div>
        <p className="note">Interpretation: negative signed bias means actual generation averaged below forecast, a direction that can increase residual thermal requirements. Positive bias means actual wind averaged above forecast. Use MAE for typical absolute error and the shortfall statistic to examine downside exposure.</p>
      </div>

      <div className="panel">
        <div className="panel-heading-row"><div><div className="eyebrow">Forecast horizon</div><h2>Where is forecast error highest?</h2></div><span className="scope-pill">MAE by 6-hour bucket</span></div>
        <p className="note">Each cell represents a forecast lead-time bucket. Darker amber indicates higher MAE relative to the largest bucket in this sample. This is a relative comparison, not a risk threshold.</p>
        <div className="horizon-heatmap" role="list" aria-label="Mean absolute error by forecast horizon">
          {byHorizon.map((row) => (
            <div className="horizon-cell-wrap" role="listitem" key={row.bucket}>
              <div className="horizon-cell-label">{row.bucket} h</div>
              <div className={`horizon-cell heat-${intensity(row.mae, maxMae)}`} title={`${row.bucket} hours ahead: MAE ${row.mae ?? 'not available'} MW`}>
                <strong>{row.mae ?? '—'}</strong><span>MW MAE</span>
              </div>
              <div className="horizon-cell-meta">n={row.count}</div>
            </div>
          ))}
        </div>
        <div className="heatmap-legend"><span>Lower MAE</span><span className="legend-ramp"><i className="heat-1"/><i className="heat-2"/><i className="heat-3"/><i className="heat-4"/></span><span>Higher MAE</span></div>
      </div>

      <div className="panel">
        <div className="panel-heading-row"><div><div className="eyebrow">Stability over time</div><h2>Daily accuracy trend</h2></div></div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={byDay} margin={{ top: 10, right: 20, left: 4, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 5" stroke="var(--gridline)" />
            <XAxis dataKey="deliveryDate" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} minTickGap={20} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }} label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: 'var(--text-dim)' }} />
            <Tooltip contentStyle={{ background: '#20242a', border: '1px solid #454b55', borderRadius: 3 }} labelStyle={{ color: '#edf0f4' }} />
            <Legend />
            <Line type="monotone" dataKey="mae" name="MAE" stroke="var(--actual)" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="bias" name="Bias (actual − forecast)" stroke="var(--forecast)" strokeWidth={2} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <div className="panel-heading-row"><div><div className="eyebrow">Audit detail</div><h2>Daily accuracy table</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Delivery date</th><th>Periods</th><th>MAE (MW)</th><th>RMSE (MW)</th><th>MAPE (%)</th><th>Bias (MW)</th><th>Downside P90 (MW)</th></tr></thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.deliveryDate}>
                  <td>{d.deliveryDate}</td><td>{d.count}</td><td>{d.mae ?? '—'}</td><td>{d.rmse ?? '—'}</td><td>{d.mape ?? '—'}</td><td className={(d.bias ?? 0) < 0 ? 'negative-number' : 'positive-number'}>{d.bias == null ? '—' : `${d.bias > 0 ? '+' : ''}${d.bias}`}</td><td>{d.downsideP90 ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
