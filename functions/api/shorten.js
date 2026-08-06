function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getTinyUrlError(data, status) {
  const message = data?.errors?.[0]?.message
    || data?.error?.message
    || data?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : `TinyURL API 錯誤（HTTP ${status}）`;
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!isHttpUrl(url)) {
    return jsonResponse({ error: "無效的分享網址" }, 400);
  }

  const apiToken = typeof context.env.TINYURL_API_TOKEN === "string"
    ? context.env.TINYURL_API_TOKEN.trim()
    : "";
  if (!apiToken) {
    return jsonResponse({ error: "尚未設定 Cloudflare 加密變數：TINYURL_API_TOKEN" }, 503);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://api.tinyurl.com/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        url,
        domain: "tinyurl.com",
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return jsonResponse({ error: getTinyUrlError(data, response.status) }, response.status);
    }

    const shortUrl = data?.data?.tiny_url;
    if (typeof shortUrl !== "string" || !/^https:\/\/(?:www\.)?tinyurl\.com\/[A-Za-z0-9_-]+$/i.test(shortUrl)) {
      return jsonResponse({ error: "TinyURL API 未回傳有效的短網址" }, 502);
    }

    return jsonResponse({ shortUrl, provider: "tinyurl" });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "TinyURL API 連線逾時"
      : "目前無法連線 TinyURL API";
    return jsonResponse({ error: message }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}
