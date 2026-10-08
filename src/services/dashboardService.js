import { dashboardMock } from '../data/mock/dashboard.js'
import { aegisService } from './aegisService.js'
import { getAegisDashboard } from './aegisAdapter.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
export const dashboardService={get:async()=>USE_MOCK_DATA?structuredClone(dashboardMock):getAegisDashboard(),getDashboard:async()=>USE_MOCK_DATA?structuredClone(dashboardMock):getAegisDashboard(),health:async()=>USE_MOCK_DATA?{status:'demo'}:aegisService.health.get()}
export const getDashboard=dashboardService.getDashboard
