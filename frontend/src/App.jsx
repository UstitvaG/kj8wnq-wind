import React, { useState } from 'react'
import DecisionView from './components/DecisionView.jsx'
import AccuracyView from './components/AccuracyView.jsx'

export default function App() {
  const [tab, setTab] = useState('decision')

  return (
    <>
      <header className="app-header">
        <div>
          <h1>GB Wind Day-Ahead Procurement Support</h1>
          <p>
            Reconstruct the wind forecast available at the day-ahead cutoff, then quantify historical error and downside shortfall risk. This pilot is a historical decision-support view, not a live forecast or an automated buy recommendation.
          </p>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'decision' ? 'active' : ''} onClick={() => setTab('decision')}>
          Decision View
        </button>
        <button className={tab === 'accuracy' ? 'active' : ''} onClick={() => setTab('accuracy')}>
          Forecast Accuracy
        </button>
      </nav>

      {tab === 'decision' ? <DecisionView /> : <AccuracyView />}

      <footer>
        Data source: Elexon BMRS Insights API (WINDFOR forecast; FUELHH actual, fuelType WIND). Historical scope: January 2026 only. Decision cutoff configured as 11:00 UTC on D−1 for this January scope. Downside statistics describe the observed sample and are not guaranteed future outcomes.
      </footer>
    </>
  )
}
