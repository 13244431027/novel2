const crypto = require('crypto');
const express = require('express');

const SIGN_KEY = 'd3dGiJc651gSQ8w1';
const CONTENT_KEY = Buffer.from('242ccb8230d709e1');

const HEADERS = {
  'app-version': '51110',
  'platform': 'android',
  'reg': '0',
  'AUTHORIZATION': '',
  'application-id': 'com.****.reader',
  'net-env': '1',
  'channel': 'unknown',
  'qm-params': ''
};

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function signParams(params) {
  const sortedKeys = Object.keys(params).sort();
  const str = sortedKeys.map((k) => `${k}=${params[k]}`).join('');
  return md5(str + SIGN_KEY);
}

function signHeaders() {
  const sortedKeys = Object.keys(HEADERS).sort();
  const str = sortedKeys.map((k) => `${k}=${HEADERS[k]}`).join('');
  return md5(str + SIGN_KEY);
}

function buildHeaders() {
  return { ...HEADERS, sign: signHeaders() };
}

function buildQuery(params) {
  const signed = { ...params, sign: signParams(params) };
  return Object.keys(signed)
    .map((k) => `${k}=${encodeURIComponent(signed[k])}`)
    .join('&');
}

async function apiGet(baseUrl, params) {
  const url = `${baseUrl}?${buildQuery(params)}`;
  const res = await fetch(url, { headers: buildHeaders() });
  return res.json();
}

function decryptContent(content) {
  const buf = Buffer.from(content, 'base64');
  const iv = buf.slice(0, 16);
  const encrypted = buf.slice(16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', CONTENT_KEY, iv);
  let plain = decipher.update(encrypted);
  plain = Buffer.concat([plain, decipher.final()]);
  return plain.toString('utf8');
}

const app = express();
app.use(express.json());

app.get('/api/search', async (req, res) => {
  try {
    const { wd = '', page = '1' } = req.query;
    const data = await apiGet('https://api-bc.wtzw.com/api/v5/search/words', {
      gender: '3', imei_ip: '2937357107', page, wd
    });
    if (data.errors) return res.status(400).json(data.errors);
    res.json(data.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/book/:id', async (req, res) => {
  try {
    const data = await apiGet('https://api-bc.wtzw.com/api/v4/book/detail', {
      id: req.params.id, imei_ip: '2937357107', teeny_mode: '0'
    });
    if (data.errors) return res.status(400).json(data.errors);
    res.json(data.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/book/:id/chapters', async (req, res) => {
  try {
    const data = await apiGet('https://api-ks.wtzw.com/api/v1/chapter/chapter-list', {
      id: req.params.id
    });
    if (data.errors) return res.status(400).json(data.errors);
    res.json(data.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/chapter/:bookId/:chapterId', async (req, res) => {
  try {
    const data = await apiGet('https://api-ks.wtzw.com/api/v1/chapter/content', {
      id: req.params.bookId, chapterId: req.params.chapterId
    });
    if (data.errors) return res.status(400).json(data.errors);
    let content = '';
    try {
      content = decryptContent(data.data.content);
    } catch (e) {
      content = data.data.content || '';
    }
    res.json({ title: data.data.title || '', content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/category', async (req, res) => {
  try {
    const { gender = '2', category_id, page = '1', tag_id } = req.query;
    let data;
    if (tag_id) {
      data = await apiGet('https://api-bc.wtzw.com/api/v4/tag/index', {
        gender, need_filters: '1', page, tag_id
      });
    } else {
      data = await apiGet('https://api-bc.wtzw.com/api/v4/category/get-list', {
        gender, category_id, need_filters: '1', page, need_category: '1'
      });
    }
    if (data.errors) return res.status(400).json(data.errors);
    res.json(data.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Qimao backend listening on http://localhost:${PORT}`);
});
