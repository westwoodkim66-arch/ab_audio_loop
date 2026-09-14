import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Local fallback DB for massive URLs
const DB_FILE = path.join(__dirname, "local_urls.json");
let urlDB: Record<string, string> = {};
try {
  if (fs.existsSync(DB_FILE)) {
    urlDB = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  }
} catch(e) {
  console.warn("Could not load local_urls.json", e);
}

function saveLocalUrl(url: string, prefix: string): string {
  const id = crypto.randomUUID().split('-')[0];
  urlDB[id] = url;
  fs.writeFileSync(DB_FILE, JSON.stringify(urlDB), "utf-8");
  return `${prefix}/s/${id}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for massive LZ string data
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Redirect local short links
  app.get("/s/:id", (req, res) => {
    const target = urlDB[req.params.id];
    if (target) {
      res.redirect(302, target);
    } else {
      res.status(404).send("Short link not found or expired.");
    }
  });

  // API 路由：使用 TinyURL 免 Token 端點建立短網址。
  app.post("/api/shorten", async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return res.status(400).json({ error: "無效的分享網址" });
      }
    } catch {
      return res.status(400).json({ error: "無效的分享網址" });
    }

    try {
      const response = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
        { headers: { "Accept": "text/plain" } }
      );
      const shortUrl = (await response.text()).trim();
      if (
        response.ok
        && /^https?:\/\/(?:www\.)?tinyurl\.com\/[A-Za-z0-9_-]+\/?$/i.test(shortUrl)
      ) {
        if (shortUrl.length >= url.length) {
          return res.json({
            shortUrl: url,
            provider: "original",
            shortened: false,
            reason: "TinyURL 回傳網址沒有比較短",
          });
        }
        return res.json({
          shortUrl,
          provider: "tinyurl-legacy",
          shortened: true,
          originalLength: url.length,
          shortLength: shortUrl.length,
        });
      }
      return res.status(502).json({ error: "TinyURL 未回傳有效的短網址" });
    } catch {
      return res.status(502).json({ error: "目前無法連線 TinyURL API" });
    }
  });

  // API 路由：獲取 YouTube 字幕
  app.get("/api/yt-transcript", async (req, res) => {
    try {
      const apiKey = process.env.SUPADATA_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "SUPADATA_NOT_CONFIGURED", message: "字幕服務尚未設定，請加入 SUPADATA_API_KEY。" });
      }

      const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
      const videoUrl = typeof req.query.url === "string" ? req.query.url : "";
      if (!jobId && !videoUrl) {
        return res.status(400).json({ error: "INVALID_YOUTUBE_URL", message: "請先載入有效的 YouTube 網址。" });
      }

      const endpoint = jobId
        ? `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`
        : `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(videoUrl)}&mode=native`;
      const upstream = await fetch(endpoint, { headers: { "x-api-key": apiKey, "Accept": "application/json" } });
      const data: any = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        const messages: Record<number, string> = {
          401: "字幕服務金鑰無效，請重新設定 SUPADATA_API_KEY。",
          402: "字幕服務目前沒有可用額度，請檢查 Supadata 方案。",
          404: "這部影片沒有可用的 YouTube 字幕。",
          429: "字幕讀取次數暫時達到上限，請稍後再試。",
        };
        return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
          error: data.error || "TRANSCRIPT_SERVICE_ERROR",
          message: messages[upstream.status] || data.message || data.details || "字幕服務無法處理這部影片。",
        });
      }

      if (upstream.status === 202 || data.jobId || data.status === "queued" || data.status === "active") {
        return res.status(202).json({ status: data.status || "queued", jobId: data.jobId });
      }
      if (data.status === "failed") {
        return res.status(502).json({ error: "TRANSCRIPT_JOB_FAILED", message: data.error?.message || "字幕處理失敗。" });
      }

      const transcript = Array.isArray(data.content)
        ? data.content.filter((item: any) => typeof item?.text === "string" && item.text.trim())
        : [];
      if (transcript.length === 0) {
        return res.status(404).json({ error: "NO_CAPTIONS", message: "這部影片沒有可用的 YouTube 字幕。" });
      }
      return res.json({
        transcript,
        language: data.lang || transcript[0]?.lang || "",
        availableLanguages: Array.isArray(data.availableLangs) ? data.availableLangs : [],
        provider: "supadata",
      });
    } catch (error: any) {
      console.error("Supadata Transcript error:", error);
      res.status(502).json({ error: "TRANSCRIPT_SERVICE_UNAVAILABLE", message: "目前無法連線字幕服務，請稍後再試。" });
    }
  });

  // API 路由：Gemini Proxy
  let geminiKeyIndex = 0;
  app.post("/api/gemini/generateContent", async (req, res) => {
    try {
      const keysEnv = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;
      if (!keysEnv) {
        return res.status(500).json({ error: "API Key 未設定 (GEMINI_API_KEYS or GEMINI_API_KEY is empty). 請在環境變數或專案設定中提供有效的 Gemini API 金鑰。" });
      }

      // 支援多個 Key，使用逗號分隔
      const keys = keysEnv.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (keys.length === 0) {
        return res.status(500).json({ error: "找不到有效的 API Key" });
      }

      // 輪詢選擇 Key
      const currentKey = keys[geminiKeyIndex % keys.length];
      geminiKeyIndex++;

      const ai = new GoogleGenAI({ apiKey: currentKey });
      const { model, contents, config } = req.body;
      
      const response = await ai.models.generateContent({ model, contents, config });
      
      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API error:", error);
      res.status(500).json({ error: error.message || "Failed to generate content" });
    }
  });

  // Vite 中場軟體設定
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
