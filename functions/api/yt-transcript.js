const SUPADATA_BASE_URL = "https://api.supadata.ai/v1/transcript";

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  let videoUrl = searchParams.get("url") || "";
  const jobId = searchParams.get("jobId") || "";
  const requestedMode = searchParams.get("mode") || "native";
  const mode = ["native", "auto", "generate"].includes(requestedMode) ? requestedMode : "native";
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

  if (!isAllowedMediaUrl(videoUrl, mode)) {
    return jsonResponse({
      error: "INVALID_MEDIA_URL",
      message: mode === "native" ? "原生字幕只支援 YouTube 網址。" : "請載入有效的公開影片或音檔網址。",
    }, 400);
  }

  const normalized = normalizeMediaUrl(videoUrl);
  if (normalized.error) return jsonResponse({ error: "UNSUPPORTED_MEDIA_URL", message: normalized.error }, 400);
  videoUrl = normalized.url;

  const endpoint = new URL(SUPADATA_BASE_URL);
  endpoint.searchParams.set("url", videoUrl);
  endpoint.searchParams.set("mode", mode);
  endpoint.searchParams.set("text", "false");
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
      message: data?.error?.details || data?.error?.message || "字幕處理失敗，請稍後再試。",
    }, 502);
  }

  const result = data?.result || data;
  const transcript = normalizeTranscript(result?.content);
  if (transcript.length === 0) {
    return jsonResponse({
      error: "NO_CAPTIONS",
      message: "這部影片沒有可用的 YouTube 字幕。",
    }, 404);
  }

  return jsonResponse({
    transcript,
    language: result?.lang || transcript[0]?.lang || "",
    availableLanguages: Array.isArray(result?.availableLangs) ? result.availableLangs : [],
    provider: "supadata",
    mode: data?.mode || "",
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
  const detail = typeof data?.details === "string" ? data.details : "";
  const message = typeof data?.message === "string" ? data.message : "";
  const upstreamMessage = detail || message;
  if (status === 400 || data?.error === "invalid-request") {
    return { status: 400, body: {
      error: "INVALID_TRANSCRIPT_REQUEST",
      message: `字幕服務拒絕這個來源：${(upstreamMessage || "網址或請求參數無效").slice(0, 500)}。請確認是公開影片網址；也可上傳音檔，以免費 Whisper 辨識。`,
    } };
  }
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

function isAllowedMediaUrl(value, mode) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isYoutube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
    return mode === "native" ? isYoutube : true;
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

function normalizeMediaUrl(value) {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const youtube = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")
    || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
  if (youtube) {
    const id = host === "youtu.be" ? url.pathname.split("/")[1]
      : url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { error: "請使用單支 YouTube 影片的分享網址，不能使用頻道或播放清單網址。" };
    return { url: `https://www.youtube.com/watch?v=${id}` };
  }
  const matches = domain => host === domain || host.endsWith(`.${domain}`);
  if (["dailymotion.com", "dai.ly", "vimeo.com", "twitch.tv"].some(matches)) {
    return { error: "雲端字幕服務不接受此平台的影片頁面網址。請按「匯入影片／音軌辨識」選取同一影片的完整 MP4 或音檔，以免費 Whisper 產生字幕與時間軸並保留影片播放；也可匯入 SRT／VTT。" };
  }
  url.hash = "";
  return { url: url.toString() };
}
