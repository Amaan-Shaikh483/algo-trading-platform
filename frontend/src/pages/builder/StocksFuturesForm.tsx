import { useState } from 'react'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import { TextInput } from '../../components/ui'
import InstrumentSearch from '../../components/InstrumentSearch'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Condition, Operator } from '@algo/rule-schema'
import type { InstrumentHit } from '../../lib/instrumentApi'
import OrderTypeSection from './OrderTypeSection'
import RiskManagementSection from './RiskManagementSection'
import {
  TRANSACTION_TYPES,
  CHART_TYPES,
  INTERVAL_OPTIONS,
  newCondition,
} from './builderState'
import type { BuilderState, TransactionType, ChartType, Underlying } from './builderState'

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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

// ── Underlying Selection Section ─────────────────────────────────────────────

function UnderlyingSection({
  underlying,
  instrument,
  onTypeChange,
  onInstrumentChange,
}: {
  underlying: Underlying
  instrument: BuilderState['underlyingInstrument']
  onTypeChange: (v: Underlying) => void
  onInstrumentChange: (v: BuilderState['underlyingInstrument']) => void
}) {
  return (
    <SectionCard title="Underlying Selection">
      <div className="space-y-4">
        <Field label="Underlying" required>
          <div className="flex gap-2">
            {(['Spot', 'Future'] as Underlying[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onTypeChange(u)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  underlying === u ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">Used for strike price calculations</p>
        </Field>

        <Field label="Underlying Instrument" required>
          {instrument ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {instrument.name || instrument.symbol}
                  </p>
                  <p className="text-xs text-gray-500">
                    {instrument.exchange}
                    {instrument.lotsize != null && instrument.lotsize > 1
                      ? ` · Lot Size: ${instrument.lotsize}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onInstrumentChange(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <InstrumentSearch
              placeholder="Search underlying (e.g. SBIN, NIFTY, RELIANCE)..."
              onSelect={(hit) => onInstrumentChange(hit)}
            />
          )}
        </Field>
      </div>
    </SectionCard>
  )
}

// ── Instruments Section ──────────────────────────────────────────────────────

function InstrumentsSection({ instruments, onChange }: { instruments: InstrumentHit[]; onChange: (v: InstrumentHit[]) => void }) {
  const [showSearch, setShowSearch] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const addInstrument = (hit: InstrumentHit) => {
    if (editIdx !== null) {
      const updated = [...instruments]
      updated[editIdx] = hit
      onChange(updated)
      setEditIdx(null)
    } else {
      onChange([...instruments, hit])
    }
    setShowSearch(false)
  }

  const removeInstrument = (idx: number) => {
    onChange(instruments.filter((_, i) => i !== idx))
  }

  return (
    <SectionCard title="Select Instruments">
      <div className="space-y-2">
        {instruments.map((inst, idx) => (
          <div
            key={`${inst.exchange}:${inst.token}`}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-brand-600">•</span>
              <div>
                <span className="text-sm font-medium text-gray-900">{inst.symbol}</span>
                <span className="ml-2 text-xs text-gray-400">{inst.exchange}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setEditIdx(idx); setShowSearch(true) }}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => removeInstrument(idx)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {showSearch ? (
          <div className="relative mt-2">
            <InstrumentSearch
              onSelect={addInstrument}
              placeholder={editIdx !== null ? 'Replace instrument…' : 'Search and add instrument…'}
            />
            <button
              onClick={() => { setShowSearch(false); setEditIdx(null) }}
              className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSearch(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Plus size={16} /> Add Instrument
          </button>
        )}
      </div>
      {instruments.length === 0 && (
        <p className="mt-2 text-xs text-red-500">At least 1 instrument is required</p>
      )}
    </SectionCard>
  )
}

// ── Trade Configuration Section ──────────────────────────────────────────────

function TradeConfigSection({
  transactionType,
  chartType,
  interval,
  onTransactionChange,
  onChartChange,
  onIntervalChange,
}: {
  transactionType: TransactionType
  chartType: ChartType
  interval: string
  onTransactionChange: (v: TransactionType) => void
  onChartChange: (v: ChartType) => void
  onIntervalChange: (v: string) => void
}) {
  return (
    <SectionCard title="Trade Configuration">
      <div className="space-y-5">
        {/* Transaction Type */}
        <Field label="Transaction Type" required>
          <div className="flex flex-wrap gap-2">
            {TRANSACTION_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onTransactionChange(opt.value)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  transactionType === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Chart Type */}
        <Field label="Chart Type" required>
          <div className="flex gap-2">
            {CHART_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChartChange(opt.value)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  chartType === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Interval */}
        <Field label="Interval" required>
          <div className="flex flex-wrap gap-2">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onIntervalChange(opt.value)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  interval === opt.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </SectionCard>
  )
}

// ── Trade Strategy Section ───────────────────────────────────────────────────

function TradeStrategySection({
  value,
  onChange,
}: {
  value: { straddle: boolean; optionsChart: boolean; spreadChart: boolean }
  onChange: (v: { straddle: boolean; optionsChart: boolean; spreadChart: boolean }) => void
}) {
  const options = [
    { key: 'straddle' as const, label: 'Straddle/Strangle Chart' },
    { key: 'optionsChart' as const, label: 'Trade On Options Chart' },
    { key: 'spreadChart' as const, label: 'Trade Spread Chart' },
  ]

  return (
    <SectionCard title="Trade Strategy">
      <div className="flex flex-col gap-3">
        {options.map((opt) => (
          <label key={opt.key} className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={value[opt.key]}
              onChange={(e) => onChange({ ...value, [opt.key]: e.target.checked })}
              className="h-4 w-4 rounded accent-brand-600"
            />
            <span className="text-sm text-gray-700">{opt.label}</span>
          </label>
        ))}
      </div>
    </SectionCard>
  )
}

// ── Entry Conditions Section ─────────────────────────────────────────────────

function ConditionRow({
  condition,
  onUpdate,
  onRemove,
}: {
  condition: Condition
  onUpdate: (partial: Partial<Condition>) => void
  onRemove: () => void
}) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-end">
        <button onClick={onRemove} className="rounded-lg p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <OperandEditor value={condition.left} allowValue={false} onChange={(left) => onUpdate({ left })} />
        <select
          className="rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm font-medium focus:border-brand-400 focus:bg-white focus:outline-none sm:mt-2"
          value={condition.operator}
          onChange={(e) => onUpdate({ operator: e.target.value as Operator })}
        >
          {OPERATORS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <OperandEditor value={condition.right} allowValue onChange={(right) => onUpdate({ right })} />
      </div>
    </div>
  )
}

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
              <ConditionRow
                key={c.id}
                condition={c}
                onUpdate={(partial) => onLongChange(updateCondition(longConditions, c.id, partial))}
                onRemove={() => onLongChange(longConditions.filter((x) => x.id !== c.id))}
              />
            ))}
            <button
              type="button"
              onClick={() => onLongChange([...longConditions, newCondition()])}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-200 py-3 text-sm font-semibold text-emerald-500 transition-colors hover:border-emerald-300 hover:text-emerald-600"
            >
              <Plus size={16} /> Add Long Condition
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
              <ConditionRow
                key={c.id}
                condition={c}
                onUpdate={(partial) => onShortChange(updateCondition(shortConditions, c.id, partial))}
                onRemove={() => onShortChange(shortConditions.filter((x) => x.id !== c.id))}
              />
            ))}
            <button
              type="button"
              onClick={() => onShortChange([...shortConditions, newCondition()])}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-red-200 py-3 text-sm font-semibold text-red-500 transition-colors hover:border-red-300 hover:text-red-600"
            >
              <Plus size={16} /> Add Short Condition
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
            <ConditionRow
              key={c.id}
              condition={c}
              onUpdate={(partial) =>
                onConditionsChange(conditions.map((x) => (x.id === c.id ? { ...x, ...partial } : x)))
              }
              onRemove={() => onConditionsChange(conditions.filter((x) => x.id !== c.id))}
            />
          ))}
          <button
            type="button"
            onClick={() => onConditionsChange([...conditions, newCondition()])}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Plus size={16} /> Add Exit Condition
          </button>
        </div>
      )}
    </SectionCard>
  )
}

// ── Main Stocks & Futures Form ───────────────────────────────────────────────

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}

export default function StocksFuturesForm({ state, patch }: Props) {
  return (
    <div className="space-y-5">
      <UnderlyingSection
        underlying={state.underlying}
        instrument={state.underlyingInstrument}
        onTypeChange={(underlying) => patch({ underlying })}
        onInstrumentChange={(underlyingInstrument) => patch({ underlyingInstrument })}
      />

      <InstrumentsSection instruments={state.instruments} onChange={(instruments) => patch({ instruments })} />

      {/* Order Type (MIS / CNC / BTST) — start time, square off and trading
          days live inside this section and swap with the selection. */}
      <OrderTypeSection state={state} patch={patch} name="sfOrderType" field="sfOrderType" />

      <TradeConfigSection
        transactionType={state.transactionType}
        chartType={state.chartType}
        interval={state.interval}
        onTransactionChange={(transactionType) => patch({ transactionType })}
        onChartChange={(chartType) => patch({ chartType })}
        onIntervalChange={(interval) => patch({ interval })}
      />

      <TradeStrategySection
        value={state.tradeStrategy}
        onChange={(tradeStrategy) => patch({ tradeStrategy })}
      />

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

      <RiskManagementSection state={state} patch={patch} name="sfProfitTrailing" />

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
