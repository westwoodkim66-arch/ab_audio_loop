export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const videoUrl = searchParams.get("url") || "";
  const match = videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^&?#]+)/);
  const videoId = match?.[1];
  if (!videoId) return jsonResponse({ error: "無效的 YouTube 網址" }, 400);

  for (const lang of ["ja", "en", "zh-Hant", "zh-Hans"]) {
    const res = await fetch(`https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=json3`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).catch(() => null);
    if (!res?.ok) continue;
    const data = await res.json().catch(() => null);
    const transcript = (data?.events?.filter((e) => e.segs) ?? [])
      .map((e) => ({ text: e.segs.map((s) => s.utf8 ?? "").join("").trim(), offset: e.tStartMs ?? 0, duration: e.dDurationMs ?? 2000 }))
      .filter((t) => t.text.length > 0);
    if (transcript.length > 0) return jsonResponse(transcript);
  }
  return jsonResponse({ error: "找不到可用字幕" }, 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}