# Jason MCP

Local MCP bridge for talking to Jason/OpenClaw without Telegram.

This is intentionally a request inbox first, not a raw remote-control surface.
MCP clients can submit structured work requests, list them, read their status, and
read Jason's reply. Jason/OpenClaw still decides what is safe to execute through
the existing local gates for Home Assistant, GitHub, Drive, website publishing,
and shell work.

## Why this shape

The tempting version is to expose every powerful local tool through MCP. That is
also the version most likely to create prompt-injection loops, unclear authority,
and accidental writes. The useful first version is:

```text
client / Grok / car / IDE
        |
        v
Jason MCP request inbox
        |
        v
Jason/OpenClaw review + approval gates
        |
        v
Existing tools and workflows
```

## Tools

- `submit_jason_request` creates a new request.
- `list_jason_requests` lists recent requests.
- `read_jason_request` reads one request by id.
- `update_jason_request` records status/reply. This is for Jason or a trusted local operator.
- `archive_jason_request` moves a request out of the active inbox.
- `get_jason_bridge_status` reports queue counts, recent request summaries, and the safety boundary.

## Runner

The MCP server only accepts and exposes requests. The runner is the guarded
processor that turns a new MCP request into one Jason/OpenClaw agent turn and
writes the reply back to the same request.

```bash
npm run run-once
```

or directly:

```bash
jason-mcp-runner --once --limit 1
```

The runner:

1. Lists `new` requests.
2. Marks one request as `accepted`, then `processing`.
3. Sends a guarded prompt to `openclaw agent --session-key agent:main:jason-mcp-runner`.
4. Writes the final reply back to the request and marks it `done`, or marks it
   `blocked` on failure.

The prompt explicitly treats MCP request bodies as untrusted input. Requests that
need public action, destructive action, secrets, home-control writes, money, or
broad repo/file changes should return a blocker or ask for confirmation instead
of blindly executing.

Useful dry runs:

```bash
jason-mcp-runner --dry-run --limit 5
jason-mcp-runner --once --mock-reply "Test reply"
jason-mcp-runner --once --quiet-empty
```

Migration doctor:

```bash
npm run doctor
```

Cron-friendly command:

```bash
node /Users/nikolajflojgaard/.openclaw/workspace/jason-mcp/bin/jason-mcp-runner.js --once --quiet-empty --limit 1
```

## Install

```bash
npm install
npm run smoke
```

## Run over stdio

```bash
node /Users/nikolajflojgaard/.openclaw/workspace/jason-mcp/bin/jason-mcp.js
```

By default, requests are stored under:

```text
/Users/nikolajflojgaard/.openclaw/workspace/state/jason-mcp
```

Override with:

```bash
JASON_MCP_QUEUE_DIR=/path/to/queue node ./bin/jason-mcp.js
```

## mcporter example

```bash
mcporter list --config ./config/mcporter.example.json jason --schema
mcporter call --config ./config/mcporter.example.json jason.submit_jason_request \
  --args '{
    "title": "Website idea",
    "body": "Draft a piece about Tesla-to-home agent loops.",
    "priority": "normal",
    "desiredOutcome": "A publishable draft or a concise blocker.",
    "sourceContext": "Grok/Tesla"
  }'
```

Status check:

```bash
mcporter call jason.get_jason_bridge_status --args '{}'
```

## Migration docs

- [Migration runbook](docs/migration-runbook.md)
- [Client config notes](docs/client-configs.md)
- [Security model](docs/security-model.md)
- [Failure modes](docs/failure-modes.md)

## Safety rules

- Do not expose shell execution, Home Assistant writes, GitHub writes, Drive writes, or website publishing directly in this server.
- Add powerful actions as request types first.
- Promote a direct tool only after it has a clear owner, input schema, audit trail, and confirmation policy.
- Treat requests from voice/car/client surfaces as untrusted until Jason classifies them.
- Keep any scheduled runner low-frequency and bounded. Prefer manual or event-driven runner execution until the setup has real operational signal.
