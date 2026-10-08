import { aiMock } from '../data/mock/ai.js'
import { getAegisAi } from './aegisAdapter.js'
import { USE_MOCK_DATA, notAvailable } from './serviceFactory.js'
export const aiService={get:async(id)=>USE_MOCK_DATA?structuredClone(aiMock.find(item=>item.id===id)||aiMock):notAvailable('AI analysis detail'),list:async()=>USE_MOCK_DATA?structuredClone(aiMock):getAegisAi()}
