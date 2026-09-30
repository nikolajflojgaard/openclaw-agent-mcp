# OpenClaw Agent MCP Migration Runbook

This repository is the safe handoff layer for moving Jason/OpenClaw behind a new
frontend such as Grok Bot, Dots, Cursor, or another MCP-capable client.

The migration target is not "give the new client all local tools." The target is:

```text
New frontend
  -> OpenClaw Agent MCP request bridge
  -> guarded Jason/OpenClaw runner
  -> existing approved tools and workflows
  -> reply written back to MCP
```

## Readiness checklist

Run this from the repo root:

```bash
npm install
npm run smoke
npm run doctor
npm run handoff
mcporter list jason --schema --json
```

The bridge is migration-ready when:

- `npm run smoke` passes.
- `npm run doctor` reports `OpenClaw Agent MCP doctor: OK`.
- `npm run handoff` prints a complete migration packet with repo commit, stdio
  config, expected tools, runner state, queue counts, and safety boundary.
- `mcporter list jason --schema --json` shows the `jason` server and the expected tools.
- OpenClaw cron `openclaw-agent-mcp-inbox-runner` is enabled and healthy.
- GitHub repo `nikolajflojgaard/openclaw-agent-mcp` is public.

## Expected tools

- `submit_jason_request`
- `list_jason_requests`
- `read_jason_request`
- `update_jason_request`
- `archive_jason_request`
- `get_jason_bridge_status`

External clients should normally use only:

- `submit_jason_request`
- `read_jason_request`
- `list_jason_requests`
- `get_jason_bridge_status`

`update_jason_request` is mainly for Jason/OpenClaw and trusted local operators.

## Migration stages

### Stage 1: parallel intake

Keep Telegram as backup. Connect the new frontend to MCP server `jason`.

The frontend should submit work requests with:

- short title
- full body
- desired outcome
- source context, for example `Tesla/Grok`, `Dots`, or `Cursor`
- priority

Jason replies through the same MCP request. The frontend reads the reply back.

### Stage 2: default intake

Use the new frontend for normal requests. Keep Telegram for:

- urgent fallback
- OAuth callbacks
- manual confirmation
- debugging the new client

### Stage 3: richer client behavior

After proving reliability, the frontend may add:

- request templates
- car/voice-friendly summaries
- polling or push notifications
- action confirmation prompts
- source-specific routing, for example Tesla requests marked `driving`

Do not add direct shell, Home Assistant writes, GitHub writes, Drive writes, or
website publish tools to the client. Those remain behind Jason/OpenClaw gates.

## Operations

Check queue state:

```bash
mcporter call jason.get_jason_bridge_status --args '{}'
```

Drain one request manually:

```bash
npm run run-once
```

Dry-run pending work:

```bash
openclaw-agent-mcp-runner --dry-run --limit 5
```

Run the doctor:

```bash
npm run doctor
```

Generate the current handoff packet:

```bash
npm run handoff
npm run handoff -- --json
```

## Rollback

If the new frontend behaves badly:

1. Disable its MCP connection.
2. Leave `openclaw-agent-mcp-inbox-runner` running if the queue contains legitimate requests.
3. Archive bad requests with `archive_jason_request`.
4. Use Telegram as the control channel until the frontend is fixed.

If the runner itself is causing trouble, disable the OpenClaw cron
`openclaw-agent-mcp-inbox-runner`. Existing requests remain in the file-backed queue.
