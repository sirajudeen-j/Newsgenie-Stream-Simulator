import React, { useState, useRef, useCallback, useEffect } from 'react'

function arrayBufferToBase64(buf) {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}


export default function VideoStreaming({
  backendUrl, sessionId, setSessionId, videoId,
  uploaderId, userType, eventType, mode, wsRef, wsStatus, setWsStatus,
  telemetry, addLog, clearLog, setAuditResult, setLatestScores,
}) {
  const [fileBuffer, setFileBuffer] = useState(null)
  const [fileName, setFileName] = useState('')
  const [sentSegments, setSentSegments] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const videoPreviewRef = useRef(null)
  const streamingRef = useRef(false)
  const segmentsRef = useRef([])
  const telemetryRef = useRef(telemetry)
  const sendNextRef = useRef(null)

  useEffect(() => { telemetryRef.current = telemetry }, [telemetry])

  const buildTelemetryPayload = useCallback((tel, captureMode) => {
    const claimedDate = tel.claimed_time ? new Date(tel.claimed_time) : new Date()
    return {
      telemetry_timestamp: claimedDate.getTime(),
      telemetry_iso: claimedDate.toISOString(),
      network_time_offset_ms: Number(tel.network_time_offset_ms) || 0,
      device_manufacturer: tel.device_manufacturer || 'Generic',
      device_model: tel.device_model || 'Simulator',
      android_sdk: Number(tel.android_sdk) || 34,
      android_release: String(tel.android_release || '14'),
      capture_mode: captureMode,
      device_lat: Number(tel.device_lat) || 0,
      device_lon: Number(tel.device_lon) || 0,
      geo_accuracy_m: Number(tel.geo_accuracy_m) || 10,
    }
  }, [])

  const buildClaimedLocation = useCallback((tel) => ({
    caption: tel.claimed_location_caption || 'Unknown location',
    latitude: Number(tel.device_lat) || 0,
    longitude: Number(tel.device_lon) || 0,
  }), [])

  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    setFileBuffer(buf)
    setFileName(file.name)
    const mb = (buf.byteLength / 1048576).toFixed(2)
    addLog(`File loaded: ${file.name} (${mb} MB)`)

    if (videoPreviewRef.current) {
      videoPreviewRef.current.src = URL.createObjectURL(file)
      videoPreviewRef.current.style.display = 'block'
    }

    // Send as a single whole segment (valid video file)
    segmentsRef.current = [arrayBufferToBase64(buf)]
    setTotalSegments(prev => prev) // don't reset total, segments accumulate
    setSentSegments(prev => prev)
    addLog(`Ready to stream: ${file.name} (${mb} MB) as one chunk`)
  }, [addLog])

  const sendNextSegment = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addLog('WebSocket not open', 'error'); return }
    if (segmentsRef.current.length === 0) { addLog('No video loaded', 'error'); return }

    const segB64 = segmentsRef.current[0]
    const segSizeKB = Math.round((segB64.length * 3 / 4) / 1024)
    const segNum = sentSegments + 1
    addLog(`WS send segment #${segNum} (${fileName}, ~${segSizeKB}KB)`, 'send')

    ws.send(segB64)
    setSentSegments(prev => prev + 1)
    setStreaming(false)
    streamingRef.current = false
    addLog('Segment sent — load next video and click Stream again', 'info')
  }, [addLog, wsRef, fileName, sentSegments])

  useEffect(() => { sendNextRef.current = sendNextSegment }, [sendNextSegment])

  const connectWS = useCallback(() => {
    if (!sessionId) { addLog('Start stream first', 'error'); return }
    const base = backendUrl.replace(/\/+$/, '').replace(/^http/, 'ws')
    const wsUrl = `${base}/api/v1/ws/stream/`
    addLog(`Connecting: ${wsUrl}`)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      addLog('WebSocket connected')
      setWsStatus('WS CONNECTED')
      setWsConnected(true)

      const tel = telemetryRef.current
      const createdAt = new Date().toISOString().split('.')[0] + 'Z'

      const meta = {
        uploader_id: uploaderId.trim(),
        user_type: userType,
        event_type: eventType,
        session_id: sessionId,
        createdAt,
        claimed_location: buildClaimedLocation(tel),
        video: null,
        telemetry: buildTelemetryPayload(tel, mode),
      }
      addLog('Sending metadata', 'send')
      ws.send(JSON.stringify(meta))
    }

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data)
        if (d.type === 'ACK') {
          addLog(`ACK: ${d.message}`, 'recv')
        } else {
          addLog(`Response: ${JSON.stringify(d, null, 2)}`, 'recv')

          const l6 = d?.layer6
          const policy = l6?.decision?.policy_status
          const inputScores = l6?.input_scores
          if (inputScores) {
            setLatestScores(inputScores)
          }
          if (policy) {
            setAuditResult({
              policy_status: policy,
              reason: l6?.decision?.reason || '',
              ndi_score: l6?.input_scores?.ndi_score,
              eis_score: l6?.input_scores?.eis_score,
              mas_score: l6?.input_scores?.mas_score,
              cis_score: l6?.input_scores?.cis_score,
              srs_score: l6?.input_scores?.srs_score,
              ti_score: l6?.policy_evaluation?.trustworthiness_index,
              segment_index: d?.fragment_index || d?.segment_index,
              timestamp: new Date().toLocaleTimeString(),
            })
          }

          if (streamingRef.current && sendNextRef.current) {
            sendNextRef.current()
          }
        }
      } catch { addLog(`Raw: ${ev.data}`, 'recv') }
    }

    ws.onerror = () => { addLog('WebSocket error', 'error'); setWsStatus('WS ERROR') }
    ws.onclose = (ev) => {
      addLog(`WS closed (${ev.code})`, 'warn')
      setWsStatus('DISCONNECTED')
      setWsConnected(false)
      wsRef.current = null
    }
  }, [sessionId, backendUrl, uploaderId, userType, eventType, mode, addLog, setWsStatus, wsRef, setAuditResult, buildTelemetryPayload, buildClaimedLocation])

  const startStreaming = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addLog('WebSocket not connected', 'error'); return }
    if (segmentsRef.current.length === 0) { addLog('No video loaded — select a file first', 'error'); return }

    streamingRef.current = true
    setStreaming(true)
    setWsStatus('STREAMING')
    sendNextSegment()
  }, [addLog, setWsStatus, sendNextSegment, wsRef])

  const stopStreaming = useCallback(async () => {
    streamingRef.current = false
    setStreaming(false)
    setWsConnected(false)
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setWsStatus('STOPPED')
    addLog('Streaming stopped & WebSocket closed', 'warn')

    if (sessionId && uploaderId) {
      const url = `${backendUrl.replace(/\/+$/, '')}/api/v1/end-stream`
      addLog(`POST ${url}`, 'send')
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, uploader_id: uploaderId.trim() }),
        })
        const d = await r.json()
        addLog(`End-stream response (${r.status}): ${JSON.stringify(d, null, 2)}`, r.ok ? 'recv' : 'error')
      } catch (e) {
        addLog(`End-stream error: ${e.message}`, 'error')
      }
    }
  }, [addLog, setWsStatus, wsRef, sessionId, uploaderId, backendUrl])

  return (
    <div className="panel">
      <h2>2. Video File & Streaming</h2>
      <label>Session ID (paste to skip Start Stream)</label>
      <input value={sessionId || ''} onChange={e => {
        const val = e.target.value.trim()
        setSessionId(val || null)
        if (val) setWsStatus('STREAM READY')
      }} placeholder="Auto-filled from Start Stream, or paste existing" />
      <label>Select Video File</label>
      <input type="file" accept="video/*" onChange={handleFile} />
      {fileName && <div className="file-info">{fileName}</div>}
      <video ref={videoPreviewRef} controls style={{ display: fileName ? 'block' : 'none' }} />
      <div className="chunk-info">
        {sentSegments > 0 ? `${sentSegments} segment${sentSegments !== 1 ? 's' : ''} sent` : 'No segments sent yet'}
      </div>
      <div className="actions">
        <button className="btn btn-success" onClick={connectWS}
          disabled={!sessionId || wsConnected}>Connect WebSocket</button>
        <button className="btn btn-primary" onClick={startStreaming}
          disabled={!wsConnected || segmentsRef.current.length === 0 || streaming}>Stream</button>
        <button className="btn btn-danger" onClick={stopStreaming}
          disabled={!streaming && !wsConnected}>Stop</button>
        <button className="btn btn-secondary" onClick={clearLog}>Clear Log</button>
        <span className={`status ${
          wsStatus === 'STREAMING' ? 'status-streaming' :
          wsStatus.includes('CONNECTED') || wsStatus.includes('READY') ? 'status-connected' :
          wsStatus === 'ERROR' || wsStatus === 'WS ERROR' ? 'status-error' : 'status-idle'
        }`}>{wsStatus}</span>
      </div>
    </div>
  )
}
