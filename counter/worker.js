/**
 * engineer-ocean.github.io 的访客统计 Worker（Cloudflare Workers + KV）
 *
 * 设计目标：回答「有多少人看、大概来自哪些城市」，**不建立任何访客档案**。
 *
 * 收集什么
 *   - 总访问量 PV            → KV: `pv`
 *   - 独立访客（按日去重累加）→ KV: `uv:total`，去重靠 KV: `uv:<日期>:<哈希>`（TTL 24h）
 *   - 城市级计数             → KV: `cityAgg`，一个 JSON 对象
 *                             （键是 `<国家>|<城市>`，值是计数，只累加数字）
 *
 * 明确**不**收集（这几条是硬约束，改代码时不要破坏）
 *   - 不存原始 IP：IP 只用于当场算一个哈希，算完即弃，从不写入 KV
 *   - 不存 User-Agent：同上，只参与哈希
 *   - 不留任何可跨天关联的访客标识：哈希的盐含当天日期，每天自动换盐，
 *     且去重键 24 小时后由 KV 自动删除
 *   - 不出售、不共享、不用于广告
 *
 * 地理信息来自 Cloudflare 边缘的 `request.cf`，**不调用任何第三方 IP 地理库**，
 * 因此也不存在「把访客 IP 转发给第三方」这件事。
 *
 * KV 命名空间绑定名必须是 COUNTER。
 * 可选环境变量 SALT_SECRET：只影响哈希强度，不影响是否记录 IP。
 */

const ALLOWED_ORIGINS = [
  'https://engineer-ocean.github.io',
  'http://127.0.0.1:8123',
  'http://localhost:8123',
];

// 去重键存活 24 小时 —— 到期自动消失，不构成长期标识
const UV_TTL_SECONDS = 24 * 60 * 60;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, extra, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

async function sha256hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// KV 没有原子自增：读-改-写之间存在竞争。
// 个人站点量级下误差可忽略；若日后量大了，把计数换成 Durable Object 即可。
async function bump(env, key) {
  const raw = await env.COUNTER.get(key);
  const next = (parseInt(raw || '0', 10) || 0) + 1;
  await env.COUNTER.put(key, String(next));
  return next;
}

// ---------------------------------------------------------------- 城市聚合
//
// 为什么不是「每个城市一个 KV 键 + list()」？
//   因为 KV 的 list() 结果带缓存：刚 put 进去的键，list() 往往要几十秒后才认得，
//   而 get() 在写入的那个机房是强一致的。早期版本正是用 list({prefix:'city:'})
//   来数城市，于是出现了这个现象 —— 新访客明明已经写进 KV、直接从后台读都看得见，
//   页面上却显示「来自 0 个城市」。不是没记上，是 list() 还没刷出来。
//   现在整张城市表存成一个 JSON 值，只走 get()/put()，读到什么就是什么。
//
//   代价：读-改-写在大表 + 高并发时会有互相覆盖。个人站点量级下可忽略；
//   真要做大，换成 Durable Object 或 Analytics Engine。
const CITY_AGG_KEY = 'cityAgg';

function parseCityKey(key) {
  const sep = key.indexOf('|');
  return {
    country: sep === -1 ? key : key.slice(0, sep),
    city: sep === -1 ? '' : key.slice(sep + 1),
  };
}

async function readCityAgg(env) {
  const raw = await env.COUNTER.get(CITY_AGG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // 值坏了就重建 —— 不让一个坏键把统计永久打死
    }
  }

  // 迁移：早期版本把计数存在分散的 `city:<国家>|<城市>` 键里。
  // 首次读到空 cityAgg 时汇总一次，写回新格式，老数据不丢。
  const agg = {};
  const listed = await env.COUNTER.list({ prefix: 'city:' });
  for (const k of listed.keys) {
    const count = parseInt((await env.COUNTER.get(k.name)) || '0', 10) || 0;
    if (count > 0) agg[k.name.slice('city:'.length)] = count;
  }
  if (Object.keys(agg).length) {
    await env.COUNTER.put(CITY_AGG_KEY, JSON.stringify(agg));
  }
  return agg;
}

function topCities(agg, limit) {
  return Object.keys(agg)
    .map((key) => Object.assign(parseCityKey(key), { count: parseInt(agg[key], 10) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// 一次算齐所有聚合数字。`hit` 与 `stats` 共用同一个快照函数，
// 保证「刚上报完的这次访问」也出现在返回里 —— 前端一次请求即可渲染，无先后竞争。
async function snapshot(env, agg) {
  const pv = parseInt((await env.COUNTER.get('pv')) || '0', 10) || 0;
  const uv = parseInt((await env.COUNTER.get('uv:total')) || '0', 10) || 0;
  const cities = topCities(agg, Infinity);
  return { pv, uv, cityCount: cities.length, topCities: cities.slice(0, 8) };
}

async function handleHit(request, env, cors) {
  const cf = request.cf || {};
  const country = typeof cf.country === 'string' ? cf.country : 'XX';
  const city = typeof cf.city === 'string' ? cf.city : '';

  await bump(env, 'pv');

  // 城市级聚合：只累加计数，键名里不含任何访客标识
  const cityKey = city ? `${country}|${city}` : `${country}|`;
  const agg = await readCityAgg(env);
  agg[cityKey] = (parseInt(agg[cityKey], 10) || 0) + 1;
  await env.COUNTER.put(CITY_AGG_KEY, JSON.stringify(agg));

  // 独立访客去重：算一个含当日盐的哈希，只把哈希写进 KV。
  // IP 与 UA 在这个函数返回后即不再被引用。
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip) {
    const ua = request.headers.get('User-Agent') || '';
    const salt = await sha256hex(`${env.SALT_SECRET || 'engineer-ocean'}|${utcDay()}`);
    const visitorHash = (await sha256hex(`${ip}|${ua}|${salt}`)).slice(0, 32);
    const dedupeKey = `uv:${utcDay()}:${visitorHash}`;

    const seen = await env.COUNTER.get(dedupeKey);
    if (!seen) {
      await env.COUNTER.put(dedupeKey, '1', { expirationTtl: UV_TTL_SECONDS });
      await bump(env, 'uv:total');
    }
  }

  // 顺带把数字回给前端：省掉第二次往返，也避免两次请求落在不同机房时的时序差。
  const stats = await snapshot(env, agg);
  return json(Object.assign({ ok: true }, stats), cors);
}

async function handleStats(env, cors) {
  const agg = await readCityAgg(env);
  return json(await snapshot(env, agg), cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/hit' && request.method === 'POST') {
        return await handleHit(request, env, cors);
      }
      if (url.pathname === '/stats' && request.method === 'GET') {
        return await handleStats(env, cors);
      }
      if (url.pathname === '/') {
        return json(
          {
            service: 'site visit counter',
            collects: ['总访问量', '独立访客（按日去重）', '城市级聚合计数'],
            does_not_collect: ['原始 IP', 'User-Agent', '可跨天关联的访客标识'],
            endpoints: { 'POST /hit': '记录一次访问', 'GET /stats': '读取聚合统计' },
          },
          cors
        );
      }
      return json({ error: 'not found' }, cors, 404);
    } catch (err) {
      return json({ error: String(err) }, cors, 500);
    }
  },
};
