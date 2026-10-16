const HOST = 'https://m.hongxiu.com';
const COVER_BASE = 'https://bookcover.yuewen.com/qdbimg/349573/';
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
  return `${COVER_BASE}c_${id}/${size || 180}`;
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
    'referer': HOST + '/',
  };
}

async function requestText(target, options = {}) {
  const retries = options.retries === undefined ? 2 : options.retries;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(target, { headers: baseHeaders(), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`红袖页面请求失败（HTTP ${res.status}）`);
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

function parseBookItems(html) {
  const list = [];
  const re = /<li class="book-li"[^>]*>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(html))) {
    const block = match[1];
    const href = (block.match(/href="\/book\/(\d+)"/) || [])[1];
    if (!href) continue;
    const cover = (block.match(/data-src="([^"]+)"/) || [])[1] || (block.match(/<img[^>]*src="([^"]+)"[^>]*class="book-cover"/) || [])[1] || '';
    const title = (block.match(/<h4 class="book-title">([\s\S]*?)<\/h4>/) || [])[1] || '';
    const desc = (block.match(/<p class="book-desc">([\s\S]*?)<\/p>/) || [])[1] || '';
    const author = (block.match(/class="book-author[^"]*">([\s\S]*?)<\/span>/) || [])[1] || '';
    const tagSource = (block.match(/<span class="tag-small-group[^"]*">([\s\S]*?)<\/span>/) || [])[1] || '';
    const tags = [];
    const tagRe = /<em[^>]*>([\s\S]*?)<\/em>/g;
    let tagMatch;
    while ((tagMatch = tagRe.exec(tagSource))) {
      const value = stripTags(tagMatch[1]);
      if (value) tags.push(value);
    }
    const words = parseWords(tags.find((t) => /[\d.]+(?:万|亿)字?/.test(t)) || '');
    list.push({
      id: String(href),
      title: stripInline(title),
      author: stripInline(author),
      intro: stripTags(desc).slice(0, 120),
      cover: normalizeCover(cover, href, 180),
      tags: tags.filter((t) => !/[\d.]+(?:万|亿)/.test(t)).slice(0, 4),
      words,
      score: '',
    });
  }
  return list;
}

function readBookData(html) {
  const marker = 'g_data.book = ';
  const index = html.indexOf(marker);
  if (index < 0) return null;
  const rest = html.slice(index + marker.length);
  let depth = 0;
  let inStr = false;
  let prev = '';
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inStr) {
      if (ch === '"' && prev !== '\\') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(rest.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
    prev = ch;
  }
  return null;
}

function cleanContent(html) {
  const inner = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  return decodeEntities(inner.replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search?kw=${encodeURIComponent(keyword)}&pageNum=${page}`);
  const list = parseBookItems(html);
  return {
    list,
    totalPages: list.length >= 20 ? page + 1 : page,
    page,
  };
}

function categoryUrl(id, page) {
  const segments = String(id).split(':');
  const catId = segments[0];
  const sort = segments[1] || '0';
  if (!/^\d+$/.test(catId)) throw new Error('分类参数无效');
  return `${HOST}/category/${catId}_f1_f1_f1_f1_f1_${encodeURIComponent(sort)}_${page}`;
}

export async function list(kind, id, page = 1) {
  if (kind === 'finish') {
    const html = await requestText(`${HOST}/finish`);
    return { list: parseBookItems(html), totalPages: 1, page: 1 };
  }
  const html = await requestText(categoryUrl(id, page));
  const list_ = parseBookItems(html);
  return {
    list: list_,
    totalPages: list_.length >= 20 ? page + 1 : page,
    page,
  };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/book/${encodeURIComponent(id)}`);
    const data = readBookData(html) || {};
    const tags = [];
    for (const candidate of [data.chanName, data.subCateName]) {
      const value = stripTags(candidate);
      if (value && tags.indexOf(value) < 0) tags.push(value);
    }
    const updateTime = Date.parse(String(data.lastUpdateTime || '').replace(' ', 'T') + '+08:00');
    const bookId = String(data.bookId || id);
    return {
      id: bookId,
      title: stripTags(data.bookName),
      author: stripTags(data.author),
      cover: coverById(bookId, 600),
      intro: String(data.desc || data.descTxt || '').trim(),
      tags,
      words: Number(data.wordsCnt) || 0,
      category: [stripTags(data.chanName), stripTags(data.subCateName)].filter(Boolean).join(' · '),
      status: stripTags(data.bookStatus),
      latestChapter: stripTags(data.updChapterName),
      updateTime: Number.isFinite(updateTime) ? updateTime : 0,
      statement: data.chapterCnt ? `共 ${data.chapterCnt} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/chapterlist/${encodeURIComponent(bookId)}`);
    const chapters = [];
    const re = /<a href="\/chapter\/\d+\/(\d+)" class="chapter-li-a([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    let index = 0;
    while ((match = re.exec(html))) {
      const id = match[1];
      const title = (match[3].match(/<span class="chapter-index[^"]*">([\s\S]*?)<\/span>/) || [])[1] || '';
      chapters.push({
        id: String(id),
        title: stripTags(title) || `第${index + 1}章`,
        words: 0,
        index: index++,
        vip: /unpay/.test(match[2]),
      });
    }
    return chapters;
  });
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/chapter/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`);
    const match = html.match(/<div class="chapter-content">([\s\S]*?)<\/div>/);
    if (!match) throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    const content = cleanContent(match[1]);
    if (content.replace(/\s/g, '').length < 10) {
      throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    }
    return content;
  });
}
