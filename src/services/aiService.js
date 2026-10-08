import { aiMock } from '../data/mock/ai.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
import { apiClient } from './apiClient.js'
export const aiService={get:async(id)=>USE_MOCK_DATA?structuredClone(aiMock.find(item=>item.id===id)||aiMock):apiClient.get(`/api/ai-analysis/${encodeURIComponent(id)}`),list:async()=>USE_MOCK_DATA?structuredClone(aiMock):[await apiClient.get('/api/ai-analysis/THR-8821')]}
