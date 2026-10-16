# Current objective

읽기 전용 Calendar audit 준비와 PR #4 공개 Pages 영향 검증 후 별도 병합 승인 요청.

- Scope: audit-only calendar.events.owned.readonly + PKCE/state, actual grant validation, explicit raw ID/private/ETag projection, private report; Pages local SheetJS asset and compatibility verification.
- Constraints: no Calendar writes, Hermes config changes, gateway restart or main merge. Never reuse Old Jarvis clients/tokens or publish private audit artifacts.
- Local private inputs prepared outside repo, directory700/file600; no client JSON/token yet. Cloud UI reports new-project trial quota reached; no existing project/client changes.
- Actual adopt/noop split remains unconfirmed until direct readonly OAuth succeeds. Prior visible content match22 and conditional adoption22 are not a confirmed raw audit.
- PR #4 new candidate ce2e5ea2a7b4320b11878c0fb56c88a8d22aa922: SheetJS CDN403 removed with pinned local asset; tests30 passed. Main-root Pages deployment means merge changes public site; approval not granted.
- Docs: READONLY_AUDIT_SETUP.md, PAGES_PR4_IMPACT.md, PRE_DEPLOY_REVIEW.md.
- Next: dedicated audit Desktop JSON/project choice and user Google consent; final CI; request approval for exact PR4 SHA only. Keep PR5 stacked.
