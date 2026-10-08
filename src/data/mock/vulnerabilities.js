const timestamps={createdAt:'2026-10-08T08:00:00.000Z',updatedAt:'2026-10-08T09:16:00.000Z'}
export const vulnerabilityMock=[
 {id:'VULN-003',asset:'admin.paysecure-demo.local',finding:'Outdated authorized dependency',severity:'Critical',risk:95,cve:'CVE-DEMO-2026-001',status:'Open',detected:'8 min ago',category:'Outdated component',remediation:'Update the authorized dependency to a vendor-supported patched release and validate in staging.',...timestamps},
 {id:'VULN-004',asset:'api.paysecure.example',finding:'TLS 1.0 protocol enabled',severity:'High',risk:78,cve:'—',status:'Open',detected:'Today',category:'SSL/TLS',remediation:'Disable TLS 1.0 and require TLS 1.2 or later.',...timestamps},
 {id:'VULN-005',asset:'portal.paysecure.example',finding:'Content-Security-Policy header missing',severity:'Medium',risk:64,cve:'—',status:'In progress',detected:'Today',category:'Security headers',remediation:'Deploy a restrictive Content-Security-Policy, initially in report-only mode.',...timestamps},
 {id:'VULN-006',asset:'storage.paysecure.example',finding:'Public object listing configuration',severity:'High',risk:83,cve:'—',status:'Open',detected:'Yesterday',category:'Cloud / storage',remediation:'Disable public listing and apply least-privilege access policies.',...timestamps},
]
