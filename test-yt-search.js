import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import fs from 'fs';

async function test() {
  const videoId = 'HAnw168huqA';
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en-GB+FX+403; PREF=hl=zh-TW&tz=Asia.Taipei'
    }
  });
  const html = await res.text();
  
  // Write HTML to check what's inside or search for captions
  console.log('HTML length:', html.length);
  
  // Search for the presence of "caption" or "captionTracks"
  let matchIdx = html.indexOf('captionTracks');
  if (matchIdx !== -1) {
    console.log('Found "captionTracks" around index:', matchIdx);
    console.log(html.slice(matchIdx - 100, matchIdx + 500));
  } else {
    console.log('Could not find word "captionTracks" anywhere in the watch page!');
  }
}

test();
