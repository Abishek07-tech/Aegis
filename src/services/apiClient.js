export class ApiError extends Error {
  constructor(message,{status=0,code='API_ERROR',cause,details}={}){super(message,{cause});this.name='ApiError';this.status=status;this.code=code;this.details=details}
}

let API_BASE_URL=import.meta.env.VITE_API_BASE_URL||''
const REQUEST_TIMEOUT=Number(import.meta.env.VITE_API_TIMEOUT_MS||10000)
export const configureApiBaseUrl=value=>{API_BASE_URL=String(value||'').replace(/\/$/,'')}
export const getApiBaseUrl=()=>API_BASE_URL

export async function request(path,{method='GET',body,headers={},signal}={}){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT)
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true})
  try{
    const response=await fetch(`${API_BASE_URL}${path}`,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal})
    if(!response.ok){
      const payload=await response.json().catch(()=>null)
      const message=typeof payload?.message==='string'&&payload.message?`${payload.message} (HTTP ${response.status})`:`Request failed (${response.status})`
      throw new ApiError(message,{status:response.status,code:'HTTP_ERROR',details:payload?.details})
    }
    if(response.status===204)return null
    return await response.json()
  }catch(error){
    if(error instanceof ApiError)throw error
    if(error.name==='AbortError')throw new ApiError('Request timed out',{code:'TIMEOUT',cause:error})
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw new ApiError('Device is offline',{code:'OFFLINE',cause:error})
    throw new ApiError(error.message||'Unable to reach API',{code:'NETWORK_ERROR',cause:error})
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}

export const apiClient={get:(path,options)=>request(path,options),post:(path,body,options)=>request(path,{...options,method:'POST',body}),put:(path,body,options)=>request(path,{...options,method:'PUT',body}),delete:(path,options)=>request(path,{...options,method:'DELETE'})}
