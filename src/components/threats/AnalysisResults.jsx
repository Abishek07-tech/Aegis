function StepError({ label, error }) {
  return <p><span>{label} unavailable · </span>{error?.message || 'Request failed'}{error?.code ? ` · ${error.code}` : ''}</p>
}

function ItemList({ items }) {
  return <ul className="drawer-evidence">{items.map((item, index) => <li key={index}><span>{item.label}{item.sublabel ? <><br/><small>{item.sublabel}</small></> : null}</span><b>{item.value}</b></li>)}</ul>
}

export default function AnalysisResults({ analysis, tab }) {
  if (!analysis) return null
  if (!analysis.applicable) {
    return <div className="drawer-section"><span>ANALYSIS NOT APPLICABLE</span><p>{analysis.reason}</p></div>
  }
  const s = analysis.steps || {}
  // Backend wraps each analysis response as {success,data}; preserve the full
  // payload per step but read the outcome from .data (fall back to raw).
  const ok = key => {
    const payload = s[key]?.ok === true ? s[key].response : null
    if (!payload || typeof payload !== 'object') return null
    return payload.data !== undefined ? payload.data : payload
  }
  const err = key => (s[key]?.ok === false ? s[key].error : null)
  const risk = ok('risk'), expl = ok('explanation'), ev = ok('evidence')
  const corr = ok('correlation'), camp = ok('campaign')
  const invRes = ok('investigation'), play = ok('playbook'), report = ok('report')
  const inv = invRes?.investigation

  if (tab === 'Evidence') {
    const reportEvidence = report?.keyEvidence?.evidence
    return <div className="drawer-section">
      {ev ? <>
        <span>LIVE EVIDENCE · {ev.evidenceCount} SIGNALS · {ev.highSeverityCount} HIGH SEVERITY</span>
        {ev.evidence?.length > 0
          ? <ItemList items={ev.evidence.map(item => ({ label: item.signal, sublabel: `${item.source} · ${item.reason}`, value: `${item.severity} · ${item.score}` }))} />
          : <p>No evidence signals returned for this candidate.</p>}
        {ev.unavailable?.length > 0 && <><span>UNAVAILABLE SOURCES</span><ItemList items={ev.unavailable.map(item => ({ label: item.source, value: 'unavailable' }))} /><p>{ev.unavailable.map(item => item.reason).join(' ')}</p></>}
      </> : reportEvidence?.length ? <>
        <span>REPORT EVIDENCE · {report.keyEvidence.evidenceCount} SIGNALS · {report.keyEvidence.highSeverityCount} HIGH SEVERITY</span>
        <ItemList items={reportEvidence.map(item => ({ label: item.signal, sublabel: `${item.source} · ${item.reason}`, value: `${item.severity} · ${item.score}` }))} />
      </> : <StepError label="Evidence analysis" error={err('evidence')} />}
    </div>
  }

  if (tab === 'AI Analysis') {
    return <div className="drawer-section">
      {inv ? <>
        <span className="ai-label">AEGIS AI INVESTIGATION · {inv.confidenceLevel} CONFIDENCE ({inv.confidence}%)</span>
        <p><b>{inv.headline}</b></p>
        <p>{inv.assessment}</p>
        <p><span>Primary intent · </span>{inv.threatIntent}{inv.secondaryIntents?.length ? ` · supporting: ${inv.secondaryIntents.join(', ')}` : ''}</p>
        {inv.keyFindings?.length > 0 && <ItemList items={inv.keyFindings.map(entry => ({ label: entry.finding, sublabel: entry.evidence, value: entry.importance }))} />}
        {inv.strongestEvidence?.length > 0 && <><span>STRONGEST EVIDENCE</span><ItemList items={inv.strongestEvidence.map(entry => ({ label: entry.signal, sublabel: `${entry.source} · ${entry.explanation}`, value: entry.strength }))} /></>}
        {inv.uncertainties?.length > 0 && <><span>OPEN UNCERTAINTIES</span><ItemList items={inv.uncertainties.map(entry => ({ label: entry.issue, sublabel: entry.reason, value: 'open' }))} /></>}
      </> : <StepError label="AI investigation" error={err('investigation')} />}
    </div>
  }

  if (tab === 'Relationships') {
    return <div className="drawer-section">
      {corr ? <>
        <span>CORRELATION CLUSTER · {corr.cluster?.size ?? 0} CANDIDATES</span>
        {corr.relatedCandidates?.length > 0
          ? <ItemList items={corr.relatedCandidates.map(rel => ({ label: rel.candidateId, sublabel: (rel.links || []).map(link => `${link.type}: ${link.explanation}`).join(' · ') || 'No link detail', value: `${rel.relationshipLevel} · ${rel.relationshipScore}` }))} />
          : <p>No related candidates found in this brand's cluster.</p>}
      </> : <StepError label="Correlation" error={err('correlation')} />}
      {camp ? <>
        <span>CAMPAIGN ANALYSIS · {camp.campaignDetected ? 'CAMPAIGN DETECTED' : 'NO CAMPAIGN'}</span>
        {camp.campaignDetected && camp.campaign
          ? <p><b>{camp.campaign.campaignType}</b> · confidence {camp.campaign.confidenceScore}% ({camp.campaign.confidenceLevel}) · {camp.campaign.candidateIds?.length ?? 0} members · {camp.campaign.relatedCandidateCount ?? 0} related candidates</p>
          : <p>No coordinated campaign detected for this candidate.</p>}
        <p>{camp.explanation}</p>
      </> : <StepError label="Campaign analysis" error={err('campaign')} />}
    </div>
  }

  if (tab === 'Timeline') {
    const path = report?.attackPath?.length ? report.attackPath : inv?.attackPath
    return <div className="drawer-section">
      {report?.generatedAt && <span>REPORT GENERATED · {new Date(report.generatedAt).toLocaleString()}</span>}
      {path?.length
        ? <ItemList items={path.map((step, index) => ({ label: step.step, sublabel: step.evidence, value: `#${index + 1}` }))} />
        : inv || report ? <p>No attack path steps returned for this candidate.</p> : <StepError label="AI investigation" error={err('investigation')} />}
    </div>
  }

  if (tab === 'Recommended Actions') {
    const recommendations = inv?.recommendedActions?.length ? inv.recommendedActions : report?.recommendedActions
    const predictions = play?.predictions?.length ? play.predictions : report?.predictedNextActions
    return <div className="drawer-section">
      {recommendations?.length > 0
        ? <><span>RECOMMENDED ACTIONS</span><ItemList items={recommendations.map(action => ({ label: action.action, sublabel: action.reason, value: action.priority }))} /></>
        : <>{!inv && <StepError label="AI investigation" error={err('investigation')} />}{!inv && !report && <p>No recommended actions returned.</p>}</>}
      {play ? <>
        <span>ADVERSARY PLAYBOOK · OVERALL CONFIDENCE {play.overallConfidence}%</span>
        {predictions?.length > 0
          ? <ItemList items={predictions.map(prediction => ({ label: prediction.action, sublabel: `${prediction.rationale}${prediction.supportingSignals?.length ? ` · signals: ${prediction.supportingSignals.join(', ')}` : ''}`, value: `${prediction.confidence}%` }))} />
          : <p>No predicted next actions returned.</p>}
        {play.limitations?.length > 0 && <><span>PLAYBOOK LIMITATIONS</span><ItemList items={play.limitations.map(limitation => ({ label: limitation.issue, sublabel: limitation.reason, value: 'limitation' }))} /></>}
      </> : predictions?.length > 0
        ? <><span>PREDICTED NEXT ACTIONS · REPORT</span><ItemList items={predictions.map(prediction => ({ label: prediction.action, sublabel: `${prediction.rationale}${prediction.supportingSignals?.length ? ` · signals: ${prediction.supportingSignals.join(', ')}` : ''}`, value: `${prediction.confidence}%` }))} /></>
        : <StepError label="Adversary playbook" error={err('playbook')} />}
      {report?.analystConclusion && <p><span>ANALYST CONCLUSION · </span>{report.analystConclusion}</p>}
      {!report && <StepError label="Investigation report" error={err('report')} />}
    </div>
  }

  // Overview
  return <div className="drawer-section">
    {risk ? <>
      <span>LIVE RISK ENGINE</span>
      <p><b>{risk.riskScore} · {risk.riskLevel}</b> · confidence {Math.round((risk.confidence ?? 0) * 100)}% · {risk.evidenceCount} signals · {risk.independentSourceCount} independent sources</p>
      {risk.reasons?.length > 0 && <ItemList items={risk.reasons.map(reason => ({ label: reason.reason, sublabel: `${reason.category} · ${reason.signal}`, value: reason.impact > 0 ? `+${reason.impact}` : `${reason.impact}` }))} />}
    </> : <StepError label="Risk analysis" error={err('risk')} />}
    {expl?.summary && <p>{expl.summary}</p>}
    {!expl && <StepError label="Explanation" error={err('explanation')} />}
    {expl?.whyFlagged?.length > 0 && <><span>WHY FLAGGED</span><ItemList items={expl.whyFlagged.map(entry => ({ label: entry.signal, sublabel: `${entry.source} · ${entry.explanation}`, value: entry.impact }))} /></>}
    {expl?.whyNotFlagged?.length > 0 && <><span>PROTECTIVE SIGNALS · NOT FLAGGED</span><ItemList items={expl.whyNotFlagged.map(entry => ({ label: entry.signal, sublabel: `${entry.source} · ${entry.explanation}`, value: entry.protection }))} /></>}
    {(!expl?.whyNotFlagged?.length) && expl?.protectiveSignals?.length > 0 && <p><span>PROTECTIVE SIGNALS · </span>{expl.protectiveSignals.join(', ')}</p>}
    {report?.targetBrand?.name && <p><span>TARGET BRAND · </span>{report.targetBrand.name}{report.candidateAsset?.value ? ` → ${report.candidateAsset.type} ${report.candidateAsset.value}` : ''}</p>}
    {report?.executiveSummary && <p><span>EXECUTIVE SUMMARY · </span>{report.executiveSummary}</p>}
  </div>
}
