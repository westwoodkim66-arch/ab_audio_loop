import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import fs from 'fs';

async function test() {
  const videoId = 'HAnw168huqA';
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  const html = await res.text();
  
  console.log('Includes ytInitialPlayerResponse:', html.includes('ytInitialPlayerResponse'));
  console.log('Includes ytInitialData:', html.includes('ytInitialData'));
  
  const matches = html.match(/ytInitialPlayerResponse\s*=\s*/);
  if (matches) {
    console.log('Found ytInitialPlayerResponse!');
    const idx = html.indexOf(matches[0]);
    // write a slice of the HTML to inspect
    fs.writeFileSync('temp_response.txt', html.slice(idx, idx + 10000));
    console.log('Saved 10000 chars of player response to temp_response.txt');
  } else {
    console.log('No matches for ytInitialPlayerResponse');
    // Let's save a bit of HTML to see if there is any other json
    fs.writeFileSync('temp_html.txt', html.slice(0, 50000));
  }
}

test();
