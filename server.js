import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadSources } from './src/booksource.js';
import * as qimao from './src/qimao.js';
import * as qidian from './src/qidian.js';
import * as hongxiu from './src/hongxiu.js';
import * as faloo from './src/faloo.js';
import * as dbxsd from './src/dbxsd.js';
import * as kuwo from './src/kuwo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const sources = loadSources();
const sourceMap = new Map(sources.map((item) => [item.id, item]));
const DEFAULT_SOURCE_ID = sources[0] ? sources[0].id : 'qimao';
const qimaoSource = sourceMap.get('qimao');
if (qimaoSource) qimao.setSignKey(qimaoSource.signKey);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

function acceptsGzip(req) {
  return (req.headers['accept-encoding'] || '').split(',').some(function (e) {
    return e.trim().split(';')[0].toLowerCase() === 'gzip';
  });
}

function finish(res, req, status, headers, body) {
  const isHead = req.method === 'HEAD';
  if (!isHead && body && body.length > 1024 && acceptsGzip(req)) {
    const buf = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = buf.length;
    res.writeHead(status, headers);
    return res.end(buf);
  }
  headers['Content-Length'] = body ? body.length : 0;
  res.writeHead(status, headers);
  res.end(isHead || !body ? undefined : body);
}

function sendJson(res, req, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  finish(res, req, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, body);
}

function isNumeric(value) {
  return /^\d+$/.test(String(value || ''));
}

function clampPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 2000) return 2000;
  return Math.floor(n);
}

function resolveSourceId(value) {
  if (value && sourceMap.has(value)) return value;
  return DEFAULT_SOURCE_ID;
}

const PROVIDERS = { qimao, qidian, hongxiu, faloo, dbxsd, kuwo };

function providerOf(sourceId) {
  return PROVIDERS[sourceId] || qimao;
}

function allowsSlugId(sourceId) {
  return sourceId === 'dbxsd';
}

const COVER_HOSTS = new Set([
  'cdn.wtzw.com',
  'bookcover.yuewen.com',
  'openbookcover.yuewen.com',
  'img.faloo.com',
  'www.dbxsd.com',
]);

const coverCache = new Map();
const COVER_CACHE_MAX = 800;
const COVER_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function respondCover(res, req, entry) {
  res.writeHead(200, {
    'Content-Type': entry.type,
    'Content-Length': entry.body.length,
    'Cache-Control': 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : entry.body);
}

async function handleCover(req, res, url) {
  let target;
  try {
    target = new URL(url.searchParams.get('u') || '');
  } catch {
    return sendJson(res, req, 400, { error: '封面参数无效' });
  }
  if (!COVER_HOSTS.has(target.hostname)) return sendJson(res, req, 400, { error: '封面域名不受支持' });
  const key = target.toString();
  const hit = coverCache.get(key);
  if (hit) {
    coverCache.delete(key);
    coverCache.set(key, hit);
    return respondCover(res, req, hit);
  }
  try {
    const upstream = await fetch(key, {
      headers: {
        'user-agent': COVER_UA,
        'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'referer': `${target.protocol}//${target.hostname}/`,
      },
      signal: AbortSignal.timeout(15000),
    });
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    if (!upstream.ok || !type.startsWith('image/')) {
      return sendJson(res, req, 502, { error: '封面获取失败' });
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!body.length || body.length > 3 * 1024 * 1024) {
      return sendJson(res, req, 502, { error: '封面获取失败' });
    }
    const entry = { body, type };
    coverCache.set(key, entry);
    if (coverCache.size > COVER_CACHE_MAX) coverCache.delete(coverCache.keys().next().value);
    return respondCover(res, req, entry);
  } catch {
    return sendJson(res, req, 502, { error: '封面获取失败' });
  }
}

function parseBookId(raw, fallbackSourceId) {
  const value = String(raw || '');
  const index = value.indexOf(':');
  if (index > 0) {
    const sourceId = value.slice(0, index);
    if (sourceMap.has(sourceId)) return { sourceId, id: value.slice(index + 1) };
  }
  return { sourceId: fallbackSourceId, id: value };
}

function wrapId(sourceId, id) {
  return `${sourceId}:${id}`;
}

function wrapBook(sourceId, book) {
  return { ...book, id: wrapId(sourceId, book.id) };
}

function wrapResult(sourceId, result) {
  return { ...result, list: (result.list || []).map((book) => wrapBook(sourceId, book)) };
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return finish(res, req, 405, { Allow: 'GET, HEAD' }, null);
  }
  const params = url.searchParams;

  if (url.pathname === '/api/config') {
    const sourceId = resolveSourceId(params.get('source'));
    const current = sourceMap.get(sourceId);
    return sendJson(res, req, 200, {
      source: { id: current.id, name: current.name, url: current.url, group: current.group },
      sources: sources.map((item) => ({ id: item.id, name: item.name, url: item.url, group: item.group })),
      sections: current.sections,
    });
  }

  if (url.pathname === '/api/search') {
    const sourceId = resolveSourceId(params.get('source'));
    const wd = (params.get('wd') || '').trim();
    if (!wd) return sendJson(res, req, 400, { error: '请输入搜索关键词' });
    const page = clampPage(params.get('page'));
    const result = await providerOf(sourceId).search(wd, page);
    return sendJson(res, req, 200, wrapResult(sourceId, result));
  }

  if (url.pathname === '/api/list') {
    const sourceId = resolveSourceId(params.get('source'));
    const kind = params.get('kind') || 'category';
    const id = params.get('id');
    if (!id) return sendJson(res, req, 400, { error: '分类参数无效' });
    if (sourceId === 'qimao' && !isNumeric(id)) return sendJson(res, req, 400, { error: '分类参数无效' });
    const page = clampPage(params.get('page'));
    const need = Number(params.get('need')) ? 1 : 0;
    const result = await providerOf(sourceId).list(kind, id, page, need);
    return sendJson(res, req, 200, wrapResult(sourceId, result));
  }

  if (url.pathname === '/api/book') {
    const fallback = resolveSourceId(params.get('source'));
    const target = parseBookId(params.get('id'), fallback);
    if (!allowsSlugId(target.sourceId) && !isNumeric(target.id)) return sendJson(res, req, 400, { error: '书籍参数无效' });
    const book = await providerOf(target.sourceId).getBook(target.id);
    return sendJson(res, req, 200, { book: wrapBook(target.sourceId, book) });
  }

  if (url.pathname === '/api/chapters') {
    const fallback = resolveSourceId(params.get('source'));
    const target = parseBookId(params.get('id'), fallback);
    if (!allowsSlugId(target.sourceId) && !isNumeric(target.id)) return sendJson(res, req, 400, { error: '书籍参数无效' });
    const chapters = await providerOf(target.sourceId).getChapters(target.id);
    return sendJson(res, req, 200, { chapters });
  }

  if (url.pathname === '/api/chapter') {
    const fallback = resolveSourceId(params.get('source'));
    const target = parseBookId(params.get('id'), fallback);
    const chapterId = params.get('chapterId');
    if ((!allowsSlugId(target.sourceId) && !isNumeric(target.id)) || !isNumeric(chapterId)) return sendJson(res, req, 400, { error: '章节参数无效' });
    const content = await providerOf(target.sourceId).getChapterContent(target.id, chapterId);
    return sendJson(res, req, 200, { content });
  }

  if (url.pathname === '/api/cover') {
    return await handleCover(req, res, url);
  }

  return sendJson(res, req, 404, { error: '接口不存在' });
}

const staticCache = new Map();

function deliverStatic(req, res, headers, entry, ext) {
  const isHead = req.method === 'HEAD';
  if (!isHead && COMPRESSIBLE.has(ext) && entry.data.length > 1024 && acceptsGzip(req)) {
    if (!entry.gzip) entry.gzip = zlib.gzipSync(entry.data);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': entry.gzip.length });
    return res.end(entry.gzip);
  }
  res.writeHead(200, { ...headers, 'Content-Length': entry.data.length });
  res.end(isHead ? undefined : entry.data);
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return finish(res, req, 405, { Allow: 'GET, HEAD' }, null);
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return finish(res, req, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Bad Request'));
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(root, '.' + rel.replace(/\/+/g, '/'));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return finish(res, req, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Forbidden'));
  }

  fs.stat(resolved, function (err, st) {
    if (err || !st.isFile()) {
      return finish(res, req, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Not Found'));
    }
    const ext = path.extname(resolved).toLowerCase();
    const etag = '"' + st.mtimeMs.toString(36) + '-' + st.size.toString(36) + '"';
    const revalidate = ext === '.html' || ext === '.js' || ext === '.css';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      return finish(res, req, 304, headers, null);
    }

    let entry = staticCache.get(resolved);
    if (entry && entry.mtime === st.mtimeMs) return deliverStatic(req, res, headers, entry, ext);

    fs.readFile(resolved, function (e, data) {
      if (e) {
        return finish(res, req, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Not Found'));
      }
      entry = { mtime: st.mtimeMs, data: data };
      staticCache.set(resolved, entry);
      deliverStatic(req, res, headers, entry, ext);
    });
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return finish(res, req, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Bad Request'));
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    sendJson(res, req, 502, { error: String(err.message || '服务异常，请稍后重试') });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[小说阅读] 端口 ${PORT} 已被占用，请使用 PORT=xxxx 指定其他端口`);
    process.exit(1);
  }
  console.error('[小说阅读] 服务错误:', err.message);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, () => {
  console.log(`[小说阅读] 已加载书源: ${sources.map((item) => item.name).join(' / ')}`);
  console.log(`[小说阅读] 服务已启动: http://localhost:${PORT}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[小说阅读] 收到 ${signal}，正在关闭服务…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
