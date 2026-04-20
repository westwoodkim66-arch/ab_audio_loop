import https from 'https';

https.get('https://tinyurl.com/api-create.php?url=https://google.com', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', data));
}).on('error', err => console.log('Error:', err.message));
