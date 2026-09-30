# Failure Modes

## MCP server does not start

Run:

```bash
npm install
npm run smoke
node ./bin/openclaw-agent-mcp.js
```

Then verify through mcporter:

```bash
mcporter list jason --schema --json
```

## Requests stay `new`

The runner is not draining the queue.

Check:

```bash
openclaw cron list --json
npm run doctor
openclaw-agent-mcp-runner --dry-run --limit 5
```

Manual drain:

```bash
openclaw-agent-mcp-runner --once --limit 1
```

## Requests become `blocked`

Read the request:

```bash
mcporter call jason.read_jason_request --args '{"id":"REQUEST_ID"}'
```

Common causes:

- OpenClaw command failed.
- OpenClaw timed out.
- Jason correctly refused a risky request.
- User confirmation is needed.

## Client cannot find replies

Read the request directly. Replies live in `reply`, and summary lists expose
`hasReply`.

```bash
mcporter call jason.list_jason_requests --args '{"limit":10}'
```

## Queue grows too large

Archive completed/rejected requests. Do not delete active files manually unless
the queue is clearly corrupt.

```bash
mcporter call jason.archive_jason_request --args '{"id":"REQUEST_ID"}'
```

## New frontend starts submitting bad requests

Disable that frontend's MCP connection first. The OpenClaw Agent MCP server can stay
registered for other clients.

Then archive or reject bad requests. Do not relax runner gates to make the
frontend look successful.
