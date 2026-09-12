import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildViewPlan, extractFieldNames, extractViews } from "./feishu-view-plan.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const result = { dryRun: false, now: "" };
  for (const arg of argv) {
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg.startsWith("--config=")) result.config = arg.slice("--config=".length);
    else if (arg.startsWith("--now=")) result.now = arg.slice("--now=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.config) throw new Error("--config=<project.local.json> is required");
  return result;
}

function runLark(args) {
  const command = process.platform === "win32" ? "powershell.exe" : "lark-cli";
  const commandArgs = process.platform === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scriptDir, "invoke-lark-cli.ps1"), ...args]
    : args;
  const stdout = execFileSync(command, commandArgs, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`lark-cli returned invalid JSON: ${error.message}`);
  }
}

function baseArgs(baseToken, tableId) {
  return ["--base-token", baseToken, "--table-id", tableId, "--format", "json", "--as", "bot"];
}

function listViews(baseToken, tableId) {
  return extractViews(runLark(["base", "+view-list", ...baseArgs(baseToken, tableId), "--limit", "200"]));
}

function requireFields(baseToken, tableId) {
  const names = extractFieldNames(runLark(["base", "+field-list", ...baseArgs(baseToken, tableId), "--limit", "200"]));
  const required = ["来源类型", "发布时间", "点赞", "评分"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`视频数据表缺少视图所需字段: ${missing.join("、")}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.feishu?.enabled) throw new Error("Feishu is not enabled");
  if (config.feishu.identity !== "bot") throw new Error("Feishu view setup requires bot identity");
  const baseToken = String(config.feishu.base_token || "");
  const tableId = String(config.feishu.tables?.videos?.table_id || "");
  const timeZone = String(config.project?.timezone || "Asia/Shanghai");
  if (!baseToken || !tableId) throw new Error("Missing Feishu base_token or videos table_id");
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${args.now}`);

  requireFields(baseToken, tableId);
  const initialViews = listViews(baseToken, tableId);
  const plan = buildViewPlan(initialViews, now, timeZone);
  if (args.dryRun) {
    process.stdout.write(`${JSON.stringify({ status: "dry_run", existing_views: initialViews, ...plan }, null, 2)}\n`);
    return;
  }

  for (const operation of plan.operations) {
    if (operation.action === "rename") {
      runLark(["base", "+view-rename", ...baseArgs(baseToken, tableId), "--view-id", operation.viewId, "--name", operation.to]);
    } else {
      runLark(["base", "+view-create", ...baseArgs(baseToken, tableId), "--json", JSON.stringify({ name: operation.name, type: operation.type })]);
    }
  }

  const finalViews = listViews(baseToken, tableId);
  const finalByName = new Map(finalViews.map((view) => [view.name, view]));
  for (const desired of plan.desired) {
    const actual = finalByName.get(desired.name);
    if (!actual) throw new Error(`Failed to resolve Feishu view after setup: ${desired.name}`);
    runLark(["base", "+view-set-filter", ...baseArgs(baseToken, tableId), "--view-id", actual.id, "--json", JSON.stringify(desired.filter)]);
    runLark(["base", "+view-set-sort", ...baseArgs(baseToken, tableId), "--view-id", actual.id, "--json", JSON.stringify(desired.sort)]);
  }

  process.stdout.write(`${JSON.stringify({
    status: "complete",
    views: plan.desired.map((view) => view.name),
    operations: plan.operations,
    refreshed_at: now.toISOString(),
    time_zone: timeZone,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
