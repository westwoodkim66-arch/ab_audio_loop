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

  // API 路由：Proxy 短網址請求以避開前端 CORS 限制並增加多重備援
  app.get("/api/shorten", async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    // 將多個公開短網址服務作為備援陣列
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
          // 確保回傳的是真正的 http 網址
          if (shortUrl.startsWith('http')) {
            return res.send(shortUrl);
          }
        }
      } catch (error) {
        console.warn(`Shorten provider failed: ${providerUrl}`, error);
        // 繼續嘗試下一個
      }
    }

    res.status(500).send("All URL shortening services failed");
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
