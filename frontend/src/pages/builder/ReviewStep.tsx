import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { summarizeRules, validateStrategyRules } from '@algo/rule-schema'
import { Alert } from '../../components/ui'
import { toRules } from './builderState'
import type { BuilderState } from './builderState'

/** Step 5 — human-readable summary + collapsible raw JSON (spec §3.4 transparency). */
export default function ReviewStep({ state }: { state: BuilderState }) {
  const [jsonOpen, setJsonOpen] = useState(false)
  const rules = toRules(state)
  const { valid, errors } = validateStrategyRules(rules)
  const summary = summarizeRules(rules)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Instrument', state.instrument?.symbol ?? '—'],
          ['Exchange', state.instrument?.exchange ?? '—'],
          ['Segment', state.segment],
          ['Timeframe', state.timeframe],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{k}</p>
            <p className="mt-0.5 text-sm font-semibold capitalize text-gray-900">{v}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Rule summary</p>
        <ul className="space-y-1.5">
          {summary.map((line, i) => (
            <li key={i} className="text-sm text-gray-700">
              {line}
            </li>
          ))}
        </ul>
      </div>

      {!valid && (
        <Alert tone="red" title="Fix before saving">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="rounded-xl border border-gray-200">
        <button
          type="button"
          onClick={() => setJsonOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <span>Rule JSON (schema v{rules.version})</span>
          {jsonOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {jsonOpen && (
          <pre className="max-h-72 overflow-auto border-t border-gray-200 bg-gray-950 p-4 text-xs leading-5 text-emerald-300">
            {JSON.stringify(rules, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
