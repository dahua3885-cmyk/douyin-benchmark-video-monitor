const DAY_MS = 24 * 60 * 60 * 1000;

function formatInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function recursivelyCollect(value, predicate, output) {
  if (!value || typeof value !== "object") return;
  if (predicate(value)) output.push(value);
  if (Array.isArray(value)) {
    for (const item of value) recursivelyCollect(item, predicate, output);
    return;
  }
  for (const child of Object.values(value)) recursivelyCollect(child, predicate, output);
}

export function extractViews(payload) {
  const found = [];
  recursivelyCollect(payload, (value) => {
    return !Array.isArray(value) && typeof value.view_id === "string" &&
      (typeof value.view_name === "string" || typeof value.name === "string");
  }, found);
  const unique = new Map();
  for (const item of found) {
    const id = item.view_id;
    unique.set(id, {
      id,
      name: String(item.view_name ?? item.name),
      type: String(item.view_type ?? item.type ?? "grid"),
    });
  }
  return [...unique.values()];
}

export function extractFieldNames(payload) {
  const found = [];
  recursivelyCollect(payload, (value) => {
    return !Array.isArray(value) && typeof value.field_id === "string" &&
      (typeof value.field_name === "string" || typeof value.name === "string");
  }, found);
  return [...new Set(found.map((item) => String(item.field_name ?? item.name)))];
}

export function desiredViews(now, timeZone) {
  const sevenDayCutoff = `ExactDate(${formatInTimeZone(new Date(now.getTime() - 7 * DAY_MS), timeZone)})`;
  const thirtyDayCutoff = `ExactDate(${formatInTimeZone(new Date(now.getTime() - 30 * DAY_MS), timeZone)})`;
  const sort = { sort_config: [{ field: "点赞", desc: true }, { field: "评分", desc: true }] };
  return [
    {
      name: "最近7天榜单",
      filter: { logic: "and", conditions: [["发布时间", ">=", sevenDayCutoff]] },
      sort,
    },
    {
      name: "对标账号视频",
      filter: {
        logic: "and",
        conditions: [["来源类型", "intersects", ["对标账号"]], ["发布时间", ">=", thirtyDayCutoff]],
      },
      sort,
    },
    {
      name: "关键词爆款",
      filter: {
        logic: "and",
        conditions: [["来源类型", "intersects", ["关键词"]], ["发布时间", ">=", sevenDayCutoff]],
      },
      sort,
    },
    {
      name: "历史记录",
      filter: { conditions: [] },
      sort,
    },
  ];
}

export function buildViewPlan(existingViews, now, timeZone) {
  const desired = desiredViews(now, timeZone);
  const desiredNames = new Set(desired.map((view) => view.name));
  const existingByName = new Map(existingViews.map((view) => [view.name, view]));
  const operations = [];

  if (![...desiredNames].some((name) => existingByName.has(name))) {
    const defaultView = existingViews.find((view) => ["表格", "Grid", "Grid view"].includes(view.name));
    if (defaultView) {
      operations.push({ action: "rename", viewId: defaultView.id, from: defaultView.name, to: desired[0].name });
      existingByName.set(desired[0].name, { ...defaultView, name: desired[0].name });
    }
  }

  for (const view of desired) {
    if (!existingByName.has(view.name)) operations.push({ action: "create", name: view.name, type: "grid" });
  }
  return { desired, operations };
}
