import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, ...value] = arg.slice(2).split("=");
  return [key, value.join("=")];
}));
if (!args.input || !args["output-dir"] || !args.config) {
  console.error("usage: node build-ranking.mjs --input=<candidates.json> --output-dir=<dir> --config=<project.json> [--state=<state.json>] [--ocr-map=<ocr.json>] [--collection-summary=<summary.json>] [--now=<ISO>]");
  process.exit(1);
}

const config = JSON.parse(await fs.readFile(path.resolve(args.config), "utf8"));
const input = JSON.parse(await fs.readFile(path.resolve(args.input), "utf8"));
const outputDir = path.resolve(args["output-dir"]);
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.getTime())) throw new Error("--now 不是有效日期");

let previousState = { videos: {} };
if (args.state) {
  try { previousState = JSON.parse(await fs.readFile(path.resolve(args.state), "utf8")); } catch {}
}
let ocrMap = {};
if (args["ocr-map"]) {
  try { ocrMap = JSON.parse(await fs.readFile(path.resolve(args["ocr-map"]), "utf8")); } catch {}
}
let collectionSummary = null;
if (args["collection-summary"]) {
  try { collectionSummary = JSON.parse(await fs.readFile(path.resolve(args["collection-summary"]), "utf8")); } catch {}
}

const DAY = 86400000;
const accountCutoff = new Date(now.getTime() - config.collection.account_window_days * DAY);
const keywordCutoff = new Date(now.getTime() - config.collection.keyword_window_days * DAY);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const number = (value) => Number(value || 0);
const unique = (values) => [...new Set(values.map(clean).filter(Boolean))];
const platform = config.project.platform;
const keywordDirectionMap = new Map(config.keyword_groups.flatMap((group) =>
  group.keywords.map((keyword) => [clean(keyword), clean(group.name)]),
));

function parseDate(value) {
  if (typeof value === "number" || /^\d{10}$/.test(String(value || ""))) return new Date(Number(value) * 1000);
  return new Date(value);
}

function localDateTime(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: config.project.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalize(raw) {
  const videoId = clean(raw.video_id || raw.aweme_id || raw["视频ID"]);
  const sources = unique(Array.isArray(raw.sources) ? raw.sources : clean(raw.source || raw["匹配来源"]).split(/[；;]/));
  const matchedKeywords = unique([
    ...(Array.isArray(raw.matched_keywords) ? raw.matched_keywords : []),
    ...sources.filter((source) => /^(keyword:|关键词｜)/.test(source)).map((source) => source.replace(/^(keyword:|关键词｜)/, "")),
  ]);
  return {
    platform: clean(raw.platform || platform),
    videoId,
    accountName: clean(raw.account_name || raw.author || raw["账号昵称"] || "未知账号"),
    accountUrl: clean(raw.account_url || raw["账号主页"]),
    followerCount: number(raw.follower_count ?? raw["粉丝数"]),
    title: clean(raw.title || raw["视频标题"] || raw.desc || "无标题").slice(0, 120),
    publishCopy: clean(raw.copy || raw.desc || raw["发布文案"]),
    transcript: clean(raw.transcript || raw["视频文案"]),
    publishedAt: parseDate(raw.published_at || raw.create_time || raw["发布时间"]),
    likes: number(raw.likes ?? raw.digg_count ?? raw["点赞"]),
    comments: number(raw.comments ?? raw.comment_count ?? raw["评论"]),
    collects: number(raw.collects ?? raw.collect_count ?? raw["收藏"]),
    shares: number(raw.shares ?? raw.share_count ?? raw["分享"]),
    videoUrl: clean(raw.video_url || raw.link || raw["视频链接"] || `https://www.douyin.com/video/${videoId}`),
    coverUrl: clean(raw.cover_url || raw["封面图链接"]),
    mediaUrl: clean(raw.media_url),
    durationMs: number(raw.duration_ms || raw["视频时长"]),
    isPinned: raw.is_pinned === true,
    sources,
    matchedKeywords,
    contentDirections: unique(clean(raw.content_direction || raw["内容方向"]).split(/[；;]/)),
    collectionStatus: clean(raw.collection_status || "success"),
  };
}

function isAccountSource(row) {
  return row.sources.some((source) => /^(benchmark_account:|对标账号｜)/.test(source));
}

function isKeywordSource(row) {
  return row.sources.some((source) => /^(keyword:|关键词｜)/.test(source)) || row.matchedKeywords.length > 0;
}

function mergeRows(left, right) {
  left.sources = unique([...left.sources, ...right.sources]);
  left.matchedKeywords = unique([...left.matchedKeywords, ...right.matchedKeywords]);
  left.contentDirections = unique([...left.contentDirections, ...right.contentDirections]);
  left.followerCount = Math.max(left.followerCount, right.followerCount);
  for (const field of ["likes", "comments", "collects", "shares", "durationMs"]) left[field] = Math.max(left[field], right[field]);
  if (right.publishCopy.length > left.publishCopy.length) { left.publishCopy = right.publishCopy; left.title = right.title; }
  if (right.transcript.length > left.transcript.length) left.transcript = right.transcript;
  if (!left.coverUrl) left.coverUrl = right.coverUrl;
  if (!left.mediaUrl) left.mediaUrl = right.mediaUrl;
  left.isPinned = left.isPinned || right.isPinned;
  return left;
}

const merged = new Map();
for (const raw of input) {
  const row = normalize(raw);
  if (!row.videoId) continue;
  const key = `${row.platform}:${row.videoId}`;
  merged.set(key, merged.has(key) ? mergeRows(merged.get(key), row) : row);
}
const rows = [...merged.values()];

function tierFor(followers) {
  return config.ranking.follower_tiers.find((tier) => tier.max_followers === null || followers <= Number(tier.max_followers));
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

const baselineConfig = config.ranking.dynamic_account_baseline;
const accountBaselines = new Map();
for (const account of config.benchmark_accounts) {
  const history = rows
    .filter((row) => isAccountSource(row) && row.accountName === account.name && !row.isPinned && !Number.isNaN(row.publishedAt.getTime()))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, baselineConfig.target_history_items);
  const value = baselineConfig.enabled && history.length >= baselineConfig.minimum_history_items
    ? percentile(history.map((row) => row.likes), baselineConfig.percentile)
    : null;
  accountBaselines.set(account.name, { sampleSize: history.length, p70: value });
}

function tierThreshold(row) {
  const tier = tierFor(row.followerCount);
  return { tier, threshold: Math.max(config.ranking.absolute_minimum_likes, Number(tier?.minimum_likes || Infinity)) };
}

function weightedInteraction(row) {
  const weights = config.ranking.weighted_interaction;
  return row.likes * weights.like + row.comments * weights.comment + row.collects * weights.collect + row.shares * weights.share;
}

function score(row, threshold) {
  const weights = config.ranking.score_weights;
  const likes = Math.max(1, row.likes);
  const followers = Math.max(1, row.followerCount);
  const traffic = Math.min(weights.traffic, weights.traffic / 2 + (weights.traffic / 4) * Math.log2(Math.max(1, row.likes / threshold)));
  const collect = Math.min(weights.collect, weights.collect * (row.collects / likes) / 0.8);
  const share = Math.min(weights.share, weights.share * (row.shares / likes) / 0.3);
  const comment = Math.min(weights.comment, weights.comment * (row.comments / likes) / 0.1);
  const breakout = Math.min(weights.low_follower_breakout, weights.low_follower_breakout * (row.likes / followers) / 0.1);
  return Math.round((traffic + collect + share + comment + breakout) * 10) / 10;
}

function sortRows(values) {
  return [...values].sort((a, b) => b.likes - a.likes || b.rankScore - a.rankScore || b.publishedAt - a.publishedAt);
}

const rejection = { invalid_date: 0, outside_source_window: 0, unknown_followers: 0, below_threshold: 0 };
const accountEligible = [];
const keywordPrequalified = [];
for (const row of rows) {
  if (Number.isNaN(row.publishedAt.getTime()) || row.publishedAt > now) { rejection.invalid_date += 1; continue; }
  const inAccountWindow = isAccountSource(row) && row.publishedAt >= accountCutoff;
  const inKeywordWindow = isKeywordSource(row) && row.publishedAt >= keywordCutoff;
  if (!inAccountWindow && !inKeywordWindow) { rejection.outside_source_window += 1; continue; }
  if (row.followerCount <= 0) { rejection.unknown_followers += 1; continue; }
  const { tier, threshold: staticThreshold } = tierThreshold(row);
  const baseline = accountBaselines.get(row.accountName) || { sampleSize: 0, p70: null };
  const accountThreshold = Math.max(staticThreshold, baseline.p70 || 0);
  let qualifiedAny = false;
  if (inAccountWindow && row.likes >= accountThreshold) {
    accountEligible.push({ ...row, tier: tier.label, threshold: accountThreshold, accountP70: baseline.p70, rankScore: score(row, accountThreshold) });
    qualifiedAny = true;
  }
  if (inKeywordWindow && row.likes >= staticThreshold) {
    keywordPrequalified.push({ ...row, tier: tier.label, threshold: staticThreshold, accountP70: null, rankScore: score(row, staticThreshold) });
    qualifiedAny = true;
  }
  if (!qualifiedAny) rejection.below_threshold += 1;
}

const configuredKeywords = config.keyword_groups.flatMap((group) => group.keywords);
const selectedKeywordIds = new Set();
const selectedKeywordsById = new Map();
for (const keyword of configuredKeywords) {
  const selected = sortRows(keywordPrequalified.filter((row) => row.matchedKeywords.includes(keyword)))
    .slice(0, config.collection.keyword_result_limit);
  for (const row of selected) {
    selectedKeywordIds.add(row.videoId);
    if (!selectedKeywordsById.has(row.videoId)) selectedKeywordsById.set(row.videoId, []);
    selectedKeywordsById.get(row.videoId).push(keyword);
  }
}
const keywordEligible = keywordPrequalified.filter((row) => selectedKeywordIds.has(row.videoId));

const firstSeenNow = now.toISOString();
const nextState = { updated_at: firstSeenNow, videos: { ...(previousState.videos || {}) } };
const allRankedIds = new Set([...accountEligible, ...keywordEligible].map((row) => row.videoId));
for (const row of rows) {
  const key = `${row.platform}:${row.videoId}`;
  const previous = previousState.videos?.[key] || {};
  nextState.videos[key] = {
    first_seen_at: previous.first_seen_at || firstSeenNow,
    first_ranked_at: previous.first_ranked_at || (allRankedIds.has(row.videoId) ? firstSeenNow : null),
    last_seen_at: firstSeenNow,
    last_metrics: { likes: row.likes, comments: row.comments, collects: row.collects, shares: row.shares },
    matched_keywords: unique([...(previous.matched_keywords || []), ...row.matchedKeywords]),
  };
}

function makeOutput(row, includeAccount, includeKeyword) {
  const key = `${row.platform}:${row.videoId}`;
  const previous = previousState.videos?.[key] || {};
  const firstSeen = new Date(previous.first_seen_at || firstSeenNow);
  const firstRanked = new Date(previous.first_ranked_at || firstSeenNow);
  const daysRanked = Math.max(1, Math.floor((now - firstRanked) / DAY) + 1);
  const exits = [];
  if (includeAccount) exits.push(new Date(row.publishedAt.getTime() + config.collection.account_window_days * DAY));
  if (includeKeyword) exits.push(new Date(row.publishedAt.getTime() + config.collection.keyword_window_days * DAY));
  const expectedExit = exits.sort((a, b) => b - a)[0];
  const sourceTypes = [includeAccount ? "对标账号" : "", includeKeyword ? "关键词" : ""].filter(Boolean);
  const windows = [includeAccount ? "近30天账号" : "", includeKeyword ? "近7天关键词" : ""].filter(Boolean);
  const selectedKeywords = includeKeyword ? unique(selectedKeywordsById.get(row.videoId) || []) : [];
  const contentDirections = row.contentDirections.length
    ? row.contentDirections
    : unique(row.matchedKeywords.map((keyword) => keywordDirectionMap.get(keyword)));
  const notes = [];
  const coverTitle = clean(ocrMap[row.videoId] || row.coverTitle || "待识别");
  if (coverTitle === "待识别") notes.push("封面OCR待补");
  if (!row.transcript) notes.push("视频转录待补");
  return {
    "视频标题": row.title,
    "唯一键": key,
    "平台": row.platform,
    "视频ID": row.videoId,
    "账号昵称": row.accountName,
    "账号主页": row.accountUrl,
    "粉丝数": row.followerCount,
    "来源类型": sourceTypes.join("；"),
    "来源": sourceTypes.join("；"),
    "内容方向": contentDirections.join("；") || "待分类",
    "关键词": (selectedKeywords.length ? selectedKeywords : row.matchedKeywords).join("；"),
    "命中关键词": row.matchedKeywords.join("；"),
    "入榜关键词": selectedKeywords.join("；"),
    "来源窗口": windows.join("；"),
    "发布时间": localDateTime(row.publishedAt),
    "点赞": row.likes,
    "评论": row.comments,
    "收藏": row.collects,
    "分享": row.shares,
    "评分": row.rankScore,
    "加权互动值": weightedInteraction(row),
    "入榜点赞门槛": row.threshold,
    "账号P70": includeAccount ? row.accountP70 : null,
    "视频链接": row.videoUrl,
    "封面标题": coverTitle,
    "视频文案": row.transcript,
    "发布文案": row.publishCopy,
    "首次发现时间": localDateTime(firstSeen),
    "最近更新时间": localDateTime(now),
    "预计下榜时间": localDateTime(expectedExit),
    "在榜状态": previous.first_ranked_at ? `已在榜 ${daysRanked} 天` : "新上榜",
    "数据备注": notes.join("；"),
  };
}

const accountRanking = sortRows(accountEligible).map((row) => makeOutput(row, true, false));
const keywordRanking = sortRows(keywordEligible).map((row) => makeOutput(row, false, true));
const combinedMap = new Map();
for (const row of accountEligible) combinedMap.set(row.videoId, { row, account: true, keyword: false });
for (const row of keywordEligible) {
  const existing = combinedMap.get(row.videoId);
  if (existing) {
    existing.keyword = true;
    existing.row = { ...existing.row, rankScore: Math.max(existing.row.rankScore, row.rankScore), threshold: Math.max(existing.row.threshold, row.threshold) };
  } else combinedMap.set(row.videoId, { row, account: false, keyword: true });
}
const combinedRanking = sortRows([...combinedMap.values()].map((item) => item.row))
  .map((row) => {
    const item = combinedMap.get(row.videoId);
    return makeOutput(row, item.account, item.keyword);
  });

const rankedKeys = new Set(combinedRanking.map((row) => row["唯一键"]));
const snapshots = rows.filter((row) => rankedKeys.has(`${row.platform}:${row.videoId}`)).map((row) => ({
  "快照ID": `${now.toISOString()}:${row.platform}:${row.videoId}`,
  "快照时间": localDateTime(now),
  "唯一键": `${row.platform}:${row.videoId}`,
  "账号昵称": row.accountName,
  "粉丝数": row.followerCount,
  "点赞": row.likes,
  "评论": row.comments,
  "收藏": row.collects,
  "分享": row.shares,
  "加权互动值": weightedInteraction(row),
  "是否当期入榜": true,
}));

const csvHeaders = ["视频标题", "账号昵称", "粉丝数", "来源类型", "命中关键词", "入榜关键词", "来源窗口", "发布时间", "点赞", "评论", "收藏", "分享", "评分", "视频链接", "视频文案"];
const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
function toCsv(data) {
  return `\uFEFF${[csvHeaders, ...data.map((row) => csvHeaders.map((field) => row[field]))].map((values) => values.map(escapeCsv).join(",")).join("\n")}`;
}

const sourceFailures = [
  ...(collectionSummary?.accounts || []).filter((row) => row.status !== "success").map((row) => `账号 ${row.account}: ${row.error || row.status}`),
  ...(collectionSummary?.keywords || []).filter((row) => !["success_with_results", "success_empty"].includes(row.status)).map((row) => `关键词 ${row.keyword}: ${row.error || row.status}`),
];
const status = sourceFailures.length || rejection.unknown_followers ? "partial" : "complete";
const summary = {
  status,
  run_at: now.toISOString(),
  account_window_days: config.collection.account_window_days,
  keyword_window_days: config.collection.keyword_window_days,
  input_count: input.length,
  deduplicated_count: rows.length,
  account_ranking_count: accountRanking.length,
  keyword_ranking_count: keywordRanking.length,
  combined_unique_count: combinedRanking.length,
  keyword_candidate_limit: config.collection.keyword_candidate_limit,
  keyword_result_limit: config.collection.keyword_result_limit,
  rejected: rejection,
  account_baselines: Object.fromEntries(accountBaselines),
  source_failures: sourceFailures,
  sorting: "点赞降序；同点赞按评分降序",
};

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "account-ranking.json"), JSON.stringify(accountRanking, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "account-ranking.csv"), toCsv(accountRanking), "utf8"),
  fs.writeFile(path.join(outputDir, "keyword-ranking.json"), JSON.stringify(keywordRanking, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "keyword-ranking.csv"), toCsv(keywordRanking), "utf8"),
  fs.writeFile(path.join(outputDir, "combined-ranking.json"), JSON.stringify(combinedRanking, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "combined-ranking.csv"), toCsv(combinedRanking), "utf8"),
  fs.writeFile(path.join(outputDir, "ranking.json"), JSON.stringify(combinedRanking, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "daily-snapshots.json"), JSON.stringify(snapshots, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "updated-state.json"), JSON.stringify(nextState, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8"),
]);
console.log(JSON.stringify({ output_dir: outputDir, ...summary }, null, 2));
if (status !== "complete") process.exitCode = 2;
