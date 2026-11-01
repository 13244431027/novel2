const HOST = 'https://www.lewen5.co';
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

async function requestText(target, referer, method, body, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const options = { headers: baseHeaders(referer), signal: AbortSignal.timeout(20000) };
      if (method) {
        options.method = method;
        options.headers['content-type'] = 'application/x-www-form-urlencoded';
        options.body = body;
      }
      const res = await fetch(target, options);
      if (!res.ok) throw new Error(`乐文网请求失败（HTTP ${res.status}）`);
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
  const re = /<dl class="rec-focus-book">[\s\S]*?<a href="\/book\/(\d+)\/"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?<p>作者[：:]\s*([^<]+)<\/p>[\s\S]*?<dt class="book-img">[\s\S]*?<img[^>]*src="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const title = stripInline(match[2]);
    if (!title) continue;
    list.push({
      id,
      title,
      author: stripTags(match[3]),
      intro: '',
      cover: absoluteUrl(match[4]),
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  if (!list.length) {
    const re2 = /href="\/book\/(\d+)\/"[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<h2>[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?作者[：:]\s*([^<]+)/g;
    while ((match = re2.exec(html))) {
      const title = stripInline(match[3]);
      if (!title) continue;
      list.push({
        id: match[1],
        title,
        author: stripTags(match[4]),
        intro: '',
        cover: absoluteUrl(match[2]),
        tags: [],
        words: 0,
        score: '',
        latestChapter: '',
      });
    }
  }
  return list;
}

export const SECTIONS = [
  {
    key: 'category',
    name: '分类',
    items: [
      ['玄幻', 'xuanhuan'], ['武侠', 'wuxia'], ['都市', 'dushi'], ['历史', 'lishi'],
      ['网游', 'wangyou'], ['科幻', 'kehuan'], ['言情', 'yanqing'], ['仙侠', 'xianxia'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
];

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search.html`, `${HOST}/`, 'POST', `s=${encodeURIComponent(keyword)}`);
  const list = parseSearch(html);
  return { list, totalPages: 1, page: 1 };
}

export async function list(kind, id, page = 1) {
  throw new Error('该书源不支持分类浏览');
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/book/${encodeURIComponent(String(id))}/`);
    const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const cover = (html.match(/class="book-main"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/) || [])[1] || '';
    const author = (html.match(/class="author"[^>]*>([\s\S]*?)<\/p>/) || [])[1]
      || (html.match(/作者[：:]\s*([^<]+)/) || [])[1] || '';
    const intro = (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/) || [])[1] || '';
    const latest = (html.match(/class="update"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    return {
      id: String(id),
      title: stripTags(title),
      author: stripTags(author),
      cover: absoluteUrl(cover),
      intro: decodeEntities(intro),
      tags: [],
      words: 0,
      category: '',
      status: '',
      latestChapter: stripTags(latest),
      updateTime: 0,
      statement: '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const id = String(bookId);
    const chapters = [];
    const seen = new Set();
    let index = 0;
    for (let pageNo = 1; pageNo <= 100; pageNo++) {
      const html = await requestText(`${HOST}/book/${id}/ml_${pageNo}.html`, `${HOST}/book/${id}/`);
      const re = new RegExp(`href="\\/book\\/${id}\\/(\\d+)\\.html"[^>]*>([\\s\\S]*?)<\\/a>`, 'g');
      let match;
      let found = false;
      while ((match = re.exec(html))) {
        const cid = match[1];
        if (seen.has(cid)) continue;
        const title = stripTags(match[2]);
        if (!title || /^(开始阅读|章节目录)$/.test(title)) continue;
        seen.add(cid);
        found = true;
        chapters.push({
          id: cid,
          title: title || `第${index + 1}章`,
          words: 0,
          index: index++,
          vip: false,
        });
      }
      const next = html.match(/href="[^"]*?ml_(\d+)\.html"[^>]*>\s*下一页|href="[^"]*?ml_(\d+)\.html"[^>]*>\s*&gt;/);
      if (!found || !next) break;
      pageNo = Number(next[1] || next[2]) - 1;
    }
    if (!chapters.length) throw new Error('获取章节列表失败');
    chapters.sort((a, b) => Number(a.id) - Number(b.id));
    chapters.forEach((c, i) => { c.index = i; });
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
    .replace(/^([^一-龥]+|说更新最快小说阅读网)+/, '')
    .trim();
}

function extractWriteln(html) {
  const parts = [];
  const re = /document\.writeln\((?:qsbs\.bb)?\('([^']+)'\)/g;
  let match;
  while ((match = re.exec(html))) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      parts.push(restoreEntities(decoded));
    } catch {
      // ignore
    }
  }
  return parts.join('');
}

function restoreEntities(value) {
  return String(value || '').split(';').map((token) => /^[0-9a-fA-F]{3,6}$/.test(token) ? '&#x' + token + ';' : token).join('');
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const id = String(bookId);
    const cid = String(chapterId);
    const html = await requestText(`${HOST}/book/${id}/${cid}.html`, `${HOST}/book/${id}/`);
    const body = extractWriteln(html) || (html.match(/<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    const content = cleanContent(body);
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}