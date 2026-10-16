# PR #5 independent verification follow-up

Baseline #5 a6ab0d4c19341c138c6e15cbf0ebf865405ca207; branch codex/aer-approved-sync-telegram. User forbids main merge, Calendar write enable, standalone polling and service restart without further approval.

Fixed per-browser sessions with separate cookie/CSRF/channel, memory-only server epoch and expiry. Tests cover foreign PLAN IDs with valid attacker session, token/cookie mixing, persistent plan across server restart and expiry/fixation. Standalone polling CLI is disabled; Hermes receiver is kept.

Read-only ingress investigation pinned actual installed Hermes native Telegram plugin (source 73b9f2af). Proposed native handler + Python/Node RPC, durable claim and required-handler guard; no upstream/runtime edits. See docs/HERMES_INGRESS_DESIGN.md for exact entrypoints and approval scope.

Actual workbook22 and fresh Calendar22 match visible date/title/description content, no duplicate dates. Expected unmanaged adoption22 preserves old IDs, but connector omits private properties/ETags so actual adopt/noop split is not confirmed. backend/audit.js provides read-only raw API aggregate verification once OAuth exists. Never treat omitted metadata as absent.

PR #4 compatibility fix 45475dc: accept known ancillary coworker codes; tests29 and actual extraction22 pass. Keep PR #5 stacked until user-approved #4 merge, then fetch exact main SHA, retarget #5 and rerun full CI. Current main ancestry checks are preparation only.

Start with tasks/CURRENT.md and docs/PRE_DEPLOY_REVIEW.md. No live Calendar writes, polling, config/runtime edits or restarts were performed.
