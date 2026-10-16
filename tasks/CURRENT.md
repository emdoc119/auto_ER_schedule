# Current objective

PR #5 독립 검증 후속: 웹 승인 세션 격리, 기존 Hermes 단일 수신기 설계, 22건 이관 재검증, PR #4 → #5 병합 준비.

- Scope: per-browser sessions and restart/cross-session tests, readonly audit CLI, standalone polling CLI disable, Hermes entrypoint/adapter approval design, dependent PR validation.
- Constraints: main merge, Calendar writes/enable, new polling, service restart are forbidden without additional user approval. Hermes runtime/config/source unchanged. Preserve private data and user files.
- Evidence: actual workbook and fresh Calendar 22 events match visible fields, no duplicated dates; conditional unmanaged plan create0/update0/adopt22/noop0/review0 preserves existing IDs. Raw private properties/ETags unavailable through connector; adoption split unconfirmed until direct readonly OAuth audit.
- PR #4: minimal ancillary-code fix; 29/29 tests and actual-file extraction22. No main merge.
- Docs: docs/PRE_DEPLOY_REVIEW.md, docs/HERMES_INGRESS_DESIGN.md.
- Next approval gates: PR #4 merge, direct OAuth setup, exact Hermes plugin/guard/runtime integration diff, then separately first Calendar writes.
