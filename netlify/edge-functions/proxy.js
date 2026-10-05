// netlify/edge-functions/proxy.js —— 降雨 API 代理（Netlify Edge，3 分钟冷却）
//
// 白名单策略：域名 + 精确路径 + 必要参数存在性
//   · 上游 URL 的 sign（签名）与 _（时间戳）逐请求变化，完整 URL 无法钉死，
//     只锁定 hostname + pathname；签名有效性由上游自行校验
//   · 整个 handler 包裹 try/catch：任何异常返回带信息的 500，不再触发
//     "uncaught exception during edge function invocation"

const ALLOWED_HOST = 'wx.121.com.cn';
const ALLOWED_PATH = '/Mobile/LdService/position';

const ALLOWED_ORIGINS = new Set([
  'https://meteoszshs.netlify.app',
  // 'https://smc-club.pages.dev',   // 多平台并存期可保留
]);

const TTL = 180;

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

    // 白名单：Set 用 .has()（不是 .includes！）；sign/_ 每次都变，只要求存在
    if (
      t.hostname !== ALLOWED_HOST ||
      t.pathname !== ALLOWED_PATH ||
      !t.searchParams.get('latitude') ||
      !t.searchParams.get('longitude') ||
      !t.searchParams.get('sign')
    ) {
      return new Response('forbidden', { status: 403 });
    }

    // 伪装请求头原样保留，适配降雨 API 的反爬策略
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
    h.set('Cache-Control', 'no-store');          // 浏览器每次都过代理，冷却由 CDN 层负责
    h.set('X-Upstream-Status', String(response.status));   // 调试用：看上游真实状态
    if (response.status === 200) {
      h.set('Netlify-CDN-Cache-Control', `public, s-maxage=${TTL}, stale-while-revalidate=30`);
    } else {
      // 非 200 不写 CDN 缓存头，避免风控页被冻结 3 分钟
      h.set('Netlify-CDN-Cache-Control', 'no-store');
    }
    return new Response(bodyText, { status: response.status, headers: h });

  } catch (e) {
    // 兜底：调试期把错误信息带回前端方便定位，稳定后改回纯 'internal server error'
    console.error('Proxy Error:', e.message);
    return new Response('internal server error: ' + e.message, { status: 500 });
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
