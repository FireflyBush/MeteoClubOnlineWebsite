// netlify/edge-functions/proxy.js —— 降雨 API 代理（Netlify Edge，全局 3 分钟冷却）
// const ALLOWED_URL = 'https://wx.121.com.cn/xxxxx?xxxxx';   // 【必改】钉死的完整 URL

const ALLOWED_DOMAINS = new Set([
  'wx.121.com.cn',
//  'geocoding-api.open-meteo.com',
]);

const ALLOWED_ORIGINS = new Set([
  'https://meteoszshs.netlify.app',      // 【必改】
  // 'https://smc-club.pages.dev',
]);

const TTL = 180;

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
  if (t.toString() !== ALLOWED_URL) return new Response('forbidden', { status: 403 });

  try {
    const response = await fetch(t.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://wx.121.com.cn/',
      },
      redirect: 'follow',
    });
    const bodyText = await response.text();

    const h = corsHeaders(request);
    h.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    h.set('Cache-Control', 'no-store');   // 浏览器每次都过代理，冷却由 CDN 层负责
    if (response.status === 200) {
      h.set('Netlify-CDN-Cache-Control', `public, s-maxage=${TTL}, stale-while-revalidate=30`);
    }
    return new Response(bodyText, { status: response.status, headers: h });
  } catch (e) {
    console.error('Proxy Error:', e.message);
    return new Response('internal server error', { status: 500 });
  }
};

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const h = new Headers();
  if (ALLOWED_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    h.set('Access-Control-Max-Age', '86400');
    h.set('Vary', 'Origin');
  }
  return h;
}
