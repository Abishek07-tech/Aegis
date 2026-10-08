export const dashboardMock = {
  id:'DASH-DEMO-001',createdAt:'2026-10-08T08:00:00.000Z',updatedAt:'2026-10-08T09:16:00.000Z',
  overview:{greeting:'Good afternoon, Security Team',subtitle:'Your brand protection overview',date:'Oct 8, 2026',dateLabel:'Wednesday · 03:16 PM'},
  brand:{name:'PaySecure',assets:108,campaigns:2},
  metrics:[['Brand Exposure','82 / 100','+12%'],['Critical Threats','3','+1 today'],['Fake Accounts','14','+4 today'],['Vulnerabilities','7','2 critical'],['Phishing Domains','9','+3 today'],['Active Campaigns','2','Live'],['Total Assets','108','Authorized inventory']],
  posture:{score:78,status:'Elevated risk',items:[['Brand Impersonation','High'],['Phishing','Critical'],['Vulnerabilities','Medium'],['Fake Applications','High'],['Infrastructure','Low']]},
  pipeline:[['Asset Collection','Complete',108,'Oct 8, 2026 · 03:14 PM','1.2s'],['Identity Analysis','Complete',14,'Oct 8, 2026 · 03:14 PM','2.8s'],['Domain Intelligence','Complete',9,'Oct 8, 2026 · 03:15 PM','3.1s'],['Application Analysis','Complete',4,'Oct 8, 2026 · 03:15 PM','1.9s'],['AI Classification','Running',5,'Oct 8, 2026 · 03:16 PM','—'],['Risk Engine','Waiting',0,'Not started','—'],['Evidence Correlation','Waiting',0,'Not started','—']],
  activity:[{day:'Oct 2',value:6},{day:'Oct 3',value:8},{day:'Oct 4',value:14},{day:'Oct 5',value:21},{day:'Oct 6',value:32},{day:'Oct 7',value:25},{day:'Oct 8',value:19}],
}
