import { useApi } from '../api'
import { Panel, PageHeader, State } from '../components/ui'
import { num, pct } from '../lib/format'

export default function Limitations() {
  const l = useApi<{ title: string; body: string }[]>('/limitations')
  const m = useApi<any>('/metrics')
  const o = m.data?.observed
  return (
    <>
      <PageHeader title="Data & model limitations" subtitle="What this dataset and model can and cannot establish. Read before quoting any number from this app." />
      {!l.data ? <State loading={l.loading} error={l.error} /> : (
        <div className="space-y-3">
          {l.data.map((x, i) => (
            <Panel key={i}><h2 className="text-sm font-semibold">{i + 1}. {x.title}</h2><p className="mt-1 text-sm leading-relaxed text-slate-600">{x.body}</p></Panel>
          ))}
        </div>
      )}
      {o && (
        <Panel className="mt-4" title="Matching & exclusion facts (from this run)">
          <ul className="space-y-1 text-sm text-slate-600">
            <li>Credit-note product rows matched to an earlier purchase: <b>{num(o.data_prep.matching.credit_rows_with_match)}</b> of {num(o.data_prep.matching.credit_rows_total)} ({pct(o.data_prep.matching.credit_rows_with_match / o.data_prep.matching.credit_rows_total)}).</li>
            <li>Credited units matched: {pct(o.data_prep.matching.credit_units_matched / o.data_prep.matching.credit_units_total)}.</li>
            <li>Purchase rows without Customer ID (excluded): {num(o.data_prep.purchase_rows_missing_customer)}.</li>
            <li>Exact duplicate rows removed: {num(o.data_prep.exact_duplicates_removed)}.</li>
          </ul>
        </Panel>
      )}
    </>
  )
}
