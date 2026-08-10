import InstrumentSearch from '../../components/InstrumentSearch'
import { TextInput } from '../../components/ui'
import { ORDER_TYPES, PRODUCT_TYPES, SEGMENTS, TIMEFRAMES } from '@algo/rule-schema'
import type { OrderType, ProductType, Segment, Timeframe } from '@algo/rule-schema'
import type { BuilderState } from './builderState'

const selectCls =
  'w-full rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  )
}

export default function BasicsStep({ state, patch }: { state: BuilderState; patch: (p: Partial<BuilderState>) => void }) {
  return (
    <div className="space-y-5">
      <TextInput
        label="Strategy name"
        value={state.strategyName}
        onChange={(e) => patch({ strategyName: e.target.value })}
        placeholder="e.g. 9/21 EMA Crossover — SBIN"
        autoFocus
      />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-gray-700">Instrument</span>
        {state.instrument ? (
          <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{state.instrument.symbol}</p>
              <p className="text-xs text-gray-500">
                {state.instrument.exchange} · token {state.instrument.token}
                {state.instrument.lotsize && state.instrument.lotsize > 1 ? ` · lot ${state.instrument.lotsize}` : ''}
              </p>
            </div>
            <button onClick={() => patch({ instrument: null })} className="text-xs font-medium text-brand-600 hover:underline">
              Change
            </button>
          </div>
        ) : (
          <InstrumentSearch onSelect={(instrument) => patch({ instrument, instruments: [instrument] })} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Segment">
          <select className={selectCls} value={state.segment} onChange={(e) => patch({ segment: e.target.value as Segment })}>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s === 'equity' ? 'Equity' : s === 'futures' ? 'Futures' : 'Options'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timeframe">
          <select className={selectCls} value={state.timeframe} onChange={(e) => patch({ timeframe: e.target.value as Timeframe })}>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Direction">
          <div className="grid grid-cols-2 gap-2">
            {(['long', 'short'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => patch({ direction: side })}
                className={`rounded-lg px-3 py-2.5 text-sm font-semibold capitalize transition-colors ${
                  state.direction === side
                    ? side === 'long'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {side === 'long' ? 'Long (Buy first)' : 'Short (Sell first)'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Order type">
          <select className={selectCls} value={state.orderType} onChange={(e) => patch({ orderType: e.target.value as OrderType })}>
            {ORDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'MARKET' ? 'Market' : 'Limit'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product type">
          <select className={selectCls} value={state.productType} onChange={(e) => patch({ productType: e.target.value as ProductType })}>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'INTRADAY' ? 'Intraday (MIS)' : t === 'DELIVERY' ? 'Delivery (CNC)' : t === 'BTST' ? 'Buy Today Sell Tomorrow' : 'Margin'}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <TextInput
        label="Description (optional)"
        value={state.description}
        onChange={(e) => patch({ description: e.target.value })}
        placeholder="Notes for yourself — what is this strategy's edge?"
      />
    </div>
  )
}
