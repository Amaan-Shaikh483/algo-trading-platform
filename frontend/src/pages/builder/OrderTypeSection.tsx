import { ChevronDown } from 'lucide-react'
import { TextInput } from '../../components/ui'
import {
  CNC_SLIDER_MAX,
  CNC_SLIDER_MIN,
  CHART_TYPES,
  INTERVAL_OPTIONS,
  ORDER_TYPE_OPTIONS,
  TRADING_DAY_OPTIONS,
  TRANSACTION_TYPES,
} from './builderState'
import type { BuilderState, OrderTypeNew } from './builderState'
import type { TradingDay } from '@algo/rule-schema'

/**
 * Order Type section — MIS (Intraday) / CNC (Delivery) / BTST (Buy Today Sell
 * Tomorrow). The whole block is dynamic: switching the radio immediately
 * swaps the fields below it without a reload.
 *
 *   MIS  → Start Time + Square Off + Trading Days
 *   CNC  → collapsible CNC Settings (entry/exit trading days before expiry
 *          sliders) + Start Time + Square Off + Trading Days
 *   BTST → Start Time + Next Day Square Off + Trading Days
 *
 * Shared by all three strategy forms (stocks-futures, option-indicator,
 * option-time) so the behaviour can never drift between them.
 */

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

/** MON…FRI toggle row. Selected days are persisted with the strategy. */
export function TradingDaysPicker({
  value,
  onChange,
}: {
  value: TradingDay[]
  onChange: (days: TradingDay[]) => void
}) {
  const toggle = (day: TradingDay) => {
    // Rebuild from the canonical MON→FRI order so the saved array is stable
    // regardless of the order the user clicked the days in.
    const next = new Set(value)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    onChange(TRADING_DAY_OPTIONS.filter((d) => next.has(d)))
  }
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-gray-700">Trading Days</span>
      <div className="flex flex-wrap gap-2">
        {TRADING_DAY_OPTIONS.map((day) => {
          const active = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(day)}
              className={`min-w-[3.5rem] rounded-lg px-3 py-2 text-xs font-semibold tracking-wide transition-colors ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
      {value.length === 0 && <p className="mt-2 text-xs text-red-500">Select at least one trading day</p>}
    </div>
  )
}

/** Labelled 0–4 slider with a live value read-out and tick marks. */
function ExpiryDaySlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}: <span className="font-semibold text-brand-700">{value}</span> trading day{value === 1 ? '' : 's'} before
        expiry
      </label>
      <input
        type="range"
        min={CNC_SLIDER_MIN}
        max={CNC_SLIDER_MAX}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-600"
      />
      <div className="mt-1 flex justify-between px-0.5 text-xs text-gray-400">
        {Array.from({ length: CNC_SLIDER_MAX - CNC_SLIDER_MIN + 1 }, (_, i) => CNC_SLIDER_MIN + i).map((tick) => (
          <span key={tick} className={tick === value ? 'font-semibold text-brand-600' : ''}>
            {tick}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Expand/collapse CNC Settings card — only rendered while CNC is selected. */
function CncSettings({
  open,
  entryDays,
  exitDays,
  onToggleOpen,
  onEntryChange,
  onExitChange,
}: {
  open: boolean
  entryDays: number
  exitDays: number
  onToggleOpen: () => void
  onEntryChange: (v: number) => void
  onExitChange: (v: number) => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-800">CNC Settings</span>
        <ChevronDown
          size={18}
          className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-5 border-t border-gray-200 px-4 py-4">
          <ExpiryDaySlider label="Entry" value={entryDays} onChange={onEntryChange} />
          <ExpiryDaySlider label="Exit" value={exitDays} onChange={onExitChange} />
        </div>
      )}
    </div>
  )
}

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
  /** Distinguishes the radio groups when several forms mount in one page. */
  name: string
  /** Which state key holds the selection for this form. */
  field: 'sfOrderType' | 'optOrderType'
  /** Indicator-based options keep their existing trade controls in this card. */
  includeTradeConfiguration?: boolean
}

export default function OrderTypeSection({ state, patch, name, field, includeTradeConfiguration = false }: Props) {
  const value = state[field]
  const isBtst = value === 'BTST'
  const isCnc = value === 'CNC'

  const selectOrderType = (next: OrderTypeNew) => {
    // Keep both selectors in step so switching strategy type preserves choice.
    patch({ sfOrderType: next, optOrderType: next })
  }

  return (
    <SectionCard title="Order Type" subtitle="Select your type">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">
          {ORDER_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 transition-colors ${
                value === opt.value
                  ? 'border-brand-300 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => selectOrderType(opt.value)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs text-gray-400">({opt.desc})</span>
            </label>
          ))}
        </div>

        {/* CNC-only: expiry-relative entry/exit windows. */}
        {isCnc && (
          <CncSettings
            open={state.cncSettingsOpen}
            entryDays={state.cncEntryDaysBeforeExpiry}
            exitDays={state.cncExitDaysBeforeExpiry}
            onToggleOpen={() => patch({ cncSettingsOpen: !state.cncSettingsOpen })}
            onEntryChange={(cncEntryDaysBeforeExpiry) => patch({ cncEntryDaysBeforeExpiry })}
            onExitChange={(cncExitDaysBeforeExpiry) => patch({ cncExitDaysBeforeExpiry })}
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Start Time"
            type="time"
            value={state.startTime}
            onChange={(e) => patch({ startTime: e.target.value })}
          />
          {isBtst ? (
            <TextInput
              label="Next Day Square Off"
              type="time"
              value={state.nextDaySquareOffTime}
              onChange={(e) => patch({ nextDaySquareOffTime: e.target.value })}
              hint="Positions carried overnight are squared off at this time the next session."
            />
          ) : (
            <TextInput
              label="Square Off"
              type="time"
              value={state.squareOffTime}
              onChange={(e) => patch({ squareOffTime: e.target.value })}
            />
          )}
        </div>

        {!isBtst && state.startTime >= state.squareOffTime && (
          <p className="text-xs text-red-500">Start Time must be before Square Off</p>
        )}

        <TradingDaysPicker value={state.tradingDays} onChange={(tradingDays) => patch({ tradingDays })} />

        {includeTradeConfiguration && (
          <div className="grid gap-5 border-t border-gray-100 pt-5 sm:grid-cols-2">
            <div>
              <span className="mb-2 block text-sm font-medium text-gray-700">Transaction Type</span>
              <div className="flex flex-wrap gap-2">
                {TRANSACTION_TYPES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={state.transactionType === opt.value}
                    onClick={() => patch({ transactionType: opt.value })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      state.transactionType === opt.value
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-gray-700">Chart Type</span>
              <div className="flex flex-wrap gap-2">
                {CHART_TYPES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={state.chartType === opt.value}
                    onClick={() => patch({ chartType: opt.value })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      state.chartType === opt.value
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-gray-700">Interval</span>
              <div className="flex flex-wrap gap-2">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={state.interval === opt.value}
                    onClick={() => patch({ interval: opt.value })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      state.interval === opt.value
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
