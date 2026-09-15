const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function onRequest(context) {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return jsonError("只支援 GET／HEAD", 405);
  }

  const requestedUrl = new URL(context.request.url).searchParams.get("url") || "";
  let upstreamUrl;
  try {
    upstreamUrl = new URL(requestedUrl);
  } catch {
    return jsonError("無效的媒體網址", 400);
  }
  if (!isSafePublicUrl(upstreamUrl)) return jsonError("不允許代理此網址", 400);

  const requestHeaders = new Headers({
    "Accept": "audio/*,video/*;q=0.9,*/*;q=0.1",
  });
  const range = context.request.headers.get("Range");
  if (range) requestHeaders.set("Range", range);

  let response;
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      response = await fetch(upstreamUrl.toString(), {
        method: context.request.method,
        headers: requestHeaders,
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("Location");
      if (!location || redirect === MAX_REDIRECTS) return jsonError("媒體網址重新導向次數過多", 502);
      upstreamUrl = new URL(location, upstreamUrl);
      if (!isSafePublicUrl(upstreamUrl)) return jsonError("媒體重新導向至不允許的網址", 400);
    }
  } catch {
    return jsonError("目前無法讀取遠端媒體", 502);
  }

  if (!response || (!response.ok && response.status !== 206)) {
    return jsonError(`遠端媒體回傳 HTTP ${response?.status || 502}`, response?.status === 404 ? 404 : 502);
  }

  const contentType = (response.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    return jsonError("網址回傳的內容不是音訊或影片", 415);
  }

  const contentRange = response.headers.get("Content-Range") || "";
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1]);
  const contentLength = Number(response.headers.get("Content-Length"));
  const totalBytes = Number.isFinite(rangeTotal) && rangeTotal > 0 ? rangeTotal : contentLength;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return jsonError("無法確認遠端媒體大小，為安全起見不予代理", 411);
  }
  if (totalBytes > MAX_MEDIA_BYTES) return jsonError("媒體檔案超過 50 MB，無法使用音量增益代理", 413);

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400",
    "Accept-Ranges": response.headers.get("Accept-Ranges") || "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(context.request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers,
  });
}

function isSafePublicUrl(url) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") return false;
  if (host.includes(":")) return false;
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
  }
  return true;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
