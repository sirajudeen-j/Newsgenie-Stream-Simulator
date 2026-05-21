import { useState, useRef, useCallback } from 'react'
import ServerConfig from './components/ServerConfig'
import StartStream from './components/StartStream'
import VideoStreaming from './components/VideoStreaming'
import TelemetryPanel from './components/TelemetryPanel'
import UploadPanel from './components/UploadPanel'
import EventLog from './components/EventLog'
import AuditResultCard from './components/AuditResultCard'
import TrustIndexCalculator from './components/TrustIndexCalculator'
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
  const [userType, setUserType] = useState('normal')
  const [eventType, setEventType] = useState('Crime')
  const [logs, setLogs] = useState([])
  const [wsStatus, setWsStatus] = useState('IDLE')
  const [auditResults, setAuditResults] = useState([])
  const [latestScores, setLatestScores] = useState(null)
  const wsRef = useRef(null)

  const addAuditResult = useCallback((result) => {
    setAuditResults(prev => [result, ...prev])
  }, [])

  const [telemetry, setTelemetry] = useState({
    device_lat: 12.8420, device_lon: 80.2260,
    geo_accuracy_m: 15.0, network_time_offset_ms: 50,
    device_manufacturer: 'Samsung', device_model: 'Galaxy S24',
    android_sdk: 34, android_release: '14', capture_mode: 'STREAMING',
    claimed_location_caption: 'Chennai, Tamil Nadu',
    claimed_time: new Date().toISOString().slice(0, 16),
    enable_injection: false,
    strip_audio: false,
    preserve_fingerprint: false,
  })

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
    setUserType('normal')
    setEventType('Crime')
    setMode('STREAMING')
    setWsStatus('IDLE')
    setLogs([])
    setAuditResults([])
  }, [])

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
        <h1 className="title" style={{ marginBottom: 0 }}>NewsGenie Stream Simulator</h1>
        <button className="btn btn-danger" onClick={resetAll} style={{ marginLeft: 'auto' }}>Reset All</button>
      </div>
      <p className="subtitle">
        Simulate live WebSocket streaming or CLIP upload. Video files are sent directly to the backend.
      </p>

      {auditResults.length > 0 && (
        <div className="audit-results-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Live Audit Results ({auditResults.length})</h3>
            <button className="btn btn-secondary" onClick={() => setAuditResults([])}>Clear All</button>
          </div>
          {auditResults.map((result, i) => (
            <AuditResultCard key={i} result={result} onClear={() => setAuditResults(prev => prev.filter((_, idx) => idx !== i))} />
          ))}
        </div>
      )}

      <div className="grid">
        <div className="col">
          <ServerConfig backendUrl={backendUrl} setBackendUrl={setBackendUrl} addLog={addLog} />
          <StartStream
            backendUrl={backendUrl} uploaderId={uploaderId} setUploaderId={setUploaderId}
            incidentId={incidentId} setIncidentId={setIncidentId}
            userType={userType} setUserType={setUserType}
            eventType={eventType} setEventType={setEventType}
            mode={mode} setMode={setMode}
            sessionId={sessionId} setSessionId={setSessionId}
            setVideoId={setVideoId} addLog={addLog}
            setWsStatus={setWsStatus} telemetry={telemetry} setTelemetry={setTelemetry}
          />
          <VideoStreaming
            backendUrl={backendUrl}
            sessionId={sessionId} setSessionId={setSessionId}
            videoId={videoId} uploaderId={uploaderId}
            userType={userType} eventType={eventType}
            mode={mode}
            wsRef={wsRef} wsStatus={wsStatus} setWsStatus={setWsStatus}
            telemetry={telemetry} addLog={addLog} clearLog={clearLog}
            setAuditResult={addAuditResult}
            setLatestScores={setLatestScores}
          />
        </div>
        <div className="col">
          <UploadPanel
            backendUrl={backendUrl}
            uploaderId={uploaderId} incidentId={incidentId}
            userType={userType} eventType={eventType}
            telemetry={telemetry} addLog={addLog}
            setAuditResult={addAuditResult}
            setLatestScores={setLatestScores}
          />
          <TelemetryPanel telemetry={telemetry} setTelemetry={setTelemetry} mode={mode} />
          <TrustIndexCalculator latestScores={latestScores} />
        </div>
        <div className="col">
          <EventLog logs={logs} clearLog={clearLog} />
        </div>
      </div>
    </div>
  )
}
