import React, { useState } from 'react'

const URL_OPTIONS = [
  { label: 'Dev (staging)', value: 'https://dev.staging.newsgenie.ai' },
  { label: 'UAT (staging)', value: 'https://uat.staging.newsgenie.ai' },
  { label: 'Localhost:8080', value: 'http://localhost:8080' },
]

export default function ServerConfig({ backendUrl, setBackendUrl, addLog }) {
  const [health, setHealth] = useState('UNKNOWN')

  const checkHealth = async () => {
    setHealth('CHECKING...')
    try {
      const r = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/healthCheck`)
      if (r.ok) {
        setHealth('HEALTHY ✓')
        addLog('Backend Health Check: OK', 'recv')
      } else {
        setHealth(`FAILED (${r.status})`)
        addLog(`Backend Health Check: FAILED (Status ${r.status})`, 'error')
      }
    } catch (e) {
      setHealth('ERROR')
      addLog(`Backend Health Check: ERROR (${e.message})`, 'error')
    }
  }

  return (
    <div className="panel">
      <h2>Server Config</h2>
      <label>Backend URL</label>
      <select value={URL_OPTIONS.find(o => o.value === backendUrl) ? backendUrl : '__custom'}
        onChange={e => { if (e.target.value !== '__custom') setBackendUrl(e.target.value) }}>
        {URL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {!URL_OPTIONS.find(o => o.value === backendUrl) && <option value="__custom">Custom</option>}
      </select>
      <input value={backendUrl} onChange={e => setBackendUrl(e.target.value)} placeholder="Or type custom URL" />
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={checkHealth}>Check Backend Health</button>
        <span style={{
          marginLeft: 10, fontWeight: 'bold',
          color: health.includes('HEALTHY') ? '#4ade80' : health === 'ERROR' || health.includes('FAILED') ? '#f87171' : '#94a3b8'
        }}>
          {health}
        </span>
      </div>
    </div>
  )
}
