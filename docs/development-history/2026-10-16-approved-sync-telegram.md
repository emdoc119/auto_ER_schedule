# Approved sync and Telegram follow-up

User requested synchronization after validation and a Telegram receiver. The follow-up extends open dry-run PR #4 with opt-in owned-event OAuth, explicit preview/apply through one transport-independent service, private single-use plans, fresh Calendar comparison, ETags, stable IDs, file lock and after-write verification. Legacy unchanged events are explicitly previewed as metadata adoption. Unrelated private/shared metadata is preserved. No delete operation is implemented.

A dedicated Telegram adapter validates private chat and sender, caps downloads, sends counts only, and requires an exact apply command. Its optional runner validates bot identity/webhook and polling ownership opt-in, persists a private cursor and fails closed on conflict. Existing Hermes gateway was not modified or taken over.

Synthetic tests cover repeated uploads after mutation/restart, partial failure, stale plans, ETag conflicts, adoption, channel boundaries, HTTP security and Telegram transport/ownership. Actual workbook comparison verified 22 desired and 22 existing events with identical date/title/description content (whitespace-normalized), using existing dashboard resident defaults; zero creates/content changes, no rewrite. Known ancillary coworker codes ICU/EICU/외래/E1 were added as readable but ungrouped, with synthetic regression coverage. Independent live backend writes, token provisioning and gateway integration remain unverified. No Old Jarvis or other production service changes.

Validation: 65/65 local synthetic tests pass; git diff --check and launchd plist lint pass. Read-only test-bot identity and empty webhook were verified without getUpdates/sendMessage or polling takeover. No dedicated AER OAuth configuration exists in the current environment. Main integrated and verified the inherited-model Telegram sidecar; no Qwen model was available.

## Independent verification follow-up

Removed shared web approval state in favor of expiring browser sessions and per-process channels, with cross-session and server-restart attack tests. Standalone polling CLI disabled in favor of existing Hermes ingress. Readonly source/install investigation found a native plugin hook and a registration-failure fail-open gap; minimal adapter and required guard are proposals awaiting approval. Added raw read-only audit aggregate CLI. Refreshed actual-file/22-event content comparison remains identical, but connector hides private identity and ETags so expected adoption22 is conditional. No main merge, writes or runtime edits.
