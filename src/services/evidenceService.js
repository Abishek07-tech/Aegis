import { evidenceMock } from '../data/mock/evidence.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
import { apiClient } from './apiClient.js'
export const evidenceService={get:async()=>USE_MOCK_DATA?structuredClone(evidenceMock):apiClient.get('/api/evidence-graph')}
