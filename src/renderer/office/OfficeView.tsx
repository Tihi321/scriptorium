import { useEffect, useRef } from 'react'
import { Tooltip } from '../ui/Tooltip'

/** The Phaser canvas. Phaser is loaded on demand so the first paint does not wait for it. */
export function OfficeView() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let handle: { destroy(): void; refresh(): void } | undefined
    let cancelled = false
    const observer = new ResizeObserver(() => handle?.refresh())
    if (ref.current) observer.observe(ref.current)
    void import('./scene').then(({ createOffice }) => {
      if (cancelled || !ref.current) return
      handle = createOffice(ref.current)
    })
    return () => {
      cancelled = true
      observer.disconnect()
      handle?.destroy()
    }
  }, [])
  return (
    <div className="office" data-testid="office">
      <div className="office-canvas" ref={ref} />
      <Tooltip />
    </div>
  )
}
