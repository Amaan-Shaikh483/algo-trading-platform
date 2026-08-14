import { Plus } from 'lucide-react'
import { TextInput } from '../../components/ui'
import OperandEditor from '../../components/OperandEditor'
import { OPERATORS } from '@algo/rule-schema'
import type { Operator } from '@algo/rule-schema'
import OptionLegCard from './OptionLegCard'
import OrderTypeSection from './OrderTypeSection'
import RiskManagementSection from './RiskManagementSection'
import { newCondition, newOptionLeg } from './builderState'
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

// ── Strategy Legs Section (time-triggered) ──────────────────────────────────

function StrategyLegsSection({
  legs,
  onChange,
  underlyingInstrument,
}: {
  legs: BuilderState['legs']
  onChange: (legs: BuilderState['legs']) => void
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

// ── Main Option Time Form ────────────────────────────────────────────────────

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
}

export default function OptionTimeForm({ state, patch }: Props) {
  // Auto-update all leg quantities when underlying instrument changes
  const handleInstrumentChange = (instrument: BuilderState['underlyingInstrument']) => {
    const lotSize = getLotSize(instrument)
    // Update all legs to use the new lot size
    const updatedLegs = state.legs.map(leg => ({ ...leg, qty: lotSize }))
    patch({ underlyingInstrument: instrument, legs: updatedLegs })
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
          <p className="mt-1.5 text-xs text-gray-400">Choose the reference used for calculations</p>
        </Field>

        <Field label="Underlying Instrument" required>
          {state.underlyingInstrument ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {state.underlyingInstrument.name || state.underlyingInstrument.symbol}
                    </p>
                    <p className="text-xs text-gray-500">
                      {state.underlyingInstrument.exchange} · Lot Size: {getLotSize(state.underlyingInstrument)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => patch({ underlyingInstrument: null })}
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
                    onClick={() => handleInstrumentChange({
                      token: inst.token,
                      symbol: inst.symbol,
                      name: inst.name,
                      exchange: inst.exchange,
                      segment: 'equity',
                      lotsize: inst.lotSize,
                      tick_size: null,
                      expiry: null,
                      strike: null,
                    })}
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

      {/* Order Type (MIS / CNC / BTST) — start time, square off and trading
          days live inside this section and swap with the selection. */}
      <OrderTypeSection state={state} patch={patch} name="optTimeOrderType" field="optOrderType" />

      {/* Strategy Legs (time-triggered) */}
      <StrategyLegsSection legs={state.legs} onChange={(legs) => patch({ legs })} underlyingInstrument={state.underlyingInstrument} />

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

      <RiskManagementSection state={state} patch={patch} name="optTimeProfitTrailing" />

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
