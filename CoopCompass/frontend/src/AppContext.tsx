import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, sendSessionEvent } from './api'
import type { Health, Profile } from './types'

interface AppState {
  health: Health | null
  healthError: Error | null
  profile: Profile | null
  profileLoaded: boolean
  refreshProfile: () => Promise<void>
  retry: () => void
  dataVersion: number
  bumpData: () => void
  openAddJob: () => void
  addJobOpen: boolean
  closeAddJob: () => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [addJobOpen, setAddJobOpen] = useState(false)

  const refreshProfile = useCallback(async () => {
    try { setProfile(await api.getProfile()) } catch {}
    setProfileLoaded(true)
  }, [])

  const load = useCallback(() => {
    setHealthError(null)
    api.health().then(setHealth).catch((e) => setHealthError(e as Error))
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    load()
    sendSessionEvent('session_start')
    const end = () => sendSessionEvent('session_end')
    window.addEventListener('pagehide', end)
    return () => window.removeEventListener('pagehide', end)
  }, [load])

  const value = useMemo<AppState>(() => ({
    health, healthError, profile, profileLoaded, refreshProfile, retry: load,
    dataVersion, bumpData: () => setDataVersion((v) => v + 1),
    openAddJob: () => setAddJobOpen(true), addJobOpen, closeAddJob: () => setAddJobOpen(false),
  }), [health, healthError, profile, profileLoaded, refreshProfile, load, dataVersion, addJobOpen])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside AppProvider')
  return v
}
