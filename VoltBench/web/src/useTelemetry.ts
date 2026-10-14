import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { connection, flushed, ingest, resetLive, snapshot, type WireUpdate } from './live'
import type { AppDispatch } from './store'

export function wsUrl(path: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${path}`
}

/** Streams live telemetry for the given devices and flushes at most once per animation frame. */
export function useTelemetry(deviceIds: number[]) {
  const dispatch = useDispatch<AppDispatch>()
  const key = deviceIds.join(',')

  useEffect(() => {
    if (!key) return
    resetLive()
    let socket: WebSocket | null = null
    let closed = false
    let retry = 500
    let frame = 0
    let dirty = false

    const flush = () => {
      frame = 0
      if (!dirty) return
      dirty = false
      dispatch(flushed(snapshot()))
    }

    const open = () => {
      socket = new WebSocket(wsUrl(`/ws/telemetry?devices=${key}`))
      socket.onopen = () => {
        retry = 500
        dispatch(connection(true))
      }
      socket.onmessage = (ev) => {
        ingest(JSON.parse(ev.data) as WireUpdate)
        dirty = true
        if (!frame) frame = requestAnimationFrame(flush)
      }
      socket.onclose = () => {
        dispatch(connection(false))
        if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 5000)))
      }
    }
    open()

    return () => {
      closed = true
      if (frame) cancelAnimationFrame(frame)
      socket?.close()
      dispatch(connection(false))
    }
  }, [key, dispatch])
}
