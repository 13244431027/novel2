const HOST = 'http://m.xinbqg.com';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const CACHE_MAX_ENTRIES = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '', shy: '' };

const cache = new Map();
const inflight = new Map();

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
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripInline(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function baseHeaders(referer) {
  return {
    'user-agent': USER_AGENT,
    'accept-language': 'zh-CN,zh;q=0.9',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'referer': referer || HOST + '/',
  };
}

async function requestText(target, referer, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(target, { headers: baseHeaders(referer), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`新百强小说请求失败（HTTP ${res.status}）`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
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

function absoluteUrl(value) {
  let src = String(value || '').trim();
  if (!src) return '';
  if (src.startsWith('//')) return 'http:' + src;
  if (/^https?:/i.test(src)) return src;
  return HOST + (src.startsWith('/') ? src : '/' + src);
}

function metaValue(html, name, property) {
  const attr = property ? 'property' : 'name';
  const re1 = html.match(new RegExp(`<meta[^>]+${attr}="([^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"[^>]*content="([^"]*)"`));
  if (re1) return re1[2];
  const re2 = html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="([^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`));
  return re2 ? re2[1] : '';
}

function parseSearch(html) {
  const list = [];
  const re = /<a href="\/(\d+_\d+)\/"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const title = stripInline(match[2]);
    if (!title) continue;
    list.push({
      id,
      title,
      author: '',
      intro: '',
      cover: '',
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  if (!list.length) {
    const re2 = /href="\/(\d+_\d+)\/"/g;
    const seen = new Set();
    while ((match = re2.exec(html))) {
      if (seen.has(match[1])) continue;
      seen.add(match[1]);
      list.push({
        id: match[1],
        title: '',
        author: '',
        intro: '',
        cover: '',
        tags: [],
        words: 0,
        score: '',
        latestChapter: '',
      });
    }
  }
  return list;
}

export const SECTIONS = [];

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/s.php?q=${encodeURIComponent(keyword)}`);
  const list = parseSearch(html);
  return { list, totalPages: 1, page: 1 };
}

export async function list(kind, id, page = 1) {
  throw new Error('该书源不支持分类浏览');
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const rawId = String(id);
    const html = await requestText(`${HOST}/${rawId}/`);
    const title = stripTags(metaValue(html, 'og:novel:book_name', true) || metaValue(html, 'og:title', true) || '');
    const author = stripTags(metaValue(html, 'og:novel:author', true) || '');
    const cover = absoluteUrl(metaValue(html, 'og:image', true));
    const intro = stripTags(metaValue(html, 'og:description', true) || metaValue(html, 'description', false) || '');
    const category = stripTags(metaValue(html, 'og:novel:category', true) || '');
    const status = stripTags(metaValue(html, 'og:novel:status', true) || '');
    const latest = stripTags(metaValue(html, 'og:novel:latest_chapter_name', true) || '');
    return {
      id: rawId,
      title,
      author,
      cover,
      intro,
      tags: category ? [category] : [],
      words: 0,
      category,
      status: status === '完本' ? '已完结' : status,
      latestChapter: latest,
      updateTime: 0,
      statement: '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const rawId = String(bookId);
    const html = await requestText(`${HOST}/${rawId}/all.html`, `${HOST}/${rawId}/`);
    const chapters = [];
    const re = /href\s*=\s*"\/[^"]*\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let index = 0;
    const seen = new Set();
    while ((match = re.exec(html))) {
      const cid = match[1];
      if (seen.has(cid)) continue;
      const title = stripTags(match[2]);
      if (!title || /^(开始阅读|章节目录|目录|上一章|下一页)$/.test(title)) continue;
      seen.add(cid);
      chapters.push({
        id: cid,
        title: title || `第${index + 1}章`,
        words: 0,
        index: index++,
        vip: false,
      });
    }
    if (!chapters.length) throw new Error('获取章节列表失败');
    return chapters;
  });
}

function cleanContent(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function nextPage(html) {
  const href = html.match(/id="pb_next"[^>]*href="([^"]+)"/) || html.match(/href="([^"]+)"[^>]*id="pb_next"/);
  if (!href) return '';
  const text = html.match(/id="pb_next"[^>]*>([^<]*)/);
  const label = text ? text[1].trim() : '';
  if (label === '下ー章' || label === '下一章' || label === '下一章') return '';
  return href[1];
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const rawId = String(bookId);
    const cid = String(chapterId);
    const parts = [];
    let url = `${HOST}/${rawId}/${cid}.html`;
    for (let pageNo = 1; pageNo <= 20; pageNo++) {
      const html = await requestText(url, `${HOST}/${rawId}/`);
      const anchor = html.match(/<div id="chaptercontent"[^>]*>/i);
      if (anchor) {
        const start = anchor.index + anchor[0].length;
        const tail = html.slice(start, start + 200000);
        const body = (tail.match(/(?:<p[^>]*>[\s\S]*?<\/p>|<br\s*\/?>)+/g) || []).join('');
        const cleaned = cleanContent(body);
        if (cleaned) parts.push(cleaned);
      }
      const next = nextPage(html);
      if (!next) break;
      url = absoluteUrl(next);
    }
    const content = parts.filter(Boolean).join('\n\n');
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}