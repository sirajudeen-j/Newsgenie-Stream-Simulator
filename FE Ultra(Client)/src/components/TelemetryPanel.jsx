import React from 'react'

export default function TelemetryPanel({ telemetry, setTelemetry, mode }) {
  const set = (key, val) => setTelemetry(prev => ({ ...prev, [key]: val }))

  const adjust = (key, delta) => {
    setTelemetry(prev => {
      const val = parseFloat(prev[key] || 0)
      return { ...prev, [key]: (val + delta).toFixed(4) }
    })
  }

  const adjustTime = (key, deltaMs) => {
    setTelemetry(prev => {
      const current = prev[key] ? new Date(prev[key]).getTime() : Date.now()
      return { ...prev, [key]: new Date(current + deltaMs).toISOString().slice(0, 16) }
    })
  }

  const setNow = (key) => set(key, new Date().toISOString().slice(0, 16))

  return (
    <div className="panel">
      <h2>Telemetry & Claims</h2>
      <p className="note">Sent as telemetry in WebSocket metadata and upload payload.</p>

      <div className="row">
        <div>
          <label>Claimed Lat</label>
          <input type="number" step="any" value={telemetry.device_lat} onChange={e => set('device_lat', e.target.value)} />
        </div>
        <div>
          <label>Claimed Lon</label>
          <input type="number" step="any" value={telemetry.device_lon} onChange={e => set('device_lon', e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div style={{ gridColumn: 'span 2' }}>
          <label>Claimed Location Caption</label>
          <input value={telemetry.claimed_location_caption || ''} onChange={e => set('claimed_location_caption', e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div style={{ gridColumn: 'span 2' }}>
          <label>Claimed Time (telemetry_timestamp source)</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary" onClick={() => adjustTime('claimed_time', -60000)}>-1m</button>
            <input type="datetime-local" value={telemetry.claimed_time || ''} onChange={e => set('claimed_time', e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={() => adjustTime('claimed_time', 60000)}>+1m</button>
            <button className="btn btn-secondary" onClick={() => setNow('claimed_time')}>Now</button>
          </div>
        </div>
      </div>

      <div className="row">
        <div><label>Geo Accuracy (m)</label><input type="number" step="any" value={telemetry.geo_accuracy_m} onChange={e => set('geo_accuracy_m', e.target.value)} /></div>
        <div><label>Network Offset (ms)</label><input type="number" value={telemetry.network_time_offset_ms} onChange={e => set('network_time_offset_ms', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Manufacturer</label><input value={telemetry.device_manufacturer} onChange={e => set('device_manufacturer', e.target.value)} /></div>
        <div><label>Model</label><input value={telemetry.device_model} onChange={e => set('device_model', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>SDK</label><input type="number" value={telemetry.android_sdk} onChange={e => set('android_sdk', e.target.value)} /></div>
        <div><label>Release</label><input value={telemetry.android_release} onChange={e => set('android_release', e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Capture Mode</label><input value={mode} readOnly /></div>
      </div>
    </div>
  )
}
