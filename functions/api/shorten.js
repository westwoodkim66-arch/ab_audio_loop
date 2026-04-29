export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const longUrl = body?.url || "";
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
    const shortUrl = await res.text();
    if (shortUrl.startsWith("http")) return new Response(shortUrl, { status: 200 });
  } catch {}
  return new Response(longUrl, { status: 200 }); // fallback 回原始長網址
}