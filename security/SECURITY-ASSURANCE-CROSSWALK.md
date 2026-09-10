# Lesson Hub 1.2.22 — Security Assurance Crosswalk

Crosswalk je auditní mapa, nikoli certifikace shody.

| Referenční rámec | GARP oblast | Evidence 1.2.22 | Stav |
|---|---|---|---|
| OWASP ASVS 5.0.0, L2 orientace | access/config/storage/files/logging | gateway hardening v3, server/core/audit regrese, deployment security | AMBER kvůli LIVE/browser dluhům |
| NIST SP 800-218 SSDF 1.1 | dependency/build/release | lock gate, workflow policy, canonical secret scan, dual SBOM, provenance, RI | RI-PREP se ověřuje samostatně; SHIELD-PREP AMBER |
| NIST SP 800-218A | AI secure development | žádný model/provider/tool egress | N/A |
| SLSA v1.2 | build provenance | custom provenance; `baseCommit` + exact source-package SHA | evidence only; žádný SLSA level se netvrdí |
| CycloneDX 1.7 | SBOM | development + deployment SBOM | structural evidence; fresh 1.2.22 installed-tree/SCA vyžaduje independent registry-capable běh |
| OWASP GenAI/Agentic | AI/agent runtime | AI-enabled=NO, AGENTIC=NO | N/A pro runtime AI kontroly |

N29/N26: source/deployment scanner sdílí canonical rules pro private-key encoding/archive i lowercase unquoted config secrets; bounded literal folding je doplněk, ne interpretace libovolného JS.  
N27/N28: workflow remote-execution policy zahrnuje i PowerShell alias/long-form a lock gate odmítá noncanonical port.  
N8 scope rule: RI-PREP podpis se vztahuje na school-server deployment, ne na GitHub Pages `dist/`.  
N19 rule: historical Git `baseCommit` není exact identity necommitnutého snapshotu; exact identity je `sourcePackageSha256` + source-tree manifest.
