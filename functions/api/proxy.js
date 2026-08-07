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
    const cacheKey = new Request(targetUrl);

    // 降雨 API：先查 Edge 全局缓存
    if (isRainApi && request.method === "GET") {
      const cached = await cache.match(cacheKey);
      if (cached) {
<<<<<<< HEAD
        const expires = cached.headers.get("X-Cache-Expires");
        const now = Date.now();

        // 缓存未过期（3 分钟内）
        if (expires && parseInt(expires) > now) {
          // 用新 Response 包装，避免修改原始缓存对象
          const newHeaders = new Headers(cached.headers);
          newHeaders.set("Access-Control-Allow-Origin", "*");
          newHeaders.set("X-Cache", "HIT");
          // 关键：浏览器仍然不缓存，确保下次刷新还会向 Cloudflare 发请求
          newHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          newHeaders.set("Pragma", "no-cache");
          newHeaders.set("Expires", "0");

          return new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: newHeaders
          });
        }

        // 已过期：显式删除，穿透到源站
        await cache.delete(cacheKey);
=======
        // 关键修复：手动检查 TTL，因为 cache.match() 不自动过期
        const expires = cached.headers.get("X-Cache-Expires");
        const now = Date.now();
        if (expires && parseInt(expires) > now) {
          // 缓存有效
          const resp = new Response(cached.body, cached);
          resp.headers.set("Access-Control-Allow-Origin", "*");
          resp.headers.set("X-Cache", "HIT");
          resp.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          resp.headers.set("Pragma", "no-cache");
          resp.headers.set("Expires", "0");
          return resp;
        } else {
          // 缓存已过期，显式删除
          await cache.delete(cacheKey);
        }
      }
    }

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
    clientResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    clientResponse.headers.set("Pragma", "no-cache");
    clientResponse.headers.set("Expires", "0");

    // 降雨 API：写入 Edge 全局缓存，附加显式过期时间戳
    if (isRainApi && request.method === "GET" && response.status === 200) {
      const expireAt = Date.now() + 180000; // 当前时间 + 180秒
      const toCache = new Response(bodyText, {
        status: response.status,
        headers: new Headers(clientResponse.headers)
      });
      toCache.headers.set("Cache-Control", "public, max-age=180");
      toCache.headers.set("X-Cache-Expires", expireAt.toString());
      toCache.headers.delete("Set-Cookie");
      await cache.put(cacheKey, toCache);
    }

    return clientResponse;

  } catch (e) {
    return new Response("Proxy Error: " + e.message, { status: 500 });
  }
}
        resp.headers.set("Expires", "0");
        return resp;
>>>>>>> 457af81af306e6b1d37a47c505ad7be5ef308522
      }
    }

    // 转发请求到目标服务器
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

    // 降雨 API：写入 Edge 缓存（独立构造，只存必要头）
    if (isRainApi && request.method === "GET" && response.status === 200) {
      const cacheHeaders = new Headers();
      cacheHeaders.set("Content-Type", response.headers.get("Content-Type") || "application/json");
      cacheHeaders.set("Cache-Control", "public, max-age=180");
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
