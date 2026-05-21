import React from 'react'

const PARTS = [
  { label: 'Y', key: 'year', pad: 4, min: 2000, max: 2099 },
  { label: 'M', key: 'month', pad: 2, min: 1, max: 12 },
  { label: 'D', key: 'day', pad: 2, min: 1, max: 31 },
  { label: 'h', key: 'hour', pad: 2, min: 0, max: 23 },
  { label: 'm', key: 'min', pad: 2, min: 0, max: 59 },
  { label: 's', key: 'sec', pad: 2, min: 0, max: 59 },
]

const SEPS = { 2: '-', 4: '-', 6: 'T', 8: ':', 10: ':' }

function parseValue(val) {
  if (!val || typeof val !== 'string') {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth()+1, day: n.getDate(), hour: n.getHours(), min: n.getMinutes(), sec: n.getSeconds() }
  }
  const s = val.replace('T', ' ').replace('Z', '')
  const [dp, tp] = s.split(' ')
  const [y, m, d] = (dp || '').split('-').map(Number)
  const [h, mi, sc] = (tp || '00:00:00').split(':').map(Number)
  return { year: y||2025, month: m||1, day: d||1, hour: h||0, min: mi||0, sec: sc||0 }
}

function formatValue(p) {
  return `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}T${String(p.hour).padStart(2,'0')}:${String(p.min).padStart(2,'0')}:${String(p.sec).padStart(2,'0')}`
}

function wrap(val, min, max) {
  const range = max - min + 1
  return ((val - min + range) % range) + min
}

const colStyle = { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', margin: '0 1px' }
const btnStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(100,200,255,0.12)', color: 'rgba(180,220,255,0.7)', fontSize: '0.5rem', padding: '2px 6px', cursor: 'pointer', borderRadius: 3, lineHeight: 1, userSelect: 'none' }
const inputBase = { textAlign: 'center', padding: '4px 2px', fontSize: '0.85rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", background: 'rgba(8,8,16,0.8)', border: '1px solid rgba(100,200,255,0.15)', borderRadius: 4, color: '#e0f0ff', margin: '2px 0' }
const sepStyle = { fontSize: '0.85rem', color: 'rgba(100,200,255,0.3)', fontWeight: 700, alignSelf: 'center', margin: '0 1px', paddingBottom: 12 }
const lblStyle = { fontSize: '0.45rem', color: 'rgba(140,160,190,0.4)', textTransform: 'uppercase', marginTop: 1 }

export default function DigitTimePicker({ value, onChange, label }) {
  const parts = parseValue(value)

  const adjust = (key, delta) => {
    const p = PARTS.find(x => x.key === key)
    onChange(formatValue({ ...parts, [key]: wrap(parts[key] + delta, p.min, p.max) }))
  }

  const setDirect = (key, raw) => {
    const num = parseInt(raw, 10)
    if (isNaN(num)) return
    const p = PARTS.find(x => x.key === key)
    onChange(formatValue({ ...parts, [key]: Math.max(p.min, Math.min(p.max, num)) }))
  }

  return (
    <div style={{ margin: '8px 0' }}>
      {label && <label>{label}</label>}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', marginTop: 4 }}>
        {PARTS.map((p, i) => (
          <React.Fragment key={p.key}>
            {i === 3 && <span style={sepStyle}>T</span>}
            {(i === 1 || i === 2) && <span style={sepStyle}>-</span>}
            {(i === 4 || i === 5) && <span style={sepStyle}>:</span>}
            <div style={colStyle}>
              <button type="button" style={btnStyle} onClick={() => adjust(p.key, 1)}>▲</button>
              <input
                style={{ ...inputBase, width: p.pad === 4 ? 46 : 30 }}
                value={String(parts[p.key]).padStart(p.pad, '0')}
                onChange={e => setDirect(p.key, e.target.value)}
                onWheel={e => { e.preventDefault(); adjust(p.key, e.deltaY < 0 ? 1 : -1) }}
              />
              <button type="button" style={btnStyle} onClick={() => adjust(p.key, -1)}>▼</button>
              <span style={lblStyle}>{p.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
