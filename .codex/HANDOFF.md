# Read-only audit preparation

Current branch codex/aer-approved-sync-telegram extends #5 6f9039fa756ab33ceed252afbbcc422867f58666. User authorizes audit preparation, but prohibits Calendar writes, Hermes changes, gateway restart and main merge. Latest generic "proceed" is continuation, not the still-unasked exact PR4 merge approval.

Added audit-only owned.readonly OAuth command (PKCE/state, strict actual scope), raw Calendar ID/private/ETag projection and validation, optional exclusive private report. Prepared user-private audit.env outside repo; no credentials/token present. Cloud UI is logged in, but dedicated AER project search empty and new-project trial quota reached. No existing project/OAuth client edited. Google consent remains pending.

Pages verified via GitHub API main / root and latest main build c0998958; live root/dashboard HTTP200 and exact main bytes. New external SheetJS script probe returned403; PR4 candidate now vendors identical pinned0.20.3 with license/hash and browser-distribution regression, tests30. New PR4 HEAD ce2e5ea2a7b4320b11878c0fb56c88a8d22aa922 must be reviewed/approved for public deployment. Keep PR5 stacked and incorporate prerequisite through ordinary branch merge, no force/rebase.

Current content comparison22 is not raw identity audit. Actual create/update/adopt/noop/review remains unconfirmed until dedicated OAuth/raw GET succeeds. Use docs/READONLY_AUDIT_SETUP.md and docs/PAGES_PR4_IMPACT.md, then request exact PR4-only merge approval; no implied #5 or operational approval.
