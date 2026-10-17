const HOST = 'https://www.dbxsd.com';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const CACHE_MAX_ENTRIES = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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

function absoluteUrl(value) {
  let src = String(value || '').trim();
  if (!src) return '';
  if (src.startsWith('//')) return 'https:' + src;
  if (/^https?:/i.test(src)) return src;
  return HOST + (src.startsWith('/') ? src : '/' + src);
}

function numericPart(id) {
  const value = String(id);
  const match = /^p?(\d+)$/.exec(value);
  return match ? match[1] : (value.match(/(\d+)$/) || [])[1] || '';
}

function coverById(id, size) {
  const num = numericPart(id);
  if (!num) return '';
  return `${HOST}/uploads/cover/${num}${size === 'middle' ? '' : 's'}.jpg`;
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
      if (!res.ok) throw new Error(`独步小说网请求失败（HTTP ${res.status}）`);
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

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const queue = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(queue);
  return results;
}

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/plus/search.php?q=${encodeURIComponent(keyword)}`);
  const list = [];
  const re = /<tr>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = re.exec(html))) {
    const block = match[1];
    const href = (block.match(/<a[^>]+href="(\/book\/[^"]+\/)"/) || [])[1];
    if (!href) continue;
    const id = String(href).replace(/^\/book\//, '').replace(/\/$/, '');
    const title = (block.match(/<a[^>]+title="([^"]*)"/) || [])[1] || (block.match(/<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const author = (block.match(/<td>([\s\S]*?)<\/td>/g) || []).slice(1).map((cell) => stripTags(cell.replace(/^<td>/, '').replace(/<\/td>$/, ''))).find(Boolean) || '';
    list.push({
      id,
      title: stripInline(title).replace(/^《|》$/g, ''),
      author,
      intro: '',
      cover: coverById(id, 180),
      tags: [],
      words: 0,
      score: '',
    });
  }
  await withConcurrency(list.filter((item) => !item.cover), 5, (item) =>
    getBook(item.id).then((book) => {
      if (book.cover) item.cover = book.cover;
    }).catch(() => {})
  );
  return { list, totalPages: 1, page: 1 };
}

const CATEGORIES = {
  'xh-qh': '玄幻·奇幻',
  'kh-yx': '科幻·游戏',
  'xx-wx': '仙侠·武侠',
  'ns-yq': '女生·言情',
  'ds-yl': '都市·娱乐',
  'ls-js': '历史·军事',
  'xy-ly': '悬疑·灵异',
  'dm-ca': '耽美·纯爱',
  qxs: '轻小说',
};

function categoryUrl(id, page) {
  const cat = String(id);
  if (!CATEGORIES[cat]) throw new Error('分类参数无效');
  if (page <= 1) return `${HOST}/nav/${cat}.html`;
  return `${HOST}/nav/sub-${cat}-${page}.html`;
}

export async function list(kind, id, page = 1) {
  const html = await requestText(categoryUrl(id, page));
  const list = [];
  const re = /<a class="media-left"[^>]*href="(\/book\/[^"]+\/)"[\s\S]*?<\/a>\s*<div class="media-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = re.exec(html))) {
    const href = match[1];
    const body = match[2];
    const id_ = String(href).replace(/^\/book\//, '').replace(/\/$/, '');
    const cover = (body.match(/<img[^>]+src="([^"]+)"[^>]*class="book-img-small"/) || [])[1] || '';
    const title = (body.match(/<h4><a[^>]*>([\s\S]*?)<\/a><\/h4>/) || [])[1] || '';
    const intro = (body.match(/class="media-info">([\s\S]*)$/) || [])[1] || '';
    const item = {
      id: id_,
      title: stripInline(title),
      author: '',
      intro: stripTags(intro).slice(0, 120),
      cover: absoluteUrl(cover) || coverById(id_, 180),
      tags: [],
      words: 0,
      score: '',
    };
    if (item.title) list.push(item);
  }
  const maxPage = (html.match(/sub-[^"']+-(\d+)\.html/g) || [])
    .map((u) => Number(u.match(/(\d+)\.html/)[1]))
    .reduce((max, n) => Math.max(max, n), 1);
  return {
    list,
    totalPages: maxPage,
    page,
  };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const slug = encodeURIComponent(String(id));
    const html = await requestText(`${HOST}/book/${slug}/`);
    const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const cover = (html.match(/<img[^>]+class="book-img-middel"[^>]+src="([^"]+)"/) || [])[1] || '';
    const author = (html.match(/作者：<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const status = (html.match(/状态：([^<]*)</) || [])[1] || '';
    const latest = (html.match(/最近更新：<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const intro = (html.match(/class="book-detail">([\s\S]*?)<\/div>/) || [])[1] || '';
    const chapterCount = (html.match(/id="all-chapter"([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/m) || [])[1] || '';
    const count = (chapterCount.match(/href="\/book\/[^"]+\/(\d+)\.html"/g) || []).length;
    return {
      id: String(id),
      title: stripTags(title),
      author: stripInline(author),
      cover: absoluteUrl(cover) || coverById(id, 'middle'),
      intro: stripTags(intro),
      tags: (() => {
        const meta = html.match(/<meta name="keywords" content="([^"]*)"/);
        return meta ? meta[1].split(',').filter((k) => k && !/笔趣阁|赶小说|小说/.test(k)).slice(0, 4) : [];
      })(),
      words: 0,
      category: '',
      status: stripInline(status),
      latestChapter: stripTags(latest),
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const slug = encodeURIComponent(String(bookId));
    const html = await requestText(`${HOST}/book/${slug}/`);
    const block = html.slice(html.indexOf('id="all-chapter"'), html.indexOf('id="all-chapter"') + 2000000);
    const chapters = [];
    const re = /href="\/book\/[^"]+\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let index = 0;
    const seen = new Set();
    while ((match = re.exec(block))) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      chapters.push({
        id,
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

function cleanContent(html) {
  return decodeEntities(String(html || '')
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

async function fetchContentPage(slug, chapterId, pageNo) {
  const url = pageNo <= 1
    ? `${HOST}/book/${slug}/${chapterId}.html`
    : `${HOST}/book/${slug}/${chapterId}_${pageNo}.html`;
  const html = await requestText(url, `${HOST}/book/${slug}/`);
  return html;
}

function extractContent(html) {
  const match = html.match(/<div id="cont-body"[^>]*>([\s\S]*?)<\/div>/);
  return match ? match[1] : '';
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const slug = encodeURIComponent(String(bookId));
    const parts = [];
    for (let pageNo = 1; pageNo <= 8; pageNo++) {
      const html = await fetchContentPage(slug, String(chapterId), pageNo);
      const body = extractContent(html);
      if (!body) break;
      parts.push(cleanContent(body));
      const nav = html.match(/<li><a[^>]+href='[^']*?(\d+)_(\d+)\.html'/);
      const more = nav ? Number(nav[2]) < 0 : false;
      const hasNext = html.match(new RegExp(`href='${escapeRegExp(String(chapterId))}_${pageNo + 1}\\.html'`));
      if (!hasNext) break;
    }
    const content = parts.filter(Boolean).join('\n\n');
    if (content.replace(/\s/g, '').length < 10) {
      throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    }
    return content;
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}