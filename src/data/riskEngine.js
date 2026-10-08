const weights={severity:.2,confidence:.2,brandSimilarity:.18,assetCriticality:.15,relatedIndicators:.12,campaignRelationships:.08,recency:.07}
const severityValue={Critical:100,High:80,Medium:60,Low:35,Informational:10,Legitimate:0}
export function calculateRisk(input={}){
 const severityInput=severityValue[input.severity]??Number(input.severity??10)
 const values={severity:Number.isFinite(severityInput)?severityInput:10,confidence:Number(input.confidence||0),brandSimilarity:Number(input.brandSimilarity||0),assetCriticality:Number(input.assetCriticality??50),relatedIndicators:Math.min(100,Number(input.relatedIndicators||0)*18),campaignRelationships:Math.min(100,Number(input.campaignRelationships||0)*25),recency:Number(input.recency??50)}
 const riskScore=Math.max(0,Math.min(100,Math.round(Object.entries(weights).reduce((sum,[key,weight])=>sum+(values[key]||0)*weight,0))))
 const severity=riskScore>=95?'Critical':riskScore>=80?'High':riskScore>=60?'Medium':riskScore>=30?'Low':'Informational'
 const classification=input.classification||`${severity} risk`
 return {riskScore,severity,classification}
}
