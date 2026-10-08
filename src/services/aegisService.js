import { apiClient, request } from './apiClient.js'

export const aegisService={
  health:{
    get:async()=>apiClient.get('/health')
  },
  brands:{
    list:async()=>apiClient.get('/api/brands'),
    get:async(brandId)=>apiClient.get(`/api/brands/${encodeURIComponent(brandId)}`),
    create:async(payload)=>apiClient.post('/api/brands',payload),
    remove:async(brandId)=>apiClient.delete(`/api/brands/${encodeURIComponent(brandId)}`)
  },
  officialAssets:{
    list:async(brandId)=>apiClient.get(`/api/brands/${encodeURIComponent(brandId)}/assets`),
    get:async(brandId,assetId)=>apiClient.get(`/api/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`),
    create:async(brandId,payload)=>apiClient.post(`/api/brands/${encodeURIComponent(brandId)}/assets`,payload),
    remove:async(brandId,assetId)=>apiClient.delete(`/api/brands/${encodeURIComponent(brandId)}/assets/${encodeURIComponent(assetId)}`)
  },
  candidates:{
    list:async(params)=>apiClient.get(`/api/candidates${params?`?${new URLSearchParams(params)}`:''}`),
    get:async(candidateId)=>apiClient.get(`/api/candidates/${encodeURIComponent(candidateId)}`),
    create:async(payload)=>apiClient.post('/api/candidates',payload),
    updateStatus:async(candidateId,status)=>request(`/api/candidates/${encodeURIComponent(candidateId)}/status`,{method:'PATCH',body:{status}}),
    remove:async(candidateId)=>apiClient.delete(`/api/candidates/${encodeURIComponent(candidateId)}`)
  },
  analysis:{
    name:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/name`),
    text:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/text`),
    logo:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/logo`),
    socialRisk:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/social-risk`),
    appRisk:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/app-risk`),
    evidence:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/evidence`),
    risk:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/risk`),
    explanation:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/explanation`),
    correlation:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/correlation`),
    campaign:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/campaign`),
    investigation:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/investigation`),
    playbook:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/playbook`),
    report:async(candidateId)=>apiClient.post(`/api/candidates/${encodeURIComponent(candidateId)}/analyze/report`)
  }
}
