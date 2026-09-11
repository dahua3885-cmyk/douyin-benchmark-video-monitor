import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(testDir);
const fixtures = path.join(testDir, "fixtures");

test("builds 30-day account and 7-day keyword rankings without duplicate videos", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-monitor-"));
  execFileSync(process.execPath, [
    path.join(repoDir, "scripts", "build-ranking.mjs"),
    `--input=${path.join(fixtures, "candidates.json")}`,
    `--output-dir=${outputDir}`,
    `--config=${path.join(fixtures, "project.json")}`,
    `--collection-summary=${path.join(fixtures, "summary.json")}`,
    "--now=2026-01-31T12:00:00+08:00",
  ], { encoding: "utf8" });

  const accounts = JSON.parse(fs.readFileSync(path.join(outputDir, "account-ranking.json"), "utf8"));
  const keywords = JSON.parse(fs.readFileSync(path.join(outputDir, "keyword-ranking.json"), "utf8"));
  const combined = JSON.parse(fs.readFileSync(path.join(outputDir, "combined-ranking.json"), "utf8"));
  const summary = JSON.parse(fs.readFileSync(path.join(outputDir, "run-summary.json"), "utf8"));

  assert.deepEqual(accounts.map((row) => row["视频ID"]), ["7000000000000000001", "7000000000000000002"]);
  assert.deepEqual(keywords.map((row) => row["视频ID"]), ["7000000000000000005", "7000000000000000001"]);
  assert.equal(combined.length, 3);
  assert.equal(new Set(combined.map((row) => row["唯一键"])).size, 3);
  const shared = combined.find((row) => row["视频ID"] === "7000000000000000001");
  assert.equal(shared["来源类型"], "对标账号；关键词");
  assert.equal(shared["命中关键词"], "测试关键词");
  assert.equal(summary.status, "complete");
  assert.equal(summary.account_window_days, 30);
  assert.equal(summary.keyword_window_days, 7);
});

test("validates the fixture browser sequence and limits", () => {
  const stdout = execFileSync(process.execPath, [
    path.join(repoDir, "scripts", "validate-browser-artifacts.mjs"),
    `--config=${path.join(fixtures, "project.json")}`,
    `--candidates=${path.join(fixtures, "candidates.json")}`,
    `--summary=${path.join(fixtures, "summary.json")}`,
  ], { encoding: "utf8" });
  assert.equal(JSON.parse(stdout).status, "valid");
});

test("uses account P70 after 20 non-pinned history posts and caps each keyword at five", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-monitor-boundary-"));
  const config = JSON.parse(fs.readFileSync(path.join(fixtures, "project.json"), "utf8"));
  const candidates = [];
  for (let index = 1; index <= 20; index += 1) {
    candidates.push({
      platform: "抖音",
      video_id: `71000000000000000${String(index).padStart(2, "0")}`,
      account_name: "测试账号",
      account_url: "https://www.douyin.com/user/TEST_ACCOUNT",
      follower_count: 80000,
      title: `账号历史 ${index}`,
      copy: "",
      published_at: `2026-01-${String(index + 1).padStart(2, "0")}T04:00:00.000Z`,
      likes: index * 100,
      comments: 1,
      collects: 1,
      shares: 1,
      video_url: `https://www.douyin.com/video/71000000000000000${String(index).padStart(2, "0")}`,
      cover_url: "",
      media_url: "",
      duration_ms: 1000,
      is_pinned: false,
      sources: ["benchmark_account:测试账号"],
      matched_keywords: [],
      collection_status: "success",
    });
  }
  for (let index = 1; index <= 6; index += 1) {
    candidates.push({
      platform: "抖音",
      video_id: `72000000000000000${String(index).padStart(2, "0")}`,
      account_name: "关键词作者",
      account_url: "https://www.douyin.com/user/KEYWORD_AUTHOR",
      follower_count: 80000,
      title: `关键词候选 ${index}`,
      copy: "测试关键词",
      published_at: "2026-01-30T04:00:00.000Z",
      likes: 5000 + index,
      comments: 1,
      collects: 1,
      shares: 1,
      video_url: `https://www.douyin.com/video/72000000000000000${String(index).padStart(2, "0")}`,
      cover_url: "",
      media_url: "",
      duration_ms: 1000,
      is_pinned: false,
      sources: ["keyword:测试关键词"],
      matched_keywords: ["测试关键词"],
      collection_status: "success",
    });
  }
  const candidatesPath = path.join(tempDir, "candidates.json");
  fs.writeFileSync(candidatesPath, JSON.stringify(candidates));
  execFileSync(process.execPath, [
    path.join(repoDir, "scripts", "build-ranking.mjs"),
    `--input=${candidatesPath}`,
    `--output-dir=${tempDir}`,
    `--config=${path.join(fixtures, "project.json")}`,
    "--now=2026-01-31T12:00:00+08:00",
  ], { encoding: "utf8" });

  const summary = JSON.parse(fs.readFileSync(path.join(tempDir, "run-summary.json"), "utf8"));
  const accountRows = JSON.parse(fs.readFileSync(path.join(tempDir, "account-ranking.json"), "utf8"));
  const keywordRows = JSON.parse(fs.readFileSync(path.join(tempDir, "keyword-ranking.json"), "utf8"));
  assert.equal(summary.account_baselines["测试账号"].p70, 1400);
  assert.ok(accountRows.every((row) => row["点赞"] >= 1400));
  assert.equal(keywordRows.length, 5);
});
