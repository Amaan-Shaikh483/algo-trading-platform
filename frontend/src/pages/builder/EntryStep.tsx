import { Plus, Trash2 } from 'lucide-react'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Condition, Operator } from '@algo/rule-schema'
import { newCondition } from './builderState'
import type { BuilderState } from './builderState'

export default function EntryStep({
  state,
  patch,
}: {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}) {
  const updateCondition = (id: string, partial: Partial<Condition>) =>
    patch({ entryConditions: state.entryConditions.map((c) => (c.id === id ? { ...c, ...partial } : c)) })
  const removeCondition = (id: string) => patch({ entryConditions: state.entryConditions.filter((c) => c.id !== id) })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Signals evaluated on every candle close.{' '}
          {state.entryConditions.length > 1 && state.combinator === 'and'
            ? 'Enter when ALL conditions match.'
            : state.entryConditions.length > 1
              ? 'Enter when ANY condition matches.'
              : ''}
        </p>
        {state.entryConditions.length > 1 && (
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
            {(['and', 'or'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => patch({ combinator: mode })}
                className={`rounded-md px-3 py-1.5 uppercase transition-colors ${
                  state.combinator === mode ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500'
                }`}
              >
                {mode === 'and' ? 'Match all' : 'Match any'}
              </button>
            ))}
          </div>
        )}
      </div>

      {state.entryConditions.map((condition, index) => (
        <div key={condition.id} className="relative rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Condition {index + 1}
              {index > 0 && <span className="ml-2 text-brand-600">{state.combinator.toUpperCase()}</span>}
            </span>
            <button onClick={() => removeCondition(condition.id)} className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
              <Trash2 size={15} />
            </button>
          </div>
          <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <OperandEditor
              value={condition.left}
              allowValue={false}
              onChange={(left) => updateCondition(condition.id, { left })}
            />
            <select
              className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
              value={condition.operator}
              onChange={(e) => updateCondition(condition.id, { operator: e.target.value as Operator })}
            >
              {OPERATORS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <OperandEditor
              value={condition.right}
              allowValue
              onChange={(right) => updateCondition(condition.id, { right })}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => patch({ entryConditions: [...state.entryConditions, newCondition()] })}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 py-4 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
      >
        <Plus size={16} /> Add entry condition
      </button>
    </div>
  )
}
