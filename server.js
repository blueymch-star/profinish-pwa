const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_HTTP = 8080;
const PORT_HTTPS = 8443;
const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, 'meet_data.json');

process.on('uncaughtException', (err) => {
  console.warn('[Server Safe Guard] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Server Safe Guard] Unhandled Rejection:', reason);
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Default initial meet database (6 lanes per heat)
function createDefaultMeetData() {
  return {
    meetTitle: '2026 校園運動會田徑錦標賽',
    activeHeatId: 1,
    updatedAt: Date.now(),
    heats: [
      {
        id: 1,
        eventTitle: '六年級男生組 100公尺',
        roundName: '預賽 第 1 組',
        distance: 100,
        status: 'ready', // ready | running | finished | official
        proofImage: null,
        lanes: [
          { lane: 1, grade: '六年一班', name: '陳小明', bib: '601', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 2, grade: '六年二班', name: '林阿豪', bib: '602', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 3, grade: '六年三班', name: '張志偉', bib: '603', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 4, grade: '六年四班', name: '黃冠宇', bib: '604', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 5, grade: '六年五班', name: '李宗翰', bib: '605', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 6, grade: '六年六班', name: '王俊傑', bib: '606', rawTime: null, officialTime: null, rank: '-', status: 'OK' }
        ]
      },
      {
        id: 2,
        eventTitle: '六年級男生組 100公尺',
        roundName: '預賽 第 2 組',
        distance: 100,
        status: 'ready',
        proofImage: null,
        lanes: [
          { lane: 1, grade: '六年一班', name: '吳承恩', bib: '611', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 2, grade: '六年二班', name: '周廷宇', bib: '612', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 3, grade: '六年三班', name: '蔡宇軒', bib: '613', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 4, grade: '六年四班', name: '許家豪', bib: '614', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 5, grade: '六年五班', name: '鄭凱文', bib: '615', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 6, grade: '六年六班', name: '謝明達', bib: '616', rawTime: null, officialTime: null, rank: '-', status: 'OK' }
        ]
      },
      {
        id: 3,
        eventTitle: '五年級女生組 60公尺',
        roundName: '計時決賽 第 1 組',
        distance: 60,
        status: 'ready',
        proofImage: null,
        lanes: [
          { lane: 1, grade: '五年一班', name: '林雅婷', bib: '501', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 2, grade: '五年二班', name: '陳怡君', bib: '502', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 3, grade: '五年三班', name: '張語彤', bib: '503', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 4, grade: '五年四班', name: '黃子晴', bib: '504', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 5, grade: '五年五班', name: '李品妍', bib: '505', rawTime: null, officialTime: null, rank: '-', status: 'OK' },
          { lane: 6, grade: '五年六班', name: '王心如', bib: '506', rawTime: null, officialTime: null, rank: '-', status: 'OK' }
        ]
      }
    ]
  };
}

let meetData = createDefaultMeetData();

function ensureHeatUids(targetMeet) {
  if (!targetMeet || !Array.isArray(targetMeet.heats)) return;
  targetMeet.heats.forEach((h, idx) => {
    if (!h.uid) {
      const d = (h.raceDate || 'nodate').replace(/-/g, '');
      h.uid = `heat_${d}_${h.id}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
    }
  });
}

function loadMeetData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      meetData = JSON.parse(raw);
      ensureHeatUids(meetData);
    } else {
      ensureHeatUids(meetData);
      saveMeetData();
    }
  } catch (err) {
    console.error('Failed to load meet_data.json, using defaults:', err);
    meetData = createDefaultMeetData();
    ensureHeatUids(meetData);
  }
}

function saveMeetData() {
  try {
    ensureHeatUids(meetData);
    meetData.updatedAt = Date.now();
    fs.writeFileSync(DATA_FILE, JSON.stringify(meetData, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save meet_data.json:', err);
  }
}

loadMeetData();

// SSE (Server-Sent Events) connected clients for real-time sync between PC Admin & Mobile Finish Camera
const sseClients = new Set();

function broadcastEvent(type, payload = {}) {
  const dataStr = `data: ${JSON.stringify({ type, payload, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(dataStr);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Allow up to 15MB for base64 proof images
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(obj));
}

async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const reqUrl = req.url.split('?')[0];

  // =========================================================================
  // API ENDPOINTS FOR PC BACKEND & MOBILE SYNC
  // =========================================================================

  // 1. SSE Real-time Event Stream
  if (reqUrl === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', activeHeatId: meetData.activeHeatId, activeHeatUid: meetData.activeHeatUid })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 2. Get full meet data
  if (reqUrl === '/api/meet' && req.method === 'GET') {
    sendJson(res, 200, meetData);
    return;
  }

  // 3. Save / update full meet data from PC Admin
  if (reqUrl === '/api/meet' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (body && Array.isArray(body.heats)) {
        meetData.meetTitle = body.meetTitle || meetData.meetTitle;
        meetData.activeHeatId = body.activeHeatId || meetData.activeHeatId;
        if (body.activeHeatUid) meetData.activeHeatUid = body.activeHeatUid;
        meetData.heats = body.heats;
        saveMeetData();
        broadcastEvent('meet_updated', { activeHeatId: meetData.activeHeatId, activeHeatUid: meetData.activeHeatUid });
        sendJson(res, 200, { ok: true, meetData });
      } else {
        sendJson(res, 400, { error: 'Invalid meet data format' });
      }
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 4. Set Active Heat (Dispatch heat from PC Admin to Mobile Camera)
  if (reqUrl === '/api/active-heat' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const heatId = parseInt(body.heatId, 10);
      const heatUid = body.uid;
      let targetHeat = null;
      if (heatUid) {
        targetHeat = meetData.heats.find(h => h.uid === heatUid);
      }
      if (!targetHeat && body.raceDate) {
        targetHeat = meetData.heats.find(h => h.id === heatId && h.raceDate === body.raceDate);
      }
      if (!targetHeat) {
        targetHeat = meetData.heats.find(h => h.id === heatId);
      }
      if (!targetHeat) {
        sendJson(res, 404, { error: 'Heat not found' });
        return;
      }
      meetData.activeHeatId = targetHeat.id;
      meetData.activeHeatUid = targetHeat.uid;
      saveMeetData();
      broadcastEvent('active_heat_changed', { activeHeatId: targetHeat.id, activeHeatUid: targetHeat.uid, heat: targetHeat });
      sendJson(res, 200, { ok: true, activeHeatId: targetHeat.id, activeHeatUid: targetHeat.uid, heat: targetHeat });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // 5. Receive race results & photo-finish proof from Mobile or Admin
  if (reqUrl === '/api/heat-result' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const heatId = parseInt(body.heatId, 10);
      const heatUid = body.uid;
      let heat = null;
      if (heatUid) {
        heat = meetData.heats.find(h => h.uid === heatUid);
      }
      if (!heat && body.raceDate) {
        heat = meetData.heats.find(h => h.id === heatId && h.raceDate === body.raceDate);
      }
      if (!heat) {
        heat = meetData.heats.find(h => h.id === heatId);
      }

      // If mobile sends a heat not yet in meetData, create it dynamically
      if (!heat) {
        heat = {
          id: heatId,
          uid: heatUid || `heat_dyn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          eventTitle: body.eventTitle || `${body.distance || 100}公尺競賽`,
          roundName: `第 ${heatId} 組`,
          raceDate: body.raceDate || '',
          distance: body.distance || 100,
          status: 'finished',
          proofImage: null,
          lanes: []
        };
        meetData.heats.push(heat);
      }

      if (Array.isArray(body.lanes)) {
        heat.lanes = body.lanes;
      }
      if (body.distance) {
        heat.distance = body.distance;
      }
      if (body.status) {
        heat.status = body.status;
      } else {
        const hasTimes = heat.lanes.some(l => l.officialTime !== null && l.officialTime !== undefined);
        if (hasTimes) heat.status = 'finished';
      }
      if (body.proofImage) {
        heat.proofImage = body.proofImage;
      }

      saveMeetData();
      broadcastEvent('heat_result_updated', { heatId: heat.id, uid: heat.uid, status: heat.status });
      sendJson(res, 200, { ok: true, heat });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // =========================================================================
  // STATIC FILE SERVER
  // =========================================================================
  let reqPath = reqUrl;
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT_DIR, reqPath);
  const ext = path.extname(filePath).toLowerCase();

  // Basic security: prevent directory traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`500 Server Error: ${err.code}`);
      }
    } else {
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(content);
    }
  });
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

// 1. Start HTTP Server
const httpServer = http.createServer(handleRequest);
httpServer.listen(PORT_HTTP, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('====================================================');
  console.log('⚡ ProFinish PWA 賽事伺服器與電腦後台已啟動！');
  console.log(`💻 電腦端管理後台： http://localhost:${PORT_HTTP}/admin.html`);
  console.log(`📱 手機端計時介面： http://localhost:${PORT_HTTP}/index.html`);
  if (ips.length > 0) {
    console.log(`🌐 區域網路後台：   http://${ips[0]}:${PORT_HTTP}/admin.html`);
  }
  console.log('====================================================');
});

// 2. Start HTTPS Server if certs or pfx exist
const certPath = path.join(ROOT_DIR, 'cert.pem');
const keyPath = path.join(ROOT_DIR, 'key.pem');
const pfxPath = path.join(ROOT_DIR, 'cert.pfx');

let httpsOptions = null;
if (fs.existsSync(pfxPath)) {
  httpsOptions = {
    pfx: fs.readFileSync(pfxPath),
    passphrase: '1234'
  };
} else if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}

if (httpsOptions) {
  const httpsServer = https.createServer(httpsOptions, handleRequest);
  httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log(`🔒 HTTPS 安全伺服器（iPhone 相機授權專用）：`);
    console.log(`📱 iPhone Safari 請開啟： https://${ips[0] || 'localhost'}:${PORT_HTTPS}`);
    console.log('====================================================');
  });
}
