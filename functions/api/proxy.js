// functions/api/proxy.js
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }

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

    // 降雨 API：缓存 key 固定为域名级别，不随 URL 时间戳变化
    // 这样 script.js 每次加 &_=123456 都能命中同一份冷却缓存
    const cacheKeyStr = isRainApi ? "domain:wx.121.com.cn" : targetUrl;
    const cacheKey = new Request(cacheKeyStr);

    if (isRainApi && request.method === "GET") {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const expires = cached.headers.get("X-Cache-Expires");
        const now = Date.now();

        // 3 分钟冷却期内：直接返回缓存，不碰源站
        if (expires && parseInt(expires) > now) {
          return new Response(cached.body, {
            status: cached.status,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "X-Cache": "HIT",
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
              "Pragma": "no-cache",
              "Expires": "0",
            }
          });
        }

        // 已过期：删除缓存，准备用新 URL 穿透源站
        await cache.delete(cacheKey);
      }
    }

    // 转发请求到目标服务器（targetUrl 带时间戳，源站视为新请求）
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

    // 降雨 API：写入缓存（key 固定为域名，3 分钟 TTL）
    if (isRainApi && request.method === "GET" && response.status === 200) {
      const cacheHeaders = new Headers();
      cacheHeaders.set("Content-Type", response.headers.get("Content-Type") || "application/json");
      cacheHeaders.set("X-Cache-Expires", (Date.now() + 180000).toString());

      const cacheResponse = new Response(bodyText, {
        status: response.status,
        headers: cacheHeaders
      });

      await cache.put(cacheKey, cacheResponse);
    }

    // 返回给浏览器（禁止浏览器本地缓存）
    return new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      }
    });

  } catch (e) {
    return new Response("Proxy Error: " + e.message, { status: 500 });
  }
}