import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API 路由：Proxy 短網址請求 (使用 Reurl.cc 服務)
  app.get("/api/shorten", async (req, res) => {
    const url = req.query.url as string;
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
      
      console.warn("Reurl API returned non-ok status or missing short_url", await response.text());
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
      } catch (error) {
        console.warn(`Fallback shorten provider failed: ${providerUrl}`, error);
      }
    }

    res.status(500).send("All URL shortening services failed");
  });

  // API 路由：獲取 YouTube 字幕
  app.get("/api/yt-transcript", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing URL parameter" });
      }

      // @ts-ignore
      const YoutubeTranscript = (await import('youtube-transcript')).YoutubeTranscript;
      
      const transcript = await YoutubeTranscript.fetchTranscript(url);
      
      // format: [{text: "hi", duration: 1000, offset: 0}, ...]
      res.json(transcript);
    } catch (error: any) {
      console.error("Youtube Transcript error:", error);
      res.status(500).json({ error: "Failed to fetch transcript: " + error.message });
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
