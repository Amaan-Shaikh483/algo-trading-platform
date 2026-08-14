import { TextInput } from '../../components/ui'
import { PROFIT_TRAILING_DESCRIPTIONS, PROFIT_TRAILING_OPTIONS } from './builderState'
import type { BuilderState, ProfitTrailing } from './builderState'

/**
 * Risk Management section — global exit profit / exit loss limits, max trade
 * cycle, the no-new-trades cutoff, and the Profit Trailing radio group whose
 * fields appear dynamically:
 *
 *   No Trailing     → no extra fields
 *   Lock Fix Profit → If profit reaches + Lock profit at
 *   Trail Profit    → On every increase of + Trail profit by
 *   Lock & Trail    → all four
 *
 * Shared by all three strategy forms.
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
      {subtitle && <p className="mt-1 text-xs leading-relaxed text-gray-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

interface Props {
  state: BuilderState
  patch: (p: Partial<BuilderState>) => void
  /** Distinguishes the radio group when several forms mount in one page. */
  name: string
}

export default function RiskManagementSection({ state, patch, name }: Props) {
  const trailing = state.profitTrailing
  const showLock = trailing === 'Lock Fix' || trailing === 'Lock & Trail'
  const showTrail = trailing === 'Trail' || trailing === 'Lock & Trail'

  return (
    <SectionCard
      title="Risk Management"
      subtitle="Control your trading outcomes by setting global limits on losses and profits on the strategy, and automating how gains are protected (trailing)."
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Exit Profit (INR)"
            type="number"
            min={0}
            value={state.exitProfitAmount}
            onChange={(e) => patch({ exitProfitAmount: e.target.value })}
            placeholder="e.g. 5000"
            hint="Book the whole strategy when unrealized + realized profit reaches this value."
          />
          <TextInput
            label="Exit Loss (INR)"
            type="number"
            value={state.exitLossAmount}
            onChange={(e) => patch({ exitLossAmount: e.target.value })}
            placeholder="e.g. 1000"
            hint="Positive INR amount. Mapped to the strategy stop-loss (also accepts a negative loss figure)."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput
            label="Max Trade Cycle"
            type="number"
            min={1}
            step={1}
            value={state.maxTradeCycle}
            onChange={(e) => patch({ maxTradeCycle: e.target.value })}
            placeholder="1"
          />
          <TextInput
            label="No Trade After"
            type="time"
            value={state.noTradeAfter}
            onChange={(e) => patch({ noTradeAfter: e.target.value })}
            hint="No new trades are opened after this time."
          />
        </div>

        {/* ── Profit Trailing ── */}
        <div>
          <span className="mb-2 block text-sm font-medium text-gray-700">Profit Trailing</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROFIT_TRAILING_OPTIONS.map((opt: ProfitTrailing) => (
              <label
                key={opt}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-4 py-2.5 transition-colors ${
                  trailing === opt
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name={name}
                  value={opt}
                  checked={trailing === opt}
                  onChange={() => patch({ profitTrailing: opt })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-semibold">{opt}</span>
                  <span className="block text-xs text-gray-400">{PROFIT_TRAILING_DESCRIPTIONS[opt]}</span>
                </span>
              </label>
            ))}
          </div>

          {/* Fields appear/disappear with the selected trailing mode. */}
          {(showLock || showTrail) && (
            <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              {showLock && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextInput
                    label="If profit reaches"
                    type="number"
                    min={0}
                    value={state.trailIfProfitReaches}
                    onChange={(e) => patch({ trailIfProfitReaches: e.target.value })}
                    placeholder="e.g. 5000"
                  />
                  <TextInput
                    label="Lock profit at"
                    type="number"
                    min={0}
                    value={state.trailLockProfitAt}
                    onChange={(e) => patch({ trailLockProfitAt: e.target.value })}
                    placeholder="e.g. 3000"
                  />
                </div>
              )}
              {showTrail && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextInput
                    label="On every increase of"
                    type="number"
                    min={0}
                    value={state.trailOnEveryIncreaseOf}
                    onChange={(e) => patch({ trailOnEveryIncreaseOf: e.target.value })}
                    placeholder="e.g. 500"
                  />
                  <TextInput
                    label="Trail profit by"
                    type="number"
                    min={0}
                    value={state.trailProfitBy}
                    onChange={(e) => patch({ trailProfitBy: e.target.value })}
                    placeholder="e.g. 300"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
