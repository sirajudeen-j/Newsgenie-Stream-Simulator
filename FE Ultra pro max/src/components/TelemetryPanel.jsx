import React from 'react'
import DigitTimePicker from './DigitTimePicker'

export default function TelemetryPanel({ telemetry, setTelemetry, mode }) {
  const set = (key, val) => setTelemetry(prev => ({ ...prev, [key]: val }))

  const adjust = (key, delta) => {
    setTelemetry(prev => {
      const val = parseFloat(prev[key] || 0)
      return { ...prev, [key]: (val + delta).toFixed(4) }
    })
  }

  const syncForensics = () => {
    setTelemetry(prev => ({
      ...prev,
      injected_lat: prev.device_lat,
      injected_lon: prev.device_lon,
      injected_time: prev.claimed_time,
      injected_model: prev.device_model,
    }))
  }

  return (
    <div className="panel">
      <h2>1. Claimed Telemetry (JSON)</h2>
      <p className="note">What the app "claims" to the backend via JSON.</p>
      
      <div className="row">
        <div>
          <label>Claimed Lat</label>
          <div className="regulator">
            <button onClick={() => adjust('device_lat', -0.001)}>-</button>
            <input type="number" step="any" value={telemetry.device_lat} onChange={e => set('device_lat', e.target.value)} />
            <button onClick={() => adjust('device_lat', 0.001)}>+</button>
          </div>
        </div>
        <div>
          <label>Claimed Lon</label>
          <div className="regulator">
            <button onClick={() => adjust('device_lon', -0.001)}>-</button>
            <input type="number" step="any" value={telemetry.device_lon} onChange={e => set('device_lon', e.target.value)} />
            <button onClick={() => adjust('device_lon', 0.001)}>+</button>
          </div>
        </div>
      </div>

      <DigitTimePicker
        label="Telemetry Timestamp (Claimed)"
        value={telemetry.claimed_time}
        onChange={val => set('claimed_time', val)}
      />
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="btn-mini" onClick={() => set('claimed_time', new Date().toISOString().slice(0, 19))}>Now</button>
        <button className="btn-mini" onClick={() => set('claimed_time', new Date(Date.now() - 3600000).toISOString().slice(0, 19))}>-1h</button>
        <button className="btn-mini" onClick={() => set('claimed_time', new Date(Date.now() - 86400000).toISOString().slice(0, 19))}>-24h</button>
      </div>

      <div className="row">
        <div><label>Manufacturer</label><input value={telemetry.device_manufacturer} onChange={e => set('device_manufacturer', e.target.value)} /></div>
        <div><label>Model</label><input value={telemetry.device_model} onChange={e => set('device_model', e.target.value)} /></div>
      </div>

      <hr />
      <h2 style={{ color: '#F44336' }}>2. Forensic Injection Lab (EXIF)</h2>
      <p className="note">What is actually embedded in the video file via Proxy.</p>
      
      <div className="row" style={{ alignItems: 'center' }}>
        <label className="toggle">
          <input type="checkbox" checked={telemetry.enable_injection} onChange={e => set('enable_injection', e.target.checked)} />
          <span className="slider"></span>
          Enable Metadata Injection
        </label>
        <button className="btn-mini" onClick={syncForensics} style={{ marginLeft: 'auto' }}>Sync with Telemetry</button>
      </div>

      {telemetry.enable_injection && (
        <div className="injection-controls">
          <div className="row">
            <div>
              <label>Injected Lat</label>
              <div className="regulator">
                <button onClick={() => adjust('injected_lat', -0.001)}>-</button>
                <input type="number" step="any" value={telemetry.injected_lat || telemetry.device_lat} onChange={e => set('injected_lat', e.target.value)} />
                <button onClick={() => adjust('injected_lat', 0.001)}>+</button>
              </div>
            </div>
            <div>
              <label>Injected Lon</label>
              <div className="regulator">
                <button onClick={() => adjust('injected_lon', -0.001)}>-</button>
                <input type="number" step="any" value={telemetry.injected_lon || telemetry.device_lon} onChange={e => set('injected_lon', e.target.value)} />
                <button onClick={() => adjust('injected_lon', 0.001)}>+</button>
              </div>
            </div>
          </div>
          <div className="row">
            <div><label>Injected Model</label><input value={telemetry.injected_model || telemetry.device_model} onChange={e => set('injected_model', e.target.value)} /></div>
          </div>
          
          <DigitTimePicker
            label="Timestamp Override (EXIF)"
            value={telemetry.injected_time}
            onChange={val => set('injected_time', val)}
          />
          <div className="actions" style={{ marginTop: 4 }}>
            <button className="btn-mini" onClick={() => set('injected_time', new Date().toISOString().slice(0, 19))}>Now</button>
            <button className="btn-mini" onClick={() => set('injected_time', new Date(Date.now() - 3600000).toISOString().slice(0, 19))}>-1h</button>
            <button className="btn-mini" onClick={() => set('injected_time', new Date(Date.now() - 86400000).toISOString().slice(0, 19))}>-24h</button>
          </div>

          <div className="row-toggles">
            <label><input type="checkbox" checked={telemetry.strip_audio} onChange={e => set('strip_audio', e.target.checked)} /> Strip Audio</label>
            <label><input type="checkbox" checked={telemetry.preserve_fingerprint} onChange={e => set('preserve_fingerprint', e.target.checked)} /> Leak Fingerprint</label>
          </div>
        </div>
      )}
    </div>
  )
}
