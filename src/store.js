import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_QUEUE_DIR = path.join(
  process.env.HOME || process.cwd(),
  ".openclaw",
  "workspace",
  "state",
  "openclaw-agent-mcp"
);

export function queueDir() {
  return path.resolve(process.env.OPENCLAW_AGENT_MCP_QUEUE_DIR || process.env.JASON_MCP_QUEUE_DIR || DEFAULT_QUEUE_DIR);
}

export async function ensureStore(dir = queueDir()) {
  await mkdir(path.join(dir, "requests"), { recursive: true });
  await mkdir(path.join(dir, "archive"), { recursive: true });
  return dir;
}

export function makeRequestId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `jmcp_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
}

export async function createRequest(input, dir = queueDir()) {
  await ensureStore(dir);
  const now = new Date().toISOString();
  const id = makeRequestId(new Date(now));
  const request = {
    id,
    status: "new",
    source: input.source || "mcp",
    title: input.title.trim(),
    body: input.body.trim(),
    priority: input.priority || "normal",
    desiredOutcome: input.desiredOutcome || "",
    sourceContext: input.sourceContext || "",
    requiresReply: input.requiresReply !== false,
    createdAt: now,
    updatedAt: now,
    reply: null,
    history: [
      {
        at: now,
        actor: "openclaw-agent-mcp",
        event: "created",
        note: "Request submitted through MCP."
      }
    ]
  };

  await writeJson(requestPath(id, dir), request);
  await appendJsonl(path.join(dir, "requests.jsonl"), {
    id,
    at: now,
    event: "created",
    title: request.title,
    priority: request.priority
  });
  return request;
}

export async function listRequests(options = {}, dir = queueDir()) {
  await ensureStore(dir);
  const files = await readdir(path.join(dir, "requests"));
  const requests = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const request = await readJson(path.join(dir, "requests", file));
    if (options.status && request.status !== options.status) continue;
    requests.push(summarizeRequest(request));
  }
  requests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return requests.slice(0, options.limit || 20);
}

export async function getQueueStatus(dir = queueDir()) {
  await ensureStore(dir);
  const activeFiles = await readdir(path.join(dir, "requests"));
  const archiveFiles = await readdir(path.join(dir, "archive"));
  const counts = {
    new: 0,
    accepted: 0,
    processing: 0,
    blocked: 0,
    done: 0,
    rejected: 0,
    archived: archiveFiles.filter((file) => file.endsWith(".json")).length,
    totalActive: 0
  };
  let newestUpdatedAt = null;
  let oldestNewAt = null;
  const samples = [];

  for (const file of activeFiles) {
    if (!file.endsWith(".json")) continue;
    const request = await readJson(path.join(dir, "requests", file));
    counts.totalActive += 1;
    if (Object.hasOwn(counts, request.status)) counts[request.status] += 1;
    if (!newestUpdatedAt || request.updatedAt > newestUpdatedAt) newestUpdatedAt = request.updatedAt;
    if (request.status === "new" && (!oldestNewAt || request.createdAt < oldestNewAt)) {
      oldestNewAt = request.createdAt;
    }
    if (samples.length < 10) samples.push(summarizeRequest(request));
  }

  const dirStats = await stat(dir);
  samples.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    status: counts.blocked > 0 ? "attention" : "ok",
    queueDir: dir,
    counts,
    newestUpdatedAt,
    oldestNewAt,
    queueDirMtime: dirStats.mtime.toISOString(),
    runnerExpectation:
      "A separate guarded runner should drain new requests and write replies back. The MCP server itself never executes shell, HA, GitHub, Drive, or website actions.",
    safetyBoundary:
      "External clients submit requests. Jason/OpenClaw classifies and executes through existing approval gates.",
    recent: samples
  };
}

export async function getRequest(id, dir = queueDir()) {
  const file = requestPath(id, dir);
  if (!existsSync(file)) {
    throw new Error(`Request not found: ${id}`);
  }
  return readJson(file);
}

export async function updateRequest(input, dir = queueDir()) {
  await ensureStore(dir);
  const request = await getRequest(input.id, dir);
  const now = new Date().toISOString();
  if (input.status) request.status = input.status;
  if (typeof input.reply === "string") request.reply = input.reply;
  if (typeof input.note === "string" && input.note.trim()) {
    request.history.push({
      at: now,
      actor: input.actor || "jason",
      event: "note",
      note: input.note.trim()
    });
  }
  if (input.status) {
    request.history.push({
      at: now,
      actor: input.actor || "jason",
      event: "status",
      note: `Status set to ${input.status}.`
    });
  }
  request.updatedAt = now;
  await writeJson(requestPath(input.id, dir), request);
  await appendJsonl(path.join(dir, "requests.jsonl"), {
    id: request.id,
    at: now,
    event: "updated",
    status: request.status
  });
  return request;
}

export async function archiveRequest(id, dir = queueDir()) {
  await ensureStore(dir);
  const source = requestPath(id, dir);
  if (!existsSync(source)) {
    throw new Error(`Request not found: ${id}`);
  }
  const target = path.join(dir, "archive", `${id}.json`);
  await rename(source, target);
  return { id, archived: true };
}

export function summarizeRequest(request) {
  return {
    id: request.id,
    title: request.title,
    status: request.status,
    priority: request.priority,
    source: request.source,
    requiresReply: request.requiresReply,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    hasReply: Boolean(request.reply)
  };
}

function requestPath(id, dir = queueDir()) {
  if (!/^jmcp_[0-9]{14}_[0-9a-f]{8}$/.test(id)) {
    throw new Error(`Invalid request id: ${id}`);
  }
  return path.join(dir, "requests", `${id}.json`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendJsonl(file, value) {
  await writeFile(file, `${JSON.stringify(value)}\n`, { flag: "a" });
}
