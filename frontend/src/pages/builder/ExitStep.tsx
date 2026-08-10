import type { ExitUiState } from './builderState'
import type { BuilderState } from './builderState'

const selectCls =
  'rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'
const inputCls =
  'w-28 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-gray-300'}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5.5 left-0.5' : 'left-0.5'}`}
      />
    </button>
  )
}

function ExitRow({
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  title: string
  hint: string
  on: boolean
  onToggle: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400">{hint}</p>
        </div>
        <Toggle on={on} onChange={onToggle} />
      </div>
      {on && children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export default function ExitStep({ state, patch }: { state: BuilderState; patch: (p: Partial<BuilderState>) => void }) {
  const setExit = (p: Partial<ExitUiState>) => patch({ exit: { ...state.exit, ...p } })
  const ex = state.exit

  return (
    <div className="space-y-4">
      <ExitRow title="Stop Loss" hint="Mandatory protection against adverse moves" on={ex.slEnabled} onToggle={(v) => setExit({ slEnabled: v })}>
        <select className={selectCls} value={ex.slType} onChange={(e) => setExit({ slType: e.target.value as ExitUiState['slType'] })}>
          <option value="points">Fixed points</option>
          <option value="percent">Percentage</option>
          <option value="atr">ATR multiple</option>
        </select>
        <input className={inputCls} type="number" step="any" min="0" value={ex.slValue} onChange={(e) => setExit({ slValue: e.target.value })} />
        {ex.slType === 'atr' && (
          <>
            <span className="text-xs text-gray-400">× ATR(</span>
            <input className="w-16 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm" type="number" min="1" value={ex.slAtrPeriod} onChange={(e) => setExit({ slAtrPeriod: e.target.value })} />
            <span className="text-xs text-gray-400">)</span>
          </>
        )}
        <span className="text-xs text-gray-400">
          {ex.slType === 'percent' ? '% below entry' : ex.slType === 'atr' ? '× ATR below entry' : 'points below entry'}
        </span>
      </ExitRow>

      <ExitRow title="Target" hint="Take profit when the move pays out" on={ex.targetEnabled} onToggle={(v) => setExit({ targetEnabled: v })}>
        <select className={selectCls} value={ex.targetType} onChange={(e) => setExit({ targetType: e.target.value as ExitUiState['targetType'] })}>
          <option value="rr_multiple">Risk × reward</option>
          <option value="points">Fixed points</option>
          <option value="percent">Percentage</option>
        </select>
        <input className={inputCls} type="number" step="any" min="0" value={ex.targetValue} onChange={(e) => setExit({ targetValue: e.target.value })} />
        <span className="text-xs text-gray-400">
          {ex.targetType === 'rr_multiple' ? '× the stop-loss distance' : ex.targetType === 'percent' ? '% above entry' : 'points above entry'}
        </span>
      </ExitRow>

      <ExitRow title="Trailing Stop Loss" hint="Lock in profits as price moves in your favour" on={ex.trailingEnabled} onToggle={(v) => setExit({ trailingEnabled: v })}>
        <select className={selectCls} value={ex.trailingType} onChange={(e) => setExit({ trailingType: e.target.value as ExitUiState['trailingType'] })}>
          <option value="points">Fixed points</option>
          <option value="percent">Percentage</option>
        </select>
        <input className={inputCls} type="number" step="any" min="0" value={ex.trailingValue} onChange={(e) => setExit({ trailingValue: e.target.value })} />
        <span className="text-xs text-gray-400">{ex.trailingType === 'percent' ? '% trail from peak' : 'points trail from peak'}</span>
      </ExitRow>

      <ExitRow title="Time-based square-off" hint="Force-exit everything at a fixed IST time (intraday discipline)" on={ex.timeSqEnabled} onToggle={(v) => setExit({ timeSqEnabled: v })}>
        <input className={inputCls} type="time" value={ex.timeSq} onChange={(e) => setExit({ timeSq: e.target.value })} />
        <span className="text-xs text-gray-400">IST — e.g. 15:20 for intraday equity</span>
      </ExitRow>

      <ExitRow title="Max holding period" hint="Exit after N candles even if nothing else triggered" on={ex.maxHoldEnabled} onToggle={(v) => setExit({ maxHoldEnabled: v })}>
        <input className={inputCls} type="number" min="1" value={ex.maxHoldBars} onChange={(e) => setExit({ maxHoldBars: e.target.value })} />
        <span className="text-xs text-gray-400">candles of the selected timeframe</span>
      </ExitRow>
    </div>
  )
}
