import { useEffect, useState } from 'react'
import { RotateCw, Wifi, WifiOff } from 'lucide-react'
import { dashboardService } from '../../services/dashboardService.js'
import { USE_MOCK_DATA } from '../../services/serviceFactory.js'

export default function BackendStatus(){const [status,setStatus]=useState(USE_MOCK_DATA?'demo':'syncing');useEffect(()=>{if(USE_MOCK_DATA)return;let mounted=true;dashboardService.health().then(()=>mounted&&setStatus('connected')).catch(()=>mounted&&setStatus(navigator.onLine?'degraded':'offline'));return()=>{mounted=false}},[]);const label={demo:'DEMO MODE',connected:'API Connected',degraded:'API Degraded',offline:'API Offline',syncing:'Synchronizing'}[status];return <span className={`backend-status ${status}`} title={label} aria-label={label} role="status" aria-live="polite">{status==='syncing'?<RotateCw size={13} className="spin"/>:status==='offline'?<WifiOff size={13}/>:<Wifi size={13}/>}<i/>{label}</span>}
