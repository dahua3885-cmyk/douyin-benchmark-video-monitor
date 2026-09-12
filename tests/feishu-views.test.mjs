import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildViewPlan, desiredViews, extractFieldNames, extractViews } from "../scripts/feishu-view-plan.mjs";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(testDir);

test("builds the four required Feishu views with independent 7-day and 30-day windows", () => {
  const views = desiredViews(new Date("2026-09-12T20:00:00+08:00"), "Asia/Shanghai");
  assert.deepEqual(views.map((view) => view.name), ["最近7天榜单", "对标账号视频", "关键词爆款", "历史记录"]);
  assert.deepEqual(views[0].filter.conditions, [["发布时间", ">=", "ExactDate(2026-09-05 20:00)"]]);
  assert.deepEqual(views[1].filter.conditions, [
    ["来源类型", "intersects", ["对标账号"]],
    ["发布时间", ">=", "ExactDate(2026-08-13 20:00)"],
  ]);
  assert.deepEqual(views[2].filter.conditions, [
    ["来源类型", "intersects", ["关键词"]],
    ["发布时间", ">=", "ExactDate(2026-09-05 20:00)"],
  ]);
  assert.deepEqual(views[3].filter, { conditions: [] });
  assert.deepEqual(views[0].sort.sort_config, [
    { field: "点赞", desc: true },
    { field: "评分", desc: true },
  ]);
});

test("renames a lone default grid and creates the other required views", () => {
  const plan = buildViewPlan([{ id: "vew_default", name: "表格", type: "grid" }], new Date("2026-09-12T12:00:00Z"), "Asia/Shanghai");
  assert.deepEqual(plan.operations, [
    { action: "rename", viewId: "vew_default", from: "表格", to: "最近7天榜单" },
    { action: "create", name: "对标账号视频", type: "grid" },
    { action: "create", name: "关键词爆款", type: "grid" },
    { action: "create", name: "历史记录", type: "grid" },
  ]);
});

test("reuses all existing named views and parses lark-cli payloads", () => {
  const payload = {
    data: {
      items: [
        { view_id: "v1", view_name: "最近7天榜单", view_type: "grid" },
        { view_id: "v2", view_name: "对标账号视频", view_type: "grid" },
        { view_id: "v3", view_name: "关键词爆款", view_type: "grid" },
        { view_id: "v4", view_name: "历史记录", view_type: "grid" },
      ],
      fields: [
        { field_id: "f1", field_name: "来源类型" },
        { field_id: "f2", field_name: "发布时间" },
      ],
    },
  };
  const parsedViews = extractViews(payload);
  assert.equal(parsedViews.length, 4);
  assert.deepEqual(extractFieldNames(payload), ["来源类型", "发布时间"]);
  const plan = buildViewPlan(parsedViews, new Date(), "Asia/Shanghai");
  assert.deepEqual(plan.operations, []);
});

test("CLI dry-run reads Feishu metadata through the Windows lark-cli bridge", { skip: process.platform !== "win32" }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-monitor-views-"));
  const configPath = path.join(tempDir, "project.json");
  const mockCli = path.join(tempDir, "lark-cli.ps1");
  fs.writeFileSync(configPath, JSON.stringify({
    project: { timezone: "Asia/Shanghai" },
    feishu: {
      enabled: true,
      identity: "bot",
      base_token: "example_base_token",
      tables: { videos: { table_id: "tbl_example" } },
    },
  }));
  fs.writeFileSync(mockCli, `\ufeff${[
    "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)",
    "$allArgs = @($CliArgs) + @($args)",
    "$command = @($allArgs | Where-Object { $_ -like '+*' } | Select-Object -First 1)[0]",
    "if ($command -eq '+field-list') {",
    "  @{data=@{items=@(",
    "    @{field_id='f1';field_name='来源类型'},",
    "    @{field_id='f2';field_name='发布时间'},",
    "    @{field_id='f3';field_name='点赞'},",
    "    @{field_id='f4';field_name='评分'}",
    "  )}} | ConvertTo-Json -Depth 5; exit 0",
    "}",
    "if ($command -eq '+view-list') {",
    "  @{data=@{items=@(@{view_id='v1';view_name='表格';view_type='grid'})}} | ConvertTo-Json -Depth 5; exit 0",
    "}",
    "exit 3",
  ].join("\n")}`);
  try {
    const stdout = execFileSync(process.execPath, [
      path.join(repoDir, "scripts", "ensure-feishu-views.mjs"),
      `--config=${configPath}`,
      "--dry-run",
      "--now=2026-09-12T20:00:00+08:00",
    ], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: `${tempDir}${path.delimiter}${process.env.PATH || ""}` },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.status, "dry_run");
    assert.deepEqual(result.operations.map((operation) => operation.action), ["rename", "create", "create", "create"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
