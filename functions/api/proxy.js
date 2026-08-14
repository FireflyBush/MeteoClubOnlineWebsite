// functions/api/proxy.js

// 安全配置：域名白名单，只允许代理指定的域名
const ALLOWED_DOMAINS = ['wx.121.com.cn'];
// CORS 配置：建议修改为您的前端实际域名，避免被恶意调用
const ALLOWED_ORIGIN = 'smc-club.pages.dev'; // 如：'https://your-frontend.com'

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  // 1. 基础参数校验
  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }

  // 2. 【关键修复】SSRF 防护：严格限制目标域名
  // 解析目标 URL 并检查是否在白名单内
  let targetObj;
  try {
    targetObj = new URL(targetUrl);
  } catch (e) {
    return new Response('Invalid URL format', { status: 400 });
  }

  if (!ALLOWED_DOMAINS.includes(targetObj.hostname)) {
    return new Response('Forbidden: Target domain not allowed', { status: 403 });
  }

  // 3. 处理 OPTIONS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS", // 按需开放，建议限制方法
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      }
    });
  }

  // 4. 非 GET 请求直接拒绝（根据您的业务只需 GET 获取数据）
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const cache = caches.default;
    // 保留原有逻辑：固定缓存 Key 实现全局冷却
    const cacheKey = new Request("https://internal.cache/rain-api-cooldown");
    const cached = await cache.match(cacheKey);

    // 检查缓存是否在有效期内
    if (cached) {
      const expires = cached.headers.get("X-Cache-Expires");
      const now = Date.now();
      
      // 3 分钟冷却期内：直接返回缓存
      if (expires && parseInt(expires) > now) {
        const hitHeaders = new Headers();
        hitHeaders.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
        hitHeaders.set("X-Cache", "HIT");
        hitHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
        const ct = cached.headers.get("Content-Type");
        if (ct) hitHeaders.set("Content-Type", ct);
        return new Response(cached.body, { status: cached.status, headers: hitHeaders });
      }
      // 已过期：删除旧缓存
      await cache.delete(cacheKey);
    }

    // 5. 转发请求到目标服务器
    // 注意：保留了您原有的请求头伪装逻辑，适配降雨 API 的反爬策略
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://wx.121.com.cn/',
      },
      redirect: 'follow',
    });

    const bodyText = await response.text();

    // 6. 写入全局缓存（仅当请求成功时）
    if (response.status === 200) {
      const cacheHeaders = new Headers();
      const ct = response.headers.get("Content-Type");
      cacheHeaders.set("Content-Type", ct || "application/json");
      // 设置 3 分钟过期时间戳
      cacheHeaders.set("X-Cache-Expires", (Date.now() + 180000).toString());
      
      const cacheResponse = new Response(bodyText, {
        status: response.status,
        headers: cacheHeaders
      });
      // 异步写入缓存，不阻塞响应
      context.waitUntil(cache.put(cacheKey, cacheResponse));
    }

    // 7. 返回给浏览器
    const browserHeaders = new Headers();
    browserHeaders.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    browserHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
    browserHeaders.set("Pragma", "no-cache");
    browserHeaders.set("Expires", "0");
    
    const respCT = response.headers.get("Content-Type");
    if (respCT) browserHeaders.set("Content-Type", respCT);

    return new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: browserHeaders
    });

  } catch (e) {
    // 【安全修复】隐藏详细错误信息，防止泄露内部架构
    // 仅在服务端日志记录详细错误，返回给用户通用错误
    console.error("Proxy Error:", e.message); 
    return new Response("Internal Server Error", { status: 500 });
  }
}
