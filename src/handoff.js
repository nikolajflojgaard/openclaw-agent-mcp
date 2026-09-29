import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./doctor.js";
import { getQueueStatus, queueDir } from "./store.js";

const EXPECTED_TOOLS = [
  "submit_jason_request",
  "list_jason_requests",
  "read_jason_request",
  "update_jason_request",
  "archive_jason_request",
  "get_jason_bridge_status"
];

export async function runHandoffCli(argv = []) {
  const options = parseArgs(argv);
  const packet = await buildHandoffPacket(options);
  console.log(options.json ? JSON.stringify(packet, null, 2) : formatMarkdown(packet));
}

export async function buildHandoffPacket(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const [pkg, commit, remoteUrl, doctor, bridgeStatus, cron] = await Promise.all([
    readPackage(repoRoot),
    gitOutput(repoRoot, ["rev-parse", "--short", "HEAD"]),
    gitOutput(repoRoot, ["remote", "get-url", "origin"]),
    runDoctor({ repoRoot }),
    getQueueStatus(),
    getCronStatus()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    title: "Jason MCP migration handoff",
    repository: {
      localPath: repoRoot,
      remoteUrl: remoteUrl || "unknown",
      commit: commit || "unknown",
      package: pkg.name,
      version: pkg.version,
      private: pkg.private === true
    },
    stdioServer: {
      command: "node",
      args: [path.join(repoRoot, "bin", "jason-mcp.js")],
      env: {
        JASON_MCP_QUEUE_DIR: queueDir()
      }
    },
    expectedTools: EXPECTED_TOOLS,
    clientContract: {
      submitWith: "submit_jason_request",
      requiredFields: ["title", "body"],
      recommendedFields: ["desiredOutcome", "sourceContext", "priority", "requiresReply"],
      statusPolling: ["read_jason_request", "list_jason_requests", "get_jason_bridge_status"],
      terminalStatuses: ["done", "blocked", "rejected"],
      warning: "A submitted request is not an executed action. Jason/OpenClaw classifies and gates the work."
    },
    runner: {
      cronDeclarationKey: "jason-mcp-inbox-runner",
      cronStatus: cron,
      manualCommand: `node ${path.join(repoRoot, "bin", "jason-mcp-runner.js")} --once --quiet-empty --limit 1`
    },
    proof: {
      doctorOk: doctor.ok,
      doctorChecks: doctor.checks,
      queueStatus: bridgeStatus
    },
    docs: [
      path.join(repoRoot, "docs", "migration-runbook.md"),
      path.join(repoRoot, "docs", "client-configs.md"),
      path.join(repoRoot, "docs", "security-model.md"),
      path.join(repoRoot, "docs", "failure-modes.md")
    ],
    boundary:
      "External clients ask through MCP. Jason/OpenClaw classifies and acts through existing gates. This bridge does not expose raw shell, HA writes, GitHub writes, Drive writes, website publishing, money actions, or secrets."
  };
}

async function readPackage(repoRoot) {
  return JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
}

async function getCronStatus() {
  const result = await runCommand("openclaw", ["cron", "list", "--json"], { timeoutMs: 20000 });
  if (result.code !== 0) {
    return {
      found: false,
      ok: false,
      detail: trim(result.stderr || result.stdout)
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const jobs = Array.isArray(parsed) ? parsed : parsed.jobs || [];
    const job = jobs.find((candidate) => candidate.declarationKey === "jason-mcp-inbox-runner");
    if (!job) return { found: false, ok: false, detail: "Missing jason-mcp-inbox-runner" };
    return {
      found: true,
      ok: Boolean(job.enabled && job.status === "ok" && job.state?.consecutiveErrors === 0),
      id: job.id,
      declarationKey: job.declarationKey,
      enabled: job.enabled,
      status: job.status,
      lastRunStatus: job.lastRunStatus,
      consecutiveErrors: job.state?.consecutiveErrors ?? null,
      nextRunAtMs: job.nextRunAtMs
    };
  } catch (error) {
    return { found: false, ok: false, detail: error.message };
  }
}

async function gitOutput(repoRoot, args) {
  const result = await runCommand("git", args, { cwd: repoRoot, timeoutMs: 10000 });
  return result.code === 0 ? result.stdout.trim() : "";
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: `${stderr}\nTimed out after ${options.timeoutMs}ms`.trim() });
    }, options.timeoutMs || 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--markdown") options.json = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: jason-mcp-handoff [--json|--markdown]

Generates a migration handoff packet for Grok, Dots, Cursor, or another MCP
frontend that wants to use Jason/OpenClaw through the request bridge.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function formatMarkdown(packet) {
  const toolList = packet.expectedTools.map((tool) => `- \`${tool}\``).join("\n");
  const docs = packet.docs.map((doc) => `- \`${doc}\``).join("\n");
  const checks = packet.proof.doctorChecks
    .map((check) => `- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`)
    .join("\n");

  return `# Jason MCP Migration Handoff

Generated: ${packet.generatedAt}

## Repository

- Remote: ${packet.repository.remoteUrl}
- Local: \`${packet.repository.localPath}\`
- Commit: \`${packet.repository.commit}\`
- Package: \`${packet.repository.package}@${packet.repository.version}\`
- Private: ${packet.repository.private}

## Stdio Server

\`\`\`json
${JSON.stringify(packet.stdioServer, null, 2)}
\`\`\`

## Expected Tools

${toolList}

## Client Contract

- Submit with: \`${packet.clientContract.submitWith}\`
- Required fields: ${packet.clientContract.requiredFields.map((field) => `\`${field}\``).join(", ")}
- Recommended fields: ${packet.clientContract.recommendedFields.map((field) => `\`${field}\``).join(", ")}
- Poll with: ${packet.clientContract.statusPolling.map((tool) => `\`${tool}\``).join(", ")}
- Terminal statuses: ${packet.clientContract.terminalStatuses.map((status) => `\`${status}\``).join(", ")}
- Warning: ${packet.clientContract.warning}

## Runner

- Cron: \`${packet.runner.cronDeclarationKey}\`
- Cron ok: ${packet.runner.cronStatus.ok}
- Cron id: \`${packet.runner.cronStatus.id || "missing"}\`
- Manual: \`${packet.runner.manualCommand}\`

## Current Queue

- Status: ${packet.proof.queueStatus.status}
- Active: ${packet.proof.queueStatus.counts.totalActive}
- New: ${packet.proof.queueStatus.counts.new}
- Blocked: ${packet.proof.queueStatus.counts.blocked}
- Archived: ${packet.proof.queueStatus.counts.archived}

## Doctor

- OK: ${packet.proof.doctorOk}

${checks}

## Docs

${docs}

## Boundary

${packet.boundary}
`;
}

function trim(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}
