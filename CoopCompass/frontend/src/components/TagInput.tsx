import { useId, useState } from 'react'

export function TagInput({ label, value, onChange, placeholder, suggestions }: {
  label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')
  const id = useId()
  const add = (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setDraft('')
  }
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-300 bg-white p-1.5 focus-within:ring-2 focus-within:ring-accent-600">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-800">
            {t}
            <button type="button" className="text-slate-500 hover:text-red-700" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>✕</button>
          </span>
        ))}
        <input id={id} value={draft} placeholder={value.length ? '' : placeholder ?? 'Type and press Enter'} list={suggestions ? `${id}-sg` : undefined}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => add(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft) }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }} />
      </div>
      {suggestions && <datalist id={`${id}-sg`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  )
}
