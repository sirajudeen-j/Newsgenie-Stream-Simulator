import React from 'react'

export default function AuditResultCard({ result, onClear }) {
  if (!result) return null

  const { policy_status, reason, ndi_score, eis_score, mas_score, cis_score, srs_score, ti_score, context, segment_index, timestamp } = result
  
  const getStatusConfig = () => {
    switch (policy_status) {
      case 'PASS': return { color: '#4CAF50', label: 'PASS', icon: '✅' }
      case 'HARD_REJECT': case 'FAIL': return { color: '#F44336', label: 'REJECTED', icon: '❌' }
      case 'URGENT_REVIEW': case 'REVIEW': return { color: '#FF9800', label: 'REVIEW', icon: '⚠️' }
      case 'RESTRICT': return { color: '#9C27B0', label: 'RESTRICTED', icon: '🔒' }
      default: return { color: '#757575', label: policy_status || '?', icon: '?' }
    }
  }

  const config = getStatusConfig()

  return (
    <div className="audit-card" style={{ borderColor: config.color, marginBottom: 8 }}>
      <div className="audit-header" style={{ backgroundColor: config.color, padding: '6px 12px' }}>
        <span style={{ fontWeight: 'bold' }}>
          {config.icon} {config.label}
          {segment_index && <span style={{ opacity: 0.8, marginLeft: 8 }}>Seg #{segment_index}</span>}
          {timestamp && <span style={{ opacity: 0.6, marginLeft: 8, fontSize: '0.8em' }}>{timestamp}</span>}
        </span>
        <button className="close-btn" onClick={onClear}>&times;</button>
      </div>
      <div className="audit-body" style={{ padding: '8px 12px' }}>
        <div className="metrics-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          {ndi_score != null && <span className="metric-pill" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em' }}>NDI: {ndi_score}</span>}
          {eis_score != null && <span className="metric-pill" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em' }}>EIS: {eis_score}</span>}
          {mas_score != null && <span className="metric-pill" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em' }}>MAS: {mas_score}</span>}
          {cis_score != null && <span className="metric-pill" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em' }}>CIS: {cis_score}</span>}
          {srs_score != null && <span className="metric-pill" style={{ background: '#1e293b', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em' }}>SRS: {srs_score}</span>}
          {ti_score != null && <span className="metric-pill" style={{ background: '#0f172a', padding: '2px 8px', borderRadius: 4, fontSize: '0.85em', fontWeight: 'bold' }}>TI: {ti_score}</span>}
        </div>
        {context && <p style={{ margin: '4px 0', fontSize: '0.85em', color: '#94a3b8' }}>{context}</p>}
        {reason && <p style={{ margin: '4px 0', fontSize: '0.8em', color: '#64748b' }}>{reason}</p>}
      </div>
    </div>
  )
}
