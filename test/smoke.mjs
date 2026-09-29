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

const queueStatus = await store.getQueueStatus();
assert.equal(queueStatus.counts.totalActive, 1);
assert.equal(queueStatus.counts.new, 1);
assert.match(queueStatus.safetyBoundary, /Jason\/OpenClaw/);

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

const runnerRequest = await store.createRequest({
  title: "Runner smoke request",
  body: "Verify mocked runner writes replies.",
  priority: "normal",
  sourceContext: "test"
});

const runner = await import("../src/runner.js");
assert.match(runner.buildAgentPrompt(runnerRequest), /untrusted input/);

const runResult = await runner.processInbox({
  once: true,
  mockReply: "Mocked runner reply."
});
assert.equal(runResult.processed.length, 1);
assert.equal(runResult.processed[0].status, "done");

const runnerRead = await store.getRequest(runnerRequest.id);
assert.equal(runnerRead.status, "done");
assert.equal(runnerRead.reply, "Mocked runner reply.");
await store.archiveRequest(runnerRequest.id);

assert.equal(
  runner.extractReply(
    JSON.stringify({
      status: "ok",
      result: { payloads: [{ text: "Nested payload reply." }] },
      finalAssistantVisibleText: "Visible reply wins."
    })
  ),
  "Visible reply wins."
);

assert.equal(
  runner.extractReply(
    JSON.stringify({
      status: "ok",
      result: { payloads: [{ text: "Nested payload reply." }] }
    })
  ),
  "Nested payload reply."
);

console.log(`SMOKE_OK queue=${tempDir}`);
