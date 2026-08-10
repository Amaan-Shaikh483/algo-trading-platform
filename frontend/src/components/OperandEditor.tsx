import { INDICATORS, INDICATOR_KEYS, defaultParams } from '@algo/rule-schema'
import type { IndicatorKey, Operand, PriceField } from '@algo/rule-schema'

const PRICE_FIELDS: { key: PriceField; label: string }[] = [
  { key: 'close', label: 'Close' },
  { key: 'open', label: 'Open' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'volume', label: 'Volume' },
]

const selectCls =
  'w-full rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-2 text-sm focus:border-brand-400 focus:bg-white focus:outline-none'
const inputCls = selectCls

/**
 * One side of a condition row: a fixed value, a price candle field, or an
 * indicator output — per the @algo/rule-schema contract shared with the engines.
 */
export default function OperandEditor({
  value,
  onChange,
  allowValue,
}: {
  value: Operand
  onChange: (op: Operand) => void
  allowValue: boolean
}) {
  const setKind = (kind: Operand['kind']) => {
    if (kind === 'value' && allowValue) onChange({ kind: 'value', value: 0 })
    else if (kind === 'price') onChange({ kind: 'price', field: 'close' })
    else onChange({ kind: 'indicator', indicator: 'ema', params: defaultParams('ema'), output: 'value' })
  }

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex gap-1.5">
        {(['indicator', 'price', ...(allowValue ? (['value'] as const) : [])] as ('indicator' | 'price' | 'value')[]).map(
          (kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKind(kind)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                value.kind === kind ? 'bg-brand-600 text-white' : 'bg-white text-gray-500 shadow-sm hover:text-gray-700'
              }`}
            >
              {kind === 'price' ? 'Price' : kind}
            </button>
          ),
        )}
      </div>

      {value.kind === 'value' && (
        <input
          type="number"
          step="any"
          className={inputCls}
          value={value.value}
          onChange={(e) => onChange({ kind: 'value', value: Number(e.target.value) })}
        />
      )}

      {value.kind === 'price' && (
        <select className={selectCls} value={value.field} onChange={(e) => onChange({ kind: 'price', field: e.target.value as PriceField })}>
          {PRICE_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      )}

      {value.kind === 'indicator' && (
        <div className="space-y-2">
          <select
            className={selectCls}
            value={value.indicator}
            onChange={(e) => {
              const key = e.target.value as IndicatorKey
              onChange({ kind: 'indicator', indicator: key, params: defaultParams(key), output: INDICATORS[key].outputs[0].key })
            }}
          >
            {INDICATOR_KEYS.map((key) => (
              <option key={key} value={key}>
                {INDICATORS[key].label}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            {INDICATORS[value.indicator].params.map((p) => (
              <label key={p.key} className="block">
                <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{p.label}</span>
                <input
                  type="number"
                  step={p.step ?? 1}
                  min={p.min}
                  max={p.max}
                  className={inputCls}
                  value={value.params[p.key] ?? p.default}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      params: { ...value.params, [p.key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>

          {INDICATORS[value.indicator].outputs.length > 1 && (
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">Output line</span>
              <select
                className={selectCls}
                value={value.output}
                onChange={(e) => onChange({ ...value, output: e.target.value })}
              >
                {INDICATORS[value.indicator].outputs.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
