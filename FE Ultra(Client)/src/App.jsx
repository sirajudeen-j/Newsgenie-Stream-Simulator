import { useState, useRef, useCallback } from 'react'
import ServerConfig from './components/ServerConfig'
import StartStream from './components/StartStream'
import VideoStreaming from './components/VideoStreaming'
import TelemetryPanel from './components/TelemetryPanel'
import L1AnalysisPanel from './components/L1AnalysisPanel'
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

  const [l1Config, setL1Config] = useState({
    enabled: true,
    status: 'Pending',
    newsworthy: true,
    confidence: 0.72,
    categories: ['fire_emergency', 'crowd_unrest'],
    summary: 'Possible newsworthy event detected.',
    eis_score: 68,
    eis_sub_scores: {
      fire_color_score: 45,
      smoke_haze_score: 22,
      emergency_lights_score: 38,
      crowd_density_score: 52,
      motion_magnitude_score: 34,
      scene_cut_rate_score: 8,
      motion_chaos_score: 15,
      camera_shake_score: 12,
      audio_intensity_score: 61,
      night_bright_spots_score: 5,
    },
    layers: [
      { id: 'L1A', name: 'QualityGate', pass: true, score100: 38, cumulative100: 38, reasons: [], ms: 120, meta: { blur_p25: 82.5, brightness_mean: 0.48, contrast_std: 0.22, short_side_px: 1080 } },
      { id: 'L1B', name: 'Authenticity', pass: true, score100: 18, cumulative100: 56, reasons: [], ms: 210, meta: { weight: 20, ai_content_risk_01: 0.12, synthetic_risk_01: 0.18, screen_synthetic_risk_01: 0.18, screen_confidence: 0.08, banding: 0.04, uniformity: 0.22, peakiness: 0.03, flicker: 0.15, encoding_score: 0.88, encoding_flags: ['CAMERA_METADATA_PRESENT'], exif_score: 0.92, freq_score: 0.91, texture_score: 1.0 } },
      { id: 'L1C', name: 'EventIntensity', pass: true, score100: 14, cumulative100: 70, reasons: ['EIS_PASS'], ms: 45, meta: {} },
      { id: 'L1D', name: 'NewsworthinessPreScreen', pass: true, score100: 8, cumulative100: 78, reasons: ['NEWS_PASS_MOV_STRONG'], ms: 2, meta: { movinet_confidence_01: 0.35, matched_subset: ['extinguishing fire'], news_tags: ['fire_emergency'], reporter_category_tuning: {} } },
      { id: 'L1E', name: 'ValidationTelemetry', pass: true, score100: 4, cumulative100: 82, reasons: [], ms: 8, meta: { device_manufacturer: 'Samsung', device_model: 'SM-S911B' } },
      { id: 'L1F', name: 'EvidenceBundle', pass: true, score100: 4, cumulative100: 86, reasons: ['EVIDENCE_SIGNED'], ms: 35, meta: {} },
    ],
    capture_context: {
      location_source: 'file_exif',
      location_available: true,
      file_exif_latitude: 33.4152,
      file_exif_longitude: -111.8369,
      file_exif_iso6709: '+33.4152-111.8370/',
      use_device_gps_for_analysis: false,
    },
    evidence_bundle: {
      v: 1,
      file_size_bytes: 8234567,
      session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    evidence_bundle_signature: 'MEUCIQDx...base64...==',
    evidence_bundle_signing_public_key: 'MCowBQ...base64...==',
    evidence_bundle_signing_algorithm: 'Ed25519',
    l1_policy_version: '2026.05.29-phone-outdoor-v13',
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
            l1Config={l1Config}
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
            l1Config={l1Config}
          />
          <TelemetryPanel telemetry={telemetry} setTelemetry={setTelemetry} mode={mode} />
          <L1AnalysisPanel l1Config={l1Config} setL1Config={setL1Config} />
          <TrustIndexCalculator latestScores={latestScores} />
        </div>
        <div className="col">
          <EventLog logs={logs} clearLog={clearLog} />
        </div>
      </div>
    </div>
  )
}
