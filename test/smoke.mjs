import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "jason-mcp-"));
process.env.JASON_MCP_QUEUE_DIR = tempDir;

const store = await import("../src/store.js");

const request = await store.createRequest({
  title: "Smoke test request",
  body: "Verify file-backed inbox works.",
  priority: "normal",
  desiredOutcome: "A request can be created, listed, read, updated, and archived.",
  sourceContext: "test"
});

assert.match(request.id, /^jmcp_/);
assert.equal(request.status, "new");

const list = await store.listRequests();
assert.equal(list.length, 1);
assert.equal(list[0].id, request.id);

const read = await store.getRequest(request.id);
assert.equal(read.title, "Smoke test request");

const updated = await store.updateRequest({
  id: request.id,
  status: "done",
  reply: "Smoke test passed.",
  actor: "test"
});
assert.equal(updated.status, "done");
assert.equal(updated.reply, "Smoke test passed.");

const archived = await store.archiveRequest(request.id);
assert.equal(archived.archived, true);

console.log(`SMOKE_OK queue=${tempDir}`);
