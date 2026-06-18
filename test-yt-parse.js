import fs from 'fs';

try {
  const content = fs.readFileSync('temp_response.txt', 'utf8');
  // It starts with ytInitialPlayerResponse = {...};
  const startIdx = content.indexOf('{');
  // It's a JS assignment, so it might end with }; or just }
  // Let's extract until the first outer matching bracket or just use the parseInlineJson logic from youtube-transcript.
  function parseInlineJson(e, t) {
    let n = `${t} = `, r = e.indexOf(n);
    if (r === -1) return null;
    let i = r + n.length, a = 0;
    for (let t = i; t < e.length; t++) {
      if (e[t] === `{`) a++;
      else if (e[t] === `}` && (a--, a === 0)) {
        try {
          return JSON.parse(e.slice(i, t + 1));
        } catch (err) {
          console.error("JSON parse inside function failed:", err);
          return null;
        }
      }
    }
    return null;
  }
  
  const parsed = parseInlineJson(content, 'ytInitialPlayerResponse');
  if (parsed) {
    console.log('Successfully parsed JSON!');
    console.log('Top level keys:', Object.keys(parsed));
    console.log('PlayabilityStatus:', parsed.playabilityStatus);
    console.log('Captions existence:', !!parsed.captions);
    if (parsed.captions) {
      console.log('Captions keys:', Object.keys(parsed.captions));
      console.log('playerCaptionsTracklistRenderer keys:', Object.keys(parsed.captions.playerCaptionsTracklistRenderer || {}));
      console.log('captionTracks:', parsed.captions.playerCaptionsTracklistRenderer?.captionTracks);
    }
  } else {
    console.log('Failed to parse inline JSON from temp_response.txt');
  }
} catch (err) {
  console.error('Error in script:', err);
}
