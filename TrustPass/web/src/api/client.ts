import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

let accessToken: string | null = null
let onSessionLost: (() => void) | null = null

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token
  },
  onSessionLost: (handler: (() => void) | null) => {
    onSessionLost = handler
  },
}

const http = axios.create({ baseURL: API_URL, withCredentials: true })

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return config
})

let refreshing: Promise<string | null> | null = null

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post<{ accessToken: string }>(`${API_URL}/auth/refresh`, null, { withCredentials: true })
      .then((response) => {
        accessToken = response.data.accessToken
        return accessToken
      })
      .catch(() => {
        accessToken = null
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

type Retryable = AxiosRequestConfig & { _retried?: boolean }

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as Retryable | undefined
    const isAuthCall = original?.url?.startsWith('/auth/') ?? false
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true
      const token = await refreshAccessToken()
      if (token) {
        return http(original)
      }
      onSessionLost?.()
    }
    return Promise.reject(error)
  },
)

export const customInstance = <T>(config: AxiosRequestConfig, options?: AxiosRequestConfig): Promise<T> =>
  http({ ...config, ...options }).then(({ data }) => data as T)

export type ErrorType<E> = AxiosError<E>
export type BodyType<B> = B

export interface ApiErrorBody {
  code?: string
  message?: string
  requestId?: string
  fieldErrors?: Record<string, string>
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined
    if (body?.fieldErrors) {
      const first = Object.values(body.fieldErrors)[0]
      if (first) return first
    }
    if (body?.message) return body.message
    if (!error.response) return 'Cannot reach the server. Check that the API is running.'
  }
  return fallback
}

export function errorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as ApiErrorBody | undefined)?.code
  }
  return undefined
}
