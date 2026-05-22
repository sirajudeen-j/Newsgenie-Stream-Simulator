import React, { useState, useMemo, useEffect } from 'react'

const WEIGHTS = {
  mas: 7.5,
  cis: 7.5,
  srs: 10,
  ndi: 37.5,
  eis: 37.5,
}

export default function TrustIndexCalculator({ latestScores }) {
  const [scores, setScores] = useState({ mas: 0, cis: 0, srs: 0, ndi: 0, eis: 0 })

  // Auto-populate from latest response (NDI displayed as original)
  useEffect(() => {
    if (latestScores) {
      setScores(prev => ({
        mas: latestScores.mas_score ?? prev.mas,
        cis: latestScores.cis_score ?? prev.cis,
        srs: latestScores.srs_score ?? prev.srs,
        ndi: latestScores.ndi_score ?? prev.ndi,
        eis: latestScores.eis_score ?? prev.eis,
      }))
    }
  }, [latestScores])

  const set = (key, val) => setScores(prev => ({ ...prev, [key]: Math.min(100, Math.max(0, Number(val) || 0)) }))

  const ti = useMemo(() => {
    const invertedNdi = 100 - scores.ndi
    return (
      (scores.mas * WEIGHTS.mas +
        scores.cis * WEIGHTS.cis +
        scores.srs * WEIGHTS.srs +
        invertedNdi * WEIGHTS.ndi +
        scores.eis * WEIGHTS.eis) / 100
    )
  }, [scores])

  const tiColor = ti >= 70 ? '#4ade80' : '#f87171'

  return (
    <div className="panel">
      <h2>Trust Index Calculator</h2>
      <p className="note">Auto-filled from response. Edit manually to simulate.</p>
      <div className="row">
        <div><label>MAS (7.5%)</label><input type="number" min="0" max="100" value={scores.mas} onChange={e => set('mas', e.target.value)} /></div>
        <div><label>CIS (7.5%)</label><input type="number" min="0" max="100" value={scores.cis} onChange={e => set('cis', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>SRS (10%)</label><input type="number" min="0" max="100" value={scores.srs} onChange={e => set('srs', e.target.value)} /></div>
        <div><label>NDI (37.5%)</label><input type="number" min="0" max="100" value={scores.ndi} onChange={e => set('ndi', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>EIS (37.5%)</label><input type="number" min="0" max="100" value={scores.eis} onChange={e => set('eis', e.target.value)} /></div>
      </div>
      <div style={{
        marginTop: 16, padding: 16, borderRadius: 8,
        background: ti >= 70 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
        border: `2px solid ${tiColor}`,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>Trust Index (TI)</div>
        <div style={{ fontSize: 36, fontWeight: 'bold', color: tiColor }}>
          {ti.toFixed(2)}
        </div>
        <div style={{ fontSize: 12, color: tiColor }}>
          {ti >= 70 ? 'TRUSTED' : 'UNTRUSTED'}
        </div>
      </div>
    </div>
  )
}
