import React, { useState, useRef } from 'react'

export default function UploadPanel({ backendUrl, uploaderId, incidentId, telemetry, addLog, setAuditResult, proxyFetch }) {
  const [uploading, setUploading] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const fileRef = useRef(null)
  const proxyUrl = telemetry.proxy_url || 'http://localhost:8001'

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (file) {
      setUploadFile(file)
      addLog(`Upload file selected: ${file.name} (${(file.size / 1048576).toFixed(2)} MB)`)
    }
  }

  const uploadVideo = async () => {
    if (!uploadFile) { addLog('No file selected for upload', 'error'); return }
    if (!uploaderId.trim()) { addLog('ERROR: uploader_id required', 'error'); return }

    setUploading(true)
    setAuditResult(null)
    addLog('Starting CLIP upload...')

    try {
      // 1. Get raw bytes as Base64
      const reader = new FileReader()
      const filePromise = new Promise((resolve) => {
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(uploadFile)
      })
      let videoBase64 = await filePromise

      // 2. Load metadata template
      const metaResp = await fetch('/metadata.json')
      const metadataTemplate = await metaResp.json()

      // 3. INJECTION (optional)
      if (telemetry.enable_injection) {
        addLog('Injecting forensics before upload...', 'info')
        const injectResp = await fetch(`${proxyUrl}/embed-exif`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: videoBase64,
            exif_template: metadataTemplate,
            overrides: {
              lat: telemetry.injected_lat || telemetry.device_lat,
              lon: telemetry.injected_lon || telemetry.device_lon,
              model: telemetry.injected_model || telemetry.device_model,
              manufacturer: telemetry.device_manufacturer,
              creation_time: telemetry.injected_time ? new Date(telemetry.injected_time).toISOString() : new Date().toISOString()
            },
            fingerprint: telemetry.preserve_fingerprint,
            strip_audio: telemetry.strip_audio
          })
        })
        if (injectResp.ok) {
          videoBase64 = await injectResp.text()
          addLog('Forensics injected ✓', 'info')
        } else {
          addLog(`Forensic injection failed (status ${injectResp.status})`, 'error')
        }
      }

      addLog('Packaging payload...', 'info')
      // 4. Convert back to Blob
      const byteCharacters = atob(videoBase64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i)
      const byteArray = new Uint8Array(byteNumbers)
      const finalBlob = new Blob([byteArray], { type: uploadFile.type })

      const telemetryPayload = {
        telemetry_timestamp: telemetry.claimed_time ? new Date(telemetry.claimed_time).getTime() : Date.now(),
        network_time_offset_ms: Number(telemetry.network_time_offset_ms || 0),
        device_manufacturer: telemetry.device_manufacturer,
        device_model: telemetry.device_model,
        android_sdk: Number(telemetry.android_sdk || 34),
        android_release: String(telemetry.android_release || '14'),
        capture_mode: 'CLIP',
        device_lat: Number(telemetry.device_lat),
        device_lon: Number(telemetry.device_lon),
        geo_accuracy_m: Number(telemetry.geo_accuracy_m || 15)
      }

      const formData = new FormData()
      formData.append('video', finalBlob, uploadFile.name)
      formData.append('uploader_id', uploaderId.trim())
      formData.append('user_type', 'normal')
      formData.append('event_type', 'general')
      formData.append('incident_id', incidentId.trim() || '')
      formData.append('telemetry', JSON.stringify(telemetryPayload))

      const path = '/api/v1/upload-video'
      addLog(`Calling BE: ${path}`, 'send')

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 minute timeout

      const resp = await proxyFetch(path, { 
        method: 'POST', 
        body: formData,
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      
      const result = await resp.json()
      addLog(`Upload response (${resp.status}): ${JSON.stringify(result, null, 2)}`, resp.ok ? 'recv' : 'error')
      
      if (result.audit_result) {
        setAuditResult(result.audit_result)
      }
    } catch (e) {
      addLog(`Upload failed: ${e.message}`, 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="panel">
      <h2>CLIP Upload (POST /upload-video)</h2>
      <p className="note">
        Uploads a complete video file directly to the backend. Sends multipart form with video file + JSON metadata.
      </p>
      <label>Select Video File</label>
      <input type="file" accept="video/*" ref={fileRef} onChange={handleFile} />
      {uploadFile && <div className="file-info">{uploadFile.name}</div>}
      <div className="actions">
        <button className="btn btn-primary" onClick={uploadVideo} disabled={uploading || !uploadFile}>
          {uploading ? 'Uploading...' : 'Upload Video'}
        </button>
      </div>
    </div>
  )
}
