<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e15df1a3-0b27-4dbe-b364-fa3544f3143c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `GEMINI_API_KEY` and `SUPADATA_API_KEY` in [.env.local](.env.local)
3. Run the app:
   `npm run dev`

## YouTube transcripts on Cloudflare Pages

The transcript endpoint uses Supadata in `native` mode to retrieve existing YouTube captions with timestamps. Add `SUPADATA_API_KEY` as an encrypted variable in Cloudflare Pages under **Settings → Variables and Secrets**, then redeploy the project. The API key is read only by the server-side Function and is never sent to the browser.
