import { TextInput } from '../../components/ui'
import { Alert } from '../../components/ui'
import type { BuilderState, RiskUiState } from './builderState'

export default function RiskStep({ state, patch }: { state: BuilderState; patch: (p: Partial<BuilderState>) => void }) {
  const setRisk = (p: Partial<RiskUiState>) => patch({ risk: { ...state.risk, ...p } })
  const rk = state.risk
  const lotsize = state.instrument?.lotsize ?? null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput
          label="Quantity"
          type="number"
          min={1}
          value={rk.quantity}
          onChange={(e) => setRisk({ quantity: e.target.value })}
          hint={lotsize && lotsize > 1 ? `Lot size for this instrument is ${lotsize} — enter total quantity (lots × ${lotsize}).` : undefined}
        />
        <TextInput
          label="Capital allocation % (optional)"
          type="number"
          min={1}
          max={100}
          value={rk.capitalAllocPercent}
          onChange={(e) => setRisk({ capitalAllocPercent: e.target.value })}
          placeholder="e.g. 10"
          hint="Max % of account capital this strategy may deploy per position. Enforced by the Risk Manager."
        />
        <TextInput
          label="Max concurrent positions"
          type="number"
          min={1}
          value={rk.maxPositions}
          onChange={(e) => setRisk({ maxPositions: e.target.value })}
        />
        <TextInput
          label="Max trades per day"
          type="number"
          min={1}
          value={rk.maxTradesPerDay}
          onChange={(e) => setRisk({ maxTradesPerDay: e.target.value })}
          hint="Circuit-breaker against over-trading on choppy days."
        />
      </div>
      <Alert tone="blue" title="Account-level limits still apply">
        These per-strategy limits sit ON TOP of your account limits (max daily loss, kill switch) — every order passes
        the central Risk Manager in both paper and live modes (spec §3.7).
      </Alert>
    </div>
  )
}
