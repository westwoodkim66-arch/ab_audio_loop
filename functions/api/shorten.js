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

  try {
    // is.gd 會建立直接重新導向的短網址，不會顯示 TinyURL 的確認頁。
    const res = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`,
      {
        headers: {
          Accept: "text/plain",
          "User-Agent": "AB-Loop-Link-Shortener/1.0",
        },
      },
    );

    if (res.ok) {
      const shortUrl = (await res.text()).trim();
      if (shortUrl.startsWith("https://is.gd/")) {
        return new Response(shortUrl, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }
  } catch {
    // 短網址服務暫時不可用時，仍讓使用者取得可分享的原始網址。
  }

  return new Response(longUrl, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
