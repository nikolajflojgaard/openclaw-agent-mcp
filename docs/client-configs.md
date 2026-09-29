# Client Config Notes

## mcporter

The local machine already registers the server as `jason` in the global mcporter
config.

Verify:

```bash
mcporter list jason --schema --json
```

Submit a request:

```bash
mcporter call jason.submit_jason_request --args '{
  "title": "Migration smoke",
  "body": "Reply with MCP_MIGRATION_OK if this reaches Jason safely.",
  "priority": "normal",
  "desiredOutcome": "A short reply written back to this request.",
  "sourceContext": "mcporter/manual"
}'
```

Read bridge status:

```bash
mcporter call jason.get_jason_bridge_status --args '{}'
```

## Generic MCP client

Use stdio transport:

```bash
node /Users/nikolajflojgaard/.openclaw/workspace/jason-mcp/bin/jason-mcp.js
```

Server name:

```text
jason
```

The client should treat Jason MCP as a request/reply bridge, not as a raw action
API.

## Grok Bot / Tesla front door

Preferred behavior:

1. Capture voice request in Tesla through Grok Assist.
2. Grok Bot running on the home machine converts it to a structured MCP request.
3. Grok Bot calls `submit_jason_request`.
4. Grok Bot polls `read_jason_request` or `list_jason_requests` until `hasReply`
   or status `done` / `blocked`.
5. Grok reads the reply back to Nikolaj.

Recommended `sourceContext` values:

- `Tesla/Grok/driving`
- `Grok/home-machine`
- `Grok/manual`

Driving requests should be conservative. If Jason asks for confirmation, Grok
should read the confirmation question back and wait.

## Dots or desktop operator

Preferred behavior:

1. Submit through `submit_jason_request`.
2. Show status through `get_jason_bridge_status`.
3. Render `done`, `blocked`, and `rejected` distinctly.
4. Keep a visible link or id for every request.

## Cursor or coding frontend

Cursor can use this bridge for orchestration requests, not direct repo mutation.
For coding work, submit a scoped request and let Jason decide whether to use
local tools, a branch, or a separate coding session.
