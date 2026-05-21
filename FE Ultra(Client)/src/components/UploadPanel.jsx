import React, { useState, useRef } from 'react'

export default function UploadPanel({ backendUrl, uploaderId, incidentId, userType, eventType, telemetry, addLog, setAuditResult, setLatestScores }) {
  const [uploading, setUploading] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const fileRef = useRef(null)

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
    addLog('Starting CLIP upload...')

    try {
      const claimedDate = telemetry.claimed_time ? new Date(telemetry.claimed_time) : new Date()

      const telemetryPayload = JSON.stringify({
        telemetry_timestamp: claimedDate.getTime(),
        telemetry_iso: claimedDate.toISOString(),
        network_time_offset_ms: Number(telemetry.network_time_offset_ms || 0),
        device_manufacturer: telemetry.device_manufacturer,
        device_model: telemetry.device_model,
        android_sdk: Number(telemetry.android_sdk || 34),
        android_release: String(telemetry.android_release || '14'),
        capture_mode: 'CLIP',
        device_lat: Number(telemetry.device_lat),
        device_lon: Number(telemetry.device_lon),
        geo_accuracy_m: Number(telemetry.geo_accuracy_m || 15),
        claimed_location: {
          caption: telemetry.claimed_location_caption || 'Unknown location',
          latitude: Number(telemetry.device_lat),
          longitude: Number(telemetry.device_lon),
        },
      })

      const formData = new FormData()
      formData.append('video', uploadFile, uploadFile.name)
      formData.append('uploader_id', uploaderId.trim())
      formData.append('user_type', userType)
      formData.append('event_type', eventType)
      if (incidentId.trim()) formData.append('incident_id', incidentId.trim())
      formData.append('telemetry', telemetryPayload)

      const url = `${backendUrl.replace(/\/+$/, '')}/api/v1/upload-video`
      addLog(`POST ${url}`, 'send')

      const resp = await fetch(url, { method: 'POST', body: formData })
      const result = await resp.json()
      addLog(`Upload response (${resp.status}): ${JSON.stringify(result, null, 2)}`, resp.ok ? 'recv' : 'error')

      // Extract audit result if present
      const l6 = result?.layer6
      const inputScores = l6?.input_scores
      if (inputScores) {
        setLatestScores(inputScores)
      }
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
          ti_score: l6?.policy_evaluation?.trustworthiness_index,
          timestamp: new Date().toLocaleTimeString(),
        })
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
        Uploads a complete video file directly to the backend. Sends multipart form with video file + individual fields.
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
