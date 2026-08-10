import type { StrategyType } from './builderState'
import { STRATEGY_TYPE_OPTIONS } from './builderState'

interface Props {
  value: StrategyType
  onChange: (type: StrategyType) => void
}

export default function StrategyTypeSelector({ value, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-gray-900">Strategy Type</h2>
      <div className="flex flex-col gap-3">
        {STRATEGY_TYPE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
              value === opt.value
                ? 'border-brand-300 bg-brand-50'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="strategyType"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="h-[18px] w-[18px] cursor-pointer accent-brand-600"
            />
            <span
              className={`text-sm font-medium ${
                value === opt.value ? 'text-brand-700' : 'text-gray-700'
              }`}
            >
              {opt.label}
            </span>
            {opt.value === 'stocks-futures' && (
              <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                Recommended
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
