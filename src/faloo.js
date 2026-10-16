const HOST = 'https://wap.faloo.com';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const CACHE_MAX_ENTRIES = 600;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const cache = new Map();
const inflight = new Map();

const gbkDecoder = new TextDecoder('gbk');
let gbkMap = null;

function gbkEncode(str) {
  if (!gbkMap) {
    gbkMap = new Map();
    for (let b1 = 0x81; b1 <= 0xfe; b1++) {
      for (let b2 = 0x40; b2 <= 0xfe; b2++) {
        if (b2 === 0x7f) continue;
        const ch = gbkDecoder.decode(Buffer.from([b1, b2]));
        if (ch.length === 1 && ch !== '\uFFFD' && !gbkMap.has(ch)) gbkMap.set(ch, [b1, b2]);
      }
    }
  }
  const bytes = [];
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else {
      const pair = gbkMap.get(ch);
      if (pair) bytes.push(pair[0], pair[1]);
    }
  }
  return bytes;
}

function gbkUrlEncode(str) {
  return gbkEncode(str).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
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

function parseWords(value) {
  const raw = String(value || '').trim();
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return 0;
  if (raw.includes('亿')) return Math.round(num * 100000000);
  if (raw.includes('万')) return Math.round(num * 10000);
  return Math.round(num);
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
      if (!res.ok) throw new Error(`飞卢页面请求失败（HTTP ${res.status}）`);
      const buf = Buffer.from(await res.arrayBuffer());
      return gbkDecoder.decode(buf);
    } catch (err) {
      lastError = err;
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

function sliceDiv(html, startIndex) {
  let depth = 1;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIndex;
  let match;
  while ((match = re.exec(html))) {
    if (match[0][1] === '/') depth--;
    else depth++;
    if (depth === 0) return html.slice(startIndex, match.index);
  }
  return html.slice(startIndex);
}

function parseNovelList(html) {
  const list = [];
  const ulStart = html.search(/<ul class="novelList">/);
  if (ulStart < 0) return list;
  const body = html.slice(html.indexOf('>', ulStart) + 1);
  const end = body.search(/<\/ul>\s*<\/div>|<\/ul>\s*<div class="(?:page|pager)/);
  const scope = end > 0 ? body.slice(0, end) : body;
  const re = /<li>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(scope))) {
    const block = match[1];
    const id = (block.match(/<a href="\/\/wap\.faloo\.com\/(\d+)\.html" title="([^"]*)"/) || [])[1];
    if (!id) continue;
    const title = (block.match(/<a href="\/\/wap\.faloo\.com\/\d+\.html" title="([^"]*)"/) || [])[1] || '';
    const cover = (block.match(/<img class="cover" src="([^"]+)"/) || [])[1] || '';
    const intro = (block.match(/class="bl_r1_into">\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const words = (block.match(/<div class="nl_r2[^"]*"><i>([^<]*)<\/i>/) || [])[1] || '';
    const authorBlock = (block.match(/class="nl_r1_author">([\s\S]*?)<\/div>/) || [])[1] || '';
    const author = (authorBlock.match(/<a[^>]*t=2[^>]*title="([^"]*)"/) || [])[1] || '';
    const category = (authorBlock.match(/title="([^"]*)"[^>]*>([^<]*)<\/a>\s*<\/div>/) || [])[1] || '';
    const tags = [];
    const tagBlock = (block.match(/class="nl_tags fr">([\s\S]*?)<\/div>/) || [])[1] || '';
    const tagRe = /<a[^>]*>([^<]+)<\/a>/g;
    let tagMatch;
    while ((tagMatch = tagRe.exec(tagBlock))) {
      const value = stripTags(tagMatch[1]);
      if (value) tags.push(value);
    }
    if (category) tags.unshift(stripTags(category));
    list.push({
      id: String(id),
      title: stripTags(title),
      author: stripTags(author),
      intro: stripTags(intro).slice(0, 120),
      cover: cover.startsWith('//') ? 'https:' + cover : cover,
      tags: tags.slice(0, 4),
      words: parseWords(words),
      score: '',
    });
  }
  return list;
}

function parseChapterList(html, bookId) {
  const chapters = [];
  let index = 0;
  const seen = new Set();
  const starts = [];
  const volumeRe = /<div class="volume[^"]*">/g;
  let volMatch;
  while ((volMatch = volumeRe.exec(html))) starts.push(volMatch.index);
  const boundaries = [...starts, html.length];
  for (let i = 0; i < starts.length; i++) {
    const seg = html.slice(starts[i], boundaries[i + 1]);
    const vipVolume = seg.includes('icon_vip');
    const re = new RegExp(`<a href="//wap\\.faloo\\.com/${bookId}_(\\d+)\\.html" title="([^"]*)"`, 'g');
    let match;
    while ((match = re.exec(seg))) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const title = decodeEntities(match[2]);
      chapters.push({ id: String(id), title: title || `第${index + 1}章`, words: 0, index: index++, vip: vipVolume });
    }
  }
  return chapters;
}

export async function search(keyword, page = 1) {
  const html = await requestText(`${HOST}/search_1_${page}.html?t=1&k=${gbkUrlEncode(keyword)}`);
  const list = parseNovelList(html);
  return {
    list,
    totalPages: list.length >= 30 ? page + 1 : page,
    page,
  };
}

function listUrl(id, page) {
  const segments = String(id).split(':');
  const catId = segments[0];
  const sort = segments[1] || '0';
  if (!/^\d+$/.test(catId)) throw new Error('分类参数无效');
  return `${HOST}/y_${catId}_0_0_0_0_${encodeURIComponent(sort)}_${page}.html`;
}

export async function list(kind, id, page = 1) {
  const html = await requestText(listUrl(id, page));
  const items = parseNovelList(html);
  return {
    list: items,
    totalPages: items.length >= 30 ? page + 1 : page,
    page,
  };
}

export async function getBook(id) {
  return cached(`book:${id}`, 10 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/${encodeURIComponent(id)}.html`);
    const title = stripTags((html.match(/<h1 class="name">([^<]*)<\/h1>/) || [])[1]);
    const cover = (html.match(/class="cover"[^>]*src="([^"]+)"/) || [])[1] || '';
    const infoLine = (html.match(/<li class="color999">([\s\S]*?)<\/li>/) || [])[1] || '';
    const textHideLinks = [];
    const linkRe = /<a class="textHide"[^>]*>([^<]*)<\/a>/g;
    let linkMatch;
    while ((linkMatch = linkRe.exec(infoLine))) textHideLinks.push(stripTags(linkMatch[1]));
    const status = stripTags((infoLine.match(/<i class="tag[^"]*">([^<]*)<\/i>/) || [])[1]);
    const countLine = (html.match(/<li class="textHide">([\d.]+万?字)<i class="shu">\|<\/i>([^<]*)<\/li>/) || []);
    const latestChapter = stripTags((html.match(/<a class="newNode"[^>]*title="([^"]*)"/) || [])[1]);
    const updateTimeText = (html.match(/更新时间：([^<\n]+)/) || [])[1] || '';
    const score = (html.match(/([\d.]+)分\s*\/\s*[^<]*已评/) || [])[1] || '';
    const introIdx = html.indexOf('<div id="novel_intro" class="intro">');
    let intro = '';
    if (introIdx >= 0) {
      const introInner = sliceDiv(html, html.indexOf('>', introIdx) + 1);
      const introParas = [];
      const paraRe = /<p>([\s\S]*?)<\/p>/g;
      let paraMatch;
      while ((paraMatch = paraRe.exec(introInner))) introParas.push(stripTags(paraMatch[1]));
      intro = introParas.join('\n').trim();
      if (!intro) intro = stripTags(introInner);
    }
    const tags = [];
    const tagBlock = (html.match(/<div class="tagList[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '';
    const tagRe = /title="([^"]+)"/g;
    let tagMatch;
    while ((tagMatch = tagRe.exec(tagBlock))) {
      const value = stripTags(tagMatch[1]);
      if (value && !tags.includes(value)) tags.push(value);
    }
    const updateTime = Date.parse(String(updateTimeText).replace(/时/g, ':00').replace(' ', 'T') + '+08:00');
    const bookId = String(id);
    return {
      id: bookId,
      title,
      author: textHideLinks[0] || '',
      cover: cover.startsWith('//') ? 'https:' + cover : cover,
      intro,
      tags: tags.length ? tags : textHideLinks.slice(1),
      words: parseWords(countLine[1]),
      category: textHideLinks.slice(1).join(' · '),
      status,
      latestChapter,
      updateTime: Number.isFinite(updateTime) ? updateTime : 0,
      statement: countLine[2] ? `阅读 ${countLine[2]}` : '',
      score,
    };
  });
}

export async function getChapters(bookId) {
  return cached(`toc:${bookId}`, 30 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/booklist_${encodeURIComponent(bookId)}.html`);
    return parseChapterList(html, bookId);
  });
}

export async function getChapterContent(bookId, chapterId) {
  return cached(`chapter:${bookId}:${chapterId}`, 60 * 60 * 1000, async () => {
    const html = await requestText(`${HOST}/${encodeURIComponent(bookId)}_${encodeURIComponent(chapterId)}.html`);
    const marker = 'class="nodeContent"';
    const markerAlt = 'class="nodeContent "';
    let idx = html.indexOf(markerAlt);
    if (idx < 0) idx = html.indexOf(marker);
    if (idx < 0) throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    const openEnd = html.indexOf('>', idx);
    const inner = sliceDiv(html, openEnd + 1);
    if (inner.includes('class="noLogin"')) {
      throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    }
    const cleaned = inner
      .replace(/<div class="chatuLayout">[\s\S]*?<\/div>/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<p\b[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n');
    const text = decodeEntities(cleaned.replace(/<[^>]+>/g, ''))
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    if (text.replace(/\s/g, '').length < 10) {
      throw new Error('本章为 VIP 或受限章节，当前书源仅支持公开章节阅读');
    }
    return text;
  });
}
