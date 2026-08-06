// 相容舊版前端的端點。
// 新版 App.tsx 已直接產生本站 /d、/y、/v 分享路徑，不再呼叫任何第三方短網址 API。
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
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!isHttpUrl(url)) {
    return textResponse("Invalid URL", 400);
  }

  // 不經過 Reurl、TinyURL、is.gd 或 da.gd，避免任何第三方確認頁。
  return textResponse(url);
}
