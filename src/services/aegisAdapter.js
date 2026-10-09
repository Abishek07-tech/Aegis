import { aegisService } from './aegisService.js'

// Concept → real backend mapping (data loading only; analysis wiring is a later task):
//   Brand            → GET /api/brands
//   Official Assets  → GET /api/brands/:brandId/assets
//   Candidate Assets → GET /api/candidates  (drives Threat Inbox / Fake Accounts / Domains / Applications rows)
//   Dashboard metrics/posture/pipeline/activity → derived from those real lists, never invented
//   Evidence → analyze/evidence · Risk → analyze/risk · Explanation → analyze/explanation
//   Correlation → analyze/correlation · Campaign → analyze/campaign · Investigation → analyze/investigation
//   Playbook → analyze/playbook · Report → analyze/report
//   (analyze/* endpoints are NOT called yet — their list slices stay empty until the analysis task)

let workspace = null
let inflight = null

const statusLabel = status => {
  const value = String(status || 'PENDING').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}
const unwrap = payload => (Array.isArray(payload?.data) ? payload.data : [])
const byCreatedAtDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
const dayKey = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
const clockDate = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const clockLabel = date => `${date.toLocaleDateString('en-US', { weekday: 'long' })} · ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
const stamp = date => `${clockDate(date)} · ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
const shortTime = value => {
  const date = new Date(value)
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
}

const candidateToThreat = c => ({
  id: c.id,
  severity: null,
  name: c.name || c.value,
  classification: c.description || `${c.type} candidate asset`,
  type: c.type,
  platform: c.type,
  asset: c.value,
  sourceUrl: /^https?:\/\//i.test(c.value) ? c.value : null,
  collectedAt: c.collectedAt || null,
  status: statusLabel(c.status),
  time: shortTime(c.createdAt),
  group: c.type,
  brandId: c.brandId,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
})

const candidateToAccount = c => ({
  id: c.id,
  username: c.value,
  platform: 'Social',
  profileName: c.name || null,
  followers: null,
  age: null,
  similarity: null,
  confidence: null,
  risk: null,
  severity: null,
  status: statusLabel(c.status),
  domain: null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
})

const candidateToDomain = c => ({
  id: c.id,
  domain: c.value,
  classification: c.type,
  similarity: null,
  age: null,
  ssl: null,
  risk: null,
  status: statusLabel(c.status),
  name: c.name || c.value,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
})

const candidateToApplication = c => ({
  id: c.id,
  name: c.name || c.value,
  store: null,
  developer: null,
  package: null,
  logoSimilarity: null,
  descriptionSimilarity: null,
  risk: null,
  status: statusLabel(c.status),
  description: c.description || null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
})

const buildActivity = (candidates, now) => Array.from({ length: 7 }, (_, index) => {
  const day = new Date(now)
  day.setDate(now.getDate() - (6 - index))
  const key = dayKey(day)
  return {
    day: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: candidates.filter(c => dayKey(new Date(c.createdAt)) === key).length
  }
})

const buildDashboard = ({ brands, candidates, officialAssets, loadedAt }) => {
  const total = candidates.length
  const count = status => candidates.filter(c => c.status === status).length
  const pending = count('PENDING')
  const reviewing = count('REVIEWING')
  const confirmed = count('CONFIRMED')
  const dismissed = count('DISMISSED')
  const now = new Date()
  const stageStamp = stamp(loadedAt)
  const breakdown = officialAssets.reduce((acc, asset) => { acc[asset.type] = (acc[asset.type] || 0) + 1; return acc }, { SOCIAL: 0, APP: 0, WEBSITE: 0, DOMAIN: 0 })
  return {
    overview: { greeting: 'Good afternoon, Security Team', subtitle: 'Your brand protection overview', date: clockDate(now), dateLabel: clockLabel(now) },
    brand: { name: brands[0]?.name || 'No brand registered', assets: officialAssets.length, campaigns: 0, website: brands[0]?.website || null, breakdown },
    metrics: [
      ['Brands', String(brands.length), 'Monitored'],
      ['Official Assets', String(officialAssets.length), 'Authorized inventory'],
      ['Candidate Assets', String(total), 'Registered in Aegis'],
      ['Pending Review', String(pending), 'Status · PENDING'],
      ['Under Review', String(reviewing), 'Status · REVIEWING'],
      ['Confirmed', String(confirmed), 'Status · CONFIRMED'],
      ['Dismissed', String(dismissed), 'Status · DISMISSED']
    ],
    posture: {
      score: total ? Math.round((100 * confirmed) / total) : 0,
      status: total ? `${confirmed} of ${total} candidates confirmed` : 'No candidate assets',
      items: [
        ['Candidate assets', String(total)],
        ['Pending review', String(pending)],
        ['Under review', String(reviewing)],
        ['Confirmed', String(confirmed)],
        ['Dismissed', String(dismissed)]
      ]
    },
    pipeline: [
      ['Brand Registry', 'Complete', brands.length, stageStamp, '—'],
      ['Official Assets', 'Complete', officialAssets.length, stageStamp, '—'],
      ['Candidate Assets', 'Complete', total, stageStamp, '—'],
      ['Evidence Engine', 'Waiting', 0, 'Not started', '—'],
      ['Risk Engine', 'Waiting', 0, 'Not started', '—'],
      ['Campaign Correlation', 'Waiting', 0, 'Not started', '—'],
      ['AI Investigation', 'Waiting', 0, 'Not started', '—']
    ],
    activity: buildActivity(candidates, now)
  }
}

async function fetchWorkspace() {
  const [brandsPayload, candidatesPayload] = await Promise.all([
    aegisService.brands.list(),
    aegisService.candidates.list()
  ])
  const brands = unwrap(brandsPayload)
  const candidates = unwrap(candidatesPayload)
  const assetPayloads = await Promise.all(brands.map(brand => aegisService.officialAssets.list(brand.id)))
  const officialAssets = assetPayloads.flatMap(unwrap)
  const threats = candidates.map(candidateToThreat).sort(byCreatedAtDesc)
  const byType = type => candidates.filter(c => c.type === type)
  const brand = brands[0]
  const graphNodes = brand ? [
    { id: `brand-${brand.id}`, label: brand.name, type: 'Brand', x: 12, y: 50, detail: 'Registered monitored brand' },
    ...candidates.slice(0, 30).map((candidate, index) => ({
      id: candidate.id,
      label: candidate.name || candidate.value,
      type: candidate.type === 'SOCIAL' ? 'Account' : candidate.type === 'APP' ? 'Application' : candidate.type === 'DOMAIN' ? 'Domain' : 'Website',
      x: 30 + (index % 4) * 20,
      y: 20 + Math.floor(index / 4) * 20,
      detail: `${candidate.type} candidate · ${statusLabel(candidate.status)}`
    }))
  ] : []
  const graphEdges = graphNodes.slice(1).map(node => [`brand-${brand.id}`, node.id])
  return {
    brands,
    candidates,
    officialAssets,
    threats,
    accounts: byType('SOCIAL').map(candidateToAccount),
    applications: byType('APP').map(candidateToApplication),
    domains: candidates.filter(c => c.type === 'WEBSITE' || c.type === 'DOMAIN').map(candidateToDomain),
    vulnerabilities: [],
    campaigns: [],
    evidence: {
      nodes: graphNodes,
      edges: graphEdges,
      note: 'Registered candidates and their relationships to the monitored brand. Supporting evidence is generated on demand from each candidate drawer.'
    },
    ai: [],
    dashboard: buildDashboard({ brands, candidates, officialAssets, loadedAt: new Date() })
  }
}

export function loadAegisWorkspace() {
  if (workspace) return Promise.resolve(workspace)
  if (inflight) return inflight
  inflight = fetchWorkspace().then(
    result => { workspace = result; inflight = null; return result },
    error => { inflight = null; throw error }
  )
  return inflight
}

export const getAegisDashboard = async () => (await loadAegisWorkspace()).dashboard
export const getAegisThreats = async () => (await loadAegisWorkspace()).threats
export const getAegisAccounts = async () => (await loadAegisWorkspace()).accounts
export const getAegisVulnerabilities = async () => (await loadAegisWorkspace()).vulnerabilities
export const getAegisDomains = async () => (await loadAegisWorkspace()).domains
export const getAegisApplications = async () => (await loadAegisWorkspace()).applications
export const getAegisCampaigns = async () => (await loadAegisWorkspace()).campaigns
export const getAegisEvidence = async () => (await loadAegisWorkspace()).evidence
export const getAegisAi = async () => (await loadAegisWorkspace()).ai
