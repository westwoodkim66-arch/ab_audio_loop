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

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const longUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!isHttpUrl(longUrl)) {
    return jsonResponse({ error: "無效的分享網址" }, 400);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    // 使用 TinyURL 舊版免 Token 端點。encodeURIComponent 只用在送往
    // TinyURL 的 query string，不會改寫實際要分享的 AB Loop 網址。
    const endpoint = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Accept": "text/plain",
      },
      signal: controller.signal,
    });

    const responseText = (await response.text()).trim();
    if (!response.ok) {
      return jsonResponse({ error: `TinyURL API 錯誤（HTTP ${response.status}）` }, 502);
    }

    if (!/^https?:\/\/(?:www\.)?tinyurl\.com\/[A-Za-z0-9_-]+\/?$/i.test(responseText)) {
      const detail = responseText && responseText.length <= 120
        ? `：${responseText}`
        : "";
      return jsonResponse({ error: `TinyURL 未回傳有效的短網址${detail}` }, 502);
    }

    return jsonResponse({ shortUrl: responseText, provider: "tinyurl-legacy" });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "TinyURL API 連線逾時"
      : "目前無法連線 TinyURL API";
    return jsonResponse({ error: message }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}
