import React from 'react'

export default function AuditResultCard({ result, onClear }) {
  const statusColor = {
    'PASS': '#4ade80',
    'SOFT_REJECT': '#facc15',
    'HARD_REJECT': '#f87171',
  }[result.policy_status] || '#94a3b8'

  return (
    <div className="audit-card" style={{ borderLeft: `4px solid ${statusColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', color: statusColor }}>{result.policy_status}</span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          {result.segment_index ? `Seg #${result.segment_index}` : 'Upload'} — {result.timestamp}
        </span>
        {onClear && <button className="btn-mini" onClick={onClear}>×</button>}
      </div>
      {result.reason && <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>{result.reason}</div>}
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
        {result.mas_score != null && <span>MAS: {result.mas_score}</span>}
        {result.cis_score != null && <span>CIS: {result.cis_score}</span>}
        {result.srs_score != null && <span>SRS: {result.srs_score}</span>}
        {result.ndi_score != null && <span>NDI: {result.ndi_score}</span>}
        {result.eis_score != null && <span>EIS: {result.eis_score}</span>}
        {result.ti_score != null && <span style={{ fontWeight: 'bold' }}>TI: {result.ti_score}</span>}
      </div>
    </div>
  )
}
