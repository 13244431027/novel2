import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const DEFAULT_SOURCE = {
  name: '七猫小说',
  url: 'https://api-bc.wtzw.com/',
  signKey: 'd3dGiJc651gSQ8w1',
};

const DEFAULT_FILE = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'qimao.json');
const QIDIAN_FILE = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'qidian.json');

export function loadBookSource(file = DEFAULT_FILE) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return {
      name: read(text, /"bookSourceName":\s*"((?:[^"\\]|\\.)*)"/) || DEFAULT_SOURCE.name,
      url: read(text, /"bookSourceUrl":\s*"((?:[^"\\]|\\.)*)"/) || DEFAULT_SOURCE.url,
      signKey: read(text, /sign_key\s*=\s*'([^']+)'/) || DEFAULT_SOURCE.signKey,
      group: read(text, /"bookSourceGroup":\s*"((?:[^"\\]|\\.)*)"/) || '',
    };
  } catch {
    return { ...DEFAULT_SOURCE, group: '' };
  }
}

function read(text, re) {
  const m = text.match(re);
  return m ? m[1] : '';
}

const MALE_CATEGORIES = [
  ['玄幻奇幻', 202, 1], ['都市人生', 203, 1], ['异术超能', 219, 1], ['武侠仙侠', 205, 1],
  ['奇闻异事', 204, 1], ['历史', 56, 1], ['游戏', 75, 1], ['科幻', 64, 1],
  ['体育', 206, 1], ['二次元', 207, 1],
];

const MALE_TAGS = [
  ['强者回归', 402], ['影视', 539], ['穿越', 373], ['鉴宝', 47], ['重生', 779], ['血脉', 426],
  ['签到', 565], ['复仇', 790], ['丹药', 428], ['医生', 156], ['战神', 527], ['女婿', 36],
  ['皇帝', 62], ['弃少', 525], ['热血', 1], ['爽文', 570], ['现实', 12], ['悬疑流', 27],
  ['女总裁', 89], ['无限流', 557],
];

const FEMALE_CATEGORIES = [
  ['现代言情', 1, 1], ['总裁豪门', 8, 0], ['古代言情', 2, 1], ['种田经商', 16, 0],
  ['宫闱宅斗', 209, 0], ['幻想言情', 4, 1], ['奇闻异事', 204, 1],
];

const FEMALE_TAGS = [
  ['日久生情', 700], ['影视原著', 539], ['短篇', 541], ['重生', 779], ['女强', 620], ['年下', 631],
  ['空间', 345], ['穿越', 373], ['隐婚', 481], ['系统', 782], ['快穿', 335], ['虐渣', 739],
  ['皇后', 106], ['王爷', 125], ['学霸', 781], ['毒妃', 109], ['校草', 701], ['女配', 191],
  ['甜宠', 21], ['搞笑', 788], ['虐恋', 16], ['治愈', 17],
];

const PUBLISH_CATEGORIES = [
  ['现代言情', 260, 0], ['古代言情', 259, 0], ['青春文学', 265, 0], ['悬疑推理', 262, 0],
  ['武侠小说', 289, 0], ['科幻未来', 261, 0], ['历史小说', 264, 0], ['仙侠奇缘', 276, 0],
  ['仙侠玄幻', 288, 0], ['现实小说', 266, 0], ['现代军旅', 290, 0], ['文学艺术', 240, 0],
  ['人物传记', 247, 0], ['人文科社', 241, 0], ['少儿教育', 258, 0], ['经管励志', 242, 0],
  ['经典文学', 243, 0],
];

const PUBLISH_TAGS = [['影视原著', 539]];

const HONGXIU_MALE = [
  ['玄幻', 20001], ['奇幻', 20005], ['武侠', 20010], ['仙侠', 20014], ['都市', 20019],
  ['现实', 20065], ['历史', 20028], ['军事', 20032], ['游戏', 20050], ['体育', 20054],
  ['科幻', 20042], ['悬疑', 20037], ['轻小说', 20059], ['短篇', 20076],
];

const HONGXIU_FEMALE = [
  ['现代言情', 30020], ['古代言情', 30013], ['浪漫青春', 30031], ['玄幻言情', 30001],
  ['仙侠奇缘', 30008], ['悬疑', 30036], ['科幻空间', 30042], ['游戏竞技', 30050],
  ['短篇小说', 30083], ['轻小说', 30055],
];

const FALOO_CATEGORIES = [
  ['玄幻奇幻', 1], ['武侠仙侠', 6], ['同人小说', 44], ['都市言情', 4], ['军事历史', 3],
  ['科幻网游', 2], ['恐怖灵异', 5], ['青春校园', 7], ['女生小说', 54], ['轻小说', 97], ['短篇其他', 9],
];

function catSections(list) {
  return list.map(([name, id]) => ({ name, kind: 'category', id: `${id}:0` }));
}

const HONGXIU_SECTIONS = [
  { key: 'male', name: '男生', items: catSections(HONGXIU_MALE) },
  { key: 'female', name: '女生', items: [...catSections(HONGXIU_FEMALE), { name: '完本', kind: 'finish', id: 'finish' }] },
];

const FALOO_SECTIONS = [
  { key: 'category', name: '分类', items: catSections(FALOO_CATEGORIES) },
];

function categories(list) {
  return list.map(([name, id, needCategory]) => ({ name, id, kind: 'category', needCategory: needCategory ? 1 : 0 }));
}

function tags(list) {
  return list.map(([name, id]) => ({ name, id, kind: 'tag' }));
}

export const SECTIONS = [
  {
    key: 'male',
    name: '男生',
    items: [...categories(MALE_CATEGORIES), ...tags(MALE_TAGS)],
  },
  {
    key: 'female',
    name: '女生',
    items: [...categories(FEMALE_CATEGORIES), ...tags(FEMALE_TAGS)],
  },
  {
    key: 'publish',
    name: '出版图书',
    items: [...categories(PUBLISH_CATEGORIES), ...tags(PUBLISH_TAGS)],
  },
];

function sectionKey(title, index) {
  if (title.includes('男频') && title.includes('榜单')) return 'male-rank';
  if (title.includes('男频')) return 'male-category';
  if (title.includes('女频') && title.includes('榜单')) return 'female-rank';
  if (title.includes('女频')) return 'female-category';
  return `section-${index}`;
}

function parseExploreItem(rawUrl) {
  const value = String(rawUrl || '');
  const rank = value.match(/\/majax\/rank\/([A-Za-z0-9_]+)\?/);
  if (rank) {
    const gender = value.match(/gender=([A-Za-z]+)/);
    if (!gender) return null;
    return { kind: 'rank', id: `${gender[1]}:${rank[1]}` };
  }
  const category = value.match(/\/majax\/category\/list\?([^"\s]+)/);
  if (category) {
    const query = category[1];
    const gender = query.match(/gender=([^&"]+)/);
    const catId = query.match(/catId=([^&"]+)/);
    const subCatId = query.match(/subCatId=([^&"]+)/);
    if (!gender || !catId || !subCatId) return null;
    return { kind: 'category', id: `${gender[1]}:${catId[1]}:${subCatId[1]}` };
  }
  return null;
}

function buildQidianSections(config) {
  let explore = [];
  try {
    explore = JSON.parse(config.exploreUrl || '[]');
  } catch {
    explore = [];
  }
  const sections = [];
  let current = null;
  for (const entry of explore) {
    if (!entry || !entry.title) continue;
    if (!entry.url) {
      current = { key: '', name: entry.title, items: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { key: '', name: '榜单', items: [] };
      sections.push(current);
    }
    const parsed = parseExploreItem(entry.url);
    if (parsed) current.items.push({ name: entry.title, kind: parsed.kind, id: parsed.id });
  }
  const used = new Set();
  sections.forEach((section, index) => {
    let key = sectionKey(section.name, index);
    while (used.has(key)) key += `-${index}`;
    used.add(key);
    section.key = key;
  });
  return sections.filter((section) => section.items.length);
}

export function loadSources() {
  const primary = loadBookSource();
  const sources = [{
    id: 'qimao',
    name: primary.name,
    group: primary.group || 'API',
    url: primary.url,
    signKey: primary.signKey,
    sections: SECTIONS,
  }];
  sources.push({
    id: 'hongxiu',
    name: '红袖读书',
    group: '网页源',
    url: 'https://m.hongxiu.com',
    sections: HONGXIU_SECTIONS,
  });
  sources.push({
    id: 'faloo',
    name: '飞卢小说',
    group: '网页源',
    url: 'https://wap.faloo.com',
    sections: FALOO_SECTIONS,
  });
  try {
    const config = JSON.parse(fs.readFileSync(QIDIAN_FILE, 'utf8'));
    const sections = buildQidianSections(config);
    if (sections.length) {
      sources.push({
        id: 'qidian',
        name: config.bookSourceName || '起点',
        group: config.bookSourceGroup || '起点',
        url: config.bookSourceUrl || 'https://m.qidian.com',
        sections,
      });
    }
  } catch {
    return sources;
  }
  return sources;
}
