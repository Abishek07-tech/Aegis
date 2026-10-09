import { ApiError } from './apiClient.js'
// Live API mode is the safe default. Demo data is opt-in for local evaluation.
export const USE_MOCK_DATA=import.meta.env.VITE_USE_MOCK_DATA==='true'
export const notAvailable=message=>Promise.reject(new ApiError(`Not available in API mode: ${message}`,{code:'NOT_AVAILABLE'}))
export function createService({endpoint,mock,collection=false,api}){
  const real=method=>api?.[method]??(()=>notAvailable(`${method} ${endpoint}`))
  return {
    list:async(params)=>USE_MOCK_DATA?structuredClone(mock):real('list')(params),
    get:async(id)=>USE_MOCK_DATA?structuredClone(mock.find?.(item=>item.id===id)):real('get')(id),
    create:async(payload)=>USE_MOCK_DATA?{id:`DEMO-${Date.now()}`,...payload,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}:real('create')(payload),
    update:async(id,payload)=>USE_MOCK_DATA?{...await (async()=>structuredClone(mock.find?.(item=>item.id===id)||{}))(),...payload,updatedAt:new Date().toISOString()}:real('update')(id,payload),
    remove:async(id)=>USE_MOCK_DATA?{id,deleted:true}:real('remove')(id),
    endpoint,mode:USE_MOCK_DATA?'demo':'api',collection,
  }
}
