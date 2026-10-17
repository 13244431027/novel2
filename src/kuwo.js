const HOST = 'http://appi.kuwo.cn';
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 8.0.0; LND-AL40 Build/HONORLND-AL40)';
const CACHE_MAX_ENTRIES = 600;

const cache = new Map();
const inflight = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function strip(value) {
  return String(value || '').replace(/[\s\u3000]+/g, ' ').trim();
}

function baseHeaders() {
  return {
    'user-agent': USER_AGENT,
    'connection': 'Close',
    'accept': '*/*',
  };
}

async function requestJson(target, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(target, { headers: baseHeaders(), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`酷我小说请求失败（HTTP ${res.status}）`);
      const data = await res.json();
      if (!data || data.code !== 200) throw new Error(data && data.message ? `酷我小说接口异常：${data.message}` : '酷我小说接口异常');
      return data;
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

function normalizeCover(value, id) {
  let src = String(value || '').trim();
  if (!src) return '';
  if (src.startsWith('//')) src = 'https:' + src;
  if (!/^https?:/i.test(src)) src = 'https://' + src.replace(/^\/+/, '');
  return src;
}

function parseStatus(value) {
  const num = Number(value);
  if (num === 30) return '连载';
  if (num === 50) return '完结';
  return String(value || '');
}

function mapSearchItem(item) {
  return {
    id: String(item.book_id),
    title: strip(item.title),
    author: strip(item.author_name),
    intro: strip(item.intro).slice(0, 120),
    cover: normalizeCover(item.cover_url, item.book_id),
    tags: [strip(item.category_name)].filter(Boolean),
    words: Number(item.all_words) || 0,
    score: '',
  };
}

export async function search(keyword, page = 1) {
  const data = await requestJson(`${HOST}/novels/api/book/search?keyword=${encodeURIComponent(keyword)}&pi=${page}&ps=30`);
  const list = ((data.data || [])).map((item) => mapSearchItem(item));
  return {
    list,
    totalPages: list.length >= 30 ? page + 1 : page,
    page,
  };
}

export async function list(kind, id, page = 1) {
  return { list: [], totalPages: 1, page: 1 };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const data = await requestJson(`${HOST}/novels/api/book/${encodeURIComponent(String(id))}`);
    const book = data.data || {};
    const updateTime = Date.parse(String(book.update_time || '').replace(' ', 'T') + '+08:00');
    return {
      id: String(book.book_id || id),
      title: strip(book.title),
      author: strip(book.author_name),
      cover: normalizeCover(book.cover_url, book.book_id),
      intro: strip(book.intro),
      tags: [strip(book.category_name), strip(book.sub_category_name)].filter(Boolean),
      words: Number(book.all_words) || 0,
      category: [strip(book.category_name), strip(book.sub_category_name)].filter(Boolean).join(' · '),
      status: parseStatus(book.status),
      latestChapter: strip(book.new_chapter_name),
      updateTime: Number.isFinite(updateTime) ? updateTime : 0,
      statement: book.chapter_count ? `共 ${book.chapter_count} 章` : '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const data = await requestJson(`${HOST}/novels/api/book/${encodeURIComponent(String(bookId))}/chapters?paging=0`);
    const chapters = [];
    (data.data || []).forEach((item, index) => {
      chapters.push({
        id: String(item.chapter_id),
        title: strip(item.chapter_title) || `第${index + 1}章`,
        words: Number(item.original_words) || 0,
        index,
        vip: Number(item.vip_flag) === 1,
      });
    });
    return chapters;
  });
}

function cleanContent(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u3000{2,}/g, '\u3000')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '')
    .trim();
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const data = await requestJson(`${HOST}/novels/api/book/${encodeURIComponent(String(bookId))}/chapters/${encodeURIComponent(String(chapterId))}`);
    const detail = data.data || {};
    const content = cleanContent(detail.content || detail.content_str || '');
    if (content.replace(/\s/g, '').length < 10) {
      throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    }
    return content;
  });
}