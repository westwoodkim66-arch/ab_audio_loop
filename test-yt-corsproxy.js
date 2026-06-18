async function testCorsProxy() {
  const videoId = 'HAnw168huqA';
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  
  try {
    console.log('Fetching via corsproxy.io...');
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      console.log('Proxy error status:', res.status);
      return;
    }
    const html = await res.text();
    console.log('HTML length received:', html.length);
    console.log('Includes ytInitialPlayerResponse:', html.includes('ytInitialPlayerResponse'));
    
    // Parse ytInitialPlayerResponse
    const matches = html.match(/ytInitialPlayerResponse\s*=\s*/);
    if (matches) {
      const idx = html.indexOf(matches[0]);
      const start = idx + matches[0].length;
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
        console.log('Status via proxy:', parsed.playabilityStatus?.status);
        console.log('Captions existence:', !!parsed.captions);
        if (parsed.captions) {
          const tracks = parsed.captions.playerCaptionsTracklistRenderer?.captionTracks;
          console.log('Caption Tracks:', tracks?.map(t => ({ lang: t.languageCode, baseUrl: t.baseUrl })));
        }
      }
    } else {
      console.log('Could not find player response in proxy HTML');
    }
  } catch (err) {
    console.error('Proxy Test Error:', err);
  }
}

testCorsProxy();
