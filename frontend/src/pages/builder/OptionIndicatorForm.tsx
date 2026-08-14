import { Plus } from 'lucide-react'
import { TextInput } from '../../components/ui'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Condition, Operator } from '@algo/rule-schema'
import OptionLegCard from './OptionLegCard'
import OrderTypeSection from './OrderTypeSection'
import RiskManagementSection from './RiskManagementSection'
import { newOptionLeg, newCondition } from './builderState'
import type { BuilderState, Underlying } from './builderState'

// ── Predefined Instruments for Option Trading ───────────────────────────────

interface PredefinedInstrument {
  symbol: string
  name: string
  exchange: string
  lotSize: number
  token: string
}

const PREDEFINED_INSTRUMENTS: PredefinedInstrument[] = [
  { symbol: 'NIFTY 50', name: 'Nifty 50', exchange: 'NSE', lotSize: 65, token: '99926000' },
  { symbol: 'NIFTY BANK', name: 'Nifty Bank', exchange: 'NSE', lotSize: 30, token: '99926009' },
  { symbol: 'NIFTY FIN SERVICE', name: 'Nifty Fin Service', exchange: 'NSE', lotSize: 60, token: '99926037' },
  { symbol: 'SENSEX', name: 'Sensex', exchange: 'BSE', lotSize: 20, token: '99919000' },
]

/** Get lot size with fallback for common indices */
function getLotSize(instrument: BuilderState['underlyingInstrument']): number {
  // First check if it's one of our predefined instruments
  const predefined = PREDEFINED_INSTRUMENTS.find(i => i.symbol === instrument?.symbol)
  if (predefined) return predefined.lotSize
  
  // Otherwise use database lot size or default to 1
  return instrument?.lotsize ?? 1
}

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

function UnderlyingSection({
  value,
  instrument,
  onTypeChange,
  onInstrumentChange,
}: {
  value: Underlying
  instrument: BuilderState['underlyingInstrument']
  onTypeChange: (v: Underlying) => void
  onInstrumentChange: (v: BuilderState['underlyingInstrument']) => void
}) {
  const handleSelectInstrument = (predef: PredefinedInstrument) => {
    const instrumentHit: BuilderState['underlyingInstrument'] = {
      token: predef.token,
      symbol: predef.symbol,
      name: predef.name,
      exchange: predef.exchange,
      segment: 'equity',
      lotsize: predef.lotSize,
      tick_size: null,
      expiry: null,
      strike: null,
    }
    onInstrumentChange(instrumentHit)
  }

  return (
    <SectionCard title="Underlying Selection">
      <Field label="Underlying" required>
        <div className="flex gap-2">
          {(['Spot', 'Future'] as Underlying[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onTypeChange(u)}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                value === u ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">Choose the reference used for calculations</p>
      </Field>

      <Field label="Underlying Instrument" required>
        {instrument ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{instrument.name || instrument.symbol}</p>
                  <p className="text-xs text-gray-500">
                    {instrument.exchange} · Lot Size: {getLotSize(instrument)}
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
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Select one of the following instruments:</p>
            <div className="grid grid-cols-2 gap-2">
              {PREDEFINED_INSTRUMENTS.map((inst) => (
                <button
                  key={inst.symbol}
                  type="button"
                  onClick={() => handleSelectInstrument(inst)}
                  className="rounded-xl border-2 border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  <p className="text-sm font-semibold text-gray-900">{inst.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {inst.exchange} · Lot: {inst.lotSize}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </Field>
    </SectionCard>
  )
}

// ── Strategy Legs Section ────────────────────────────────────────────────────

function StrategyLegsSection({
  legs,
  onChange,
  showEntryTime = false,
  underlyingInstrument,
}: {
  legs: BuilderState['legs']
  onChange: (legs: BuilderState['legs']) => void
  showEntryTime?: boolean
  underlyingInstrument: BuilderState['underlyingInstrument']
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
            lotSize={getLotSize(underlyingInstrument)}
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

// ── Entry Conditions (Long / Short Pairs) Section ──────────────────────────

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

  const addConditionPair = () => {
    onLongChange([...longConditions, newCondition()])
    onShortChange([...shortConditions, newCondition()])
  }

  const removeConditionPair = (index: number) => {
    if (longConditions.length <= 1 && shortConditions.length <= 1) return
    onLongChange(longConditions.filter((_, i) => i !== index))
    onShortChange(shortConditions.filter((_, i) => i !== index))
  }

  // Ensure we have at least one pair
  const maxLength = Math.max(longConditions.length, shortConditions.length, 1)

  return (
    <SectionCard title="Entry Conditions">
      <div className="space-y-4">
        {Array.from({ length: maxLength }).map((_, index) => {
          const longCond = longConditions[index]
          const shortCond = shortConditions[index]
          
          return (
            <div key={`pair-${index}`} className="space-y-3">
              {/* Long Entry */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-700">Long Entry</span>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => removeConditionPair(index)}
                      className="rounded-lg p-1 text-red-400 hover:bg-red-100 hover:text-red-600"
                      title="Remove Pair"
                    >
                      <Plus size={14} className="rotate-45" />
                    </button>
                  )}
                </div>
                {longCond ? (
                  <div className="grid items-start gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <OperandEditor value={longCond.left} allowValue={false} onChange={(left) => onLongChange(updateCondition(longConditions, longCond.id, { left }))} />
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium focus:border-brand-400 focus:outline-none"
                      value={longCond.operator}
                      onChange={(e) => onLongChange(updateCondition(longConditions, longCond.id, { operator: e.target.value as Operator }))}
                    >
                      {OPERATORS.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <OperandEditor value={longCond.right} allowValue onChange={(right) => onLongChange(updateCondition(longConditions, longCond.id, { right }))} />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Select Indicator → Comparator → Select Indicator</p>
                )}
              </div>

              {/* Short Entry */}
              <div className="rounded-xl border border-red-200 bg-red-50/30 p-3">
                <span className="mb-2 block text-xs font-semibold text-red-700">Short Entry</span>
                {shortCond ? (
                  <div className="grid items-start gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <OperandEditor value={shortCond.left} allowValue={false} onChange={(left) => onShortChange(updateCondition(shortConditions, shortCond.id, { left }))} />
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium focus:border-brand-400 focus:outline-none"
                      value={shortCond.operator}
                      onChange={(e) => onShortChange(updateCondition(shortConditions, shortCond.id, { operator: e.target.value as Operator }))}
                    >
                      {OPERATORS.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <OperandEditor value={shortCond.right} allowValue onChange={(right) => onShortChange(updateCondition(shortConditions, shortCond.id, { right }))} />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Select Indicator → Comparator → Select Indicator</p>
                )}
              </div>

              {/* AND/OR combinator between pairs */}
              {index < maxLength - 1 && (
                <div className="flex justify-center">
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-brand-600 px-4 py-1 text-xs font-semibold text-white">AND</button>
                    <button className="rounded-lg bg-gray-200 px-4 py-1 text-xs font-semibold text-gray-600">OR</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <button
          type="button"
          onClick={addConditionPair}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 py-3 text-sm font-semibold text-brand-600 transition-colors hover:border-brand-400 hover:bg-brand-100"
        >
          <Plus size={16} /> Add Condition Pair
        </button>

        {longConditions.length === 0 && shortConditions.length === 0 && (
          <p className="text-xs text-red-500">Add at least one condition pair</p>
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

// ── Main Option Indicator Form ───────────────────────────────────────────────

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}

export default function OptionIndicatorForm({ state, patch }: Props) {
  // Auto-update all leg quantities when underlying instrument changes
  const handleInstrumentChange = (instrument: BuilderState['underlyingInstrument']) => {
    const lotSize = getLotSize(instrument)
    // Update all legs to use the new lot size
    const updatedLegs = state.legs.map(leg => ({ ...leg, qty: lotSize }))
    patch({ underlyingInstrument: instrument, legs: updatedLegs })
  }

  return (
    <div className="space-y-5">
      <UnderlyingSection
        value={state.underlying}
        instrument={state.underlyingInstrument}
        onTypeChange={(underlying) => patch({ underlying })}
        onInstrumentChange={handleInstrumentChange}
      />

      {/* Order Type (MIS / CNC / BTST) — start time, square off and trading
          days live inside this section and swap with the selection. */}
      <OrderTypeSection
        state={state}
        patch={patch}
        name="optIndicatorOrderType"
        field="optOrderType"
        includeTradeConfiguration
      />

      <StrategyLegsSection legs={state.legs} onChange={(legs) => patch({ legs })} underlyingInstrument={state.underlyingInstrument} />

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

      <RiskManagementSection state={state} patch={patch} name="optIndicatorProfitTrailing" />

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
