# Issue #3 continuation

Base: main c0998958b0e62c4f20903a1c677e8b0bcedf46db. Branch: codex/aer-calendar-dry-run.

Implemented shared parser, private local read-only Calendar preview, conservative legacy matching, File transfer from official Pages origin, synthetic tests and CI. Read-only connector query confirmed 22 existing Nov–Dec 2026 events; no private snapshot committed. No Calendar write adapter or apply route exists. Mac mini deployment and Telegram receiver remain uninstalled/unconnected.

Start with README.md and docs/MAC_MINI.md; pipeline is backend/pipeline.js, rules are lib/aer-parser.js, matching is lib/reconcile.js. Real-file comparison and live write semantics need later user approval. Missing/changed legacy events produce review; no deletion. Repeated upload is tested against synthetic existing events, not a live write.

Pre-merge review: accept known ancillary coworker codes ICU/EICU/외래/E1 without counting them as D/N; personal assignments with these remain unsupported. This compatibility fix is required before deploying PR #4 against the actual workbook format. No Calendar write paths added.

Pages pre-merge inspection found the new external script CDN unavailable (HTTP403 in direct probe). The identical pinned SheetJS 0.20.3 browser distribution is now a versioned local static asset with license/hash and a VM browser-bundle XLSX regression test. PR #4 suite30 passes; main merge remains approval-only.
