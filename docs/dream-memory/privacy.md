# Dream Memory System — Privacy & Security

## Temporary Chat (报告 §15)

Temporary Chat mode (`memoryMode: 'temporary'`) guarantees **zero side-effects**:
- No memory read (retrieveMemories returns empty)
- No chat_log write
- No SourceRecord creation
- No memory extraction/persist
- No dreaming trigger
- No memory_source_link

Flow: renderer sets `memoryMode=temporary` → TurnSchema validates →
AgentLoop.retrieveMemories short-circuits → dreamAfterTurn short-circuits.

Tested in: `src/dream/chat/middleware-e2e.test.ts`

## Don't Mention This Again (报告 §8)

SuppressionRule (≠ deletion):
- Scope: memory / source / summary / topic
- suppress() sets active=true; unsuppress() sets active=false
- filterSuppressedHits() removes suppressed memories before injection
- User can still explicitly ask about suppressed topics (retrieve doesn't hard-filter)
- deleteSuppression() physically removes the rule

## Source-Level Deletion (报告 §16)

deleteSourceAndDerived (cascade):
- Deletes the SourceRecord
- Deletes all derived inferred memories (via memory_source_link JOIN)
- Preserves user-saved memories (provenance.source === 'user' && SAVED_MEMORY)
- Logs cascade_delete event

## Sanitizer (报告 §7.2)

sanitizeForMemory is the first defense layer:
- PII patterns: email, phone, SSN, credit card, API key, password
- Injection patterns: override, role-tag, dev-mode, secrets, system-tag, command
- Decisions: allow / redact / quarantine / reject
- memory_create tool path runs sanitizer BEFORE fail-open (injection cannot bypass)

## OAuth Token Security (报告 §7.1)

OAuthTokenStore uses AES-256-GCM encryption.
- Default key: `dream-default-key` (dev/test only)
- Production: set `DREAM_OAUTH_KEY` env var or use OS keychain
- Tokens never appear in export/purge/logs

## Shared Chat Privacy (报告 §7.3)

MemoryItem.shareable field + SourceRecord sensitivity:
- Connector sources (Gmail/Drive) default non-shareable
- Export filters out non-shareable sources
- (Future: shared transcript pipeline enforcement)
