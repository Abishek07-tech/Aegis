import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, ChevronDown, ChevronRight, Command, Menu, Search, X } from 'lucide-react'
import BackendStatus from './BackendStatus.jsx'
import Modal from '../ui/Modal.jsx'
import { USE_MOCK_DATA } from '../../services/serviceFactory.js'

export function initialNotifications(records){
 if(USE_MOCK_DATA)return [{id:'n1',text:'3 critical threats detected',read:false},{id:'n2',text:'Fake account detected: @PaySecure_Support',read:false},{id:'n3',text:'Phishing domain detected',read:false},{id:'n4',text:'Fake application detected',read:true}]
 const threats=records?.threats||[]
 const pending=threats.filter(t=>String(t.status||'').toLowerCase()==='pending').length
 return [
  {id:'n-api-1',text:`${threats.length} candidate assets registered`,read:false},
  {id:'n-api-2',text:`${pending} candidates awaiting review`,read:false},
  {id:'n-api-3',text:`${(records?.campaigns||[]).length} correlated campaigns on record`,read:true}
 ]
}

export default function Topbar({onMenu,overview,records,onSelectThreat,onNavigate,scanComplete}){
 const [query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[notifications,setNotifications]=useState(false),[items,setItems]=useState(()=>initialNotifications(records))
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true)}if(e.key==='Escape'){setSearchOpen(false);setNotifications(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
 useEffect(()=>{if(scanComplete)setItems(prev=>[{id:`scan-${Date.now()}`,text:`${scanComplete.demo?'Demo':'Authorized API'} scan complete: ${scanComplete.critical||0} critical threats detected`,read:false},{id:`scan-domain-${Date.now()}`,text:`${scanComplete.demo?'Simulated ':''}phishing domain detected`,read:false},{id:`scan-app-${Date.now()}`,text:`${scanComplete.demo?'Simulated ':''}fake application detected`,read:false},...prev])},[scanComplete])
 const found=useMemo(()=>{if(!query.trim()||!records)return[];const all=[...(records.threats||[]),...(records.accounts||[]),...(records.domains||[]),...(records.applications||[]),...(records.vulnerabilities||[]),...(records.campaigns||[])];return all.filter(x=>JSON.stringify(x).toLowerCase().includes(query.toLowerCase())).slice(0,8)},[query,records])
 return <header className="topbar"><div className="topbar-left"><button className="menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20}/></button><div className="topbar-greeting"><b>Good afternoon, Security Team</b><small>Your brand protection overview</small></div></div><button className="global-search launch-search" onClick={()=>setSearchOpen(true)}><Search size={16}/><span>Search threats, accounts, domains, applications...</span><kbd><Command size={11}/> K</kbd></button><div className="topbar-actions"><BackendStatus/><button className="icon-button notification-button" aria-label="Notifications" aria-expanded={notifications} onClick={()=>setNotifications(x=>!x)}><Bell size={18}/><i/></button><button className="user-menu"><span className="user-avatar">R</span><span>Ramajayam</span><ChevronDown size={15}/></button><div className="date-chip"><CalendarDays size={16}/><div><b>{overview.date}</b><span>{overview.dateLabel}</span></div></div></div>
 {notifications&&<aside className="notification-popover"><header><b>Notifications</b><button onClick={()=>setItems([])}>Clear all</button></header>{items.length?items.map(n=><div className={`notification-entry ${n.read?'read':''}`} key={n.id}><i/><span>{n.text}</span><button onClick={()=>{setItems(prev=>prev.map(x=>x.id===n.id?{...x,read:true}:x));if(records?.threats?.[0])onSelectThreat(records.threats[0])}}>Open</button><button onClick={()=>setItems(prev=>prev.map(x=>x.id===n.id?{...x,read:true}:x))}>Mark read</button></div>):<p>No new notifications</p>}</aside>}
 <Modal open={searchOpen} title="Global Search" onClose={()=>{setSearchOpen(false);setQuery('')}} wide><div className="command-search"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search threats, accounts, domains, applications..." aria-label="Search all intelligence"/><kbd>ESC</kbd></div><div className="command-results">{query?found.map((r,i)=><button key={r.id||i} onClick={()=>{setSearchOpen(false);setQuery('');if(r.username||r.name&&r.type)onSelectThreat(r);else if(r.domain){onNavigate('Domains');onSelectThreat(r)}else if(r.package){onNavigate('Applications');onSelectThreat(r)}else if(r.finding){onNavigate('Vulnerabilities');onSelectThreat(r)}else if(r.id?.startsWith('CAMP-')){onNavigate('Campaigns');onSelectThreat(r)}else onNavigate('Threat Inbox')}}><span>{r.name||r.username||r.domain||r.finding}</span><small>{r.type||r.platform||r.classification||'Result'}</small><ChevronRight size={15}/></button>):<p>Search across threats, accounts, domains, applications, vulnerabilities and campaigns.</p>}{query&&found.length===0&&<p>No results found.</p>}</div></Modal>
 </header>
}
