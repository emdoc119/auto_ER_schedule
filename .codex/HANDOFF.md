# Issue #3 continuation

Follow-up branch codex/aer-approved-sync-telegram starts at 9745d493343ddbbfdb4510365ca30007e1467a41 (open dry-run PR #4; main not merged).

Adds opt-in Calendar writing, private expiring channel-bound plans, legacy identity adoption, preflight snapshot/ETag checks, deterministic create recovery, process-shared lock, post-write verification and partial-failure fresh-preview recovery. Telegram adapter shares the service; dedicated polling runner requires explicit ownership acknowledgment and does not modify existing webhook or gateway.

No actual Calendar writes or service installs were made. User-provided actual workbook was parsed and 22 events match the 22 live Calendar events by date/title/description content (whitespace-normalized); zero creates/content changes, so no rewrite. Existing dashboard resident defaults used. Independent OAuth files and current test-bot receiver ownership are unverified. Do not start competing polling or infer operational readiness from source tests. Old Jarvis/Gemini Spark/schedulers/finance untouched.

Start with tasks/CURRENT.md, docs/MAC_MINI.md and docs/SYNC_TELEGRAM.md. Code entry points: backend/runtime.js, sync-service.js, telegram-runner.js. Real-file verified plan plus runtime credentials/ownership are required for live E2E. Main merge still requires user authorization. Private plan store must be outside checkout, mode700 with files600.
