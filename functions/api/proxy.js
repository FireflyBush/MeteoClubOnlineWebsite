// functions/api/proxy.js
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response('Missing "url" parameter', { status: 400 });
  }

  try {
    const headers = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      redirect: 'follow',
    });

    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", "*");
    newResponse.headers.delete("Content-Security-Policy");
    return newResponse;
  } catch (e) {
    return new Response("Proxy Error: " + e.message, { status: 500 });
  }
}
