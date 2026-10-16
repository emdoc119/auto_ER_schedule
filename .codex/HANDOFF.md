# Issue #3 continuation

Base: main c0998958b0e62c4f20903a1c677e8b0bcedf46db. Branch: codex/aer-calendar-dry-run.

Implemented shared parser, private local read-only Calendar preview, conservative legacy matching, File transfer from official Pages origin, synthetic tests and CI. Read-only connector query confirmed 22 existing Nov–Dec 2026 events; no private snapshot committed. No Calendar write adapter or apply route exists. Mac mini deployment and Telegram receiver remain uninstalled/unconnected.

Start with README.md and docs/MAC_MINI.md; pipeline is backend/pipeline.js, rules are lib/aer-parser.js, matching is lib/reconcile.js. Real-file comparison and live write semantics need later user approval. Missing/changed legacy events produce review; no deletion. Repeated upload is tested against synthetic existing events, not a live write.
