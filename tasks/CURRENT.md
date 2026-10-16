# Current objective

Issue #3: Excel → AER duty dry-run을 독립 브랜치에서 검토 가능하게 구현한다.

- Scope: shared browser/Node parser, synthetic XLSX tests, readonly local OAuth/backend, conservative reconciliation, Pages-to-loopback File handoff, installation guide, PR.
- Constraints: no live Calendar writes, no production install/restart, no private roster/credentials in repository; Old Jarvis/Gemini Spark/schedulers/finance unchanged.
- Done: synthetic checks and CI pass, PR opened, Mac mini setup and workflow documented.
- Next gate: reviewed real-file dry-run and explicit authorization before designing/applying live synchronization.
