const HOST = 'https://m.92dxs.org';
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
      if (!res.ok) throw new Error(`就爱读请求失败（HTTP ${res.status}）`);
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
    if (data.code !== 0) throw new Error(`就爱读接口返回 code=${data.code}`);
    return data;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error('就爱读返回数据格式错误');
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
    id: String(item.articleno),
    title: stripInline(item.articlename),
    author: stripTags(item.author),
    intro: stripTags(item.intro).slice(0, 180),
    cover: absoluteUrl(item.coverUrl),
    tags: [],
    words: 0,
    score: '',
    latestChapter: stripTags(item.latestChapterName),
  };
}

export const SECTIONS = [
  {
    key: 'male',
    name: '男生',
    items: [
      ['玄幻魔法', '1'], ['武侠修真', '2'], ['都市言情', '3'],
      ['历史军事', '4'], ['科幻灵异', '5'], ['科幻灵异', '6'],
      ['科幻灵异', '7'], ['科幻灵异', '8'], ['科幻灵异', '9'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
  {
    key: 'female',
    name: '女生',
    items: [
      ['现代言情', '10'], ['古代言情', '11'], ['科幻灵异', '12'],
      ['科幻灵异', '13'], ['科幻灵异', '14'], ['科幻灵异', '15'],
      ['科幻灵异', '16'], ['科幻灵异', '17'], ['科幻灵异', '18'],
    ].map(([name, id]) => ({ name, kind: 'category', id })),
  },
];

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search/${encodeURIComponent(keyword)}.html`, HOST + '/');
  const list = [];
  const re = /<div class="waps_one">([\s\S]*?)<\/div>\s*<div class="author">([\s\S]*?)<\/div>\s*<div class="genxin">([\s\S]*?)<\/div>/g;
  let match;
  while ((match = re.exec(html))) {
    const id = (match[1].match(/info\/(\d+)\/(\d+)\.html/) || []).pop();
    const title = (match[1].match(/<a[^>]*>([^<]+)<\/a>/) || [])[1] || '';
    const author = (match[2].match(/作者[：:]?\s*([^<\s]+)/) || [])[1] || '';
    const latest = (match[3].match(/<a[^>]*>([^<]+)<\/a>/) || [])[1] || '';
    if (!id || !stripInline(title)) continue;
    list.push({
      id,
      title: stripInline(title),
      author: stripTags(author),
      intro: '',
      cover: '',
      tags: [],
      words: 0,
      score: '',
      latestChapter: stripTags(latest),
    });
  }
  return { list, totalPages: 1, page: 1 };
}

export async function list(kind, id, page = 1) {
  const html = await requestText(`${HOST}/list/${id}.html`, HOST + '/');
  const list = [];
  const re = /<td><a href="\/info\/(\d+)\/(\d+)\.html"><img src="([^"]+)"[^>]*><\/a><\/td>\s*<td>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/td>\s*<\/tr>\s*<\/table>/g;
  let match;
  while ((match = re.exec(html))) {
    const bookId = match[2];
    const title = (match[4].match(/<a[^>]*>([^<]+)<\/a>/) || [])[1] || '';
    const author = (match[4].match(/<\/a><span[^>]*>-([^<]+)<\/span>/) || []).pop() || '';
    if (!bookId || !stripInline(title)) continue;
    list.push({
      id: bookId,
      title: stripInline(title),
      author: stripTags(author),
      intro: '',
      cover: absoluteUrl(match[3]),
      tags: [],
      words: 0,
      score: '',
      latestChapter: '',
    });
  }
  return { list, totalPages: 1, page: 1 };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/info/${String(id).slice(0, 2)}/${id}.html`, HOST + '/');
    const title = (html.match(/og:title"[^>]*content="([^"]+)"/) || [])[1] || '';
    const author = (html.match(/og:novel:author"[^>]*content="([^"]+)"/) || [])[1] || '';
    const cover = (html.match(/og:image"[^>]*content="([^"]+)"/) || [])[1] || '';
    const intro = (html.match(/og:description"[^>]*content="([^"]+)"/) || [])[1] || '';
    const kind = (html.match(/og:novel:category"[^>]*content="([^"]+)"/) || [])[1] || '';
    const latest = (html.match(/og:novel:latest_chapter_name"[^>]*content="([^"]+)"/) || [])[1] || '';
    const status = (html.match(/og:novel:status"[^>]*content="([^"]+)"/) || [])[1] || '';
    const updateTime = (html.match(/og:novel:update_time"[^>]*content="([^"]+)"/) || [])[1] || '';
    return {
      id: String(id),
      title: stripTags(title),
      author: stripTags(author),
      cover: absoluteUrl(cover),
      intro: stripTags(intro),
      tags: kind ? [stripTags(kind)] : [],
      words: 0,
      category: stripTags(kind),
      status: stripTags(status),
      latestChapter: stripTags(latest),
      updateTime: updateTime ? Math.floor(new Date(updateTime.replace(' ', 'T')) / 1000) : 0,
      statement: '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const data = await requestJson(`${HOST}/ajaxService?action=chapterlist&articleno=${bookId}&index=0&size=99999&sort=1`, `${HOST}/info/${String(bookId).slice(0, 2)}/${bookId}.html`);
    const chapters = (data.items || []).map((item, index) => ({
      id: String(item.chapterno),
      title: stripTags(item.chaptername),
      words: Number(item.size) || 0,
      index,
      vip: !!item.isvip,
    }));
    if (!chapters.length) throw new Error('获取章节列表失败');
    return chapters;
  });
}

function cleanContent(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/reader/${String(bookId).slice(0, 2)}/${bookId}/${chapterId}.html`, `${HOST}/info/${String(bookId).slice(0, 2)}/${bookId}.html`);
    const anchor = html.match(/<div[^>]*id="nr1"[^>]*>/i);
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
