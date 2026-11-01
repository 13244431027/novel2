const HOST = 'http://www.bqgz.cc';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36';
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
      if (!res.ok) throw new Error(`笔趣阁请求失败（HTTP ${res.status}）`);
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
  if (/^https?:/i.test(src)) {
    const host = src.split('/').slice(0, 3).join('/');
    if (host.toLowerCase().replace(/^https?:\/\//, '') !== new URL(HOST).hostname) return HOST + src.replace(/^[^:]*:\/+[^/]*\//, '/');
    return src;
  }
  return HOST + (src.startsWith('/') ? src : '/' + src);
}

function idFromHref(href) {
  const match = String(href || '').match(/\/book\/(\d+)\//);
  return match ? match[1] : '';
}

function parseSearch(html) {
  const list = [];
  const re = /<div class="pt-ll-l">\s*<a href="\/book\/(\d+)\/"[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<div class="pt-ll-r">([\s\S]*?)<\/div>/g;
  let match;
  while ((match = re.exec(html))) {
    const id = match[1];
    const block = match[3];
    const title = (block.match(/class="novelname"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const author = (block.match(/作者[：:]?[^>]*>([^<]+)</) || [])[1] || '';
    const intro = (block.match(/<p class="intro">([\s\S]*?)<\/p>/) || [])[1] || '';
    if (!stripInline(title)) continue;
    list.push({
      id,
      title: stripInline(title),
      author: stripTags(author),
      intro: stripTags(intro).slice(0, 120),
      cover: absoluteUrl(match[2]),
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  if (!list.length) {
    const re2 = /href="\/book\/(\d+)\/"[^>]*>[\s\S]*?class="novelname"[^>]*>([\s\S]*?)<\/a>/g;
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

export const SECTIONS = [
  {
    key: 'category',
    name: '分类',
    items: [
      ['玄幻', 'xuanhuan'], ['武侠', 'wuxia'], ['都市', 'dushi'], ['历史', 'lishi'],
      ['网游', 'wangyou'], ['科幻', 'kehuan'], ['言情', 'yanqing'], ['轻小说', 'qing'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
];

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search/result.html?searchkey=${encodeURIComponent(keyword)}`);
  const list = parseSearch(html);
  return { list, totalPages: 1, page: 1 };
}

function listUrl(id, page) {
  return page <= 1 ? `${HOST}/category/${id}.html` : `${HOST}/category/${id}/${page}.html`;
}

export async function list(kind, id, page = 1) {
  const html = await requestText(listUrl(id, page));
  const list = [];
  const re = /href="\/book\/(\d+)\/"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?class="novelname"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  const used = new Set();
  while ((match = re.exec(html))) {
    if (used.has(match[1])) continue;
    used.add(match[1]);
    if (!stripInline(match[3])) continue;
    list.push({
      id: match[1],
      title: stripInline(match[3]),
      author: '',
      intro: '',
      cover: absoluteUrl(match[2]) || '',
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  const totalPages = (() => {
    const pages = [...html.matchAll(/category\/[a-z]+\/(\d+)\.html/g)].map((m) => Number(m[1]));
    return pages.length ? Math.max(...pages) : 1;
  })();
  return { list, totalPages, page };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/book/${encodeURIComponent(String(id))}/`);
    const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const author = (html.match(/<li[^>]*>\s*作者[：:][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const cover = (html.match(/class="novelinfo-r"[^>]*>\s*<img[^>]*src="([^"]+)"/) || [])[1] || '';
    const intro = (html.match(/<div[^>]*class="[^"]*intro[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const kind = (html.match(/<li[^>]*>\s*分类[：:][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const latest = (html.match(/<li[^>]*>\s*最新章节[：:][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const dirIndex = html.indexOf('dirlist');
    const dirBlock = dirIndex >= 0 ? html.slice(dirIndex) : html;
    const count = (dirBlock.match(new RegExp(`href="\\/book\\/${id}\\/\\d+\\.html"`, 'g')) || []).length;
    return {
      id: String(id),
      title: stripTags(title),
      author: stripTags(author),
      cover: absoluteUrl(cover),
      intro: stripTags(intro),
      tags: kind ? [stripTags(kind)] : [],
      words: 0,
      category: stripTags(kind),
      status: '',
      latestChapter: stripTags(latest),
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const id = String(bookId);
    const html = await requestText(`${HOST}/book/${encodeURIComponent(id)}/`);
    const dirIndex = html.indexOf('dirlist');
    const block = dirIndex >= 0 ? html.slice(dirIndex) : html;
    const chapters = [];
    const re = new RegExp(`href="\\/book\\/${id}\\/(\\d+)\\.html"[^>]*>([\\s\\S]*?)<\\/a>`, 'g');
    let match;
    let index = 0;
    const seen = new Set();
    while ((match = re.exec(block))) {
      const cid = match[1];
      if (seen.has(cid)) continue;
      seen.add(cid);
      chapters.push({
        id: cid,
        title: stripTags(match[2]) || `第${index + 1}章`,
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
    const html = await requestText(`${HOST}/book/${id}/${cid}.html`, `${HOST}/book/${id}/`);
    const anchor = html.match(/<div[^>]*id="chaptercontent"[^>]*>/i)
      || html.match(/<div[^>]*id="htmlContent"[^>]*>/i)
      || html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>/i);
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