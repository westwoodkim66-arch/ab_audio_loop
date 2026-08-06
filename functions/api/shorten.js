export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const longUrl = typeof body?.url === "string" ? body.url.trim() : "";

  // 只允許一般網頁網址，避免把無效內容送到短網址服務。
  try {
    const parsedUrl = new URL(longUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return new Response(longUrl, { status: 200 });
    }
  } catch {
    return new Response(longUrl, { status: 200 });
  }

  const requestShortUrl = async (endpoint, expectedPrefix) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(
        `${endpoint}${encodeURIComponent(longUrl)}`,
        {
          headers: {
            Accept: "text/plain",
            "User-Agent": "AB-Loop-Link-Shortener/1.1",
          },
          signal: controller.signal,
        },
      );

      if (!res.ok) return "";

      const shortUrl = (await res.text()).trim();
      return shortUrl.startsWith(expectedPrefix) ? shortUrl : "";
    } catch {
      return "";
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // 第一順位使用 is.gd。其 API 偶爾會回傳 HTTP 200，但內容其實是
  // "Error, database insert failed"，因此不能只檢查 res.ok。
  let shortUrl = await requestShortUrl(
    "https://is.gd/create.php?format=simple&url=",
    "https://is.gd/",
  );

  // is.gd 暫時故障或限流時，改用同樣會直接 302 跳轉的 da.gd，
  // 避免畫面再次顯示原始長網址。
  if (!shortUrl) {
    shortUrl = await requestShortUrl(
      "https://da.gd/s?url=",
      "https://da.gd/",
    );
  }

  if (shortUrl) {
    return new Response(shortUrl, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(longUrl, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}