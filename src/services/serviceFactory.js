import { apiClient } from './apiClient.js'
export const USE_MOCK_DATA=import.meta.env.VITE_USE_MOCK_DATA!=='false'
export function createService({endpoint,mock,collection=false}){
  return {
    list:async(params)=>USE_MOCK_DATA?structuredClone(mock):apiClient.get(`${endpoint}${params?`?${new URLSearchParams(params)}`:''}`),
    get:async(id)=>USE_MOCK_DATA?structuredClone(mock.find?.(item=>item.id===id)):apiClient.get(`${endpoint}/${encodeURIComponent(id)}`),
    create:async(payload)=>USE_MOCK_DATA?{id:`DEMO-${Date.now()}`,...payload,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}:apiClient.post(endpoint,payload),
    update:async(id,payload)=>USE_MOCK_DATA?{...await (async()=>structuredClone(mock.find?.(item=>item.id===id)||{}))(),...payload,updatedAt:new Date().toISOString()}:apiClient.put(`${endpoint}/${encodeURIComponent(id)}`,payload),
    remove:async(id)=>USE_MOCK_DATA?{id,deleted:true}:apiClient.delete(`${endpoint}/${encodeURIComponent(id)}`),
    endpoint,mode:USE_MOCK_DATA?'demo':'api',collection,
  }
}
