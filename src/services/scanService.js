import { apiClient } from './apiClient.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
export const scanService={start:async(payload)=>USE_MOCK_DATA?{id:`SCAN-${Date.now()}`,status:'demo',...payload}:apiClient.post('/api/scans',payload),get:async(id)=>USE_MOCK_DATA?{id,status:'complete',progress:100}:apiClient.get(`/api/scans/${encodeURIComponent(id)}`)}
