import React from 'react'

export default function ExifPanel({ exif, setExif, telemetry }) {
  const set = (key, val) => setExif(prev => ({ ...prev, [key]: val }))

  const setTimesNow = () => {
    const now = new Date().toISOString()
    setExif(prev => ({ ...prev, creation_time: now }))
  }

  const syncFromTelemetry = () => {
    setExif(prev => ({
      ...prev,
      gps_lat: Number(telemetry.device_lat),
      gps_lon: Number(telemetry.device_lon),
    }))
  }

  return (
    <div className="panel">
      <h2>EXIF Metadata (embedded per chunk)</h2>
      <p className="note">
        These are written as ffmpeg format-level tags. The backend reads them via ffprobe
        (format.tags.com.android.model, format.tags.location, format.tags.creation_time).
        Change anytime during streaming.
      </p>
      <div className="row">
        <div><label>GPS Latitude</label><input type="number" step="any" value={exif.gps_lat} onChange={e => set('gps_lat', Number(e.target.value))} /></div>
        <div><label>GPS Longitude</label><input type="number" step="any" value={exif.gps_lon} onChange={e => set('gps_lon', Number(e.target.value))} /></div>
      </div>
      <label>Creation Time (ISO 8601)</label>
      <input value={exif.creation_time} onChange={e => set('creation_time', e.target.value)} />
      <div className="row">
        <div><label>Android Model (com.android.model)</label><input value={exif.android_model || ''} onChange={e => set('android_model', e.target.value)} placeholder="e.g. 2201117TG, SM-S926B" /></div>
        <div><label>Android Manufacturer</label><input value={exif.android_manufacturer || ''} onChange={e => set('android_manufacturer', e.target.value)} placeholder="e.g. Xiaomi, Samsung" /></div>
      </div>
      <div className="row">
        <div><label>Android Version</label><input value={exif.android_version || ''} onChange={e => set('android_version', e.target.value)} placeholder="e.g. 13, 14, 15" /></div>
        <div><label>Capture FPS</label><input value={exif.capture_fps || ''} onChange={e => set('capture_fps', e.target.value)} placeholder="e.g. 30.000000" /></div>
      </div>
      <div className="row">
        <div><label>Xiaomi Normal Video</label><input value={exif.xiaomi_normal_video || ''} onChange={e => set('xiaomi_normal_video', e.target.value)} placeholder="e.g. 30 (leave empty if not Xiaomi)" /></div>
        <div><label>Rotation (degrees)</label><input type="number" value={exif.rotation ?? 0} onChange={e => set('rotation', Number(e.target.value))} placeholder="e.g. -90, 0, 90, 180" /></div>
      </div>
      <div className="row">
        <div><label>Video Handler Name</label><input value={exif.video_handler_name || ''} onChange={e => set('video_handler_name', e.target.value)} placeholder="VideoHandle" /></div>
        <div><label>Audio Handler Name</label><input value={exif.audio_handler_name || ''} onChange={e => set('audio_handler_name', e.target.value)} placeholder="SoundHandle" /></div>
      </div>
      <div className="row">
        <div>
          <div className="checkbox-row" style={{ marginTop: 22 }}>
            <input type="checkbox" checked={exif.strip_audio || false} onChange={e => set('strip_audio', e.target.checked)} />
            <label style={{ margin: 0 }}>Strip audio (simulates AI-generated)</label>
          </div>
        </div>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn btn-secondary" onClick={setTimesNow}>Set Time to Now</button>
        <button className="btn btn-secondary" onClick={syncFromTelemetry}>Copy GPS from Telemetry</button>
      </div>
    </div>
  )
}
