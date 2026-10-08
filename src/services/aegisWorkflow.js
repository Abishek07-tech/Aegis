import { aegisService } from './aegisService.js'
import { loadAegisWorkspace } from './aegisAdapter.js'
import { USE_MOCK_DATA } from './serviceFactory.js'

// The 8 backend analysis endpoints, run in pipeline order. Each response is
// preserved verbatim ({ok:true,response}) or recorded as a real failure
// ({ok:false,error:{status,code,message}}) — a failed step is never faked.
const ANALYSIS_METHODS = [
  ['evidence', 'evidence'],
  ['risk', 'risk'],
  ['explanation', 'explanation'],
  ['correlation', 'correlation'],
  ['campaign', 'campaign'],
  ['investigation', 'investigation'],
  ['playbook', 'playbook'],
  ['report', 'report']
]

const captureError = error => ({
  status: error?.status ?? 0,
  code: error?.details?.code || error?.code || 'UNKNOWN_ERROR',
  message: error?.message || 'Request failed'
})

async function resolveCandidate(candidateId) {
  try {
    const workspace = await loadAegisWorkspace()
    const match = workspace.candidates?.find(candidate => candidate.id === candidateId)
    if (match) return match
  } catch {
    // fall through to a direct fetch
  }
  const payload = await aegisService.candidates.get(candidateId)
  return payload?.data ?? null
}

export async function runCandidateAnalysis(candidateId) {
  if (USE_MOCK_DATA) {
    return {
      candidateId: candidateId ?? null,
      applicable: false,
      reason: 'Analysis runs against the authorized API and is unavailable in demo mode.',
      steps: {},
      failed: 0,
      total: ANALYSIS_METHODS.length
    }
  }
  if (!candidateId) {
    return { candidateId: null, applicable: false, reason: 'No candidate selected.', steps: {}, failed: 0, total: ANALYSIS_METHODS.length }
  }

  let candidate
  try {
    candidate = await resolveCandidate(candidateId)
  } catch (error) {
    const failure = captureError(error)
    return { candidateId, applicable: false, reason: failure.message, error: failure, steps: {}, failed: 0, total: ANALYSIS_METHODS.length }
  }
  if (!candidate) {
    return { candidateId, applicable: false, reason: `Candidate not found: ${candidateId}`, steps: {}, failed: 0, total: ANALYSIS_METHODS.length }
  }

  const type = String(candidate.type || '').toUpperCase()
  if (type !== 'SOCIAL' && type !== 'APP') {
    return {
      candidateId,
      applicable: false,
      reason: `${type || 'This candidate type'} candidates sit outside the analysis pipeline — the analysis endpoints apply to SOCIAL and APP candidates only.`,
      candidate: { id: candidate.id, type: candidate.type },
      steps: {},
      failed: 0,
      total: ANALYSIS_METHODS.length
    }
  }
  if (!candidate.brandId) {
    return {
      candidateId,
      applicable: false,
      reason: 'This candidate is not linked to a target brand — the analysis endpoints require a brand association.',
      candidate: { id: candidate.id, type: candidate.type },
      steps: {},
      failed: 0,
      total: ANALYSIS_METHODS.length
    }
  }

  const steps = {}
  let failed = 0
  for (const [key, method] of ANALYSIS_METHODS) {
    try {
      steps[key] = { ok: true, response: await aegisService.analysis[method](candidateId) }
    } catch (error) {
      steps[key] = { ok: false, error: captureError(error) }
      failed += 1
    }
  }

  return {
    candidateId,
    applicable: true,
    candidate: { id: candidate.id, type: candidate.type, name: candidate.name || candidate.value, brandId: candidate.brandId },
    steps,
    failed,
    total: ANALYSIS_METHODS.length
  }
}
