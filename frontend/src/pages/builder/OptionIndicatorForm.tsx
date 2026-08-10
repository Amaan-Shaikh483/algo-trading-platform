import { Plus } from 'lucide-react'
import { TextInput } from '../../components/ui'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Condition, Operator } from '@algo/rule-schema'
import OptionLegCard from './OptionLegCard'
import {
  ORDER_TYPE_OPTIONS,
  PROFIT_TRAILING_OPTIONS,
  newOptionLeg,
  newCondition,
} from './builderState'
import type { BuilderState, Underlying, ProfitTrailing } from './builderState'

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

// ── Underlying Selection ─────────────────────────────────────────────────────

function UnderlyingSection({ value, onChange }: { value: Underlying; onChange: (v: Underlying) => void }) {
  return (
    <SectionCard title="Underlying Selection">
      <Field label="Underlying" required>
        <div className="flex gap-2">
          {(['Spot', 'Future'] as Underlying[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onChange(u)}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                value === u ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">Used for strike price calculations</p>
      </Field>
    </SectionCard>
  )
}

// ── Strategy Legs Section ────────────────────────────────────────────────────

function StrategyLegsSection({
  legs,
  onChange,
  showEntryTime = false,
}: {
  legs: BuilderState['legs']
  onChange: (legs: BuilderState['legs']) => void
  showEntryTime?: boolean
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
    <SectionCard title="Strategy Legs">
      <div className="space-y-4">
        {legs.map((leg) => (
          <OptionLegCard
            key={leg.id}
            leg={leg}
            onUpdate={(partial) => updateLeg(leg.id, partial)}
            onRemove={() => removeLeg(leg.id)}
            canRemove={legs.length > 1}
            showEntryTime={showEntryTime}
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

// ── Entry Conditions (Long / Short) Section ─────────────────────────────────

function EntryConditionsSection({
  longConditions,
  shortConditions,
  onLongChange,
  onShortChange,
}: {
  longConditions: Condition[]
  shortConditions: Condition[]
  onLongChange: (v: Condition[]) => void
  onShortChange: (v: Condition[]) => void
}) {
  const updateCondition = (conditions: Condition[], id: string, partial: Partial<Condition>) =>
    conditions.map((c) => (c.id === id ? { ...c, ...partial } : c))

  return (
    <SectionCard title="Entry Conditions">
      <div className="space-y-6">
        {/* Long Entry */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <h4 className="text-sm font-semibold text-emerald-700">Long Entry</h4>
          </div>
          <div className="space-y-3">
            {longConditions.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <OperandEditor value={c.left} allowValue={false} onChange={(left) => onLongChange(updateCondition(longConditions, c.id, { left }))} />
                  <select
                    className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
                    value={c.operator}
                    onChange={(e) => onLongChange(updateCondition(longConditions, c.id, { operator: e.target.value as Operator }))}
                  >
                    {OPERATORS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <OperandEditor value={c.right} allowValue onChange={(right) => onLongChange(updateCondition(longConditions, c.id, { right }))} />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onLongChange(longConditions.filter((x) => x.id !== c.id))}
                    className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                  >
                    <Plus size={15} className="rotate-45" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onLongChange([...longConditions, newCondition()])}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-200 py-3 text-sm font-semibold text-emerald-500 transition-colors hover:border-emerald-300 hover:text-emerald-600"
            >
              <Plus size={16} /> Add Long Entry Condition
            </button>
          </div>
        </div>

        {/* Short Entry */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            <h4 className="text-sm font-semibold text-red-700">Short Entry</h4>
          </div>
          <div className="space-y-3">
            {shortConditions.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <OperandEditor value={c.left} allowValue={false} onChange={(left) => onShortChange(updateCondition(shortConditions, c.id, { left }))} />
                  <select
                    className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
                    value={c.operator}
                    onChange={(e) => onShortChange(updateCondition(shortConditions, c.id, { operator: e.target.value as Operator }))}
                  >
                    {OPERATORS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <OperandEditor value={c.right} allowValue onChange={(right) => onShortChange(updateCondition(shortConditions, c.id, { right }))} />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onShortChange(shortConditions.filter((x) => x.id !== c.id))}
                    className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"
                  >
                    <Plus size={15} className="rotate-45" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onShortChange([...shortConditions, newCondition()])}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-red-200 py-3 text-sm font-semibold text-red-500 transition-colors hover:border-red-300 hover:text-red-600"
            >
              <Plus size={16} /> Add Short Entry Condition
            </button>
          </div>
        </div>

        {longConditions.length === 0 && shortConditions.length === 0 && (
          <p className="text-xs text-red-500">Add at least one Long or Short entry condition</p>
        )}
      </div>
    </SectionCard>
  )
}

// ── Exit Conditions Section ──────────────────────────────────────────────────

function ExitConditionsSection({
  enabled,
  conditions,
  onEnabledChange,
  onConditionsChange,
}: {
  enabled: boolean
  conditions: Condition[]
  onEnabledChange: (v: boolean) => void
  onConditionsChange: (v: Condition[]) => void
}) {
  return (
    <SectionCard title="Exit Conditions">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded accent-brand-600"
        />
        <span className="text-sm font-medium text-gray-700">Enable Exit Conditions</span>
      </label>
      {enabled && (
        <div className="mt-4 space-y-3">
          {conditions.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <OperandEditor value={c.left} allowValue={false} onChange={(left) => onConditionsChange(conditions.map((x) => (x.id === c.id ? { ...x, left } : x)))} />
                <select
                  className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
                  value={c.operator}
                  onChange={(e) => onConditionsChange(conditions.map((x) => (x.id === c.id ? { ...x, operator: e.target.value as Operator } : x)))}
                >
                  {OPERATORS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <OperandEditor value={c.right} allowValue onChange={(right) => onConditionsChange(conditions.map((x) => (x.id === c.id ? { ...x, right } : x)))} />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onConditionsChange([...conditions, newCondition()])}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Plus size={16} /> Add Signal Candle Condition
          </button>
        </div>
      )}
    </SectionCard>
  )
}

// ── Risk Management Section ──────────────────────────────────────────────────

function RiskManagementSection({
  exitProfitAmount,
  exitLossAmount,
  maxTradeCycle,
  noTradeAfter,
  profitTrailing,
  onFieldChange,
}: {
  exitProfitAmount: string
  exitLossAmount: string
  maxTradeCycle: string
  noTradeAfter: string
  profitTrailing: ProfitTrailing
  onFieldChange: (field: string, value: string) => void
}) {
  return (
    <SectionCard title="Risk Management">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Exit Profit (INR)"
            type="number"
            min={0}
            value={exitProfitAmount}
            onChange={(e) => onFieldChange('exitProfitAmount', e.target.value)}
            placeholder="e.g. 5000"
          />
          <TextInput
            label="Exit Loss (INR)"
            type="number"
            max={0}
            value={exitLossAmount}
            onChange={(e) => onFieldChange('exitLossAmount', e.target.value)}
            placeholder="e.g. -2000"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Max Trade Cycle"
            type="number"
            min={1}
            value={maxTradeCycle}
            onChange={(e) => onFieldChange('maxTradeCycle', e.target.value)}
          />
          <TextInput
            label="No Trade After"
            type="time"
            value={noTradeAfter}
            onChange={(e) => onFieldChange('noTradeAfter', e.target.value)}
          />
        </div>

        <Field label="Profit Trailing">
          <div className="flex flex-wrap gap-2">
            {PROFIT_TRAILING_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onFieldChange('profitTrailing', opt)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  profitTrailing === opt ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </SectionCard>
  )
}

// ── Main Option Indicator Form ───────────────────────────────────────────────

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}

export default function OptionIndicatorForm({ state, patch }: Props) {
  const handleRiskFieldChange = (field: string, value: string) => {
    patch({ [field]: value } as Partial<BuilderState>)
  }

  return (
    <div className="space-y-5">
      <UnderlyingSection value={state.underlying} onChange={(underlying) => patch({ underlying })} />

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
                name="optOrderType"
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

      <StrategyLegsSection legs={state.legs} onChange={(legs) => patch({ legs })} />

      <EntryConditionsSection
        longConditions={state.longEntryConditions}
        shortConditions={state.shortEntryConditions}
        onLongChange={(longEntryConditions) => patch({ longEntryConditions })}
        onShortChange={(shortEntryConditions) => patch({ shortEntryConditions })}
      />

      <ExitConditionsSection
        enabled={state.exitConditionsEnabled}
        conditions={state.exitConditions}
        onEnabledChange={(exitConditionsEnabled) => patch({ exitConditionsEnabled })}
        onConditionsChange={(exitConditions) => patch({ exitConditions })}
      />

      <RiskManagementSection
        exitProfitAmount={state.exitProfitAmount}
        exitLossAmount={state.exitLossAmount}
        maxTradeCycle={state.maxTradeCycle}
        noTradeAfter={state.noTradeAfter}
        profitTrailing={state.profitTrailing}
        onFieldChange={handleRiskFieldChange}
      />

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
