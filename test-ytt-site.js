async function test() {
  const videoId = 'HAnw168huqA';
  try {
    const res = await fetch(`https://youtubetranscript.com/?v=${videoId}`);
    const text = await res.text();
    console.log('youtubetranscript.com text status:', res.status);
    console.log('Includes xml:', text.includes('<?xml'));
    console.log('Includes <text:', text.includes('<text'));
    console.log('First 1000 characters:');
    console.log(text.slice(0, 1000));
  } catch (err) {
    console.error('Fetch error:', err);
  }
}
test();
