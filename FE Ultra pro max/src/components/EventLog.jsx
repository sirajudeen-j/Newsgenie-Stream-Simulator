import React, { useEffect, useRef } from 'react'

export default function EventLog({ logs, clearLog }) {
  const boxRef = useRef(null)

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [logs])

  return (
    <div className="panel" style={{ height: '100%' }}>
      <h2>Event Log</h2>
      <div className="log-box" ref={boxRef}>
        {logs.map((l, i) => (
          <span key={i} className={`log-${l.cls}`}>
            [{l.ts}] {l.msg}{'\n'}
          </span>
        ))}
      </div>
    </div>
  )
}
