import crypto from 'node:crypto';

const HEADER_BASE = {
  'app-version': '51110',
  'platform': 'android',
  'reg': '0',
  'AUTHORIZATION': '',
  'application-id': 'com.****.reader',
  'net-env': '1',
  'channel': 'unknown',
  'qm-params': '',
};

const CONTENT_KEY = Buffer.from('32343263636238323330643730396531', 'hex');

const HOST = {
  bc: 'https://api-bc.wtzw.com',
  ks: 'https://api-ks.wtzw.com',
};

const CACHE_MAX_ENTRIES = 600;
const cache = new Map();
const inflight = new Map();

let signKey = 'd3dGiJc651gSQ8w1';

export function setSignKey(key) {
  if (key) signKey = key;
}

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

function signParams(params) {
  const keys = Object.keys(params).sort();
  let str = '';
  for (const key of keys) str += key + '=' + params[key];
  return md5(str + signKey);
}

function buildHeaders() {
  const headers = { ...HEADER_BASE };
  headers.sign = signParams(headers);
  return headers;
}

function encodeParams(params) {
  return Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
}

function buildUrl(base, params) {
  const merged = { ...params };
  merged.sign = signParams(merged);
  return `${base}?${encodeParams(merged)}`;
}

async function request(url, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: buildHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`上游返回了非 JSON 数据（HTTP ${res.status}）`);
      }
      if (json.errors) {
        const err = new Error(json.errors.details || json.errors.title || '上游接口错误');
        err.retryable = false;
        throw err;
      }
      if (!res.ok) throw new Error(`上游请求失败（HTTP ${res.status}）`);
      return json;
    } catch (err) {
      lastError = err;
      if (err.retryable === false) break;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}

function normalizeBook(book) {
  const tags = String(book.ptags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    id: String(book.id),
    title: stripTags(book.original_title || book.title),
    author: book.original_author || book.author || '',
    intro: stripTags(book.intro).replace(/\s*\n\s*/g, ' ').slice(0, 120),
    cover: book.image_link || '',
    tags,
    words: Number(book.words_num) || 0,
    score: book.score || '',
  };
}

export async function search(keyword, page = 1) {
  const params = { gender: '3', imei_ip: '2937357107', page, wd: keyword };
  const json = await request(buildUrl(`${HOST.bc}/api/v5/search/words`, params));
  const data = json.data || {};
  return {
    list: (data.books || []).map(normalizeBook),
    totalPages: Number(data.meta?.total_page || 1),
    page: Number(data.meta?.page || page) || page,
  };
}

export async function listByCategory(categoryId, page = 1, needCategory = 1) {
  const params = {
    gender: '2',
    category_id: categoryId,
    need_filters: '1',
    page,
    need_category: needCategory ? 1 : 0,
  };
  const json = await request(buildUrl(`${HOST.bc}/api/v4/category/get-list`, params));
  const data = json.data || {};
  return {
    list: (data.books || []).map(normalizeBook),
    totalPages: Number(data.meta?.total_pages || 1),
    page: Number(data.meta?.page || page) || page,
  };
}

export async function listByTag(tagId, page = 1) {
  const params = { gender: '2', need_filters: '1', page, tag_id: tagId };
  const json = await request(buildUrl(`${HOST.bc}/api/v4/tag/index`, params));
  const data = json.data || {};
  return {
    list: (data.books || []).map(normalizeBook),
    totalPages: Number(data.meta?.total_pages || 1),
    page: Number(data.meta?.page || page) || page,
  };
}

export async function list(kind, id, page = 1, need = 1) {
  if (kind === 'tag') return listByTag(id, page);
  return listByCategory(id, page, need);
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const params = { id, imei_ip: '2937357107', teeny_mode: 0 };
    const json = await request(buildUrl(`${HOST.bc}/api/v4/book/detail`, params));
    const book = json.data?.book || {};
    const tags = Array.isArray(book.book_tag_list)
      ? book.book_tag_list.map((t) => t.title).filter(Boolean)
      : String(book.ptags || '').split(',').filter(Boolean);
    return {
      id: String(book.id),
      title: stripTags(book.title),
      author: book.author || '',
      cover: book.image_link || '',
      intro: String(book.intro || '').trim(),
      tags,
      words: Number(book.words_num) || 0,
      category: [book.category1_name, book.category2_name].filter(Boolean).join(' · '),
      status: String(book.is_over) === '1' ? '已完结' : '连载中',
      latestChapter: book.latest_chapter_title || '',
      updateTime: Number(book.update_time) * 1000 || 0,
      statement: book.statement || '',
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const params = { id: bookId };
    const json = await request(buildUrl(`${HOST.ks}/api/v1/chapter/chapter-list`, params));
    const list = json.data?.chapter_lists || [];
    return list.map((c, i) => ({
      id: String(c.id),
      title: c.title || `第${i + 1}章`,
      words: Number(c.words) || 0,
      index: i,
      vip: false,
    }));
  });
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const params = { id: bookId, chapterId };
    const json = await request(buildUrl(`${HOST.ks}/api/v1/chapter/content`, params));
    const content = json.data?.content;
    if (!content) throw new Error('章节内容为空');
    return decryptContent(content);
  });
}

export function decryptContent(content) {
  const buf = Buffer.from(content, 'base64');
  if (buf.length < 32) throw new Error('章节数据格式异常');
  const decipher = crypto.createDecipheriv('aes-128-cbc', CONTENT_KEY, buf.subarray(0, 16));
  decipher.setAutoPadding(true);
  const plain = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString('utf8');
  return plain.replace(/\r\n/g, '\n').trim();
}
