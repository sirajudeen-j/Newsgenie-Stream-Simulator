import React, { useState } from 'react'

export default function L1AnalysisPanel({ l1Config, setL1Config }) {
  const [expanded, setExpanded] = useState(false)
  const [layersExpanded, setLayersExpanded] = useState(false)

  const set = (key, val) => setL1Config(prev => ({ ...prev, [key]: val }))
  const setNested = (parent, key, val) => setL1Config(prev => ({
    ...prev, [parent]: { ...prev[parent], [key]: val }
  }))
  const setEisSub = (key, val) => setL1Config(prev => ({
    ...prev, eis_sub_scores: { ...prev.eis_sub_scores, [key]: Number(val) }
  }))
  const setEvidence = (key, val) => setL1Config(prev => ({
    ...prev, evidence_bundle: { ...prev.evidence_bundle, [key]: val }
  }))

  const setLayerField = (idx, key, val) => {
    setL1Config(prev => {
      const layers = [...prev.layers]
      layers[idx] = { ...layers[idx], [key]: val }
      return { ...prev, layers }
    })
  }

  const setLayerMeta = (idx, key, val) => {
    setL1Config(prev => {
      const layers = [...prev.layers]
      layers[idx] = { ...layers[idx], meta: { ...layers[idx].meta, [key]: val } }
      return { ...prev, layers }
    })
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>L1 On-Device Analysis</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={l1Config.enabled} onChange={e => set('enabled', e.target.checked)} />
            Attach L1
          </label>
          <button className="btn btn-secondary" onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, padding: '2px 8px' }}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      <p className="note">Configure the on-device pre-analysis (Layer 1) result attached to the payload.</p>

      {/* L1B Authenticity — always visible when L1 is enabled */}
      {l1Config.enabled && (
        <div style={{ border: '1px solid #555', borderRadius: 6, padding: 10, marginBottom: 12, background: '#1a1a2e' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#7cb3ff' }}>L1B Authenticity Controls</h3>
          <div className="row">
            <div>
              <label>Pass</label>
              <select value={l1Config.layers[1]?.pass ? 'true' : 'false'} onChange={e => setLayerField(1, 'pass', e.target.value === 'true')}>
                <option value="true">true (authentic)</option>
                <option value="false">false (suspicious)</option>
              </select>
            </div>
            <div>
              <label>AI Content Risk (0–1)</label>
              <input type="number" step="0.01" min="0" max="1" value={l1Config.layers[1]?.meta?.ai_content_risk_01 ?? 0.12} onChange={e => setLayerMeta(1, 'ai_content_risk_01', Number(e.target.value))} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Synthetic Risk (0–1)</label>
              <input type="number" step="0.01" min="0" max="1" value={l1Config.layers[1]?.meta?.synthetic_risk_01 ?? 0.18} onChange={e => setLayerMeta(1, 'synthetic_risk_01', Number(e.target.value))} />
            </div>
            <div>
              <label>Screen Synthetic Risk (0–1)</label>
              <input type="number" step="0.01" min="0" max="1" value={l1Config.layers[1]?.meta?.screen_synthetic_risk_01 ?? 0.18} onChange={e => setLayerMeta(1, 'screen_synthetic_risk_01', Number(e.target.value))} />
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <>
          {/* Status & Core Scores */}
          <div className="row">
            <div>
              <label>Status</label>
              <select value={l1Config.status} onChange={e => set('status', e.target.value)}>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Failed">Failed</option>
              </select>
            </div>
            <div>
              <label>Newsworthy</label>
              <select value={l1Config.newsworthy ? 'true' : 'false'} onChange={e => set('newsworthy', e.target.value === 'true')}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div><label>Confidence (0–1)</label><input type="number" step="0.01" min="0" max="1" value={l1Config.confidence} onChange={e => set('confidence', Number(e.target.value))} /></div>
            <div><label>EIS Score (0–100)</label><input type="number" min="0" max="100" value={l1Config.eis_score} onChange={e => set('eis_score', Number(e.target.value))} /></div>
          </div>

          {/* Categories */}
          <label>Categories (comma-separated)</label>
          <input value={l1Config.categories.join(', ')} onChange={e => set('categories', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />

          <label>Summary</label>
          <input value={l1Config.summary} onChange={e => set('summary', e.target.value)} />

          {/* EIS Sub-Scores */}
          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>EIS Sub-Scores</h3>
          <div className="row">
            <div><label>Fire Color</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.fire_color_score} onChange={e => setEisSub('fire_color_score', e.target.value)} /></div>
            <div><label>Smoke/Haze</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.smoke_haze_score} onChange={e => setEisSub('smoke_haze_score', e.target.value)} /></div>
          </div>
          <div className="row">
            <div><label>Emergency Lights</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.emergency_lights_score} onChange={e => setEisSub('emergency_lights_score', e.target.value)} /></div>
            <div><label>Crowd Density</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.crowd_density_score} onChange={e => setEisSub('crowd_density_score', e.target.value)} /></div>
          </div>
          <div className="row">
            <div><label>Motion Magnitude</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.motion_magnitude_score} onChange={e => setEisSub('motion_magnitude_score', e.target.value)} /></div>
            <div><label>Scene Cut Rate</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.scene_cut_rate_score} onChange={e => setEisSub('scene_cut_rate_score', e.target.value)} /></div>
          </div>
          <div className="row">
            <div><label>Motion Chaos</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.motion_chaos_score} onChange={e => setEisSub('motion_chaos_score', e.target.value)} /></div>
            <div><label>Camera Shake</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.camera_shake_score} onChange={e => setEisSub('camera_shake_score', e.target.value)} /></div>
          </div>
          <div className="row">
            <div><label>Audio Intensity</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.audio_intensity_score} onChange={e => setEisSub('audio_intensity_score', e.target.value)} /></div>
            <div><label>Night Bright Spots</label><input type="number" min="0" max="100" value={l1Config.eis_sub_scores.night_bright_spots_score} onChange={e => setEisSub('night_bright_spots_score', e.target.value)} /></div>
          </div>

          {/* Debug / Layers */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 6px' }}>
            <h3 style={{ margin: 0, fontSize: 13 }}>L1 Layers (Debug Pipeline)</h3>
            <button className="btn btn-secondary" onClick={() => setLayersExpanded(!layersExpanded)} style={{ fontSize: 11, padding: '2px 8px' }}>
              {layersExpanded ? 'Hide Layers' : 'Show Layers'}
            </button>
          </div>

          {layersExpanded && l1Config.layers.map((layer, idx) => (
            <div key={layer.id} style={{ border: '1px solid #333', borderRadius: 4, padding: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <strong style={{ fontSize: 12 }}>{layer.id}: {layer.name}</strong>
                <label style={{ fontSize: 11, marginLeft: 'auto' }}>
                  <input type="checkbox" checked={layer.pass} onChange={e => setLayerField(idx, 'pass', e.target.checked)} /> Pass
                </label>
              </div>
              <div className="row">
                <div><label>Score (0–100)</label><input type="number" min="0" max="100" value={layer.score100} onChange={e => setLayerField(idx, 'score100', Number(e.target.value))} /></div>
                <div><label>Cumulative</label><input type="number" min="0" max="100" value={layer.cumulative100} onChange={e => setLayerField(idx, 'cumulative100', Number(e.target.value))} /></div>
              </div>
              <div className="row">
                <div><label>Duration (ms)</label><input type="number" value={layer.ms} onChange={e => setLayerField(idx, 'ms', Number(e.target.value))} /></div>
                <div><label>Reasons (comma-sep)</label><input value={(layer.reasons || []).join(', ')} onChange={e => setLayerField(idx, 'reasons', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></div>
              </div>
            </div>
          ))}

          {/* Evidence Bundle */}
          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>Evidence Bundle</h3>
          <div className="row">
            <div><label>Session ID</label><input value={l1Config.evidence_bundle.session_id} onChange={e => setEvidence('session_id', e.target.value)} /></div>
            <div><label>File Size (bytes)</label><input type="number" value={l1Config.evidence_bundle.file_size_bytes} onChange={e => setEvidence('file_size_bytes', Number(e.target.value))} /></div>
          </div>
          <label>SHA256</label>
          <input value={l1Config.evidence_bundle.sha256} onChange={e => setEvidence('sha256', e.target.value)} style={{ fontSize: 11 }} />

          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>Signing</h3>
          <label>Signature (base64)</label>
          <input value={l1Config.evidence_bundle_signature} onChange={e => set('evidence_bundle_signature', e.target.value)} style={{ fontSize: 11 }} />
          <label>Public Key (base64)</label>
          <input value={l1Config.evidence_bundle_signing_public_key} onChange={e => set('evidence_bundle_signing_public_key', e.target.value)} style={{ fontSize: 11 }} />
          <div className="row">
            <div>
              <label>Signing Algorithm</label>
              <input value={l1Config.evidence_bundle_signing_algorithm} onChange={e => set('evidence_bundle_signing_algorithm', e.target.value)} />
            </div>
            <div>
              <label>L1 Policy Version</label>
              <input value={l1Config.l1_policy_version} onChange={e => set('l1_policy_version', e.target.value)} />
            </div>
          </div>

          {/* Capture Context */}
          <h3 style={{ margin: '12px 0 6px', fontSize: 13 }}>Capture Context</h3>
          <div className="row">
            <div>
              <label>Location Source</label>
              <select value={l1Config.capture_context.location_source} onChange={e => setNested('capture_context', 'location_source', e.target.value)}>
                <option value="device_gps">device_gps</option>
                <option value="file_exif">file_exif</option>
                <option value="network">network</option>
              </select>
            </div>
            <div>
              <label>Use Device GPS for Analysis</label>
              <select value={l1Config.capture_context.use_device_gps_for_analysis ? 'true' : 'false'} onChange={e => setNested('capture_context', 'use_device_gps_for_analysis', e.target.value === 'true')}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
          </div>
          <div className="row">
            <div><label>EXIF Latitude</label><input type="number" step="any" value={l1Config.capture_context.file_exif_latitude} onChange={e => setNested('capture_context', 'file_exif_latitude', Number(e.target.value))} /></div>
            <div><label>EXIF Longitude</label><input type="number" step="any" value={l1Config.capture_context.file_exif_longitude} onChange={e => setNested('capture_context', 'file_exif_longitude', Number(e.target.value))} /></div>
          </div>
          <label>EXIF ISO6709</label>
          <input value={l1Config.capture_context.file_exif_iso6709} onChange={e => setNested('capture_context', 'file_exif_iso6709', e.target.value)} />
        </>
      )}
    </div>
  )
}
