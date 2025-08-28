const http = require('http');
const fs = require('fs');
const path = require('path');

// Simple in-memory last known state
let latestState = null;

// Connected SSE clients
const sseClients = new Set();

function sendEvent(client, data) {
  client.write(`data: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS for POST from file pages if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/events') {
    // Server-Sent Events endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    sseClients.add(res);
    if (latestState) {
      sendEvent(res, { type: 'state', payload: latestState });
    }
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (url.pathname === '/broadcast' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (data && data.type === 'state') {
          latestState = data.payload;
        }
        // Fan out
        for (const client of sseClients) {
          try {
            sendEvent(client, data);
          } catch (err) {
            // Best effort
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Serve static files from public
  const publicDir = path.join(__dirname, 'public');
  let filePath = path.join(publicDir, url.pathname === '/' ? 'mod.html' : url.pathname);

  // Prevent path traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type =
      ext === '.html' ? 'text/html' :
      ext === '.js' ? 'application/javascript' :
      ext === '.css' ? 'text/css' :
      ext === '.png' ? 'image/png' :
      ext === '.gif' ? 'image/gif' :
      ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

function startServer(preferredPort, maxAttempts = 10) {
  let currentPort = Number(preferredPort) || 3001;
  let attempts = 0;

  function tryListen() {
    attempts += 1;
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && attempts < maxAttempts) {
        console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
        currentPort += 1;
        setTimeout(tryListen, 50);
        return;
      }
      console.error('Failed to start server:', err);
      process.exit(1);
    });
    server.listen(currentPort, () => {
      console.log(`Realtime server running on http://localhost:${currentPort}`);
      console.log('Open /mod for moderator and /view for viewer.');
    });
  }

  tryListen();
}

startServer(process.env.PORT || 3001);


