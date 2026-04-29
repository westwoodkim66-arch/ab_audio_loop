export async function onRequestPost(context) {
  const { request, env } = context;
  const API_KEY = env.GEMINI_API_KEY;
  if (!API_KEY) {
    return jsonResponse({ error: "伺服器未設定 GEMINI_API_KEY" }, 500);
  }

  const body = await request.json().catch(() => ({}));
  const { model = "gemini-2.5-flash", contents, config = {} } = body;

  let normalizedContents;
  if (typeof contents === "string") {
    normalizedContents = [{ role: "user", parts: [{ text: contents }] }];
  } else if (Array.isArray(contents)) {
    normalizedContents = contents.map((msg) => ({
      role: msg.role || "user",
      parts: msg.parts ?? [{ text: String(msg.content ?? "") }],
    }));
  } else {
    normalizedContents = [{ role: "user", parts: [{ text: String(contents ?? "") }] }];
  }

  const geminiBody = { contents: normalizedContents };
  const generationConfig = {};
  if (config.responseMimeType) generationConfig.responseMimeType = config.responseMimeType;
  if (config.responseSchema)   generationConfig.responseSchema   = config.responseSchema;
  if (Object.keys(generationConfig).length > 0) geminiBody.generationConfig = generationConfig;

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
  const geminiRes = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
  });

  const geminiData = await geminiRes.json().catch(() => ({}));
  if (!geminiRes.ok) {
    return jsonResponse({ error: geminiData?.error?.message || `Gemini API 錯誤 (${geminiRes.status})` }, geminiRes.status);
  }

  const text = geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return jsonResponse({ text });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}