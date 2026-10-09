import type { QualityConfig } from '../../shared/schemas'

export interface ReviewResult {
  role: string
  verdict: 'pass' | 'revise'
  scores: Record<string, number>
  notes: string
}

/** Dimensions each reviewer role scores (1-10). */
export const ROLE_DIMENSIONS: Record<string, string[]> = {
  'continuity-checker': ['continuity'],
  'developmental-editor': ['structure'],
  'line-editor': ['prose'],
  'copy-editor': ['mechanics'],
  'beta-reader': ['enjoyment', 'genre_fit'],
  'originality-checker': ['originality'],
  'child-safety-reviewer': ['age_fit'],
  'read-aloud-reviewer': ['read_aloud'],
  'fact-checker': ['accuracy'],
  'thread-check': ['threads']
}

export function dimensionsFor(role: string): string[] {
  return ROLE_DIMENSIONS[role] ?? ['quality']
}

/** Average of every dimension across reviewers, then the weighted mean of those averages. */
export function weightedScore(reviews: ReviewResult[], weights: Record<string, number>): { score: number; byDimension: Record<string, number> } {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const r of reviews) {
    for (const [dim, v] of Object.entries(r.scores)) {
      const e = sums.get(dim) ?? { sum: 0, n: 0 }
      e.sum += v
      e.n++
      sums.set(dim, e)
    }
  }
  const byDimension: Record<string, number> = {}
  let num = 0
  let den = 0
  for (const [dim, e] of sums) {
    const avg = e.sum / e.n
    byDimension[dim] = Number(avg.toFixed(2))
    const w = weights[dim] ?? 1
    num += avg * w
    den += w
  }
  return { score: den > 0 ? Number((num / den).toFixed(2)) : 0, byDimension }
}

export interface Decision {
  publish: boolean
  score: number
  byDimension: Record<string, number>
  reasons: string[]
}

/** The publisher's rule: a must-pass reviewer that says `revise` rejects. Otherwise the weighted score must reach the threshold. */
export function decide(reviews: ReviewResult[], quality: QualityConfig): Decision {
  const { score, byDimension } = weightedScore(reviews, quality.weights)
  const reasons: string[] = []
  for (const r of reviews) {
    if (quality.must_pass.includes(r.role) && r.verdict !== 'pass') {
      reasons.push(`must-pass gate failed: ${r.role} says revise. ${r.notes.slice(0, 400)}`)
    }
  }
  if (score < quality.threshold) reasons.push(`weighted score ${score} is below the threshold ${quality.threshold}`)
  return { publish: reasons.length === 0, score, byDimension, reasons }
}
