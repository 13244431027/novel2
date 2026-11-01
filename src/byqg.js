const HOST = 'https://www.byqg.cc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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

function parseWords(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim();
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return 0;
  if (raw.includes('亿')) return Math.round(num * 100000000);
  if (raw.includes('万')) return Math.round(num * 10000);
  return Math.round(num);
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
      if (attempt < retries) await sleep(500 * (attempt + 1));
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

function parseBooks(html) {
  const list = [];
  const re = /<div class="bookinfo">([\s\S]*?)<\/div>\s*<\/div>/g;
  let match;
  while ((match = re.exec(html))) {
    const block = match[1];
    const href = (block.match(/<a[^>]+href="\/book\/([a-zA-Z0-9]+)\.html"/) || [])[1];
    if (!href) continue;
    const title = (block.match(/<h2 class="bookname">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const author = (block.match(/作者[：:]\s*([^<]+)/) || [])[1] || '';
    const wordsRaw = (block.match(/字数[：:]\s*([^<]+)/) || [])[1] || '';
    const intro = (block.match(/简介[：:]<\/span>([\s\S]*?)<\/div>/) || [])[1]
      || (block.match(/<div class="update"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    if (!stripInline(title)) continue;
    list.push({
      id: href,
      title: stripInline(title),
      author: stripTags(author),
      intro: stripTags(intro).slice(0, 140),
      cover: '',
      tags: [],
      words: parseWords(wordsRaw),
      score: '',
      latestChapter: '',
    });
  }
  return list;
}

function totalPagesFrom(html) {
  const last = html.match(/class="last"[^>]*href="[^"]*?(\d+)\.html"/)
    || html.match(/href="[^"]*?(\d+)\.html"[^>]*class="last"/);
  if (last) return Number(last[1]) || 1;
  const pages = [...html.matchAll(/class="page"[^>]*>[\s\S]*?<a href="[^"]*?(\d+)\.html"/g)];
  return pages.length ? Number(pages[pages.length - 1][1]) || 1 : 1;
}

export const SECTIONS = [
  {
    key: 'category',
    name: '分类',
    items: [
      ['玄幻', '3j60Al2J6aEQvWFfJmSizr'], ['仙侠', 'resIRzyoE401QajeUymgn'], ['都市', '3B21UHLP8KrzfeYIPsArBp'],
      ['历史', 'H3sDVoLvXWx3h3ivdXwgB'], ['科幻', 'Cp0sda3r5LmSK6cghq0b0'], ['军事', '5st1gil4MXOf262kjquJgQ'],
      ['言情', 'dpW1A5qFkBbLGAvTFu2s'], ['轻小说', '29tDzNPydoqUhYehjpef8P'], ['悬疑', '55PZODSwAZ9Wsd2FAfF43i'],
      ['奇幻', 'dTGt7MsEVgLqFaeGtydjw'], ['游戏', '5HxCwRWS4ZBwmh6ju1xn1X'], ['诸天无限', '2wYKuP8qBF6nXVHlXbzVC8'],
      ['武侠', '5d4etgRfGWROezKGuQ7KCr'], ['重生', 'iPXVtWNiNYqz4CNL2SzIo'], ['体育', 'xRooPGBpRQhawbXAkXbHq'],
      ['现实', '1bQ2IpTozNx87QBAX3Nhyh'], ['穿越', '2JYvr7HSCpos8cHN4cY2VQ'], ['未删减', '2ni2CHKCPVVuASAl3sHHOP'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
];

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search/${encodeURIComponent(keyword)}.html`);
  let list = parseBooks(html);
  const start = (page - 1) * 20;
  if (start > 0 && page > 1) list = [];
  return { list: list.slice(start, start + 20), totalPages: Math.max(1, Math.ceil(list.length / 20)), page };
}

function listUrl(kind, id, page) {
  if (kind === 'category') {
    return page <= 1
      ? `${HOST}/library/${id}.html`
      : `${HOST}/library/${id}/${page}.html`;
  }
  if (kind === 'rank') {
    const known = ['hits', 'words', 'guru', 'create', 'update'];
    if (known.includes(id)) {
      return page <= 1
        ? `${HOST}/ranking/${id}.html`
        : `${HOST}/ranking/${id}/${page}.html`;
    }
  }
  throw new Error('分类参数无效');
}

export async function list(kind, id, page = 1) {
  const html = await requestText(listUrl(kind, id, page));
  return { list: parseBooks(html), totalPages: totalPagesFrom(html), page };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const code = encodeURIComponent(String(id));
    const html = await requestText(`${HOST}/book/${code}.html`);
    const title = (html.match(/<h1 class="booktitle"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const author = (html.match(/class="booktag"[^>]*>[\s\S]*?作者[^<]*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]
      || (html.match(/<p class="booktag"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    const intro = (html.match(/<p class="bookintro">([\s\S]*?)<\/p>/) || [])[1] || '';
    const tags = (html.match(/<meta name="keywords" content="([^"]*)"/) || [])[1]
      ? (html.match(/<meta name="keywords" content="([^"]*)"/) || [])[1].split(',').filter(Boolean).slice(0, 5)
      : [];
    const wordsRaw = (html.match(/字数[：:]\s*<span class="blue">([^<]+)/) || [])[1]
      || (html.match(/>([\d.]+万?字)</) || [])[1] || '';
    const status = (html.match(/class="blue">全本<|>连载</) || []) ? (html.includes('class="blue">全本') ? '已完结' : '连载中') : '';
    const latest = (html.match(/更新到[：:][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    let count = 0;
    const toc = await requestText(`${HOST}/chapter/${code}.html`, `${HOST}/book/${code}.html`);
    count = (toc.match(/<dd data-num="[^"]*">\s*<a/g) || []).length;
    return {
      id: String(id),
      title: stripTags(title),
      author: stripTags(author),
      cover: '',
      intro: stripTags(intro),
      tags,
      words: parseWords(wordsRaw),
      category: '',
      status,
      latestChapter: stripTags(latest),
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const code = encodeURIComponent(String(bookId));
    const chapters = [];
    let pageNo = 1;
    let index = 0;
    const seen = new Set();
    for (; pageNo <= 1000; pageNo++) {
      const url = pageNo <= 1
        ? `${HOST}/chapter/${code}.html`
        : `${HOST}/chapter/${code}/${pageNo}.html`;
      const html = await requestText(url, `${HOST}/book/${code}.html`);
      const re = /<dd data-num="[^"]*">\s*<a[^>]+href="\/chapter\/[^"]+\/([a-zA-Z0-9]+)\.html"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      let found = false;
      while ((match = re.exec(html))) {
        const cid = match[1];
        if (seen.has(cid)) continue;
        seen.add(cid);
        found = true;
        chapters.push({
          id: cid,
          title: stripTags(match[3] || match[2]) || `第${chapters.length + 1}章`,
          words: 0,
          index: index++,
          vip: false,
        });
      }
      const next = html.match(/id="linkNext"[^>]*href="\/chapter\/[^"]+?\/(\d+)\.html"/)
        || html.match(/href="\/chapter\/[^"]+?\/(\d+)\.html"[^>]*id="linkNext"/);
      if (!next) break;
      const nextNo = Number(next[1]);
      if (!found || nextNo <= pageNo) break;
      pageNo = nextNo - 1;
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
    const code = encodeURIComponent(String(bookId));
    const cid = encodeURIComponent(String(chapterId));
    const html = await requestText(`${HOST}/chapter/${code}/${cid}.html`, `${HOST}/chapter/${code}.html`);
    const match = html.match(/<div role="main" id="content" class="readcontent">([\s\S]*?)<\/div>\s*<\/div>/);
    const body = match ? match[1] : '';
    const content = cleanContent(body);
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}