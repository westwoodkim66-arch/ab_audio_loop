import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { YoutubeTranscript } = require('youtube-transcript');

async function test() {
  try {
    const videoId = 'HAnw168huqA';
    console.log('Fetching transcript with video ID:', videoId);
    
    // Let's test with no options
    try {
      const t1 = await YoutubeTranscript.fetchTranscript(videoId);
      console.log('Success (no options)! Retrieved:', t1.length, 'lines.');
    } catch (e1) {
      console.error('Failed (no options):', e1.message || e1);
    }

    // Let's inspect available languages or custom options if any
    // Some videos only have auto-translated or specific languages.
    // Let's test fetching with browser/fetch request to YouTube's watch page directly to see what caption tracks exist.
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      }
    });
    const html = await res.text();
    const ytResponseStr = 'ytInitialPlayerResponse = ';
    const idx = html.indexOf(ytResponseStr);
    if (idx !== -1) {
      const start = idx + ytResponseStr.length;
      let depth = 0;
      let jsonStr = '';
      for (let i = start; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
          depth--;
          if (depth === 0) {
            jsonStr = html.slice(start, i + 1);
            break;
          }
        }
      }
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        const captionTracks = parsed.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        console.log('Available Caption Tracks in browser response:');
        if (captionTracks) {
          captionTracks.forEach((track) => {
            console.log(`- Language: ${track.languageCode}, Kind: ${track.kind}, Name: ${track.name?.simpleText}, BaseUrl: ${track.baseUrl}`);
          });
        } else {
          console.log('No caption tracks found in player initial response!');
        }
      }
    } else {
      console.log('Could not find ytInitialPlayerResponse in watch page.');
    }

  } catch (err) {
    console.error('General Error:', err);
  }
}

test();
