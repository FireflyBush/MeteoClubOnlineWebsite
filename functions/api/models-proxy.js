// functions/api/models-proxy.js —— 模式对比页专用代理（确定性 10 分钟时间桶缓存）
//
// 缓存设计：
//   bucket = floor(now / 600000) —— 每 10 分钟自增的整数
//   · 同一窗口内：所有用户的相同 URL → 相同 _ts → 相同 cacheKey → 共享同一条全局缓存
//   · 窗口切换后：bucket+1 → cacheKey 变化 → 天然 MISS → 带 _ts 回源拉新数据
//   · 旧条目由 Cache-Control: max-age=600 交给 CF 自动驱逐，全程无需 cache.delete
//
// 上游 URL 附加 _ts=<bucket>：对 open-meteo 是无害参数（返回数据不变），
//   仅用于区分窗口，规避上游/中间层超出 10 分钟的隐性缓存。

const ALLOWED_DOMAINS = new Set([
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',   // 位置搜索（Geocoding API），之前 403 就差这一条
]);
const ALLOWED_ORIGIN = 'https://smc-club.pages.dev';
const TTL_MS = 10 * 60 * 1000;

export async function onRequest(context) {
  const { request, waitUntil } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }});
  if (request.method !== 'GET')
    return new Response('method not allowed', { status: 405 });

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('missing url', { status: 400 });

  let t;
  try { t = new URL(targetUrl); } catch { return new Response('bad url', { status: 400 }); }
  if (!ALLOWED_DOMAINS.has(t.hostname)) return new Response('forbidden', { status: 403 });

  // ---- 确定性时间桶：窗口内恒定，跨窗口自动轮换 ----
  const bucket = Math.floor(Date.now() / TTL_MS);

  // ---- 上游 URL：附加 _ts（同窗口内所有用户得到相同值）----
  const upstream = new URL(t.toString());
  upstream.searchParams.set('_ts', String(bucket));

  // ---- cacheKey：上游完整路径 + query（含 _ts 桶）----
  // 注意必须包含 pathname：否则三个 meta.json（query 均为空）会撞同一个 key
  const cache = caches.default;
  const cacheKey = new Request('https://internal.cache/models' + upstream.pathname + upstream.search);

  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Content-Type': 'application/json',
  };

  const cached = await cache.match(cacheKey);
  if (cached) {
    const h = new Headers(cors);
    h.set('X-Cache', 'HIT');
    h.set('Cache-Control', 'no-store');   // 浏览器不缓存，统一由边缘层管理
    return new Response(cached.body, { status: 200, headers: h });
  }

  const resp = await fetch(upstream.toString(), {
    headers: { 'User-Agent': 'SMC-Club-WeatherStack/1.0' },
  });
  const body = await resp.text();

  if (resp.ok) {
    // 写入缓存的副本带 10 分钟 TTL，与桶周期对齐；桶切换后 key 变化，旧条目自然失效
    const ch = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${TTL_MS / 1000}`,
    });
    waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers: ch })));
  }

  const h = new Headers(cors);
  h.set('X-Cache', 'MISS');
  h.set('Cache-Control', 'no-store');
  return new Response(body, { status: resp.status, headers: h });
}
