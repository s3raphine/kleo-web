// Tiny local static server: node serve.js  →  http://127.0.0.1:8765
// Serves only the app's own files, and only on the loopback interface.
const http = require('http'), fs = require('fs'), path = require('path');

const root = __dirname;
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/lib/openpgp.min.js': ['lib/openpgp.min.js', 'text/javascript; charset=utf-8'],
};

http.createServer((req, res) => {
  const entry = files[req.url.split('?')[0]];
  if (!entry || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, entry[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end(); }
    res.writeHead(200, {
      'Content-Type': entry[1],
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(process.env.PORT || 8765, '127.0.0.1', function () {
  console.log('Kleo Web: http://127.0.0.1:' + this.address().port);
});
