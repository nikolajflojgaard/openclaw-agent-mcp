import { access, constants, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureStore, getQueueStatus, queueDir } from "./store.js";

const EXPECTED_TOOLS = [
  "submit_jason_request",
  "list_jason_requests",
  "read_jason_request",
  "update_jason_request",
  "archive_jason_request",
  "get_jason_bridge_status"
];

const EXPECTED_CRON_KEY = "jason-mcp-inbox-runner";

export async function runDoctorCli(argv = []) {
  const options = parseArgs(argv);
  const report = await runDoctor(options);
  const output = options.pretty ? formatReport(report) : JSON.stringify(report, null, 2);
  console.log(output);
  if (!report.ok && !options.noFail) process.exit(1);
}

export async function runDoctor(options = {}) {
  const checks = [];
  const repoRoot = path.resolve(options.repoRoot || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

  checks.push(await checkNode());
  checks.push(await checkPackage(repoRoot));
  checks.push(await checkQueue());
  checks.push(await checkGit(repoRoot));
  checks.push(await checkGitHub(repoRoot));
  checks.push(await checkMcporterTools());
  checks.push(await checkCron());

  return {
    ok: checks.every((check) => check.status === "ok" || check.status === "warn"),
    generatedAt: new Date().toISOString(),
    repoRoot,
    queueDir: queueDir(),
    expectedTools: EXPECTED_TOOLS,
    expectedCronKey: EXPECTED_CRON_KEY,
    checks
  };
}

async function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    name: "node",
    status: major >= 20 ? "ok" : "warn",
    detail: `Node ${process.versions.node}${major < 20 ? " works may vary; Node 20+ is preferred." : ""}`
  };
}

async function checkPackage(repoRoot) {
  try {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const missingBins = ["jason-mcp", "jason-mcp-runner", "jason-mcp-doctor", "jason-mcp-handoff"].filter(
      (name) => !pkg.bin?.[name]
    );
    const missingScripts = ["smoke", "doctor", "run-once", "handoff"].filter((name) => !pkg.scripts?.[name]);
    const missing = [...missingBins.map((name) => `bin:${name}`), ...missingScripts.map((name) => `script:${name}`)];
    return {
      name: "package",
      status: missing.length === 0 ? "ok" : "fail",
      detail: missing.length === 0 ? `${pkg.name} ${pkg.version}` : `Missing ${missing.join(", ")}`
    };
  } catch (error) {
    return { name: "package", status: "fail", detail: error.message };
  }
}

async function checkQueue() {
  try {
    const dir = await ensureStore();
    await access(dir, constants.R_OK | constants.W_OK);
    const probe = path.join(dir, ".doctor-write-test");
    await writeFile(probe, "ok\n", "utf8");
    await rm(probe, { force: true });
    const status = await getQueueStatus(dir);
    return {
      name: "queue",
      status: "ok",
      detail: `${dir}; active=${status.counts.totalActive}; new=${status.counts.new}; blocked=${status.counts.blocked}`
    };
  } catch (error) {
    return { name: "queue", status: "fail", detail: error.message };
  }
}

async function checkGit(repoRoot) {
  const result = await runCommand("git", ["status", "--short", "--branch"], { cwd: repoRoot });
  if (result.code !== 0) return { name: "git", status: "fail", detail: result.stderr || result.stdout };
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const dirty = lines.slice(1).length > 0;
  return {
    name: "git",
    status: dirty ? "warn" : "ok",
    detail: dirty ? `Working tree has local changes: ${lines.slice(1).join("; ")}` : lines[0] || "clean"
  };
}

async function checkGitHub(repoRoot) {
  const result = await runCommand(
    "gh",
    ["repo", "view", "nikolajflojgaard/jason-mcp", "--json", "isPrivate,nameWithOwner,url"],
    { cwd: repoRoot, timeoutMs: 15000 }
  );
  if (result.code !== 0) return { name: "github", status: "warn", detail: trim(result.stderr || result.stdout) };
  try {
    const repo = JSON.parse(result.stdout);
    return {
      name: "github",
      status: repo.isPrivate ? "ok" : "fail",
      detail: `${repo.nameWithOwner} private=${repo.isPrivate} ${repo.url}`
    };
  } catch (error) {
    return { name: "github", status: "warn", detail: error.message };
  }
}

async function checkMcporterTools() {
  const result = await runCommand("mcporter", ["list", "jason", "--schema", "--json"], { timeoutMs: 20000 });
  if (result.code !== 0) return { name: "mcporter", status: "fail", detail: trim(result.stderr || result.stdout) };
  try {
    const parsed = JSON.parse(result.stdout);
    const toolNames = extractToolNames(parsed);
    const missing = EXPECTED_TOOLS.filter((tool) => !toolNames.includes(tool));
    return {
      name: "mcporter",
      status: missing.length === 0 ? "ok" : "fail",
      detail: missing.length === 0 ? `jason exposes ${toolNames.length} tools` : `Missing tools: ${missing.join(", ")}`
    };
  } catch (error) {
    return { name: "mcporter", status: "fail", detail: error.message };
  }
}

async function checkCron() {
  const result = await runCommand("openclaw", ["cron", "list", "--json"], { timeoutMs: 20000 });
  if (result.code !== 0) return { name: "cron", status: "fail", detail: trim(result.stderr || result.stdout) };
  try {
    const parsed = JSON.parse(result.stdout);
    const jobs = Array.isArray(parsed) ? parsed : parsed.jobs || [];
    const job = jobs.find((candidate) => candidate.declarationKey === EXPECTED_CRON_KEY);
    if (!job) return { name: "cron", status: "fail", detail: `Missing ${EXPECTED_CRON_KEY}` };
    const ok = job.enabled && ["ok", "idle", undefined, null].includes(job.status) && job.state?.consecutiveErrors === 0;
    return {
      name: "cron",
      status: ok ? "ok" : "fail",
      detail: `${job.displayName || job.name} enabled=${job.enabled} status=${job.status || job.state?.lastStatus} errors=${
        job.state?.consecutiveErrors ?? "unknown"
      }`
    };
  } catch (error) {
    return { name: "cron", status: "fail", detail: error.message };
  }
}

function extractToolNames(value) {
  if (Array.isArray(value)) return value.flatMap(extractToolNames);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.tools)) return value.tools.map((tool) => tool.name).filter(Boolean);
  if (Array.isArray(value.servers)) return value.servers.flatMap(extractToolNames);
  if (value.result) return extractToolNames(value.result);
  if (value.server) return extractToolNames(value.server);
  return [];
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
    if (arg === "--pretty") options.pretty = true;
    else if (arg === "--no-fail") options.noFail = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: jason-mcp-doctor [--pretty] [--no-fail]

Checks migration readiness for the Jason MCP bridge: package metadata, queue,
Git/GitHub, mcporter registration, and the OpenClaw runner cron.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function formatReport(report) {
  const lines = [
    `Jason MCP doctor: ${report.ok ? "OK" : "ATTENTION"}`,
    `repo: ${report.repoRoot}`,
    `queue: ${report.queueDir}`,
    ""
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  }
  return lines.join("\n");
}

function trim(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}
