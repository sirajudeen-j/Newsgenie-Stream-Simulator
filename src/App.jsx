import { useState, useRef, useCallback } from 'react'
import ServerConfig from './components/ServerConfig'
import StartStream from './components/StartStream'
import VideoStreaming from './components/VideoStreaming'
import TelemetryPanel from './components/TelemetryPanel'
import UploadPanel from './components/UploadPanel'
import EventLog from './components/EventLog'
import AuditResultCard from './components/AuditResultCard'
import './App.css'

const formatTime = () => {
  const d = new Date()
  return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

const DEFAULT_UPLOADER = '1b7b7603-ad49-44a7-8df7-09e3cc1b1cfb'
const DEFAULT_INCIDENT = ''

export default function App() {
  const [backendUrl, setBackendUrl] = useState('https://dev.staging.newsgenie.ai')
  const [sessionId, setSessionId] = useState(null)
  const [videoId, setVideoId] = useState(null)
  const [mode, setMode] = useState('STREAMING')
  const [uploaderId, setUploaderId] = useState(DEFAULT_UPLOADER)
  const [incidentId, setIncidentId] = useState(DEFAULT_INCIDENT)
  const [logs, setLogs] = useState([])
  const [wsStatus, setWsStatus] = useState('IDLE')
  const [auditResults, setAuditResults] = useState([])
  const addAuditResult = useCallback((result) => {
    setAuditResults(prev => [result, ...prev])
  }, [])
  const wsRef = useRef(null)

  const [telemetry, setTelemetry] = useState({
    device_lat: 12.8420, device_lon: 80.2260,
    geo_accuracy_m: 15.0, network_time_offset_ms: 50,
    device_manufacturer: 'Samsung', device_model: 'Galaxy S24',
    android_sdk: 34, android_release: '14', capture_mode: 'STREAMING',
    claimed_time: new Date().toISOString().slice(0, 19),
    enable_injection: false,
    strip_audio: false,
    preserve_fingerprint: false,
    proxy_url: 'https://ratings-kai-evolution-brings.trycloudflare.com', // Active Cloudflare Tunnel
  })

  /**
   * Universal Fetch Wrapper that relays through the Proxy if needed.
   * This is how we bypass the VPN on mobile!
   */
  const proxyFetch = useCallback(async (path, options = {}) => {
    const isRelayNeeded = telemetry.proxy_url && telemetry.proxy_url.startsWith('http')
    
    let url = `${backendUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
    const headers = { ...(options.headers || {}) }

    if (isRelayNeeded) {
      // Use the Relay on the Proxy! 
      // Clean up the proxy URL to ensure it's just the base (no trailing /health or /relay)
      const proxyBase = telemetry.proxy_url
        .replace(/\/+$/, '')
        .replace(/\/health$/, '')
        .replace(/\/relay$/, '')
      
      url = `${proxyBase}/relay/${path.replace(/^\/+/, '')}`
      headers['X-Backend-Base'] = backendUrl
      addLog(`Relaying call to BE via Proxy: ${path}`, 'debug')
    }

    return fetch(url, { ...options, headers })
  }, [backendUrl, telemetry.proxy_url])

  const addLog = useCallback((msg, cls = 'info') => {
    setLogs(prev => [...prev, { ts: formatTime(), msg, cls }])
  }, [])

  const clearLog = useCallback(() => setLogs([]), [])

  const resetAll = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} }
    wsRef.current = null
    setSessionId(null)
    setVideoId(null)
    setUploaderId(DEFAULT_UPLOADER)
    setIncidentId(DEFAULT_INCIDENT)
    setMode('STREAMING')
    setWsStatus('IDLE')
    setLogs([])
    setAuditResults([])
  }, [])

  return (
    <div className="container">
      <div className="premium-header">
        <div className="header-brand">
          <div className="logo-icon">NG</div>
          <div>
            <h1 className="title">NewsGenie Narrative Integrity Simulator</h1>
            <p className="subtitle">High-Fidelity Forensic Testing & Stream Validation Engine</p>
          </div>
        </div>
        <div className="header-actions">
          <div className={`proxy-status ${wsStatus !== 'WS ERROR' ? 'online' : 'offline'}`}>
            <span className="pulse-dot"></span>
            FORENSIC PROXY: {wsStatus !== 'WS ERROR' ? 'ACTIVE' : 'OFFLINE'}
          </div>
          <button className="btn btn-danger" onClick={resetAll}>Factory Reset</button>
        </div>
      </div>
      
      {auditResults.length > 0 && (
        <div className="audit-results-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, color: '#e2e8f0' }}>Live Audit Results ({auditResults.length})</h3>
            <button className="btn btn-secondary" onClick={() => setAuditResults([])}>Clear All</button>
          </div>
          {auditResults.map((result, i) => (
            <AuditResultCard key={i} result={result} onClear={() => setAuditResults(prev => prev.filter((_, idx) => idx !== i))} />
          ))}
        </div>
      )}

      <div className="grid">
        <div className="col">
          <ServerConfig 
            backendUrl={backendUrl} setBackendUrl={setBackendUrl} 
            telemetry={telemetry} setTelemetry={setTelemetry}
            proxyFetch={proxyFetch}
            addLog={addLog}
          />
          <StartStream
            backendUrl={backendUrl} uploaderId={uploaderId} setUploaderId={setUploaderId}
            incidentId={incidentId} setIncidentId={setIncidentId}
            mode={mode} setMode={setMode}
            sessionId={sessionId} setSessionId={setSessionId}
            setVideoId={setVideoId} addLog={addLog}
            setWsStatus={setWsStatus} telemetry={telemetry} setTelemetry={setTelemetry}
            proxyFetch={proxyFetch}
          />
          <VideoStreaming
            backendUrl={backendUrl}
            sessionId={sessionId} setSessionId={setSessionId}
            videoId={videoId} uploaderId={uploaderId} mode={mode}
            wsRef={wsRef} wsStatus={wsStatus} setWsStatus={setWsStatus}
            telemetry={telemetry} addLog={addLog} clearLog={clearLog}
            setAuditResult={addAuditResult}
            proxyFetch={proxyFetch}
          />
        </div>
        <div className="col">
          <UploadPanel
            backendUrl={backendUrl}
            uploaderId={uploaderId} incidentId={incidentId}
            telemetry={telemetry} addLog={addLog}
            setAuditResult={addAuditResult}
            proxyFetch={proxyFetch}
          />
          <TelemetryPanel telemetry={telemetry} setTelemetry={setTelemetry} mode={mode} />
        </div>
        <div className="col">
          <EventLog logs={logs} clearLog={clearLog} />
        </div>
      </div>
    </div>
  )
}
