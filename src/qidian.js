const MOBILE_HOST = 'https://m.qidian.com';
const TOC_API = 'https://wxapp.qidian.com/api/book/categoryV2';
const COVER_BASE = 'https://bookcover.yuewen.com/qdbimg/349573/';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const CACHE_MAX_ENTRIES = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '', shy: '' };

const cache = new Map();
const inflight = new Map();
const cookies = new Map();

let csrfToken = '';
let sessionPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code) => {
    if (code[0] === '#') {
      const charCode = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(charCode) ? String.fromCodePoint(charCode) : match;
    }
    return ENTITIES[code] === undefined ? match : ENTITIES[code];
  });
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function parseWords(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim();
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return 0;
  if (raw.includes('亿')) return Math.round(num * 100000000);
  if (raw.includes('万')) return Math.round(num * 10000);
  return Math.round(num);
}

function coverById(id, size) {
  return `${COVER_BASE}${id}/${size || 180}`;
}

function normalizeCover(value, id, size) {
  let src = String(value || '').trim();
  if (!src) return coverById(id, size);
  if (src.startsWith('//')) src = 'https:' + src;
  if (!/^https?:/i.test(src)) src = 'https://' + src.replace(/^\/+/, '');
  return src;
}

function baseHeaders() {
  return {
    'user-agent': USER_AGENT,
    'accept-language': 'zh-CN,zh;q=0.9',
    'accept': 'text/html,application/json,text/plain,*/*',
    'referer': MOBILE_HOST + '/',
  };
}

function absorbCookies(headers) {
  let list = [];
  if (typeof headers.getSetCookie === 'function') {
    list = headers.getSetCookie();
  } else if (typeof headers.get === 'function') {
    const raw = headers.get('set-cookie');
    if (raw) list = raw.split(/,(?=[^;,\s]+=)/);
  }
  for (const entry of list) {
    const pair = String(entry).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value) cookies.set(name, value);
  }
}

function cookieHeader() {
  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function csrfTokenCookie() {
  return cookies.get('_csrfToken') || '';
}

async function fetchSession() {
  const res = await fetch(`${MOBILE_HOST}/soushu/%E5%B0%8F%E8%AF%B4.html?pageNum=1`, {
    headers: baseHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  absorbCookies(res.headers);
  const token = csrfTokenCookie();
  if (!token) throw new Error('无法建立起点访问会话');
  csrfToken = token;
  return token;
}

async function ensureSession(force) {
  if (csrfToken && !force) return csrfToken;
  if (force) {
    csrfToken = '';
    sessionPromise = null;
    cookies.delete('_csrfToken');
  }
  if (!sessionPromise) sessionPromise = fetchSession().finally(() => { sessionPromise = null; });
  return sessionPromise;
}

async function requestText(target, options = {}) {
  const retries = options.retries === undefined ? 2 : options.retries;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = baseHeaders();
      const cookie = cookieHeader();
      if (cookie) headers.cookie = cookie;
      const res = await fetch(target, { headers, signal: AbortSignal.timeout(20000) });
      absorbCookies(res.headers);
      if (!res.ok) throw new Error(`起点页面请求失败（HTTP ${res.status}）`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

async function requestJson(target, options = {}) {
  const authorize = !!options.authorize;
  const retries = options.retries === undefined ? 1 : options.retries;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (authorize) await ensureSession(attempt > 0);
      const headers = baseHeaders();
      const cookie = cookieHeader();
      if (cookie) headers.cookie = cookie;
      const url = authorize && csrfToken
        ? `${target}&_csrfToken=${encodeURIComponent(csrfToken)}`
        : target;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      absorbCookies(res.headers);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`起点接口返回非 JSON 数据（HTTP ${res.status}）`);
      }
      if (json.code === undefined || json.code === 0) return json;
      const err = new Error(json.msg || '起点接口错误');
      if (authorize && json.code === 1 && attempt < retries) {
        await ensureSession(true);
        continue;
      }
      throw err;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

function readPageData(html) {
  const match = String(html).match(/<script id="vite-plugin-ssr_pageContext" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && parsed.pageContext && parsed.pageContext.pageProps
      ? parsed.pageContext.pageProps.pageData || {}
      : null;
  } catch {
    return null;
  }
}

function normalizeRecord(record) {
  const id = String(record.bid || record.cbid || record.cid || '');
  const tags = [];
  for (const candidate of [record.cat, record.subCateName, record.state]) {
    const value = stripTags(candidate);
    if (value && tags.indexOf(value) < 0) tags.push(value);
  }
  return {
    id,
    title: stripTags(record.bName),
    author: stripTags(record.bAuth),
    intro: stripTags(record.desc).slice(0, 120),
    cover: normalizeCover(record.imgUrl, id, 180),
    tags,
    words: parseWords(record.cnt || record.wordsCnt || record.showWordsCnt),
    score: '',
  };
}

function pageMeta(page, pageSize, total, pageMax) {
  if (Number.isFinite(pageMax) && pageMax > 0) return pageMax;
  if (total > 0) return Math.max(1, Math.ceil(total / (pageSize || 20)));
  if (pageSize > 0) return page + 1;
  return page;
}

function cleanContent(value) {
  const html = String(value || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/?\s*p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(html)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
}

async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  }
  let promise = inflight.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const value = await producer();
        cache.set(key, { time: Date.now(), value });
        if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
  }
  return promise;
}

export async function search(keyword, page = 1) {
  const html = await requestText(`${MOBILE_HOST}/soushu/${encodeURIComponent(keyword)}.html?pageNum=${page}`);
  const data = readPageData(html) || {};
  const info = data.bookInfo || {};
  const records = Array.isArray(info.records) ? info.records : [];
  const pageSize = Number(info.pageSize) || 20;
  return {
    list: records.map(normalizeRecord),
    totalPages: pageMeta(Number(info.pageNum) || page, pageSize, Number(info.total) || 0),
    page: Number(info.pageNum) || page,
  };
}

async function listByRank(id, page) {
  const segments = String(id).split(':');
  if (segments.length !== 2 || !segments[0] || !segments[1]) throw new Error('榜单参数无效');
  const json = await requestJson(`${MOBILE_HOST}/majax/rank/${encodeURIComponent(segments[1])}?gender=${encodeURIComponent(segments[0])}&pageNum=${page}`, { authorize: true });
  const data = json.data || {};
  const records = Array.isArray(data.records) ? data.records : [];
  return {
    list: records.map(normalizeRecord),
    totalPages: pageMeta(Number(data.pageNum) || page, records.length || 20, Number(data.total) || 0),
    page: Number(data.pageNum) || page,
  };
}

async function listByCategory(id, page) {
  const segments = String(id).split(':');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) throw new Error('分类参数无效');
  const json = await requestJson(
    `${MOBILE_HOST}/majax/category/list?catId=${encodeURIComponent(segments[1])}&subCatId=${encodeURIComponent(segments[2])}&gender=${encodeURIComponent(segments[0])}&pageNum=${page}`,
    { authorize: true }
  );
  const data = json.data || {};
  const records = Array.isArray(data.records) ? data.records : [];
  const pageSize = Number(data.pageSize) || records.length || 20;
  return {
    list: records.map(normalizeRecord),
    totalPages: pageMeta(Number(data.pageNum) || page, pageSize, Number(data.total) || 0, Number(data.pageMax) || 0),
    page: Number(data.pageNum) || page,
  };
}

export async function list(kind, id, page = 1) {
  if (kind === 'rank') return listByRank(id, page);
  if (kind === 'category') return listByCategory(id, page);
  throw new Error('不支持的列表类型');
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${MOBILE_HOST}/book/${encodeURIComponent(id)}/`);
    const data = readPageData(html) || {};
    const info = data.bookInfo || {};
    const extra = data.bookExtra || {};
    const fans = data.fansInfo || {};
    const tags = [];
    if (Array.isArray(extra.ugcTagInfos)) {
      for (const tag of extra.ugcTagInfos) {
        const value = stripTags(tag && (tag.TagName || tag.tagName));
        if (value && tags.indexOf(value) < 0) tags.push(value);
      }
    }
    const bookId = String(info.bookId || id);
    return {
      id: bookId,
      title: stripTags(info.bookName),
      author: stripTags(info.authorName),
      cover: info.coverUrl ? normalizeCover(info.coverUrl, bookId, 600) : coverById(bookId, 600),
      intro: String(info.desc || '').trim(),
      tags,
      words: Number(info.wordsCnt) || parseWords(info.showWordsCnt),
      category: [stripTags(info.chanName), stripTags(info.subCateName)].filter(Boolean).join(' · '),
      status: stripTags(info.bookStatus),
      latestChapter: stripTags(info.updChapterName),
      updateTime: Number(info.updTimes) * 1000 || 0,
      statement: fans.fansTotal ? `书友 ${fans.fansTotal}` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const json = await requestJson(`${TOC_API}?bookId=${encodeURIComponent(bookId)}`, { retries: 2 });
    const volumes = json.data && Array.isArray(json.data.vs) ? json.data.vs : [];
    const chapters = [];
    let index = 0;
    for (const volume of volumes) {
      const items = Array.isArray(volume.cs) ? volume.cs : [];
      for (const chapter of items) {
        chapters.push({
          id: String(chapter.id),
          title: stripTags(chapter.cN) || `第${index + 1}章`,
          words: Number(chapter.cnt) || 0,
          index: index++,
        });
      }
    }
    return chapters;
  });
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const html = await requestText(`${MOBILE_HOST}/chapter/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}/`);
    const data = readPageData(html) || {};
    const chapter = data.chapterInfo || {};
    const content = chapter.content;
    if (!content) throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    return cleanContent(content);
  });
}
