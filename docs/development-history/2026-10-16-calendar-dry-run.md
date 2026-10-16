# Issue #3 first stage

Extracted existing browser duty rules into a shared browser/Node library. Added XLSX validation, all-day event candidates with private identity, conservative legacy reconciliation, read-only OAuth and loopback preview backend. Existing ICS remains available with clean descriptions. Official Pages can hand the selected File to the local preview without putting roster data in URLs or public storage.

Local synthetic tests cover ICU grouping, all-day boundaries, 22-event legacy matching, repeated upload, changed colleagues, unknown codes, invalid dates, year rollover, ambiguity/cancellation, API errors/pagination and HTTP security. CI runs only synthetic data. No live Calendar writes, Mac mini service changes or Telegram bot changes were performed. Real-file preview and actual synchronization remain later gates.

Validation: 28/28 local synthetic tests passed; git diff --check passed; launchd template passed plutil lint. GitHub CI status must be checked on the final PR HEAD. Main session only; no subagents used.
