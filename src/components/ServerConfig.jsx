import React from 'react'

export default function ServerConfig({ backendUrl, setBackendUrl, telemetry, setTelemetry, proxyFetch, addLog }) {
  const [health, setHealth] = React.useState('UNKNOWN')

  const checkHealth = async () => {
    setHealth('CHECKING...')
    try {
      // This path is relayed through your proxy!
      const r = await proxyFetch('/api/healthCheck')
      if (r.ok) {
        setHealth('HEALTHY ✓')
        addLog('Backend Health Check: OK', 'success')
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
      <label>Backend URL (Staging)</label>
      <input value={backendUrl} onChange={e => setBackendUrl(e.target.value)} />
      
      <label>Forensic Proxy URL (Local/Cloudflare)</label>
      <input 
        value={telemetry.proxy_url || ''} 
        placeholder="https://...trycloudflare.com"
        onChange={e => setTelemetry(prev => ({ ...prev, proxy_url: e.target.value }))} 
      />

      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={checkHealth}>Check Backend Health</button>
        <span style={{ 
          marginLeft: 10, 
          fontWeight: 'bold', 
          color: health.includes('HEALTHY') ? '#4ade80' : health === 'ERROR' || health.includes('FAILED') ? '#f87171' : '#94a3b8' 
        }}>
          {health}
        </span>
      </div>
    </div>
  )
}
