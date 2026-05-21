import React from 'react'

export default function StartStream({
  backendUrl, uploaderId, setUploaderId, incidentId, setIncidentId,
  userType, setUserType, eventType, setEventType,
  mode, setMode, sessionId, setSessionId, setVideoId, addLog,
  setWsStatus, telemetry, setTelemetry,
}) {
  const handleModeChange = (e) => {
    const m = e.target.value
    setMode(m)
    setTelemetry(prev => ({ ...prev, capture_mode: m }))
  }

  const startStream = async () => {
    if (!uploaderId.trim()) { addLog('ERROR: uploader_id required', 'error'); return }
    const url = `${backendUrl.replace(/\/+$/, '')}/api/v1/start-stream`

    const body = {
      uploader_id: uploaderId.trim(),
      user_type: userType,
      event_type: eventType,
      mode,
    }
    if (incidentId.trim()) body.incident_id = incidentId.trim()

    addLog(`POST ${url}`, 'send')
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      addLog(`Response (${r.status}): ${JSON.stringify(d, null, 2)}`, r.ok ? 'recv' : 'error')
      if (r.ok) {
        setSessionId(d.session_id)
        setVideoId(d.video_id)
        setWsStatus('STREAM READY')
      }
    } catch (e) {
      addLog(`Fetch error: ${e.message}`, 'error')
    }
  }

  return (
    <div className="panel">
      <h2>1. Start Stream</h2>
      <div className="row">
        <div>
          <label>Uploader ID (UUID)</label>
          <input value={uploaderId} onChange={e => setUploaderId(e.target.value)}
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000" />
        </div>
        <div>
          <label>Incident ID (optional)</label>
          <input value={incidentId} onChange={e => setIncidentId(e.target.value)}
            placeholder="Leave blank for standalone" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>User Type</label>
          <select value={userType} onChange={e => setUserType(e.target.value)}>
            <option value="normal">normal</option>
            <option value="journalist">journalist</option>
          </select>
        </div>
        <div>
          <label>Event Type</label>
          <select value={eventType} onChange={e => setEventType(e.target.value)}>
            <option value="Crime">Crime</option>
            <option value="Violence">Violence</option>
            <option value="Emergency">Emergency</option>
            <option value="Public Safety">Public Safety</option>
            <option value="Protest">Protest</option>
            <option value="Civil Unrest">Civil Unrest</option>
            <option value="Disaster">Disaster</option>
            <option value="Major Incident">Major Incident</option>
            <option value="Conflict">Conflict</option>
            <option value="Military Activity">Military Activity</option>
            <option value="Celebrity">Celebrity</option>
            <option value="Sports">Sports</option>
            <option value="Entertainment">Entertainment</option>
            <option value="General">General</option>
          </select>
        </div>
      </div>
      <label>Mode</label>
      <select value={mode} onChange={handleModeChange}>
        <option value="STREAMING">STREAMING</option>
        <option value="CLIP">CLIP</option>
      </select>
      <div className="actions">
        <button className="btn btn-primary" onClick={startStream} disabled={!!sessionId}>
          Start Stream
        </button>
        <span className={`status ${sessionId ? 'status-connected' : 'status-idle'}`}>
          {sessionId ? 'STREAM READY' : 'IDLE'}
        </span>
      </div>
      {sessionId && (
        <div className="file-info" style={{ marginTop: 8 }}>
          session: {sessionId}
        </div>
      )}
    </div>
  )
}
