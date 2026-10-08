import { evidenceMock } from '../data/mock/evidence.js'
import { getAegisEvidence } from './aegisAdapter.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
export const evidenceService={get:async()=>USE_MOCK_DATA?structuredClone(evidenceMock):getAegisEvidence()}
