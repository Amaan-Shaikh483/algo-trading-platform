import { Trash2, Heart } from 'lucide-react'
import type { OptionLeg, LegCondition, OptionPosition, OptionType, ExpiryType } from './builderState'

const selectCls =
  'rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'
const inputCls =
  'w-20 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'
const smallInputCls =
  'w-16 rounded-lg border border-gray-200 bg-gray-50/60 px-2 py-1.5 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'

interface Props {
  leg: OptionLeg
  onUpdate: (partial: Partial<OptionLeg>) => void
  onRemove: () => void
  canRemove: boolean
  /** Show the time-based entry trigger input (option-time strategy). */
  showEntryTime?: boolean
}

export default function OptionLegCard({ leg, onUpdate, onRemove, canRemove, showEntryTime = false }: Props) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            Leg {leg.legNumber}{' '}
            <span className={leg.position === 'BUY' ? 'text-emerald-600' : 'text-red-500'}>
              {leg.position} {leg.optionType === 'CALL' ? 'CE' : 'PE'}
            </span>
          </span>
          {leg.active && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onUpdate({ active: !leg.active })}
            className={`rounded-lg p-1.5 transition-colors ${
              leg.active ? 'text-red-400 hover:bg-red-50' : 'text-emerald-400 hover:bg-emerald-50'
            }`}
            title={leg.active ? 'Deactivate' : 'Activate'}
          >
            <Heart size={15} fill={leg.active ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={onRemove}
            disabled={!canRemove}
            className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
            title="Delete leg"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Condition tabs */}
      <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['LONG', 'SHORT'] as LegCondition[]).map((cond) => (
          <button
            key={cond}
            onClick={() => onUpdate({ condition: cond })}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold uppercase transition-colors ${
              leg.condition === cond
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            When {cond}
          </button>
        ))}
      </div>

      {/* Time-based entry trigger */}
      {showEntryTime && (
        <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3">
          <span className="mb-1.5 block text-[11px] font-medium text-brand-700">Entry Time (trigger)</span>
          <input
            type="time"
            value={leg.entryTime ?? ''}
            onChange={(e) => onUpdate({ entryTime: e.target.value })}
            className="w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-brand-600/70">
            Trade executes at this time. Leave blank to disable the time trigger for this leg.
          </p>
        </div>
      )}

      {/* Strike Configuration */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Strike Criteria</span>
          <select
            className={selectCls}
            value={leg.strikeCriteria}
            onChange={(e) => onUpdate({ strikeCriteria: e.target.value })}
          >
            <option value="ATM">ATM</option>
            <option value="ATM pt">ATM pt</option>
            <option value="OTM pt">OTM pt</option>
            <option value="ITM pt">ITM pt</option>
          </select>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Strike Type</span>
          <select
            className={selectCls}
            value={leg.strikeType}
            onChange={(e) => onUpdate({ strikeType: e.target.value })}
          >
            <option value="ATM">ATM</option>
            <option value="OTM">OTM</option>
            <option value="ITM">ITM</option>
          </select>
        </div>
      </div>

      {/* Position & Option Type */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Qty</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onUpdate({ qty: Math.max(1, leg.qty - 1) })}
              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-100"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              value={leg.qty}
              onChange={(e) => onUpdate({ qty: Math.max(1, Number(e.target.value)) })}
              className={smallInputCls + ' text-center'}
            />
            <button
              onClick={() => onUpdate({ qty: leg.qty + 1 })}
              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-100"
            >
              +
            </button>
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Position</span>
          <div className="flex gap-1">
            {(['BUY', 'SELL'] as OptionPosition[]).map((pos) => (
              <button
                key={pos}
                onClick={() => onUpdate({ position: pos })}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                  leg.position === pos
                    ? pos === 'BUY'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Type</span>
          <div className="flex gap-1">
            {(['CALL', 'PUT'] as OptionType[]).map((ot) => (
              <button
                key={ot}
                onClick={() => onUpdate({ optionType: ot })}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                  leg.optionType === ot
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {ot === 'CALL' ? 'CE' : 'PE'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">Expiry</span>
          <select
            className={selectCls}
            value={leg.expiry}
            onChange={(e) => onUpdate({ expiry: e.target.value as ExpiryType })}
          >
            <option value="WEEKLY">WEEKLY</option>
            <option value="MONTHLY">MONTHLY</option>
          </select>
        </div>
      </div>

      {/* Stop Loss & Take Profit */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
          <span className="mb-1.5 block text-[11px] font-medium text-gray-500">Stop Loss</span>
          <div className="flex items-center gap-2">
            <select
              className={selectCls + ' w-20'}
              value={leg.slType}
              onChange={(e) => onUpdate({ slType: e.target.value })}
            >
              <option value="SL%">SL%</option>
              <option value="SL pts">SL pts</option>
            </select>
            <input
              type="number"
              value={leg.slValue}
              onChange={(e) => onUpdate({ slValue: e.target.value })}
              className={inputCls}
            />
            <label className="flex items-center gap-1 text-[11px] text-gray-400">
              <input type="checkbox" className="h-3 w-3 accent-brand-600" defaultChecked />
              On Price
            </label>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
          <span className="mb-1.5 block text-[11px] font-medium text-gray-500">Take Profit</span>
          <div className="flex items-center gap-2">
            <select
              className={selectCls + ' w-20'}
              value={leg.tpType}
              onChange={(e) => onUpdate({ tpType: e.target.value })}
            >
              <option value="TP%">TP%</option>
              <option value="TP pts">TP pts</option>
            </select>
            <input
              type="number"
              value={leg.tpValue}
              onChange={(e) => onUpdate({ tpValue: e.target.value })}
              className={inputCls}
            />
            <label className="flex items-center gap-1 text-[11px] text-gray-400">
              <input type="checkbox" className="h-3 w-3 accent-brand-600" defaultChecked />
              On Price
            </label>
          </div>
        </div>
      </div>

      {/* Trailing & Advanced */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-500">Trail SL Type</span>
            <div className="flex items-center gap-2">
              <select
                className={selectCls + ' w-16'}
                value={leg.trailSlType}
                onChange={(e) => onUpdate({ trailSlType: e.target.value })}
              >
                <option value="%">%</option>
                <option value="pts">pts</option>
              </select>
              <input
                type="number"
                value={leg.trailSlValue}
                onChange={(e) => onUpdate({ trailSlValue: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-500">Price Movement</span>
            <input
              type="number"
              value={leg.priceMovement}
              onChange={(e) => onUpdate({ priceMovement: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-gray-500">Trading Value</span>
            <input
              type="number"
              value={leg.tradingValue}
              onChange={(e) => onUpdate({ tradingValue: e.target.value })}
              className={inputCls + ' w-full'}
            />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 pb-1">
              <input
                type="checkbox"
                checked={leg.prePunchSl}
                onChange={(e) => onUpdate({ prePunchSl: e.target.checked })}
                className="h-4 w-4 rounded accent-brand-600"
              />
              <span className="text-xs font-medium text-gray-600">Pre Punch SL</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
