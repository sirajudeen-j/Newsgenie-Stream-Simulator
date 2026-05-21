import React, { useState, useRef, useCallback, useEffect } from 'react'

function arrayBufferToBase64(buf) {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const SEGMENT_DURATION_S = 10
const LIVE_SEGMENT_DURATION_S = 5 // 2 chunks of 5s = 10s for BE

/**
 * Find the byte offset of the first Cluster element in a WebM buffer.
 * WebM Cluster element ID is 0x1F43B675. Everything before it is the header.
 */
function findClusterOffset(buffer) {
  const bytes = new Uint8Array(buffer)
  // Search for Cluster ID: 0x1F 0x43 0xB6 0x75
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) {
    if (bytes[i] === 0x1F && bytes[i+1] === 0x43 && bytes[i+2] === 0xB6 && bytes[i+3] === 0x75) {
      return i
    }
  }
  // Fallback: use first 4KB as header if Cluster not found
  return Math.min(4096, buffer.byteLength)
}

/**
 * Cuts a segment from a video file buffer using a hidden video element + MediaRecorder.
 * Returns a Blob of the segment.
 */
function cutSegmentFromFile(fileBuffer, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([fileBuffer], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = url

    video.onloadedmetadata = () => {
      // If startSec is beyond video duration, resolve empty
      if (startSec >= video.duration) {
        URL.revokeObjectURL(url)
        reject(new Error('Segment start beyond video duration'))
        return
      }
      video.currentTime = startSec
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      const stream = canvas.captureStream(30)

      // Try to capture audio too
      try {
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaElementSource(video)
        const dest = audioCtx.createMediaStreamDestination()
        source.connect(dest)
        source.connect(audioCtx.destination)
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      } catch (e) { /* no audio track or already captured */ }

      const types = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || ''
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 })
      const chunks = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        URL.revokeObjectURL(url)
        resolve(new Blob(chunks, { type: mimeType || 'video/webm' }))
      }

      recorder.start()
      video.play()

      // Draw frames to canvas
      const endTime = Math.min(startSec + durationSec, video.duration)
      const drawFrame = () => {
        if (video.currentTime >= endTime || video.ended) {
          recorder.stop()
          video.pause()
          return
        }
        ctx.drawImage(video, 0, 0)
        requestAnimationFrame(drawFrame)
      }
      drawFrame()
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Video element error during segment cut'))
    }
  })
}

export default function VideoStreaming({
  backendUrl, sessionId, setSessionId, videoId,
  uploaderId, mode, wsRef, wsStatus, setWsStatus,
  telemetry, addLog, clearLog, setAuditResult,
  proxyFetch,
}) {
  const [fileBuffer, setFileBuffer] = useState(null)
  const [fileName, setFileName] = useState('')
  const [videoDuration, setVideoDuration] = useState(0)
  const [totalSegments, setTotalSegments] = useState(0)
  const [sentSegments, setSentSegments] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  
  const videoPreviewRef = useRef(null)
  const liveStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const geoWatchIdRef = useRef(null)
  const streamingRef = useRef(false)
  const segIndexRef = useRef(0)
  const segmentsRef = useRef([])
  const telemetryRef = useRef(telemetry)
  const sendNextRef = useRef(null)

  const [metadataTemplate, setMetadataTemplate] = useState(null)
  const proxyUrl = telemetry.proxy_url || 'http://localhost:8001'

  useEffect(() => { telemetryRef.current = telemetry }, [telemetry])

  // Load metadata template on mount
  useEffect(() => {
    fetch('/metadata.json')
      .then(r => r.json())
      .then(setMetadataTemplate)
      .catch(e => addLog('Failed to load metadata.json template', 'error'))
  }, [addLog])

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

    // Get video duration from the element to calculate segment count
    const tempVideo = document.createElement('video')
    tempVideo.preload = 'metadata'
    tempVideo.src = URL.createObjectURL(file)
    tempVideo.onloadedmetadata = () => {
      const dur = tempVideo.duration
      setVideoDuration(dur)
      URL.revokeObjectURL(tempVideo.src)
      const estimatedSegs = Math.max(1, Math.ceil(dur / SEGMENT_DURATION_S))
      setTotalSegments(estimatedSegs)
      addLog(`File ready: ${dur.toFixed(1)}s. (~${estimatedSegs} segments)`)
    }
  }, [addLog])

  const startLiveMode = useCallback(async () => {
    try {
      addLog('Requesting Camera & Sensors...', 'info')
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, 
        audio: true 
      })
      
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream
        videoPreviewRef.current.onloadedmetadata = () => videoPreviewRef.current.play()
      }
      
      liveStreamRef.current = stream
      setWsStatus('LIVE READY')
      setTotalSegments(9999)
      addLog('Camera Active ✓ (environment mode)', 'info')

      // Get real device GPS
      if (navigator.geolocation) {
        geoWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords
            telemetryRef.current = {
              ...telemetryRef.current,
              device_lat: latitude,
              device_lon: longitude,
              geo_accuracy_m: accuracy,
            }
            addLog(`GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy.toFixed(0)}m)`, 'debug')
          },
          (err) => addLog(`GPS error: ${err.message}`, 'warn'),
          { enableHighAccuracy: true, maximumAge: 5000 }
        )
        addLog('GPS watchPosition started ✓', 'info')
      }
    } catch (e) {
      addLog(`Camera failed: ${e.name}. ${e.message}`, 'error')
      if (window.location.protocol !== 'https:') {
        alert('CRITICAL: Camera requires HTTPS. Please use the Cloudflare Tunnel URL.')
      } else {
        alert(`Camera Error: ${e.message}`)
      }
    }
  }, [addLog, setWsStatus])

  useEffect(() => { sendNextRef.current = null }, []) 

  const liveQueueRef = useRef([])
  const isWaitingForProxyRef = useRef(false)
  const webmHeaderRef = useRef(null) // Store WebM init segment for prepending

  // Update sendNextSegment to include Forensic Overrides for the Bridge
  const sendNextSegment = useCallback(async () => {
    const ws = wsRef.current
    if (!streamingRef.current) return
    if (!ws || ws.readyState !== WebSocket.OPEN) { addLog('Segment skip: WS not open', 'debug'); return }
    if (!fileBuffer) return

    const segIdx = segIndexRef.current
    const numSegs = Math.max(1, Math.ceil(videoDuration / SEGMENT_DURATION_S))
    if (segIdx >= numSegs) {
      addLog(`Stream Complete: all ${numSegs} segments sent`, 'info')
      streamingRef.current = false
      setStreaming(false)
      setWsStatus('COMPLETE')
      return
    }

    // Cut 10s segment client-side using a hidden video + MediaRecorder
    const startSec = segIdx * SEGMENT_DURATION_S
    addLog(`Cutting segment ${segIdx + 1}/${numSegs} (${startSec}s-${startSec + SEGMENT_DURATION_S}s)...`, 'info')

    try {
      const segBlob = await cutSegmentFromFile(fileBuffer, startSec, SEGMENT_DURATION_S)
      const segBuf = await segBlob.arrayBuffer()
      const segB64 = arrayBufferToBase64(segBuf)

      const tel = telemetryRef.current
      const payload = {
        type: 'FILE_CHUNK',
        session_id: sessionId,
        segment_index: segIdx + 1,
        blob_b64: segB64,
        exif_template: metadataTemplate,
        forensic_overrides: {
          lat: tel.injected_lat || tel.device_lat,
          lon: tel.injected_lon || tel.device_lon,
          model: tel.injected_model || tel.device_model,
          manufacturer: tel.device_manufacturer,
          creation_time: tel.injected_time ? new Date(tel.injected_time + 'Z').toISOString() : new Date().toISOString(),
          enabled: tel.enable_injection,
        }
      }

      addLog(`Sending segment ${segIdx + 1}/${numSegs} (${(segBuf.byteLength / 1024).toFixed(0)} KB)`, 'send')
      ws.send(JSON.stringify(payload))
      segIndexRef.current = segIdx + 1
      setSentSegments(segIdx + 1)
    } catch (e) {
      addLog(`Segment cut failed: ${e.message}`, 'error')
    }
  }, [sessionId, metadataTemplate, addLog, setWsStatus, wsRef, fileBuffer, videoDuration])

  // Decoupled send function for LIVE mode
  const sendNextLiveChunk = useCallback(async () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (isWaitingForProxyRef.current) return
    if (liveQueueRef.current.length === 0) return

    const { meta, buf, idx } = liveQueueRef.current.shift()
    try {
      isWaitingForProxyRef.current = true
      addLog(`DEBUG: [Seg ${idx}] Packaging Unified Frame...`, 'debug')
      
      // Merge binary into meta as Base64
      const unifiedMeta = {
        ...meta,
        blob_b64: arrayBufferToBase64(buf)
      }
      
      addLog(`DEBUG: [Seg ${idx}] Sending Unified Frame to Proxy...`, 'debug')
      ws.send(JSON.stringify(unifiedMeta))
    } catch (err) {
      addLog(`DEBUG: [Seg ${idx}] Send failed: ${err.message}`, 'error')
      isWaitingForProxyRef.current = false
    }
  }, [addLog, wsRef])

  const startStreaming = useCallback(async () => {
    addLog('!!! STREAM BUTTON CLICKED !!!', 'info')
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { addLog('Connect to Bridge first', 'error'); return }
    
    if (!liveMode && !fileBuffer) { addLog('No video file loaded', 'error'); return }
    setWsStatus('PREPARING...')
    streamingRef.current = true
    setStreaming(true)
    segIndexRef.current = 0
    setSentSegments(0)
    isWaitingForProxyRef.current = false // Reset traffic light
    liveQueueRef.current = [] // Clear any old queue
    webmHeaderRef.current = null // Reset WebM header for new session

    if (liveMode) {
      if (!liveStreamRef.current) { addLog('Camera not enabled', 'error'); return }
      
      addLog('Live Stream Active: Starting recorder...', 'info')
      setWsStatus('LIVE STREAMING')
      setTotalSegments(999) 

      // Mobile-first MIME priority: webm works on Android, mp4 fallback for iOS
      const types = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      let supportedType = types.find(t => MediaRecorder.isTypeSupported(t))
      
      addLog(`Using recorder format: ${supportedType || 'default'}`, 'debug')
      
      const recorder = new MediaRecorder(liveStreamRef.current, supportedType ? { 
        mimeType: supportedType,
        videoBitsPerSecond: 1200000 
      } : { videoBitsPerSecond: 1200000 })
      
      recorder.ondataavailable = async (e) => {
        addLog(`DEBUG: Recorder chunk captured (size: ${e.data.size} bytes)`, 'debug')
        if (e.data.size > 0) {
          const ws = wsRef.current
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            addLog(`DEBUG: Skipping Segment ${segIndexRef.current + 1} - WS state ${ws?.readyState}`, 'warn')
            return
          }

          let buf = await e.data.arrayBuffer()
          const segIdx = segIndexRef.current

          // WebM header fix: first chunk has the EBML header, subsequent ones don't
          if (segIdx === 0) {
            // Store the header from first chunk (first ~4KB contains EBML + Segment + Tracks)
            webmHeaderRef.current = buf.slice(0, findClusterOffset(buf))
            addLog(`WebM header captured (${webmHeaderRef.current.byteLength} bytes)`, 'debug')
          } else if (webmHeaderRef.current) {
            // Prepend header to make each chunk a valid standalone WebM
            const header = webmHeaderRef.current
            const merged = new Uint8Array(header.byteLength + buf.byteLength)
            merged.set(new Uint8Array(header), 0)
            merged.set(new Uint8Array(buf), header.byteLength)
            buf = merged.buffer
          }

          const tel = telemetryRef.current || {}
          
          const meta = {
            type: 'LIVE_CHUNK_META',
            session_id: sessionId,
            segment_index: segIdx + 1,
            forensic_overrides: {
              lat: tel.device_lat,
              lon: tel.device_lon,
              model: tel.device_model,
              manufacturer: tel.device_manufacturer,
              creation_time: new Date().toISOString(),
              enabled: tel.enable_injection,
            }
          }
          
          // Instead of sending immediately, push to queue and trigger sender
          liveQueueRef.current.push({ meta, buf, idx: segIdx + 1 })
          addLog(`Live Fragment ${segIdx + 1} recorded & queued (${(buf.byteLength / 1024).toFixed(0)} KB)`, 'info')
          
          segIndexRef.current++
          setSentSegments(segIndexRef.current)
          sendNextLiveChunk()
        }
      }

      recorder.onerror = (e) => {
        addLog(`MediaRecorder error: ${e.error?.name || 'unknown'} - ${e.error?.message || ''}`, 'error')
        streamingRef.current = false
        setStreaming(false)
        setWsStatus('RECORDER ERROR')
      }

      recorder.onstop = () => {
        if (streamingRef.current) {
          addLog('MediaRecorder stopped unexpectedly (app backgrounded?). Restarting...', 'warn')
          try {
            const newRecorder = new MediaRecorder(liveStreamRef.current, supportedType ? {
              mimeType: supportedType,
              videoBitsPerSecond: 1200000
            } : { videoBitsPerSecond: 1200000 })
            newRecorder.ondataavailable = recorder.ondataavailable
            newRecorder.onerror = recorder.onerror
            newRecorder.onstop = recorder.onstop
            newRecorder.start(LIVE_SEGMENT_DURATION_S * 1000)
            mediaRecorderRef.current = newRecorder
            addLog('MediaRecorder restarted ✓', 'info')
          } catch (restartErr) {
            addLog(`Failed to restart recorder: ${restartErr.message}`, 'error')
            streamingRef.current = false
            setStreaming(false)
            setWsStatus('RECORDER DEAD')
          }
        }
      }

      recorder.start(LIVE_SEGMENT_DURATION_S * 1000)
      mediaRecorderRef.current = recorder
    } else {
      // FILE MODE — cut & send segments from FE directly
      const numSegs = Math.max(1, Math.ceil(videoDuration / SEGMENT_DURATION_S))
      setTotalSegments(numSegs)
      setWsStatus('STREAMING')
      addLog(`File Stream Active: FE-cut mode (${numSegs} segments)`)
      sendNextSegment()
    }
    
    // 10s TELEMETRY PING to BE (updates claimed device position)
    const pingInterval = setInterval(() => {
      if (!streamingRef.current || !wsRef.current) {
        clearInterval(pingInterval)
        return
      }
      const tel = telemetryRef.current
      const ping = {
        type: 'TELEMETRY_UPDATE',
        data: {
          telemetry_timestamp: Date.now(),
          network_time_offset_ms: Number(tel.network_time_offset_ms) || 0,
          device_manufacturer: tel.device_manufacturer,
          device_model: tel.device_model,
          android_sdk: Number(tel.android_sdk) || 34,
          android_release: String(tel.android_release) || '14',
          device_lat: Number(tel.device_lat),
          device_lon: Number(tel.device_lon),
          geo_accuracy_m: Number(tel.geo_accuracy_m) || 15.0,
        }
      }
      wsRef.current.send(JSON.stringify(ping))
    }, 10000)
    
  }, [addLog, setWsStatus, sendNextSegment, sendNextLiveChunk, wsRef, fileBuffer, videoDuration, liveMode, sessionId])

  const connectWS = useCallback(() => {
    if (!sessionId) { addLog('Start stream first', 'error'); return }
    
    // CONNECT TO BRIDGE INSTEAD OF BE
    const bridgeWsUrl = proxyUrl.replace(/^http/, 'ws') + '/ws/bridge'
    addLog(`Connecting to Forensic Bridge: ${bridgeWsUrl}`)

    const ws = new WebSocket(bridgeWsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      addLog('Bridge connected ✓')
      setWsStatus('BRIDGE ACTIVE')
      setWsConnected(true)

      const tel = telemetryRef.current
      const baseBE = backendUrl.replace(/\/+$/, '').replace(/^http/, 'ws')
      const beWsUrl = `${baseBE}/api/v1/ws/stream/`

      const createdAt = new Date().toISOString()

      const meta = {
        uploader_id: uploaderId.trim(),
        session_id: sessionId.trim(),
        createdAt: createdAt,
        backend_ws_url: beWsUrl,
        telemetry: {
          telemetry_timestamp: tel.claimed_time ? new Date(tel.claimed_time + 'Z').getTime() : Date.now(),
          network_time_offset_ms: Number(tel.network_time_offset_ms) || 0,
          device_manufacturer: tel.device_manufacturer || 'Samsung',
          device_model: tel.device_model || 'Galaxy S24',
          android_sdk: Number(tel.android_sdk) || 34,
          android_release: String(tel.android_release) || '14',
          capture_mode: tel.capture_mode || 'STREAMING',
          device_lat: Number(tel.device_lat) || 0,
          device_lon: Number(tel.device_lon) || 0,
          geo_accuracy_m: Number(tel.geo_accuracy_m) || 15.0,
        },
      }
      addLog('Sending metadata via Bridge...', 'send')
      ws.send(JSON.stringify(meta))

      if (liveMode) {
        addLog('Live Mode Active: Bridge ready — click Stream to begin', 'info')
      }
    }

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data)
        
        // --- PROXY LEVEL ACK ---
        if (d?.type === 'PROXY_ACK') {
          addLog(`Proxy ACK: Segment ${d.segment_index} done ✓`, 'recv')
          isWaitingForProxyRef.current = false
          if (liveMode) {
            sendNextLiveChunk()
          } else if (streamingRef.current && sendNextRef.current) {
            setTimeout(() => sendNextRef.current(), 200)
          }
          return
        }

        // --- BRIDGE LEVEL ACK ---
        if (d?.type === 'ACK') {
          addLog(`Bridge ACK: ${d?.message || 'Ready'}`, 'recv')
          if (streamingRef.current && sendNextRef.current && !liveMode) {
            setTimeout(() => sendNextRef.current(), 300)
          }
        } else if (d?.type === 'ERROR') {
          addLog(`Bridge Error: ${d?.message}`, 'error')
        } else {
          // --- AUDIT RESULTS / BE MESSAGES ---
          addLog(`BE Response Received`, 'recv')
          
          const l6 = d?.layer6
          const policy = l6?.decision?.policy_status

          if (policy) {
            setAuditResult({
              policy_status: policy,
              reason: l6?.decision?.reason || '',
              ndi_score: l6?.input_scores?.ndi_score,
              eis_score: l6?.input_scores?.eis_score,
              mas_score: l6?.input_scores?.mas_score,
              cis_score: l6?.input_scores?.cis_score,
              srs_score: l6?.input_scores?.srs_score,
              ti_score: l6?.computed?.ti_score,
              context: l6?.layer5?.context || l6?.audit?.context,
              segment_index: d?.fragment_index || d?.segment_index,
              timestamp: new Date().toLocaleTimeString(),
            })
          }
        }
      } catch (err) {
        addLog(`BE: ${ev.data}`, 'receive')
      }
    }

    ws.onerror = () => { addLog('Bridge connection error', 'error'); setWsStatus('BRIDGE ERROR') }
    ws.onclose = (ev) => {
      addLog(`Bridge closed (${ev.code})`, 'warn')
      setWsStatus('DISCONNECTED')
      setWsConnected(false)
      wsRef.current = null
    }
  }, [sessionId, backendUrl, uploaderId, addLog, setWsStatus, wsRef, setAuditResult, fileBuffer, liveMode, startStreaming, sendNextLiveChunk])


  useEffect(() => { sendNextRef.current = sendNextSegment }, [sendNextSegment])

  const stopStreaming = useCallback(async () => {
    streamingRef.current = false
    setStreaming(false)
    setWsConnected(false)

    // Stop GPS watch
    if (geoWatchIdRef.current != null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current)
      geoWatchIdRef.current = null
    }

    // Stop MediaRecorder first so final chunk fires ondataavailable
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.onstop = null // Prevent auto-restart
        mediaRecorderRef.current.stop()
        addLog('MediaRecorder stopped, final chunk captured', 'info')
      } catch (e) { /* already stopped */ }
      mediaRecorderRef.current = null
    }

    // Give time for final chunk to send before closing WS
    await new Promise(r => setTimeout(r, 500))

    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setWsStatus('STOPPED')
    addLog('Streaming stopped & WebSocket closed', 'warn')

    if (sessionId && uploaderId) {
      const path = '/api/v1/end-stream'
      addLog(`Calling BE: ${path}`, 'send')
      try {
        const r = await proxyFetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, uploader_id: uploaderId.trim() }),
        })
        const d = await r.json()
        addLog(`End-stream response (${r.status}): ${JSON.stringify(d, null, 2)}`, r.ok ? 'recv' : 'error')
        
        if (d.audit_result) {
          setAuditResult(d.audit_result)
        }
      } catch (e) {
        addLog(`End-stream error: ${e.message}`, 'error')
      }
    }
  }, [addLog, setWsStatus, wsRef, sessionId, uploaderId, backendUrl, proxyFetch])

  const pct = totalSegments > 0 ? ((sentSegments / totalSegments) * 100).toFixed(1) : 0

  return (
    <div className="panel">
      <h2>2. Video File & Streaming</h2>
      <label>Session ID (paste to skip Start Stream)</label>
      <input value={sessionId || ''} onChange={e => {
        const val = e.target.value.trim()
        setSessionId(val || null)
        if (val) setWsStatus('STREAM READY')
      }} placeholder="Auto-filled from Start Stream, or paste existing" />
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <label className="toggle">
          <input type="checkbox" checked={liveMode} onChange={e => setLiveMode(e.target.checked)} />
          <span className="slider"></span>
          Live Camera Mode
        </label>
        {liveMode && <div className="live-indicator"><span className="pulse-dot"></span> LIVE</div>}
      </div>

      {!liveMode ? (
        <>
          <label>Select Video File</label>
          <input type="file" accept="video/*" onChange={handleFile} />
          {fileName && <div className="file-info">{fileName}</div>}
          <video ref={videoPreviewRef} controls style={{ display: fileName ? 'block' : 'none' }} />
        </>
      ) : (
        <>
          <div className="actions">
            <button className="btn btn-primary" onClick={startLiveMode} disabled={wsStatus === 'LIVE READY' || streaming}>
              Enable Camera & Sensors
            </button>
          </div>
          <video ref={videoPreviewRef} autoPlay muted playsInline className="camera-preview" />
        </>
      )}

      {totalSegments > 0 && !liveMode && (
        <div className="chunk-info" style={{ marginTop: 6 }}>
          {videoDuration.toFixed(1)}s → {totalSegments} segment{totalSegments !== 1 ? 's' : ''} ({SEGMENT_DURATION_S}s each)
        </div>
      )}
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <div className="chunk-info">
        {fileName ? (
          totalSegments > 0 ? `${sentSegments}/${totalSegments} segments — ${pct}%` : 'Analyzing video...'
        ) : 'No file loaded'}
      </div>
      <div className="actions">
        <button className="btn btn-success" onClick={connectWS}
          disabled={!sessionId || wsConnected || (liveMode && !liveStreamRef.current) || (!liveMode && !fileBuffer)}>Connect WebSocket</button>
        <button className="btn btn-primary" onClick={startStreaming}
          disabled={!wsConnected || streaming}>Stream</button>
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
