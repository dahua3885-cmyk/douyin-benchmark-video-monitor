import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const configPath = path.resolve(process.argv[2] || path.join(skillDir, "config", "project.local.json"));
const errors = [];
const warnings = [];

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(JSON.stringify({ status: "invalid", config_path: configPath, errors: [`配置读取失败：${error.message}`] }, null, 2));
  process.exit(1);
}

const accounts = Array.isArray(config.benchmark_accounts) ? config.benchmark_accounts : [];
const groups = Array.isArray(config.keyword_groups) ? config.keyword_groups : [];
const keywords = groups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords : []);
const collection = config.collection || {};
const browser = collection.browser || {};
const tiers = config.ranking?.follower_tiers || [];

if (config.schema_version !== 1) errors.push("schema_version 必须为 1");
for (const field of ["id", "name", "platform", "timezone", "output_root"]) {
  if (!String(config.project?.[field] || "").trim()) errors.push(`project.${field} 不能为空`);
}
if (path.isAbsolute(String(config.project?.output_root || "")) || String(config.project?.output_root || "").split(/[\\/]/).includes("..")) {
  errors.push("project.output_root 必须是 Skill 目录内的安全相对路径");
}
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(config.schedule?.daily_time || ""))) errors.push("schedule.daily_time 必须为 HH:mm");

if (!accounts.length) errors.push("至少配置一个对标账号");
if (new Set(accounts.map((row) => String(row.name || "").trim())).size !== accounts.length) errors.push("对标账号名称不能重复");
if (new Set(accounts.map((row) => String(row.url || "").trim())).size !== accounts.length) errors.push("对标账号链接不能重复");
for (const account of accounts) {
  if (!String(account.name || "").trim() || !/^https:\/\/www\.douyin\.com\/user\//.test(String(account.url || ""))) {
    errors.push(`对标账号配置无效：${account.name || "未命名账号"}`);
  }
}

if (!keywords.length) errors.push("至少配置一个关键词");
if (new Set(keywords.map((value) => String(value).trim())).size !== keywords.length) errors.push("关键词不能重复");
if (keywords.some((value) => !String(value).trim())) errors.push("关键词不能为空");

if (config.excluded_accounts !== undefined || config.content_filter?.excluded_formats !== undefined) {
  errors.push("公开版不接受排除账号或排除内容配置");
}
if (config.feishu?.notification !== undefined) errors.push("公开版不接受通知接收人或群配置");

const exact = [
  ["collection.account_post_limit", collection.account_post_limit, 60],
  ["collection.account_window_days", collection.account_window_days, 30],
  ["collection.keyword_window_days", collection.keyword_window_days, 7],
  ["collection.account_concurrency", collection.account_concurrency, 1],
  ["collection.keyword_concurrency_max", collection.keyword_concurrency_max, 3],
  ["collection.keyword_risk_fallback_concurrency", collection.keyword_risk_fallback_concurrency, 1],
  ["collection.keyword_candidate_limit", collection.keyword_candidate_limit, 10],
  ["collection.keyword_result_limit", collection.keyword_result_limit, 5],
];
for (const [name, actual, expected] of exact) if (actual !== expected) errors.push(`${name} 必须为 ${expected}`);
if (![2, 3].includes(collection.keyword_concurrency)) errors.push("collection.keyword_concurrency 只能为 2 或 3");
if (!Number.isInteger(collection.account_retry_attempts) || collection.account_retry_attempts < 1) errors.push("账号重试次数必须为正整数");
if (!Number.isFinite(collection.account_retry_backoff_seconds) || collection.account_retry_backoff_seconds < 0) errors.push("账号重试退避必须为非负数");

if (browser.provider !== "codex_in_app_browser") errors.push("只能使用 Codex 内置浏览器");
if (browser.reuse_session !== true) errors.push("必须复用 Codex 内置浏览器登录态");
if (browser.allow_standalone_browser !== false) errors.push("不得启用独立浏览器");

if (config.ranking?.absolute_minimum_likes !== 100) errors.push("绝对最低点赞必须为 100");
if (tiers.length < 2) errors.push("至少配置两个粉丝门槛档位");
let previousMax = -1;
let previousMinimum = -1;
for (const [index, tier] of tiers.entries()) {
  const max = tier.max_followers;
  const minimum = Number(tier.minimum_likes);
  if (!String(tier.label || "").trim()) errors.push(`第 ${index + 1} 档缺少 label`);
  if (!Number.isFinite(minimum) || minimum < 100 || minimum < previousMinimum) errors.push(`第 ${index + 1} 档点赞门槛无效或未递增`);
  if (max !== null && (!Number.isFinite(Number(max)) || Number(max) <= previousMax)) errors.push(`第 ${index + 1} 档粉丝上限无效或未递增`);
  if (max === null && index !== tiers.length - 1) errors.push("只有最后一档的 max_followers 可以为 null");
  if (max !== null) previousMax = Number(max);
  previousMinimum = minimum;
}
if (tiers.length && tiers.at(-1).max_followers !== null) errors.push("最后一个粉丝档位必须覆盖无上限账号");

const baseline = config.ranking?.dynamic_account_baseline || {};
if (baseline.enabled !== true || baseline.percentile !== 70 || baseline.minimum_history_items !== 20 || baseline.target_history_items !== 30) {
  errors.push("动态账号基线必须启用 P70，并使用至少20条、目标30条非置顶历史作品");
}
const scoreTotal = Object.values(config.ranking?.score_weights || {}).reduce((sum, value) => sum + Number(value || 0), 0);
if (scoreTotal !== 100) errors.push(`评分权重合计必须为 100，当前为 ${scoreTotal}`);

if (config.feishu?.enabled) {
  if (config.feishu.identity !== "bot") errors.push("飞书无人值守写入必须使用 bot 身份");
  if (!config.feishu.base_token || !config.feishu.base_url) errors.push("启用飞书后必须填写本地 base_token 和 base_url");
  for (const key of ["videos", "snapshots", "runs"]) {
    if (!config.feishu.tables?.[key]?.table_id) errors.push(`启用飞书后缺少 ${key} table_id`);
  }
} else {
  warnings.push("飞书未启用：只能生成本地榜单");
}

const forbiddenKeys = ["app_secret", "access_token", "cookie", "provider_tab_id", "codex_session_id", "recipient_id", "chat_id"];
const serialized = JSON.stringify(config).toLowerCase();
for (const key of forbiddenKeys) if (serialized.includes(`\"${key}\"`)) errors.push(`配置中禁止保存敏感或会话字段：${key}`);

const result = {
  status: errors.length ? "invalid" : "valid",
  config_path: configPath,
  account_count: accounts.length,
  keyword_group_count: groups.length,
  keyword_count: keywords.length,
  errors,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
