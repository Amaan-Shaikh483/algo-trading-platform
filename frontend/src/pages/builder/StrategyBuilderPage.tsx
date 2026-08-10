import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Alert, Button, Card } from '../../components/ui'
import BeginnerHint from '../../components/BeginnerHint'
import { strategyApi } from '../../lib/strategyApi'
import { validateStrategyRules } from '@algo/rule-schema'
import BasicsStep from './BasicsStep'
import EntryStep from './EntryStep'
import ExitStep from './ExitStep'
import RiskStep from './RiskStep'
import ReviewStep from './ReviewStep'
import { fromStrategyRow, initialBuilderState, stepErrors, toRules } from './builderState'
import type { BuilderState } from './builderState'

const STEPS = ['Basics', 'Entry Conditions', 'Exit Conditions', 'Position Sizing & Risk', 'Review & Save'] as const

export default function StrategyBuilderPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [state, setState] = useState<BuilderState>(initialBuilderState)
  const [step, setStep] = useState(0)
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
  const currentErrors = useMemo(() => stepErrors(state, step), [state, step])
  const rules = useMemo(() => toRules(state), [state])
  const rulesValidation = useMemo(() => validateStrategyRules(rules), [rules])

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const save = async () => {
    if (!rulesValidation.valid || !state.instrument) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        instrument: state.instrument.symbol,
        symbolToken: state.instrument.token,
        exchange: state.instrument.exchange,
        segment: state.segment,
        timeframe: state.timeframe,
        rules,
      }
      const saved = state.id ? await strategyApi.update(state.id, payload) : await strategyApi.create(payload)
      navigate('/strategies', { state: { savedName: saved.name } })
    } catch (err) {
      setError((err as Error).message)
      setStep(0)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-gray-900">
            {state.id ? 'Edit Strategy' : 'Strategy Builder'}
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {state.id ? `Editing: ${state.name || '…'}` : 'No-code rule builder — produces a versioned JSON rule tree'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/strategies')}>
          <ChevronLeft size={16} /> Back to strategies
        </Button>
      </div>

      <BeginnerHint title="New to algo trading?">
        Build your rule, then <strong>backtest it on historical data</strong> and run it in <strong>paper mode</strong>{' '}
        before ever switching to live. Strategies always start in paper mode — switching to live asks for explicit
        confirmation and enforces your account risk limits on every order.
      </BeginnerHint>

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col gap-1.5">
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-gray-200'}`} />
            <button
              onClick={() => i < step && setStep(i)}
              className={`truncate text-left text-[11px] font-medium ${
                i === step ? 'text-brand-700' : i < step ? 'text-gray-500 hover:text-gray-700' : 'text-gray-300'
              }`}
              title={label}
            >
              {i + 1}. {label}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <Alert tone="red" title="Could not save">
          {error}
        </Alert>
      )}
      {currentErrors.length > 0 && (
        <Alert tone="yellow">
          <ul className="list-disc pl-4">
            {currentErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        {step === 0 && <BasicsStep state={state} patch={patch} />}
        {step === 1 && <EntryStep state={state} patch={patch} />}
        {step === 2 && <ExitStep state={state} patch={patch} />}
        {step === 3 && <RiskStep state={state} patch={patch} />}
        {step === 4 && <ReviewStep state={state} />}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0}>
          <ChevronLeft size={16} /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={currentErrors.length > 0}>
            Next <ChevronRight size={16} />
          </Button>
        ) : (
          <Button onClick={save} loading={saving} disabled={!rulesValidation.valid}>
            <Check size={16} /> {state.id ? 'Save Changes' : 'Create Strategy'}
          </Button>
        )}
      </div>
    </div>
  )
}
