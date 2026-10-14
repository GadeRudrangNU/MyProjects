import Editor, { type OnMount } from '@monaco-editor/react'
import { useMemo, useRef, useState } from 'react'
import { useCreateDefinitionMutation, useGetDefinitionsQuery, useLazyGetDefinitionQuery } from '../api'
import { Empty, ErrorState, Loading } from '../components/common'
import type { Definition, ValidationError } from '../types'

const TEMPLATE = `name: my_range_check
kind: custom
device_type: ANY
version: 1
description: Describe what this test proves.
steps:
  - sample:
      signals: monitored
      duration_ms: 3000
  - assert_each: "range_lo <= mean <= range_hi"
`

type Monaco = Parameters<OnMount>[1]
type CodeEditor = Parameters<OnMount>[0]

export default function Definitions() {
  const { data, error, isLoading, refetch } = useGetDefinitionsQuery()
  const [load] = useLazyGetDefinitionQuery()
  const [create, state] = useCreateDefinitionMutation()
  const [text, setText] = useState(TEMPLATE)
  const [selected, setSelected] = useState<number | null>(null)
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [notice, setNotice] = useState('')
  const editor = useRef<CodeEditor | null>(null)
  const monaco = useRef<Monaco | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, Definition[]>()
    for (const d of data ?? []) map.set(d.name, [...(map.get(d.name) ?? []), d])
    return [...map.entries()]
  }, [data])

  const mark = (errs: ValidationError[]) => {
    const model = editor.current?.getModel()
    if (!model || !monaco.current) return
    monaco.current.editor.setModelMarkers(
      model,
      'voltbench',
      errs.map((e) => ({
        severity: monaco.current!.MarkerSeverity.Error,
        message: e.message,
        startLineNumber: e.line,
        startColumn: e.column,
        endLineNumber: e.line,
        endColumn: model.getLineMaxColumn(Math.min(e.line, model.getLineCount())),
      })),
    )
  }

  const open = async (id: number) => {
    const res = await load(id).unwrap()
    setSelected(id)
    setText(res.spec_yaml ?? '')
    setErrors([])
    mark([])
    setNotice(`Loaded ${res.name} v${res.version}. Bump the version to save changes.`)
  }

  const save = async () => {
    setNotice('')
    const res = await create(text)
    if ('error' in res) {
      const body = res.error as { errors?: ValidationError[]; error?: string }
      const errs = body.errors ?? []
      setErrors(errs)
      mark(errs)
      if (!errs.length) setNotice(body.error ?? 'Could not save the definition.')
      return
    }
    setErrors([])
    mark([])
    setNotice('Saved.')
  }

  return (
    <section>
      <header className="page-head">
        <h1>Test definitions</h1>
        <button
          className="btn secondary"
          onClick={() => {
            setText(TEMPLATE)
            setSelected(null)
            setErrors([])
            mark([])
            setNotice('')
          }}
        >
          New from template
        </button>
      </header>
      <div className="split">
        <aside className="panel list">
          {isLoading && <Loading what="definitions" />}
          {error && <ErrorState error={error} retry={refetch} />}
          {data?.length === 0 && <Empty>No test definitions yet.</Empty>}
          {grouped.map(([name, versions]) => (
            <div key={name} className="def-group">
              <div className="def-name">{name}</div>
              {versions.map((v) => (
                <button key={v.id} className={`def-version ${selected === v.id ? 'active' : ''}`} onClick={() => open(v.id)}>
                  v{v.version} <span className="muted">{v.device_type}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="editor-col">
          <div className="editor-box" data-testid="yaml-editor">
            <Editor
              height="420px"
              language="yaml"
              theme="vs-dark"
              value={text}
              onChange={(v) => setText(v ?? '')}
              onMount={(e, m) => {
                editor.current = e
                monaco.current = m
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
          <div className="row">
            <button className="btn" onClick={save} disabled={state.isLoading}>
              Validate and save
            </button>
            {notice && <span className="muted">{notice}</span>}
          </div>
          {errors.length > 0 && (
            <ul className="errors" role="alert" data-testid="definition-errors">
              {errors.map((e, i) => (
                <li key={i}>
                  <button className="link" onClick={() => editor.current?.revealLineInCenter(e.line)}>
                    line {e.line}
                  </button>
                  : {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
