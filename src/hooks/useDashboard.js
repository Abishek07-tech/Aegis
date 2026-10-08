import { useCallback, useEffect, useState } from 'react'
import { getDashboard } from '../services/dashboardService.js'

export function useDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading,setLoading]=useState(true)
  const refresh=useCallback(async()=>{setLoading(true);setError(null);try{setData(await getDashboard())}catch(reason){setError(reason)}finally{setLoading(false)}},[])
  useEffect(()=>{refresh()},[refresh])
  return { data, error, loading, refresh }
}
