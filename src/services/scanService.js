import { USE_MOCK_DATA, notAvailable } from './serviceFactory.js'
export const scanService={start:async(payload)=>USE_MOCK_DATA?{id:`SCAN-${Date.now()}`,status:'demo',...payload}:notAvailable('scan start'),get:async(id)=>USE_MOCK_DATA?{id,status:'complete',progress:100}:notAvailable('scan status')}
