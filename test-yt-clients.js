async function testClient(clientName, clientVersion, userAgent) {
  const r = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  const videoId = 'HAnw168huqA';
  
  try {
    const res = await fetch(r, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: clientName,
            clientVersion: clientVersion
          }
        },
        videoId: videoId
      })
    });
    
    if (!res.ok) {
      console.log(`[${clientName}] HTTP error:`, res.status);
      return;
    }
    
    const data = await res.json();
    console.log(`[${clientName}] playabilityStatus:`, data.playabilityStatus?.status);
    console.log(`[${clientName}] captions existence:`, !!data.captions);
    if (data.captions) {
      const tracks = data.captions.playerCaptionsTracklistRenderer?.captionTracks;
      console.log(`[${clientName}] caption tracks:`, tracks?.map(t => t.languageCode));
    }
  } catch (err) {
    console.error(`[${clientName}] Error:`, err);
  }
}

async function run() {
  // Test 1: WEB
  await testClient('WEB', '2.20240328.00.00');
  
  // Test 2: IOS
  await testClient('IOS', '19.08.2', 'com.google.ios.youtube/19.08.2 (iPhone16,2; U; CPU iPhone OS 17_4 like Mac OS X; en_US)');

  // Test 3: TVHTML5
  await testClient('TVHTML5', '7.20230405.08.02');
  
  // Test 4: MWEB
  await testClient('MWEB', '2.20240328.00.00', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
}

run();
