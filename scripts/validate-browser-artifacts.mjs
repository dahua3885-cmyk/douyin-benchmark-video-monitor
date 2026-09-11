import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, ...value] = arg.slice(2).split("=");
  return [key, value.join("=")];
}));
const errors = [];

function readJson(name) {
  const file = args[name] ? path.resolve(args[name]) : "";
  if (!file || !fs.existsSync(file)) {
    errors.push(`缺少 ${name} 文件`);
    return name === "candidates" ? [] : {};
  }
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { errors.push(`${name} 读取失败：${error.message}`); return name === "candidates" ? [] : {}; }
}

const config = readJson("config");
const candidates = readJson("candidates");
const summary = readJson("summary");
const accounts = config.benchmark_accounts || [];
const keywords = (config.keyword_groups || []).flatMap((group) => group.keywords || []);

if (!Array.isArray(candidates)) errors.push("候选数据根节点必须为数组");
if (summary.browser?.provider !== "codex_in_app_browser") errors.push("采集摘要不是 Codex 内置浏览器");
if (summary.browser?.login_verified !== true) errors.push("采集摘要未确认抖音登录状态");
if (JSON.stringify(summary.phases) !== JSON.stringify(["accounts", "keywords"])) errors.push("采集阶段必须先 accounts 后 keywords");
if (Number(summary.account_max_observed_concurrency) !== 1) errors.push("对标账号必须严格串行采集");

const keywordConcurrency = summary.keyword_concurrency || {};
if (![2, 3].includes(Number(keywordConcurrency.initial))) errors.push("关键词初始并发只能为 2 或 3");
if (Number(keywordConcurrency.initial) !== Number(config.collection?.keyword_concurrency)) errors.push("关键词初始并发与配置不一致");
if (Number(keywordConcurrency.max_observed) > 3 || Number(keywordConcurrency.max_observed) > Number(config.collection?.keyword_concurrency_max)) errors.push("关键词实际并发超过上限 3");
if (keywordConcurrency.risk_triggered === true && Number(keywordConcurrency.after_risk) !== 1) errors.push("触发风控后必须降为单关键词串行");

const accountRows = Array.isArray(summary.accounts) ? summary.accounts : [];
const keywordRows = Array.isArray(summary.keywords) ? summary.keywords : [];
for (const [index, account] of accounts.entries()) {
  const row = accountRows.find((item) => item.account === account.name);
  if (!row) errors.push(`采集摘要缺少账号：${account.name}`);
  else if (Number(row.sequence) !== index + 1) errors.push(`账号顺序错误：${account.name}`);
}
for (const keyword of keywords) {
  const row = keywordRows.find((item) => item.keyword === keyword);
  if (!row) errors.push(`采集摘要缺少关键词：${keyword}`);
  else if (Number(row.examined_count || 0) > 10) errors.push(`关键词 ${keyword} 检查数量超过 10`);
}

const required = ["platform", "video_id", "account_name", "published_at", "follower_count", "likes", "video_url", "sources", "matched_keywords", "collection_status"];
const keys = new Set();
for (const [index, row] of (Array.isArray(candidates) ? candidates : []).entries()) {
  for (const field of required) if (row?.[field] === undefined || row?.[field] === null || row?.[field] === "") errors.push(`候选第 ${index + 1} 条缺少 ${field}`);
  if (!Array.isArray(row.sources) || !row.sources.length) errors.push(`候选第 ${index + 1} 条 sources 无效`);
  if (!Array.isArray(row.matched_keywords)) errors.push(`候选第 ${index + 1} 条 matched_keywords 无效`);
  const key = `${row.platform}:${row.video_id}`;
  if (keys.has(key)) errors.push(`候选视频重复：${key}`);
  keys.add(key);
  if (Number.isNaN(Date.parse(row.published_at))) errors.push(`候选第 ${index + 1} 条发布时间无效`);
  for (const field of ["follower_count", "likes", "comments", "collects", "shares", "duration_ms"]) {
    if (row[field] !== undefined && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) errors.push(`候选第 ${index + 1} 条 ${field} 无效`);
  }
}
if (Number(summary.candidate_count) !== (Array.isArray(candidates) ? candidates.length : 0)) errors.push("summary.candidate_count 与候选数量不一致");
if (!summary.captured_at || Number.isNaN(Date.parse(summary.captured_at))) errors.push("采集摘要缺少有效 captured_at");

console.log(JSON.stringify({
  status: errors.length ? "invalid" : "valid",
  candidate_count: Array.isArray(candidates) ? candidates.length : 0,
  account_count: accountRows.length,
  keyword_count: keywordRows.length,
  errors,
}, null, 2));
if (errors.length) process.exit(1);
