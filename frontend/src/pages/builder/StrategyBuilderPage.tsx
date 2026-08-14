import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Loader2, Save } from 'lucide-react'
import { Alert, Button } from '../../components/ui'
import BeginnerHint from '../../components/BeginnerHint'
import { strategyApi } from '../../lib/strategyApi'
import { validateStrategyRules } from '@algo/rule-schema'
import StrategyTypeSelector from './StrategyTypeSelector'
import StocksFuturesForm from './StocksFuturesForm'
import OptionIndicatorForm from './OptionIndicatorForm'
import OptionTimeForm from './OptionTimeForm'
import { fromStrategyRow, initialBuilderState, toRules } from './builderState'
import type { BuilderState, StrategyType } from './builderState'

function validateBuilderState(state: BuilderState): string[] {
  const errors: string[] = []

  // Strategy name validation
  if (!state.strategyName.trim()) {
    errors.push('Strategy name is required')
  } else if (state.strategyName.trim().length < 3) {
    errors.push('Strategy name must be at least 3 characters')
  }

  // Type-specific validation
  if (state.strategyType === 'stocks-futures') {
    if (state.instruments.length === 0) {
      errors.push('Select at least 1 instrument')
    }
    if (state.longEntryConditions.length === 0 && state.shortEntryConditions.length === 0) {
      errors.push('Add at least one Long or Short entry condition')
    }
    if (state.startTime >= state.squareOffTime) {
      errors.push('Start time must be before Square Off time')
    }
  }

  if (state.strategyType === 'option-indicator' || state.strategyType === 'option-time') {
    if (!state.underlyingInstrument) {
      errors.push('Select an underlying instrument')
    }
  }

  if (state.strategyType === 'option-indicator') {
    if (state.legs.length === 0) {
      errors.push('Add at least one strategy leg')
    }
    if (state.longEntryConditions.length === 0 && state.shortEntryConditions.length === 0) {
      errors.push('Add at least one Long or Short entry condition')
    }
    if (state.startTime >= state.squareOffTime) {
      errors.push('Start time must be before Square Off time')
    }
  }

  if (state.strategyType === 'option-time') {
    if (state.legs.length === 0) {
      errors.push('Add at least one strategy leg')
    }
    if (state.legs.length > 0 && state.legs.every((l) => !l.entryTime)) {
      errors.push('Set an Entry Time on at least one leg')
    }
    if (state.startTime >= state.squareOffTime) {
      errors.push('Start time must be before Square Off time')
    }
  }

  return errors
}

export default function StrategyBuilderPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [state, setState] = useState<BuilderState>(initialBuilderState)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    strategyApi
      .get(id)
      .then((row) => setState(fromStrategyRow(row)))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [id])

  const patch = (p: Partial<BuilderState>) => setState((s) => ({ ...s, ...p }))
  const validationErrors = useMemo(() => validateBuilderState(state), [state])
  const rules = useMemo(() => toRules(state), [state])
  const rulesValidation = useMemo(() => validateStrategyRules(rules), [rules])

  const allErrors = useMemo(() => {
    const errs = [...validationErrors]
    if (!rulesValidation.valid) {
      rulesValidation.errors.forEach((e) => {
        if (!errs.includes(e)) errs.push(e)
      })
    }
    return errs
  }, [validationErrors, rulesValidation])

  const handleTypeChange = (type: StrategyType) => {
    // Clear instrument selections when switching strategy types so stale
    // data from the previous type never bleeds into the new one.
    patch({
      strategyType: type,
      underlyingInstrument: null,
      instruments: [],
    })
  }

  const save = async () => {
    if (allErrors.length > 0) return
    setSaving(true)
    setError(null)
    try {
      // For option strategies the underlying instrument is the tracked symbol;
      // for stocks-futures use the first selected instrument.
      const primaryInstrument = state.strategyType === 'option-indicator' || state.strategyType === 'option-time'
        ? state.underlyingInstrument
        : state.instruments[0]
      const payload = {
        name: state.strategyName.trim(),
        description: '',
        instrument: primaryInstrument?.symbol ?? '',
        symbolToken: primaryInstrument?.token ?? '',
        exchange: primaryInstrument?.exchange ?? '',
        segment: state.strategyType === 'option-indicator' || state.strategyType === 'option-time' ? 'options' as const : state.segment,
        strategyType: state.strategyType,
        timeframe: state.interval || state.timeframe,
        rules,
      }
      const saved = state.id
        ? await strategyApi.update(state.id, payload)
        : await strategyApi.create(payload)
      navigate('/strategies', { state: { savedName: saved.name } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-brand-600" size={28} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">
            {state.id ? 'Edit Strategy' : 'Strategy Builder'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {state.id ? `Editing: ${state.strategyName || '…'}` : 'Create automated trading strategies with our no-code builder'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/strategies')}>
          <ChevronLeft size={16} /> Back to strategies
        </Button>
      </div>

      <BeginnerHint title="New to algo trading?">
        Select your strategy type below, configure the form, then <strong>backtest it on historical data</strong> and
        run it in <strong>paper mode</strong> before ever switching to live. Strategies always start in paper mode —
        switching to live asks for explicit confirmation and enforces your account risk limits on every order.
      </BeginnerHint>

      {/* Error display */}
      {error && (
        <Alert tone="red" title="Could not save">
          {error}
        </Alert>
      )}
      {allErrors.length > 0 && (
        <Alert tone="yellow">
          <ul className="list-disc pl-4">
            {allErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Strategy Type Selector */}
      <StrategyTypeSelector value={state.strategyType} onChange={handleTypeChange} />

      {/* Dynamic Form based on strategy type */}
      {state.strategyType === 'stocks-futures' && <StocksFuturesForm state={state} patch={patch} />}
      {state.strategyType === 'option-indicator' && <OptionIndicatorForm state={state} patch={patch} />}
      {state.strategyType === 'option-time' && <OptionTimeForm state={state} patch={patch} />}

      {/* Save button */}
      <div className="flex items-center justify-end border-t border-gray-100 pt-4">
        <Button onClick={save} loading={saving} disabled={allErrors.length > 0}>
          <Save size={16} /> {state.id ? 'Save Changes' : 'Create Strategy'}
        </Button>
      </div>
    </div>
  )
}
