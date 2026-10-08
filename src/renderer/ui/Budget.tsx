import { budgetLevel, budgetPct, formatUsd } from '../store/model'
import { useOffice } from '../store/hooks'

function Meter({ label, spent, cap, testId }: { label: string; spent: number; cap: number; testId: string }) {
  const pct = budgetPct(spent, cap)
  const level = budgetLevel(pct)
  return (
    <div className={`meter ${level}`} data-testid={testId} data-level={level}>
      <div className="row spread meter-label">
        <span>{label}</span>
        <span>
          {formatUsd(spent)} / {cap > 0 ? formatUsd(cap) : 'no cap'}
          {cap > 0 ? ` (${Math.round(pct)}%)` : ''}
        </span>
      </div>
      <div className="meter-bar">
        <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export function Budget() {
  const spend = useOffice((s) => s.spend)
  return (
    <div className="card" data-testid="budget">
      <h3>Budget</h3>
      <Meter label="Today" spent={spend.today} cap={spend.dailyCap} testId="meter-today" />
      <Meter label="This month" spent={spend.month} cap={spend.monthlyCap} testId="meter-month" />
    </div>
  )
}
