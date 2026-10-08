import Drawer from '../ui/Drawer.jsx'
import { useState } from 'react'
import { calculateRisk } from '../../data/riskEngine.js'
import { USE_MOCK_DATA } from '../../services/serviceFactory.js'
import AnalysisResults from './AnalysisResults.jsx'

export default function ThreatDrawer({ record, onClose, onResolve, onCampaign, onEvidence, analysis, analysisState, onRunAnalysis }) {
  const [tab, setTab] = useState('Overview')
  const tabs = ['Overview', 'Evidence', 'AI Analysis', 'Relationships', 'Timeline', 'Recommended Actions']
  const model = record ? calculateRisk({ severity: record.severity || 'Medium', confidence: record.confidence || 0, brandSimilarity: record.similarity || 0, assetCriticality: 70, relatedIndicators: 2, campaignRelationships: 1, recency: 80 }) : null
  const title = record?.id?.startsWith('VULN-') ? 'Vulnerability Details' : record?.id?.startsWith('ACC-') ? 'Account Investigation' : record?.id?.startsWith('DOM-') ? 'Domain Investigation' : record?.id?.startsWith('APP-') ? 'Application Investigation' : 'Threat Investigation'
  const demoBody = record && (tab === 'Evidence' ? <ul className="drawer-evidence">{[['Username similarity', record.usernameSimilarity || 97], ['Logo similarity', record.logoSimilarity || 94], ['Bio similarity', record.bioSimilarity || 91], ['Suspicious domain detected', record.domain || 'Yes'], ['Recently created account', record.age || 'Yes']].map(([k, v]) => <li key={k}><span>{k}</span><b>{v}{typeof v === 'number' ? '%' : ''}</b></li>)}</ul>
    : tab === 'AI Analysis' ? <div className="drawer-section"><span className="ai-label">AI DEMO ENGINE · {record.confidence || 96}% CONFIDENCE</span><p>Multiple identity and infrastructure signals resemble the authorized monitored brand identity. Analyst validation is required.</p></div>
    : tab === 'Relationships' ? <div className="drawer-section"><b>Related indicators</b><p>{record.domain || 'paysecure-login-demo.example'}<br />Campaign #001</p></div>
    : tab === 'Timeline' ? <div className="drawer-section"><p>Detected · {record.time || '2 min ago'}</p><p>Identity analysis · Complete</p><p>Investigation · In progress</p></div>
    : tab === 'Recommended Actions' ? <div className="drawer-section"><p>{record.remediation || 'Investigate and initiate takedown workflow if confirmed.'}</p></div>
    : <div className="drawer-section"><p>This demonstration record is illustrative only. Validate signals against authorized sources before taking action.</p><span>Asset: {record.asset || record.platform || 'Authorized brand scope'}</span></div>)
  const idleBody = <div className="drawer-section"><span>ANALYSIS NOT RUN</span><p>Run Aegis Analysis to load live results for this tab.</p></div>
  const errorBody = <div className="drawer-section"><span>ANALYSIS FAILED</span><p>The analysis request did not complete. Check the API connection and run the analysis again.</p></div>
  const body = analysis ? <AnalysisResults analysis={analysis} tab={tab} /> : USE_MOCK_DATA ? demoBody : analysisState === 'error' ? errorBody : idleBody
  const running = analysisState === 'running'
  const analysisRisk = !USE_MOCK_DATA && analysis?.applicable && analysis?.steps?.risk?.ok
    ? (analysis.steps.risk.response?.data ?? analysis.steps.risk.response)
    : null
  const hasRecordRisk = record && (record.risk ?? record.score) != null
  const riskValue = analysisRisk ? analysisRisk.riskScore : hasRecordRisk ? (record.risk ?? record.score) : '—'
  const riskClass = analysisRisk
    ? String(analysisRisk.riskLevel || 'neutral').toLowerCase()
    : hasRecordRisk || (USE_MOCK_DATA && record)
      ? String(record?.severity || record?.status || 'high').toLowerCase()
      : 'neutral'
  const projection = USE_MOCK_DATA
    ? { label: 'Risk engine projection', value: model ? `${model.riskScore} · ${model.severity}` : '—' }
    : { label: 'Aegis analysis', value: analysis
        ? analysis.applicable === false ? 'Not applicable'
          : analysisRisk ? `${analysisRisk.riskScore} · ${analysisRisk.riskLevel}`
          : analysis.steps?.risk?.ok ? 'Risk pending' : 'Risk unavailable'
        : analysisState === 'running' ? 'Analyzing…'
        : analysisState === 'error' ? 'Failed'
        : 'Not analyzed yet' }
  return <Drawer open={Boolean(record)} title={title} onClose={onClose}>{record && <>
    <div className="drawer-threat-head"><div><small>{record.id || 'DEMO RECORD'} · {record.type || record.classification || 'Finding'}</small><h3>{record.name || record.username || record.domain || record.finding || record.label}</h3></div><b className={`drawer-risk ${riskClass}`}>{riskValue}<small>/ 100</small></b></div>
    <div className="drawer-meta"><span>Classification<b>{record.type || record.classification || record.category || record.label || 'Brand Impersonation'}</b></span><span>Status<b>{record.status || 'Investigating'}</b></span><span>{projection.label}<b>{projection.value}</b></span></div>
    <div className="drawer-tabs">{tabs.map(t => <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>{t}</button>)}</div>
    {body}
    <div className="drawer-actions">
      {!USE_MOCK_DATA && <button className="primary" disabled={running} onClick={() => onRunAnalysis?.()}>{running ? 'Running analysis…' : analysis ? 'Re-run Aegis Analysis' : 'Run Aegis Analysis'}</button>}
      <button onClick={() => onResolve?.(record)}>Mark Investigating</button>
      <button className="primary" onClick={() => onResolve?.(record, 'Resolved')}>Mark Resolved</button>
      <button onClick={() => onCampaign?.(record)}>Create Campaign</button>
      <button onClick={() => onEvidence?.()}>View Evidence</button>
    </div>
  </>}</Drawer>
}
