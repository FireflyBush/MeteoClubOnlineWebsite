// functions/api/models-proxy.js —— 模式对比页专用代理（10 分钟边缘缓存）
const ALLOWED_DOMAIN = 'api.open-meteo.com';
const ALLOWED_ORIGIN = 'https://smc-club.pages.dev';
const ALLOWED_DOMAIN = 'geocoding-api.open-meteo.com';
const TTL_MS = 10 * 60 * 1000;

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('missing url', { status: 400 });

  let t; try { t = new URL(targetUrl); } catch { return new Response('bad url', { status: 400 }); }
  if (t.hostname !== ALLOWED_DOMAIN) return new Response('forbidden', { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });

  const cache = caches.default;
  // 缓存 key 含完整 query，不同要素/天数/单位各自独立缓存，互不污染
  const cacheKey = new Request(`https://internal.cache/models?${t.search}`);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const expires = +cached.headers.get('X-Cache-Expires') || 0;
    if (expires > Date.now()) {
      const h = new Headers();
      h.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      h.set('Content-Type', 'application/json');
      h.set('X-Cache', 'HIT');
      return new Response(cached.body, { status: 200, headers: h });
    }
    await cache.delete(cacheKey);
  }

  const upstream = await fetch(t.toString(), { headers: { 'User-Agent': 'SMC-Club-WeatherStack/1.0' } });
  const body = await upstream.text();

  if (upstream.status === 200) {
    const ch = new Headers();
    ch.set('Content-Type', 'application/json');
    ch.set('X-Cache-Expires', String(Date.now() + TTL_MS));
    waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers: ch })));
  }

  const h = new Headers();
  h.set('Access-Cache-Control', 'no-store');
  h.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  h.set('Content-Type', 'application/json');
  return new Response(body, { status: upstream.status, headers: h });
}
