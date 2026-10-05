// netlify/edge-functions/proxy.js —— 降雨 API 中继代理
//
// 架构：浏览器(校园网) → Netlify → Cloudflare Pages /api/proxy → wx.121.com.cn
//   · 校园网无法解析 *.pages.dev，但 Netlify 服务器可以 → 由本函数代为拉取
//   · wx.121.com.cn 对 Cloudflare 出口友好、对 Netlify 出口不友好
//     → 借道 Cloudflare 的已验证链路，中继本身不直接碰上游
//   · 3 分钟单槽冷却由 Cloudflare 端的固定 cacheKey 负责，本端只做中继 + 缓存加速
//
// ⚠️ Cloudflare 端 proxy.js 的 ALLOWED_DOMAINS 必须仍含 'wx.121.com.cn'
//    （服务端 fetch 无 Origin 头，CF 的 CORS 白名单不影响本中继）

const CF_PROXY = 'https://smc-club.pages.dev/api/proxy';
const ALLOWED_HOST = 'wx.121.com.cn';     // 本端仍做轻量校验，防止被当开放中继滥用

const ALLOWED_ORIGINS = new Set([
  'https://meteoszshs.netlify.app',
  // 'https://smc-club.pages.dev',
]);

export default async (request) => {
  try {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== 'GET')
      return new Response('method not allowed', { status: 405 });

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) return new Response('missing url', { status: 400 });

    let t;
    try { t = new URL(targetUrl); }
    catch { return new Response('bad url', { status: 400 }); }

    // 轻量校验：域名 + 路径即可（签名的有效性由上游和 CF 端把关）
    if (t.hostname !== ALLOWED_HOST || t.pathname !== '/Mobile/LdService/position')
      return new Response('forbidden', { status: 403 });

    const t0 = Date.now();
    // 关键：目标 URL 本身已含 %2F 等编码序列，转发前必须重新 encodeURIComponent，
    // 否则 CF 端 searchParams.get('url') 会拿到残缺值
    const relayUrl = `${CF_PROXY}?url=${encodeURIComponent(t.toString())}`;

    const response = await fetch(relayUrl, {
      headers: { 'User-Agent': 'SMC-Club-WeatherStack/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),   // CF 端 + 上游的链路预算，低于平台时限
    });
    const bodyText = await response.text();

    const h = corsHeaders(request);
    h.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    h.set('Cache-Control', 'no-store');
    h.set('X-Relay-Status', String(response.status));
    h.set('X-Relay-Ms', String(Date.now() - t0));

    if (response.status === 200) {
      // Netlify CDN 按本函数请求 URL 缓存 180s：会话内恒定 URL 时命中，
      // 即使未命中，CF 端的单槽冷却也保证了全局每 3 分钟最多一次真实回源
      h.set('Netlify-CDN-Cache-Control', 'public, s-maxage=180, stale-while-revalidate=30');
    } else {
      h.set('Netlify-CDN-Cache-Control', 'no-store');
    }
    return new Response(bodyText, { status: response.status, headers: h });

  } catch (e) {
    console.error('Relay Error:', e.name, e.message);
    const status = (e.name === 'TimeoutError' || e.name === 'AbortError') ? 504 : 500;
    return new Response(`relay error: ${e.name}`, { status });
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
