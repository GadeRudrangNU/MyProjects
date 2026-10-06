import { useEffect, useRef, useState } from 'react'
import { sendTimeRecord } from '../api'
import { ActiveTimeCounter } from '../lib/activeTime'
import type { TimeKind } from '../types'

export function useActiveTime(kind: TimeKind, jobId: number | null, applicationId?: number | null): number {
  const [seconds, setSeconds] = useState(0)
  const appRef = useRef(applicationId)
  useEffect(() => { appRef.current = applicationId }, [applicationId])

  useEffect(() => {
    if (jobId === null || Number.isNaN(jobId)) return
    const counter = new ActiveTimeCounter(Date.now())
    let total = 0
    const flush = (final: boolean) => {
      const n = counter.take(final)
      if (n > 0) sendTimeRecord({ job_id: jobId, application_id: appRef.current, kind, seconds: n })
    }
    const onInteract = () => counter.interact(Date.now())
    const onVisibility = () => {
      counter.visible = document.visibilityState === 'visible'
      if (!counter.visible) flush(false)
      else counter.interact(Date.now())
    }
    const onUnload = () => flush(true)
    counter.visible = document.visibilityState === 'visible'

    const events = ['pointerdown', 'keydown', 'scroll', 'pointermove', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onInteract, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onUnload)

    let ticks = 0
    const tickTimer = window.setInterval(() => {
      if (counter.tick(Date.now())) total += 1
      ticks += 1
      if (ticks % 5 === 0) setSeconds(total)
    }, 1000)
    const flushTimer = window.setInterval(() => flush(false), 60_000)

    return () => {
      window.clearInterval(tickTimer)
      window.clearInterval(flushTimer)
      events.forEach((e) => window.removeEventListener(e, onInteract))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onUnload)
      flush(true)
    }
  }, [kind, jobId])

  return seconds
}
