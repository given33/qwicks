# Dream Memory System — Runbook

## How to run the dreaming pipeline

```bash
# Manual trigger via HTTP
curl -X POST 'http://127.0.0.1:8899/v1/dream/dreaming/trigger?user_id=default' \
  -H 'Authorization: Bearer <token>'

# Check dreaming status
curl 'http://127.0.0.1:8899/v1/dream/dreaming/status?user_id=default' \
  -H 'Authorization: Bearer <token>'
```

Programmatically:
```typescript
system.scheduler.markDirty(userId)
system.scheduler.tick({ userId })  // runs decay + temporal + top-of-mind
```

## How to view/edit/delete memories

```bash
# Memory Summary (7-section)
curl 'http://127.0.0.1:8899/v1/dream/summary?user_id=default' -H 'Authorization: Bearer <token>'

# List sources
curl 'http://127.0.0.1:8899/v1/dream/sources?user_id=default' -H 'Authorization: Bearer <token>'

# Suppress a memory (Don't mention this again)
curl -X POST 'http://127.0.0.1:8899/v1/dream/suppressions' \
  -H 'Authorization: Bearer <token>' \
  -d '{"userId":"default","scope":"memory","target":"mem_xxx"}'

# Delete source + cascade
curl -X DELETE 'http://127.0.0.1:8899/v1/dream/sources/src_xxx' \
  -H 'Authorization: Bearer <token>' -d '{"hard":true}'
```

## How to run tests

```bash
# Requires Node 22 (.nvmrc pins it)
cd qwicks
.tools/test.sh src/dream/           # full dream suite
.tools/test.sh src/dream/acceptance.test.ts  # 10 acceptance criteria
.tools/typecheck.sh                 # TypeScript check
```

## Troubleshooting

### Memories not working
1. Check `GET /v1/dream/embedding/health` — is embedding degraded?
2. Check `GET /v1/dream/dreaming/status` — is dreaming dirty but not running?
3. Check SSE stream for `memory_status` events — is remembering=false?
4. Check `memory_mode` — is it temporary/off?

### Sources empty
1. Check if chat SourceRecords exist: `GET /v1/dream/sources`
2. Check memory_source_link table (run `backfillSourceLinks` migration)
3. Verify afterTurn is being called (check `dream_stage_failed` events)

### Embedding degraded
1. Check `GET /v1/dream/embedding/health`
2. If degraded=true, HTTP embedding failed → using HashEmbedder fallback
3. Verify `config.embedding.baseUrl` and `apiKey` are set
4. Check dim consistency (HTTP dim must match fallback dim)

### OAuth failure
1. Ensure `DREAM_OAUTH_KEY` env var is set (not default key)
2. Check token expiry: `OAuthToken.isExpired()`
3. Re-authorize via connector settings
