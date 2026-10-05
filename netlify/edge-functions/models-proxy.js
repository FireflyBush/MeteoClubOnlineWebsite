// netlify/edge-functions/models-proxy.js —— 模式对比页代理（Netlify Edge）
// 缓存：确定性时间桶 + Netlify-CDN-Cache-Control（CDN 按 URL 缓存 10 分钟）
const ALLOWED_DOMAINS = new Set([
  'api.open-meteo.com',
  'geocoding-api.open-meteo.com',
]);

const ALLOWED_ORIGINS = new Set([
  'https://meteoszshs.netlify.app',      // 【必改】实际 Netlify 域名
  // 'https://smc-club.pages.dev',     // 多平台并存期可保留
]);

const TTL_MS = 10 * 60 * 1000;

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return new Response('missing url', { status: 400 });

  let t;
  try { t = new URL(targetUrl); } catch { return new Response('bad url', { status: 400 }); }
  if (!ALLOWED_DOMAINS.has(t.hostname)) return new Response('forbidden', { status: 403 });

  const bucket = Math.floor(Date.now() / TTL_MS);
  const upstream = new URL(t.toString());
  upstream.searchParams.set('_ts', String(bucket));

  const resp = await fetch(upstream.toString(), {
    headers: { 'User-Agent': 'SMC-Club-WeatherStack/1.0' },
  });
  const body = await resp.text();

  const h = corsHeaders(request);
  h.set('Content-Type', 'application/json');
  h.set('Cache-Control', 'no-store');   // 浏览器不缓存，与 CF 版一致
  if (resp.ok) {
    // Netlify CDN 侧按 URL 缓存 10 分钟；桶号变化 → URL 变化 → 自动回源
    h.set('Netlify-CDN-Cache-Control', `public, s-maxage=${TTL_MS / 1000}, stale-while-revalidate=60`);
  }
  return new Response(body, { status: resp.status, headers: h });
};

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const h = new Headers();
  if (ALLOWED_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    h.set('Vary', 'Origin');
  }
  return h;
}
