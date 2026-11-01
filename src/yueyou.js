const HOST = 'https://m.suixkan.com';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36';
const CACHE_MAX_ENTRIES = 600;

const cache = new Map();
const inflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripInline(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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
      if (!res.ok) throw new Error(`阅友小说请求失败（HTTP ${res.status}）`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

async function requestJson(target, referer, retries = 2) {
  const text = await requestText(target, referer, retries);
  try {
    const data = JSON.parse(text);
    if (data.code !== 0) throw new Error(`阅友小说接口返回 code=${data.code}`);
    return data;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('阅友小说返回数据格式错误');
    throw err;
  }
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

function mapBook(item) {
  return {
    id: String(item.wapBookId),
    title: stripInline(item.bookName),
    author: stripTags(item.authorName),
    intro: stripTags(item.intro).slice(0, 180),
    cover: absoluteUrl(item.bookPic),
    tags: [],
    words: Number(item.words) || 0,
    score: '',
    latestChapter: stripTags(item.latestChapterName),
  };
}

export const SECTIONS = [
  {
    key: 'male',
    name: '男频',
    items: [
      ['都市人生', '1100'], ['玄幻奇幻', '1101'], ['武侠仙侠', '1102'],
      ['军事历史', '1103'], ['科幻末世', '1104'], ['游戏体育', '1105'],
      ['热血青春', '1106'], ['悬疑灵异', '1107'], ['脑洞大开', '1108'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
  {
    key: 'female',
    name: '女频',
    items: [
      ['现代言情', '2100'], ['古代言情', '2101'], ['幻想言情', '2102'],
      ['穿越时空', '2104'], ['宫闱争斗', '2105'], ['豪门总裁', '2106'],
      ['婚恋爱情', '2107'], ['经商种田', '2108'], ['末世重生', '2109'],
      ['悬疑灵异', '2110'], ['网游科幻', '2111'], ['青春校园', '2112'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
];

export async function search(keyword, page = 1) {
  const data = await requestJson(`${HOST}/api/book/search?keyword=${encodeURIComponent(keyword)}&page=${page}`, HOST + '/');
  const list = (data.data.list || []).map(mapBook);
  const totalPages = Math.max(1, Math.ceil((data.data.count || 0) / 10));
  return { list, totalPages, page: Number(page) };
}

export async function list(kind, id, page = 1) {
  const data = await requestJson(`${HOST}/api/book/classify?site_id=&classify_id=${id}&page=${page}`, HOST + '/');
  const list = (data.data.list || []).map(mapBook);
  const totalPages = Math.max(1, Math.ceil((data.data.count || 0) / 5));
  return { list, totalPages, page: Number(page) };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/b/${id}.html`, HOST + '/');
    const title = (html.match(/class="face-info-title"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
    const author = (html.match(/作者[：:]?([^<\s]+)<\/span>/) || [])[1] || '';
    const cover = (html.match(/class="face-cover-img"[^>]*src="([^"]+)"/) || [])[1] || '';
    const intro = (html.match(/id="intro"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const kind = (html.match(/分类[：:]?([^<\s]+)<\/span>/) || [])[1] || '';
    const count = (html.match(/共\s*(\d+)\s*章/) || [])[1] || '';
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
      latestChapter: '',
      updateTime: 0,
      statement: count ? `共 ${count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/c/${bookId}.html`, `${HOST}/b/${bookId}.html`);
    const chapters = [];
    const re = /<li>\s*<a href="\/r\/\d+\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/g;
    let match;
    let index = 0;
    const seen = new Set();
    while ((match = re.exec(html))) {
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

function cleanSection(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/（本章未完，请翻页）|（本章完）|.*书友群.*/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/r/${bookId}/${chapterId}.html`, `${HOST}/c/${bookId}.html`);
    const sections = [];
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>\s*<div class="con">([\s\S]*?)<\/div>/g;
    let match;
    while ((match = re.exec(html))) {
      sections.push(cleanSection(match[2]));
    }
    const content = sections.join('\n\n');
    if (content.replace(/\s/g, '').length < 10) throw new Error('正文获取失败');
    return content;
  });
}
