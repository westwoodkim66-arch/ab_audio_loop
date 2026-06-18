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

  // API 路由：Proxy 短網址請求 (使用 Reurl.cc 服務)
  app.post("/api/shorten", async (req, res) => {
    const url = req.body.url as string;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    try {
      // 優先使用使用者指定的 Reurl API
      const reurlApiKey = "4070ff49d794e43715573b663c974755ecd7b132999204df8a38b58d65165567c4f5d6";
      const response = await fetch("https://api.reurl.cc/shorten", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "reurl-api-key": reurlApiKey
        },
        body: JSON.stringify({ url })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.short_url) {
          return res.send(data.short_url);
        }
      }
      console.warn("Reurl API failed", await response.text());
    } catch (error) {
      console.error("Reurl API error:", error);
    }

    // 若 Reurl 失效，提供備援選項
    const providers = [
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`
    ];

    for (const providerUrl of providers) {
      try {
        const response = await fetch(providerUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        if (response.ok) {
          const shortUrl = (await response.text()).trim();
          if (shortUrl.startsWith('http')) {
            return res.send(shortUrl);
          }
        }
      } catch (error) {}
    }

    // 終極備援：如果外部 API 全面失敗或網址實在太長被拒絕，使用內部儲存！
    const origin = req.headers.origin || req.protocol + '://' + req.get('host');
    const localShort = saveLocalUrl(url, origin);
    return res.send(localShort);
  });

  // API 路由：獲取 YouTube 字幕
  app.get("/api/yt-transcript", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing URL parameter" });
      }

      // Regex 提取正確的 11 位 YouTube Video ID
      let videoId = url.trim();
      const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i;
      const match = url.match(regExp);
      if (match && match[1]) {
        videoId = match[1];
      }

      try {
        console.log(`Attempting to fetch transcript directly with library for video: ${videoId}`);
        const { YoutubeTranscript } = require('youtube-transcript');
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        return res.json(transcript);
      } catch (innerError: any) {
        console.warn("Direct YoutubeTranscript.fetchTranscript failed, attempting fallback parsing from watch page...", innerError.message);
        
        // Let's do our OWN clean fetch from watch page with a modern User Agent as fallback!
        try {
          const ytRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            }
          });
          
          if (ytRes.ok) {
            const html = await ytRes.text();
            
            // Look for captions block inside ytInitialPlayerResponse
            const parseInlineJson = (e: string, t: string) => {
              let n = `${t} = `, r = e.indexOf(n);
              if (r === -1) return null;
              let i = r + n.length, a = 0;
              for (let t = i; t < e.length; t++) {
                if (e[t] === `{`) a++;
                else if (e[t] === `}` && (a--, a === 0)) {
                  try {
                    return JSON.parse(e.slice(i, t + 1));
                  } catch (err) {
                    return null;
                  }
                }
              }
              return null;
            };
            
            const playerResponse = parseInlineJson(html, 'ytInitialPlayerResponse');
            
            if (playerResponse) {
              console.log(`Bypass parser playabilityStatus:`, playerResponse.playabilityStatus?.status);
              
              if (playerResponse.playabilityStatus?.status === 'LOGIN_REQUIRED') {
                return res.status(403).json({
                  error: "LOGIN_REQUIRED",
                  message: "此影片受到 YouTube 登入限制或年齡限制（Bot 偵測安全防護）。",
                  videoId
                });
              }
              
              if (playerResponse.captions) {
                const captionTracks = playerResponse.captions.playerCaptionsTracklistRenderer?.captionTracks;
                if (captionTracks && captionTracks.length > 0) {
                  // Find Chinese, or fallback to English, or fallback to first track
                  const track = captionTracks.find((t: any) => t.languageCode === 'zh-TW' || t.languageCode === 'zh') || captionTracks[0];
                  console.log(`Downloading track via fallback: ${track.languageCode} (${track.baseUrl})`);
                  
                  const trackRes = await fetch(track.baseUrl);
                  if (trackRes.ok) {
                    const xmlText = await trackRes.text();
                    
                    // Parse xml into [{text, duration, offset}]
                    const lines: any[] = [];
                    const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/gi;
                    let m;
                    while ((m = regex.exec(xmlText)) !== null) {
                      const startRaw = parseFloat(m[1]);
                      const durRaw = parseFloat(m[2]);
                      let rawText = m[3]
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/<[^>]*>/g, ''); // strip XML tags
                      
                      lines.push({
                        text: rawText,
                        duration: Math.round(durRaw * 1000),
                        offset: Math.round(startRaw * 1000)
                      });
                    }
                    
                    if (lines.length > 0) {
                      console.log(`Successfully extracted ${lines.length} lines via custom crawler fallback!`);
                      return res.json(lines);
                    }
                  }
                }
              }
            }
          }
        } catch (fallbackError: any) {
          console.error("Custom tracker fallback failed:", fallbackError.message);
        }
        
        throw innerError;
      }
    } catch (error: any) {
      console.error("Youtube Transcript error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch transcript" });
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
