import { useEffect, useState } from 'react'
import { sendCommand } from '../api'
import { useOffice } from '../store/hooks'

/** Pause all / Resume, and the big red Stop now with an in-app confirm step. */
export function Controls() {
  const enginePaused = useOffice((s) => s.allPaused)
  const [paused, setPaused] = useState(enginePaused)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => setPaused(enginePaused), [enginePaused])

  return (
    <div className="controls">
      <button
        data-testid="pause-all"
        onClick={() => {
          sendCommand({ type: paused ? 'resumeAll' : 'pauseAll' })
          setPaused(!paused)
        }}
      >
        {paused ? 'Resume all' : 'Pause all'}
      </button>
      {confirming ? (
        <span className="confirm" data-testid="stop-confirm">
          Stop every job now?
          <button
            className="danger"
            data-testid="stop-confirm-yes"
            onClick={() => {
              sendCommand({ type: 'stopNow' })
              setConfirming(false)
            }}
          >
            Yes, stop
          </button>
          <button onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <button className="stop-now" data-testid="stop-now" onClick={() => setConfirming(true)}>
          STOP NOW
        </button>
      )}
    </div>
  )
}
