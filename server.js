// Tiny local HTTP server — no npm packages required, uses Node.js built-ins only
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 4000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.txt':  'text/plain',
};

http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? '/game.html' : req.url);

  // strip query strings
  filePath = filePath.split('?')[0];

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + req.url);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('HTM Game Clock server running at http://127.0.0.1:' + PORT);
});
