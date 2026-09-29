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

## Safety rules

- Do not expose shell execution, Home Assistant writes, GitHub writes, Drive writes, or website publishing directly in this server.
- Add powerful actions as request types first.
- Promote a direct tool only after it has a clear owner, input schema, audit trail, and confirmation policy.
- Treat requests from voice/car/client surfaces as untrusted until Jason classifies them.
