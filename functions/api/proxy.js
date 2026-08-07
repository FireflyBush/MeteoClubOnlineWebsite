// functions/api/proxy.js
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }

  // 处理浏览器 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      }
    });
  }

  try {
    const cache = caches.default;
    const isRainApi = targetUrl.includes('wx.121.com.cn');

    // 降雨 API：先查 Edge 全局缓存
    if (isRainApi && request.method === "GET") {
      const cached = await cache.match(new Request(targetUrl));
      if (cached) {
        const resp = new Response(cached.body, cached);
        resp.headers.set("Access-Control-Allow-Origin", "*");
        resp.headers.set("X-Cache", "HIT");
        return resp;
      }
    }

    // 构造更真实的浏览器请求头
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://wx.121.com.cn/',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
      redirect: 'follow',
    });

    const bodyText = await response.text();
    const clientResponse = new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    clientResponse.headers.set("Access-Control-Allow-Origin", "*");
    clientResponse.headers.delete("Content-Security-Policy");

    // 禁止浏览器本地缓存，确保用户每次刷新都向 Cloudflare 请求
    clientResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    clientResponse.headers.set("Pragma", "no-cache");
    clientResponse.headers.set("Expires", "0");

    // 降雨 API：写入 Edge 全局缓存，强制 3 分钟 TTL
    if (isRainApi && request.method === "GET" && response.status === 200) {
      const toCache = new Response(bodyText, {
        status: response.status,
        headers: new Headers(clientResponse.headers)
      });
      toCache.headers.set("Cache-Control", "public, max-age=240");
      toCache.headers.delete("Set-Cookie");
      await cache.put(new Request(targetUrl), toCache);
    }

    return clientResponse;

  } catch (e) {
    return new Response("Proxy Error: " + e.message, { status: 500 });
  }
}