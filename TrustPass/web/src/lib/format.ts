export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function dateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function dateOnly(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
}

export function timeRange(start: string, end: string): string {
  const time = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' })
  return `${time.format(new Date(start))} – ${time.format(new Date(end))}`
}

export function dayKey(value: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(value))
}

export function shortDay(value: string): string {
  const [, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}`
}

export function describeAgent(agent: string): string {
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Unknown browser'
  const system = /Windows/.test(agent) ? 'Windows' : /Mac OS/.test(agent) ? 'macOS' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Linux/.test(agent) ? 'Linux' : 'unknown system'
  return agent === 'unknown' ? 'Unknown device' : `${browser} on ${system}`
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
