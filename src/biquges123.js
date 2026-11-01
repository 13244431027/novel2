const HOST = 'https://www.biquges123.com';
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
      if (!res.ok) throw new Error(`新笔趣阁请求失败（HTTP ${res.status}）`);
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
  if (src.startsWith('//')) return 'https:' + src;
  if (/^https?:/i.test(src)) return src;
  return HOST + (src.startsWith('/') ? src : '/' + src);
}

function parseSearch(html) {
  const list = [];
  const re = /<li class="hot_4_item">\s*<a href="\/(\d+)"[^>]*title="([^"]*)">([\s\S]*?)<\/a>\s*<\/li>/g;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const title = match[2] || '';
    const block = match[3] || '';
    const author = (block.match(/<div class="author">([\s\S]*?)<\/div>/) || [])[1] || '';
    const intro = (block.match(/<p class="hot_des">([\s\S]*?)<\/p>/) || [])[1] || '';
    const cover = (block.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '';
    if (!stripInline(title)) continue;
    list.push({
      id,
      title: stripInline(title),
      author: stripTags(author),
      intro: stripTags(intro).slice(0, 120),
      cover: absoluteUrl(cover),
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  if (!list.length) {
    const re2 = /<a href="\/(\d+)"[^>]*title="([^"]+)"/g;
    while ((match = re2.exec(html))) {
      if (!stripInline(match[2])) continue;
      list.push({
        id: match[1],
        title: stripInline(match[2]),
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
  const html = await requestText(`${HOST}/search?keyword=${encodeURIComponent(keyword)}&page=${page}`);
  const list = parseSearch(html);
  return { list, totalPages: 1, page: 1 };
}

export async function list(kind, id, page = 1) {
  throw new Error('该书源不支持分类浏览');
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/${encodeURIComponent(String(id))}`);
    const title = (html.match(/class="info_title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1]
      || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const cover = (html.match(/class="info_lt"[^>]*>\s*<img[^>]*src="([^"]+)"/) || [])[1] || '';
    const intro = (html.match(/class="des"[^>]*>([\s\S]*?)<\/div>/) || [])[1]
      || (html.match(/class="info_rt"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const authorBlock = (html.match(/class="info_ct"[^>]*>([\s\S]*?)<div class="info_btn"/) || [])[1]
      || (html.match(/class="info_ct"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const author = String((authorBlock.match(/作者[：:]\s*([^<]+)/) || [])[1] || '').trim();
    const status = String((authorBlock.match(/状态[：:]\s*([^<]+)/) || [])[1] || '').trim();
    const count = (html.match(/<li><a href="\/\d+\/\d+"[^>]*title="[^"]*"/g) || []).length;
    return {
      id: String(id),
      title: stripTags(title),
      author,
      cover: absoluteUrl(cover),
      intro: stripTags(intro),
      tags: [],
      words: 0,
      category: '',
      status,
      latestChapter: '',
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const id = String(bookId);
    const html = await requestText(`${HOST}/${encodeURIComponent(id)}`);
    const listIndex = html.indexOf('class="list"');
    const block = listIndex >= 0 ? html.slice(listIndex) : html;
    const chapters = [];
    const re = new RegExp(`href="\\/${id}\\/(\\d+)"[^>]*title="([^"]*)"[^>]*>([\\s\\S]*?)<\\/a>`, 'g');
    let match;
    let index = 0;
    const seen = new Set();
    while ((match = re.exec(block))) {
      const cid = match[1];
      if (seen.has(cid)) continue;
      seen.add(cid);
      chapters.push({
        id: cid,
        title: stripTags(match[3] || match[2]) || `第${index + 1}章`,
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

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const id = String(bookId);
    const cid = String(chapterId);
    const html = await requestText(`${HOST}/${id}/${cid}`, `${HOST}/${id}`);
    const anchor = html.match(/class="article"[^>]*>/i);
    let body = '';
    if (anchor) {
      const start = anchor.index + anchor[0].length;
      const tail = html.slice(start, start + 200000);
      body = (tail.match(/(?:<p[^>]*>[\s\S]*?<\/p>|<br\s*\/?>)+/g) || []).join('');
    }
    const content = cleanContent(body);
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}