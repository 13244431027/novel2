const HOST = 'https://wap.shoujixs.net';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
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
      if (!res.ok) throw new Error(`手机小说请求失败（HTTP ${res.status}）`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

async function postText(target, body, referer, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { ...baseHeaders(referer), 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`手机小说请求失败（HTTP ${res.status}）`);
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

function coverById(id) {
  const num = String(id).match(/\d+/);
  if (!num) return '';
  const value = num[0];
  const dir = Math.floor(Number(value) / 1000);
  return `https://images.shoujixs.net/${dir}/${value}/${value}s.jpg`;
}

function metaValue(html, name, property) {
  const attr = property ? 'property' : 'name';
  const re1 = html.match(new RegExp(`<meta[^>]+${attr}="([^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"[^>]*content="([^"]*)"`));
  if (re1) return re1[2];
  const re2 = html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="([^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`));
  return re2 ? re2[1] : '';
}

function parseListBlock(html) {
  const list = [];
  const re = /class="hot_sale[^"]*"><span class="num[^"]*"[^>]*>[\s\S]*?<a href="\/([a-zA-Z0-9_]+)\/">([\s\S]*?)<\/a>/g;
  const reCover = /class="hot_sale[^"]*">\s*<a href="\/([a-zA-Z0-9_]+)\/"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = reCover.exec(html))) {
    const id = match[1].replace(/^shoujixs_/, '');
    const title = stripInline(match[3]) || stripInline(match[4]);
    if (!title) continue;
    const block = match[4];
    const authors = block.match(/class="author"[^>]*>([\s\S]*?)<\/p>/g) || [];
    const author = String(((authors[0] || '').match(/作者[：:]\s*([^<|]+)/) || [])[1] || '').trim();
    const coverSrc = String(match[2] || '');
    const cover = (coverSrc.includes('nocover') ? '' : absoluteUrl(coverSrc)) || coverById(id);
    list.push({
      id,
      title,
      author,
      intro: '',
      cover,
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  const used = new Set(list.map((item) => item.id));
  while ((match = re.exec(html))) {
    const rawId = match[1];
    const id = rawId.replace(/^shoujixs_/, '');
    if (used.has(id)) continue;
    used.add(id);
    const block = match[2];
    const title = (block.match(/class="title"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    const authors = block.match(/class="author"[^>]*>([\s\S]*?)<\/p>/g) || [];
    const author = String(((authors[0] || '').match(/作者[：:]\s*([^<|]+)/) || [])[1] || '').trim();
    const latest = stripTags(authors[1] || '');
    if (!title) continue;
    list.push({
      id,
      title: stripInline(title),
      author,
      intro: '',
      cover: '',
      tags: [],
      words: 0,
      score: '',
      latestChapter: latest,
    });
  }
  return list;
}

function absoluteUrl(value) {
  let src = String(value || '').trim();
  if (!src) return '';
  if (src.startsWith('//')) return 'https:' + src;
  if (/^https?:/i.test(src)) return src;
  return HOST + (src.startsWith('/') ? src : '/' + src);
}

function totalPagesFrom(html) {
  const options = [...html.matchAll(/<option[^>]*value="\/([a-zA-Z0-9_]+)_(\d+)\.html"[^>]*>第(\d+)页/g)];
  if (!options.length) return 1;
  return Math.max(...options.map((o) => Number(o[2])));
}

export const SECTIONS = [
  {
    key: 'category',
    name: '分类',
    items: [
      ['玄幻奇幻', 'xhqh'], ['武侠小说', 'wx'], ['仙侠小说', 'xx'], ['都市现实', 'ds'],
      ['军事小说', 'js'], ['历史小说', 'ls'], ['游戏体育', 'yxty'], ['科幻小说', 'kh'],
      ['灵异小说', 'ly'], ['二次元类', 'ecy'], ['言情小说', 'yq'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
  {
    key: 'rank',
    name: '排行',
    items: [
      ['周榜', 'week'], ['月榜', 'month'], ['总榜', 'all'], ['全本', 'quanben'],
    ].map(([name, kind]) => ({ name, kind: 'rank', id: kind })),
  },
];

export async function search(keyword, page = 1) {
  const html = await postText(`${HOST}/search/`, `searchkey=${encodeURIComponent(keyword)}&t=1`, `${HOST}/`);
  const list = parseListBlock(html);
  return { list, totalPages: 1, page: 1 };
}

function listUrl(kind, id, page) {
  const cat = { xhqh: 'xhqh', wx: 'wx', xx: 'xx', ds: 'ds', js: 'js', ls: 'ls', yxty: 'yxty', kh: 'kh', ly: 'ly', ecy: 'ecy', yq: 'yq' }[id];
  if (kind === 'category' && cat) return `${HOST}/${cat}_${page}.html`;
  const rank = { week: 'top/week', month: 'top/month', all: 'top/all', quanben: 'quanben' }[id];
  if (kind === 'rank' && rank) return `${HOST}/${rank}_${page}.html`;
  throw new Error('分类参数无效');
}

export async function list(kind, id, page = 1) {
  const html = await requestText(listUrl(kind, id, page));
  const list = parseListBlock(html);
  return { list, totalPages: totalPagesFrom(html), page };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/shoujixs_${encodeURIComponent(String(id))}/`);
    const title = stripTags(metaValue(html, 'og:novel:book_name', true) || metaValue(html, 'og:title', true) || '');
    const intro = stripTags(metaValue(html, 'og:description', true) || metaValue(html, 'description', false) || '');
    const category = stripTags(metaValue(html, 'og:novel:category', true) || '');
    const status = stripTags(metaValue(html, 'og:novel:status', true) || '');
    const latest = stripTags(metaValue(html, 'og:novel:latest_chapter_name', true) || '');
    const anchor = html.indexOf('全部章节列表');
    const block = anchor >= 0 ? html.slice(anchor) : '';
    const count = (block.match(/shoujixs_\d+_\d+\.html/g) || []).length;
    return {
      id: String(id),
      title,
      author: stripTags(metaValue(html, 'og:novel:author', true) || ''),
      cover: absoluteUrl(metaValue(html, 'og:image', true)),
      intro,
      tags: [],
      words: 0,
      category,
      status,
      latestChapter: latest,
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const id = String(bookId);
    const html = await requestText(`${HOST}/shoujixs_${encodeURIComponent(id)}/`);
    const anchor = html.indexOf('全部章节列表');
    const block = anchor >= 0 ? html.slice(anchor) : '';
    const chapters = [];
    const re = /shoujixs_\d+_(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
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
    const parts = [];
    for (let pageNo = 1; pageNo <= 20; pageNo++) {
      const url = pageNo <= 1
        ? `${HOST}/shoujixs_${id}_${cid}.html`
        : `${HOST}/shoujixs_${id}_${cid}_${pageNo}.html`;
      const html = await requestText(url, `${HOST}/shoujixs_${id}/`);
      const match = html.match(/<div id="articlecon"[^>]*>([\s\S]*?)<\/div>/i);
      if (match && match[1].replace(/<[^>]+>/g, '').trim()) parts.push(cleanContent(match[1]));
      const next = html.match(/id="pt_next"[^>]*>([^<]*)/);
      if (!next || String(next[1]).trim() !== '下一页') break;
    }
    const content = parts.filter(Boolean).join('\n\n');
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}