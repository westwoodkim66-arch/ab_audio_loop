const REURL_API_ENDPOINT = "https://api.reurl.cc/shorten";
const REURL_SHORT_URL_PREFIX = "https://reurl.cc/";

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
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

  // 無效輸入不送往 Reurl，並維持前端原本「回傳原內容」的相容行為。
  if (!isHttpUrl(longUrl)) {
    return textResponse(longUrl);
  }

  // 請在 Cloudflare Pages 的環境變數中設定此金鑰，不要寫死在原始碼。
  const apiKey = String(context.env?.REURL_API_KEY || "").trim();
  if (!apiKey) {
    console.error("Reurl shortening skipped: REURL_API_KEY is not configured.");
    return textResponse(longUrl);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(REURL_API_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "reurl-api-key": apiKey,
      },
      body: JSON.stringify({ url: longUrl }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);
    const shortUrl = typeof data?.short_url === "string"
      ? data.short_url.trim()
      : "";

    // Reurl 成功時會回傳 res=success 與 short_url。
    if (
      response.ok &&
      data?.res === "success" &&
      shortUrl.startsWith(REURL_SHORT_URL_PREFIX) &&
      isHttpUrl(shortUrl)
    ) {
      return textResponse(shortUrl);
    }

    console.error("Reurl API rejected the shortening request.", {
      status: response.status,
      code: data?.code,
      message: data?.msg || data?.err,
    });
  } catch (error) {
    console.error(
      error?.name === "AbortError"
        ? "Reurl API request timed out."
        : "Reurl API request failed.",
      error,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Reurl 暫時不可用時，仍讓分享功能回傳原始網址，不再改用會跳確認頁的服務。
  return textResponse(longUrl);
}
