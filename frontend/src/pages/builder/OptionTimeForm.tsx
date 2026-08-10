import { Plus } from 'lucide-react'
import { TextInput } from '../../components/ui'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Operator } from '@algo/rule-schema'
import OptionLegCard from './OptionLegCard'
import {
  ORDER_TYPE_OPTIONS,
  PROFIT_TRAILING_OPTIONS,
  newCondition,
  newOptionLeg,
} from './builderState'
import type { BuilderState, Underlying } from './builderState'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}

// ── Strategy Legs Section (time-triggered) ──────────────────────────────────

function StrategyLegsSection({
  legs,
  onChange,
}: {
  legs: BuilderState['legs']
  onChange: (legs: BuilderState['legs']) => void
}) {
  const updateLeg = (id: string, partial: Partial<BuilderState['legs'][0]>) => {
    onChange(legs.map((l) => (l.id === id ? { ...l, ...partial } : l)))
  }

  const removeLeg = (id: string) => {
    if (legs.length <= 1) return
    onChange(legs.filter((l) => l.id !== id))
  }

  const addLeg = () => {
    onChange([...legs, newOptionLeg(legs.length + 1)])
  }

  return (
    <SectionCard title="Strategy Legs (Time-Triggered)">
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm text-brand-700">
          <p className="font-semibold">Time-based option legs</p>
          <p className="mt-1 text-xs text-brand-600">
            Each leg executes at its Entry Time. Pick the action (BUY/SELL), option type (CE/PE), strike and
            expiry for every leg. Legs without an entry time stay inactive for automatic entry.
          </p>
        </div>
        {legs.map((leg) => (
          <OptionLegCard
            key={leg.id}
            leg={leg}
            onUpdate={(partial) => updateLeg(leg.id, partial)}
            onRemove={() => removeLeg(leg.id)}
            canRemove={legs.length > 1}
            showEntryTime
          />
        ))}
        <button
          type="button"
          onClick={addLeg}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <Plus size={16} /> Add Leg
        </button>
      </div>
    </SectionCard>
  )
}

// ── Main Option Time Form ────────────────────────────────────────────────────

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}

export default function OptionTimeForm({ state, patch }: Props) {
  const handleRiskFieldChange = (field: string, value: string) => {
    patch({ [field]: value } as Partial<BuilderState>)
  }

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
        <p className="font-semibold">Option Trading - Time Based</p>
        <p className="mt-1 text-xs text-brand-600">
          Configure options trades triggered by time conditions. No complex indicator logic needed — 
          perfect for expiry-based and clock-time strategies.
        </p>
      </div>

      {/* Underlying */}
      <SectionCard title="Underlying Selection">
        <Field label="Underlying" required>
          <div className="flex gap-2">
            {(['Spot', 'Future'] as Underlying[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => patch({ underlying: u })}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  state.underlying === u ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </Field>
      </SectionCard>

      {/* Order Type */}
      <SectionCard title="Order Type">
        <div className="flex flex-wrap gap-3">
          {ORDER_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 transition-colors ${
                state.optOrderType === opt.value
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="optTimeOrderType"
                value={opt.value}
                checked={state.optOrderType === opt.value}
                onChange={() => patch({ optOrderType: opt.value })}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs text-gray-400">({opt.desc})</span>
            </label>
          ))}
        </div>
      </SectionCard>

      {/* Timing */}
      <SectionCard title="Timing">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Start Time"
            type="time"
            value={state.startTime}
            onChange={(e) => patch({ startTime: e.target.value })}
          />
          <TextInput
            label="Square Off Time"
            type="time"
            value={state.squareOffTime}
            onChange={(e) => patch({ squareOffTime: e.target.value })}
          />
        </div>
      </SectionCard>

      {/* Strategy Legs (time-triggered) */}
      <StrategyLegsSection legs={state.legs} onChange={(legs) => patch({ legs })} />

      {/* Exit Conditions */}
      <SectionCard title="Exit Conditions">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={state.exitConditionsEnabled}
            onChange={(e) => patch({ exitConditionsEnabled: e.target.checked })}
            className="h-4 w-4 rounded accent-brand-600"
          />
          <span className="text-sm font-medium text-gray-700">Enable Exit Conditions</span>
        </label>
        {state.exitConditionsEnabled && (
          <div className="mt-4 space-y-3">
            {state.exitConditions.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <OperandEditor value={c.left} allowValue={false} onChange={(left) => patch({ exitConditions: state.exitConditions.map((x) => (x.id === c.id ? { ...x, left } : x)) })} />
                  <select
                    className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
                    value={c.operator}
                    onChange={(e) => patch({ exitConditions: state.exitConditions.map((x) => (x.id === c.id ? { ...x, operator: e.target.value as Operator } : x)) })}
                  >
                    {OPERATORS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <OperandEditor value={c.right} allowValue onChange={(right) => patch({ exitConditions: state.exitConditions.map((x) => (x.id === c.id ? { ...x, right } : x)) })} />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch({ exitConditions: [...state.exitConditions, newCondition()] })}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              <Plus size={16} /> Add Exit Condition
            </button>
          </div>
        )}
      </SectionCard>

      {/* Risk Management */}
      <SectionCard title="Risk Management">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              label="Exit Profit (INR)"
              type="number"
              min={0}
              value={state.exitProfitAmount}
              onChange={(e) => handleRiskFieldChange('exitProfitAmount', e.target.value)}
              placeholder="e.g. 5000"
            />
            <TextInput
              label="Exit Loss (INR)"
              type="number"
              max={0}
              value={state.exitLossAmount}
              onChange={(e) => handleRiskFieldChange('exitLossAmount', e.target.value)}
              placeholder="e.g. -2000"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              label="Max Trade Cycle"
              type="number"
              min={1}
              value={state.maxTradeCycle}
              onChange={(e) => handleRiskFieldChange('maxTradeCycle', e.target.value)}
            />
            <TextInput
              label="No Trade After"
              type="time"
              value={state.noTradeAfter}
              onChange={(e) => handleRiskFieldChange('noTradeAfter', e.target.value)}
            />
          </div>

          <Field label="Profit Trailing">
            <div className="flex flex-wrap gap-2">
              {PROFIT_TRAILING_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleRiskFieldChange('profitTrailing', opt)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    state.profitTrailing === opt ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </SectionCard>

      {/* Strategy Name */}
      <SectionCard title="Strategy Name">
        <TextInput
          label="Strategy Name"
          required
          value={state.strategyName}
          onChange={(e) => patch({ strategyName: e.target.value.slice(0, 50) })}
          placeholder="Enter your strategy name here"
          maxLength={50}
        />
        <p className="mt-1 text-xs text-gray-400">
          {state.strategyName.length}/50 characters
          {state.strategyName.length > 0 && state.strategyName.length < 3 && (
            <span className="ml-2 text-red-500">Minimum 3 characters required</span>
          )}
        </p>
      </SectionCard>
    </div>
  )
}
