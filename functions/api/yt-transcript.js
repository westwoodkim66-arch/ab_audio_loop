const SUPADATA_BASE_URL = "https://api.supadata.ai/v1/transcript";

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrl = searchParams.get("url") || "";
  const jobId = searchParams.get("jobId") || "";
  const apiKey = context.env?.SUPADATA_API_KEY;

  if (!apiKey) {
    return jsonResponse({
      error: "SUPADATA_NOT_CONFIGURED",
      message: "字幕服務尚未設定，請在 Cloudflare 加入 SUPADATA_API_KEY。",
    }, 503);
  }

  if (jobId) {
    if (jobId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(jobId)) {
      return jsonResponse({ error: "INVALID_JOB_ID", message: "無效的字幕工作編號。" }, 400);
    }
    return fetchSupadata(`${SUPADATA_BASE_URL}/${encodeURIComponent(jobId)}`, apiKey);
  }

  if (!isYoutubeUrl(videoUrl)) {
    return jsonResponse({ error: "INVALID_YOUTUBE_URL", message: "請先載入有效的 YouTube 網址。" }, 400);
  }

  const endpoint = new URL(SUPADATA_BASE_URL);
  endpoint.searchParams.set("url", videoUrl);
  endpoint.searchParams.set("mode", "native");
  return fetchSupadata(endpoint.toString(), apiKey);
}

async function fetchSupadata(endpoint, apiKey) {
  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json",
      },
    });
  } catch {
    return jsonResponse({
      error: "TRANSCRIPT_SERVICE_UNAVAILABLE",
      message: "目前無法連線字幕服務，請稍後再試。",
    }, 502);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const mapped = mapSupadataError(response.status, data);
    return jsonResponse(mapped.body, mapped.status);
  }

  if (response.status === 202 || data?.jobId) {
    return jsonResponse({
      status: data?.status || "queued",
      jobId: data?.jobId,
    }, 202);
  }

  if (data?.status === "queued" || data?.status === "active") {
    return jsonResponse({ status: data.status }, 202);
  }

  if (data?.status === "failed") {
    return jsonResponse({
      error: "TRANSCRIPT_JOB_FAILED",
      message: data?.error?.message || data?.error?.details || "字幕處理失敗，請稍後再試。",
    }, 502);
  }

  const transcript = normalizeTranscript(data?.content);
  if (transcript.length === 0) {
    return jsonResponse({
      error: "NO_CAPTIONS",
      message: "這部影片沒有可用的 YouTube 字幕。",
    }, 404);
  }

  return jsonResponse({
    transcript,
    language: data?.lang || transcript[0]?.lang || "",
    availableLanguages: Array.isArray(data?.availableLangs) ? data.availableLangs : [],
    provider: "supadata",
  });
}

function normalizeTranscript(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text.trim() : "",
      offset: Number.isFinite(Number(item?.offset)) ? Number(item.offset) : 0,
      duration: Number.isFinite(Number(item?.duration)) ? Number(item.duration) : 2000,
      lang: typeof item?.lang === "string" ? item.lang : "",
    }))
    .filter((item) => item.text.length > 0);
}

function mapSupadataError(status, data) {
  const upstreamMessage = data?.message || data?.details;
  if (status === 401) {
    return { status: 503, body: { error: "SUPADATA_AUTH_ERROR", message: "字幕服務金鑰無效，請重新設定 SUPADATA_API_KEY。" } };
  }
  if (status === 402) {
    return { status: 402, body: { error: "SUPADATA_PAYMENT_REQUIRED", message: "字幕服務目前沒有可用額度，請檢查 Supadata 方案。" } };
  }
  if (status === 404) {
    return { status: 404, body: { error: "NO_CAPTIONS", message: "這部影片沒有可用的 YouTube 字幕。" } };
  }
  if (status === 429) {
    return { status: 429, body: { error: "SUPADATA_RATE_LIMITED", message: "字幕讀取次數暫時達到上限，請稍後再試。" } };
  }
  return {
    status: status >= 500 ? 502 : 400,
    body: {
      error: "TRANSCRIPT_SERVICE_ERROR",
      message: upstreamMessage || "字幕服務無法處理這部影片。",
    },
  };
}

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
