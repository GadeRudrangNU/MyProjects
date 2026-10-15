import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { refreshAccessToken, tokenStore } from '@/api/client'
import { getCurrentUser, logout as logoutRequest } from '@/api/generated/trustpass'
import type { UserView } from '@/api/generated/model'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthState {
  status: Status
  user: UserView | null
  signIn: (accessToken: string, user: UserView) => void
  adoptSession: () => Promise<boolean>
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<UserView | null>(null)
  const queryClient = useQueryClient()

  const clear = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  const adoptSession = useCallback(async () => {
    const token = await refreshAccessToken()
    if (!token) {
      clear()
      return false
    }
    try {
      setUser(await getCurrentUser())
      setStatus('authenticated')
      return true
    } catch {
      clear()
      return false
    }
  }, [clear])

  useEffect(() => {
    tokenStore.onSessionLost(clear)
    void adoptSession()
    return () => tokenStore.onSessionLost(null)
  }, [adoptSession, clear])

  const signIn = useCallback((accessToken: string, signedIn: UserView) => {
    tokenStore.set(accessToken)
    setUser(signedIn)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      clear()
    }
  }, [clear])

  const reload = useCallback(async () => {
    setUser(await getCurrentUser())
  }, [])

  const value = useMemo(
    () => ({ status, user, signIn, adoptSession, signOut, reload }),
    [status, user, signIn, adoptSession, signOut, reload],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
