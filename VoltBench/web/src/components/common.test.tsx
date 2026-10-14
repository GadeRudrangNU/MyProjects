import { fireEvent, render, screen } from '@testing-library/react'
import { StatusBadge, VerdictCell, pct } from './common'
import type { Verdict } from '../types'

describe('VerdictCell', () => {
  it.each<Verdict>(['PASS', 'FAIL', 'ERROR', 'FLAKY'])('renders the %s state', (verdict) => {
    render(<VerdictCell verdict={verdict} />)
    const cell = screen.getByText(verdict)
    expect(cell).toHaveClass(`verdict-${verdict.toLowerCase()}`)
  })

  it('renders a placeholder when no test applies', () => {
    render(<VerdictCell />)
    expect(screen.getByText('–')).toBeInTheDocument()
  })

  it('is clickable', () => {
    const onClick = vi.fn()
    render(<VerdictCell verdict="FAIL" onClick={onClick} />)
    fireEvent.click(screen.getByText('FAIL'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('helpers', () => {
  it('shows device status', () => {
    render(<StatusBadge status="DEGRADED" />)
    expect(screen.getByText('DEGRADED')).toHaveClass('status-degraded')
  })

  it('formats ratios', () => {
    expect(pct(0.9567)).toBe('95.7%')
    expect(pct(null)).toBe('n/a')
  })
})
