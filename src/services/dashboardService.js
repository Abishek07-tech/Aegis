import { dashboardMock } from '../data/mock/dashboard.js'
import { apiClient } from './apiClient.js'
import { USE_MOCK_DATA } from './serviceFactory.js'
export const dashboardService={get:async()=>USE_MOCK_DATA?structuredClone(dashboardMock):apiClient.get('/api/dashboard'),getDashboard:async()=>USE_MOCK_DATA?structuredClone(dashboardMock):apiClient.get('/api/dashboard'),health:async()=>USE_MOCK_DATA?{status:'demo'}:apiClient.get('/api/health')}
export const getDashboard=dashboardService.getDashboard
