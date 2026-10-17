(function () {
  'use strict';

  var view = document.getElementById('view');
  var readerEl = document.getElementById('reader');
  var toastEl = document.getElementById('toast');
  var catalogDrawer = document.getElementById('catalogDrawer');
  var catalogBody = document.getElementById('catalogBody');
  var catalogSearch = document.getElementById('catalogSearch');
  var readerBody = document.getElementById('readerBody');
  var readerTitle = document.getElementById('readerTitle');
  var settingsPanel = document.getElementById('readerSettings');
  var sourceSelect = document.getElementById('sourceSelect');

  var state = {
    config: null,
    sources: [],
    sourceId: '',
    home: null,
    tocCache: {},
    reader: null
  };

  var PAPER_THEMES = {
    default: { label: '默认', bg: '', text: '' },
    linen: { label: '米白', bg: '#f7f2ea', text: '#3b352b' },
    paper: { label: '纸黄', bg: '#f3ead7', text: '#3a3226' },
    green: { label: '护眼绿', bg: '#e3efe0', text: '#26331f' },
    bean: { label: '豆绿', bg: '#e6ecd8', text: '#2f3a24' },
    blue: { label: '灰蓝', bg: '#e7eef7', text: '#2b3544' },
    rose: { label: '豆沙', bg: '#f5e8e6', text: '#3d2c2a' },
    orange: { label: '暖黄', bg: '#f7ecd9', text: '#4a3820' },
    night: { label: '夜间', bg: '#16181c', text: '#c9c6c0' }
  };

  var SWATCH_COLORS = {
    default: '#f6f1e7', linen: '#f7f2ea', paper: '#f3ead7', green: '#e3efe0',
    bean: '#e6ecd8', blue: '#e7eef7', rose: '#f5e8e6', orange: '#f7ecd9', night: '#16181c'
  };

  var FONT_STACKS = {
    serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif',
    sans: '"PingFang SC", "Microsoft YaHei", "Heiti SC", "Hiragino Sans GB", sans-serif',
    kai: '"Kaiti SC", "KaiTi", "STKaiti", "Songti SC", serif'
  };

  var WIDTHS = { narrow: '620px', medium: '720px', wide: '880px' };

  var DEFAULT_PREFS = {
    fontSize: 19,
    lineHeight: 1.95,
    letterSpacing: 0,
    paraSpacing: 1.1,
    font: 'serif',
    width: 'medium',
    indent: true,
    pure: false
  };

  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtWords(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿字';
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万字';
    return n + '字';
  }

  function api(path) {
    var url = path;
    if (state.sourceId && url.indexOf('/api/') === 0 && url.indexOf('/api/config') !== 0) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'source=' + encodeURIComponent(state.sourceId);
    }
    return fetch(url).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || '请求失败');
        return data;
      });
    });
  }

  function apiConfig(sourceId) {
    var query = sourceId ? '?source=' + encodeURIComponent(sourceId) : '';
    return fetch('/api/config' + query).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || '请求失败');
        return data;
      });
    });
  }

  function renderSourceOptions() {
    sourceSelect.innerHTML = state.sources.map(function (source) {
      return '<option value="' + esc(source.id) + '"' +
        (source.id === state.sourceId ? ' selected' : '') + '>' +
        esc(source.name) + '</option>';
    }).join('');
  }

  function applyConfig(cfg) {
    state.config = cfg;
    state.sources = cfg.sources || [];
    state.sourceId = cfg.source && cfg.source.id ? cfg.source.id : '';
    state.home = cfg.sections && cfg.sections.length
      ? { section: cfg.sections[0].key, itemIndex: 0, page: 1 }
      : null;
    state.tocCache = {};
    renderSourceOptions();
    set('qm_source', state.sourceId);
  }

  function loadConfig(sourceId) {
    return apiConfig(sourceId)
      .then(function (cfg) {
        applyConfig(cfg);
        route();
      })
      .catch(function (err) {
        state.config = null;
        state.sources = [];
        view.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
      });
  }

  function switchSource(sourceId) {
    if (!sourceId || sourceId === state.sourceId) return;
    exitReader();
    state.config = null;
    state.home = null;
    state.reader = null;
    if (location.hash && location.hash !== '#/') location.hash = '#/';
    view.innerHTML = '<div class="empty">正在切换书源…</div>';
    loadConfig(sourceId);
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2200);
  }

  function setTitle(title) {
    document.title = title ? title + ' · 在线书城' : '在线书城 · 多源小说阅读';
  }

  function coverImg(book) {
    if (!book.cover) return '';
    return (
      '<img src="' + esc(book.cover) + '" alt="' + esc(book.title) +
      '" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
    );
  }

  function tabsHtml() {
    return state.config.sections
      .map(function (sec) {
        return (
          '<button data-section="' + sec.key + '" class="' +
          (sec.key === state.home.section ? 'active' : '') + '">' + esc(sec.name) + '</button>'
        );
      })
      .join('');
  }

  function chipsHtml() {
    var section = currentSection();
    return section.items
      .map(function (item, i) {
        return (
          '<button class="chip ' + (i === state.home.itemIndex ? 'active' : '') +
          '" data-index="' + i + '">' + esc(item.name) + '</button>'
        );
      })
      .join('');
  }

  function currentSection() {
    var sections = (state.config && state.config.sections) || [];
    var key = state.home && state.home.section;
    return sections.filter(function (s) {
      return s.key === key;
    })[0] || sections[0];
  }

  function currentItem() {
    var section = currentSection();
    if (!section || !section.items.length) return null;
    return section.items[Math.min(state.home.itemIndex, section.items.length - 1)];
  }

  function bookCard(book) {
    return (
      '<a class="card" href="#/book/' + esc(book.id) + '">' +
      '<div class="cover">' + coverImg(book) +
      (book.score ? '<div class="score">' + esc(book.score) + '</div>' : '') +
      '</div>' +
      '<h3>' + esc(book.title) + '</h3>' +
      '<div class="meta"><span>' + esc(book.author) + '</span><span>' + fmtWords(book.words) + '</span></div>' +
      '<div class="tags">' + esc((book.tags || []).slice(0, 3).join(' · ')) + '</div>' +
      '</a>'
    );
  }

  function gridHtml(list) {
    if (!list.length) return '<div class="empty">没有找到相关书籍</div>';
    return '<div class="grid">' + list.map(bookCard).join('') + '</div>';
  }

  function pagerHtml(page, totalPages) {
    return (
      '<div class="pager">' +
      '<button data-page="' + (page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>' +
      '<span>第 ' + page + ' / ' + totalPages + ' 页</span>' +
      '<button data-page="' + (page + 1) + '" ' + (page >= totalPages ? 'disabled' : '') + '>下一页</button>' +
      '</div>'
    );
  }

  function loadingGrid() {
    var cards = '';
    for (var i = 0; i < 12; i++) {
      cards += '<div class="card"><div class="cover skeleton"></div><div class="skeleton" style="height:16px;margin-top:10px"></div></div>';
    }
    return '<div class="grid">' + cards + '</div>';
  }

  function renderHome() {
    if (!currentSection()) {
      view.innerHTML = state.sources.length
        ? '<div class="empty">当前书源暂不支持分类浏览，请使用顶部搜索找书</div>'
        : '<div class="empty">书源配置加载失败，请刷新重试</div>';
      return;
    }
    view.innerHTML =
      '<div class="section-head"><h2>书城推荐</h2></div>' +
      '<div class="tabs" id="secTabs">' + tabsHtml() + '</div>' +
      '<div class="chips" id="chips">' + chipsHtml() + '</div>' +
      '<div id="listArea">' + loadingGrid() + '</div>';

    document.getElementById('secTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-section]');
      if (!btn) return;
      state.home.section = btn.dataset.section;
      state.home.itemIndex = 0;
      state.home.page = 1;
      renderHome();
    });

    document.getElementById('chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      state.home.itemIndex = Number(chip.dataset.index);
      state.home.page = 1;
      renderHome();
    });

    loadHomeList();
  }

  var listToken = 0;

  function renderListInto(area, endpoint, page, onPage) {
    var token = ++listToken;
    area.innerHTML = loadingGrid();
    api(endpoint)
      .then(function (res) {
        if (token !== listToken || area !== document.getElementById('listArea')) return;
        area.innerHTML = gridHtml(res.list) +
          (res.totalPages > 1 ? pagerHtml(page, Math.min(res.totalPages, 500)) : '');
        bindPager(area, onPage);
      })
      .catch(function (err) {
        if (token !== listToken || area !== document.getElementById('listArea')) return;
        area.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
      });
  }

  function loadHomeList() {
    var item = currentItem();
    var area = document.getElementById('listArea');
    if (!area) return;
    if (!item) {
      area.innerHTML = '<div class="empty">暂无可用的分类</div>';
      return;
    }
    renderListInto(
      area,
      '/api/list?kind=' + item.kind + '&id=' + item.id + '&page=' + state.home.page +
        '&need=' + (item.needCategory || 0),
      state.home.page,
      function (page) {
        state.home.page = page;
        loadHomeList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    );
  }

  function bindPager(area, onPage) {
    var pager = area.querySelector('.pager');
    if (!pager) return;
    pager.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-page]');
      if (!btn || btn.disabled) return;
      onPage(Number(btn.dataset.page));
    });
  }

  function renderSearch(params) {
    var wd = params.get('wd') || '';
    var page = Number(params.get('page')) || 1;
    document.getElementById('searchInput').value = wd;
    view.innerHTML =
      '<div class="section-head"><h2>搜索：' + esc(wd) + '</h2></div>' +
      '<div id="listArea">' + loadingGrid() + '</div>';

    var area = document.getElementById('listArea');
    renderListInto(
      area,
      '/api/search?wd=' + encodeURIComponent(wd) + '&page=' + page,
      page,
      function (p) {
        location.hash = '#/search?wd=' + encodeURIComponent(wd) + '&page=' + p;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    );
  }

  function renderBook(id) {
    view.innerHTML = '<div class="empty">正在加载书籍信息…</div>';
    api('/api/book?id=' + id)
      .then(function (res) {
        var book = res.book;
        setTitle(book.title);
        var inShelf = isInShelf(book.id);
        view.innerHTML =
          '<div class="detail-hero">' +
          '<div class="cover">' + coverImg(book) + '</div>' +
          '<div class="detail-info">' +
          '<h1>' + esc(book.title) + '</h1>' +
          '<div class="author">' + esc(book.author) + (book.category ? ' · ' + esc(book.category) : '') + '</div>' +
          '<div class="tag-row">' + (book.tags || []).map(function (t) {
            return '<span>' + esc(t) + '</span>';
          }).join('') + '</div>' +
          '<div class="detail-stats">' +
          '<span>' + esc(book.status) + '</span>' +
          '<span>' + fmtWords(book.words) + '</span>' +
          (book.latestChapter ? '<span>最新：' + esc(book.latestChapter) + '</span>' : '') +
          '</div>' +
          '<div class="actions">' +
          '<button class="btn btn-primary" id="startRead">开始阅读</button>' +
          '<button class="btn btn-ghost" id="shelfBtn">' + (inShelf ? '已在书架' : '加入书架') + '</button>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div class="intro-block">' + esc(book.intro) + '</div>' +
          '<div class="chapter-panel">' +
          '<div class="chapter-tools"><h2>目录</h2><input id="chFilter" placeholder="搜索章节名" autocomplete="off"></div>' +
          '<div class="chapter-list" id="chList"></div>' +
          '<div class="more-chapters" id="chMore"></div>' +
          '</div>';

        var progress = getHistory()[book.id];
        document.getElementById('startRead').addEventListener('click', function () {
          if (progress) {
            location.hash = '#/read/' + book.id + '/' + progress.chapterId;
          } else {
            openFirstChapter(book);
          }
        });

        document.getElementById('shelfBtn').addEventListener('click', function () {
          toggleShelf(book, this);
        });

        loadChapters(book.id, progress ? progress.chapterId : null);
      })
      .catch(function (err) {
        view.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
      });
  }

  function openFirstChapter(book) {
    getToc(book.id).then(function (chapters) {
      if (chapters.length) {
        location.hash = '#/read/' + book.id + '/' + chapters[0].id;
      } else {
        toast('该书籍暂无章节');
      }
    }).catch(function () {
      toast('目录加载失败，请重试');
    });
  }

  function cacheToc(bookId, chapters) {
    if (state.tocCache[bookId]) return chapters;
    var keys = Object.keys(state.tocCache);
    if (keys.length >= 30) delete state.tocCache[keys[0]];
    state.tocCache[bookId] = chapters;
    return chapters;
  }

  function loadChapters(bookId, currentId) {
    api('/api/chapters?id=' + bookId)
      .then(function (res) {
        res.chapters.forEach(function (c) { c.bookId = bookId; });
        cacheToc(bookId, res.chapters);
        var list = document.getElementById('chList');
        var more = document.getElementById('chMore');
        if (!list) return;
        renderChapterPager(res.chapters, currentId, list, more, bookId);
      })
      .catch(function (err) {
        var list = document.getElementById('chList');
        if (list) list.innerHTML = '<div class="empty">' + esc(err.message) + '</div>';
      });
  }

  function chapterLinkHtml(chapter, currentId) {
    return (
      '<a href="#/read/' + esc(chapter.bookId || '') + '/' + esc(chapter.id) + '" data-cid="' + esc(chapter.id) +
      '" class="' + (chapter.id === currentId ? 'current' : '') + '">' +
      '<span>' + esc(chapter.title) + '</span>' +
      (chapter.vip ? '<span class="vip">VIP</span>' : '') +
      '<span class="w">' + (chapter.words ? chapter.words + '字' : '') + '</span></a>'
    );
  }

  function renderChapterPager(chapters, currentId, listEl, moreEl, bookId) {
    var limit = 150;
    var filter = '';

    function draw() {
      var data = filter
        ? chapters.filter(function (c) { return c.title.indexOf(filter) >= 0; })
        : chapters;
      var shown = data.slice(0, limit);
      listEl.innerHTML = shown.length
        ? shown.map(function (c) { return chapterLinkHtml(c, currentId); }).join('')
        : '<div class="empty">没有匹配的章节</div>';
      if (moreEl) {
        if (shown.length < data.length) {
          moreEl.innerHTML = '<button class="btn btn-ghost">显示更多（' + (data.length - shown.length) + '）</button>';
          moreEl.querySelector('button').addEventListener('click', function () {
            limit += 300;
            draw();
          });
        } else {
          moreEl.innerHTML = '<span style="color:var(--muted);font-size:13px">共 ' + data.length + ' 章</span>';
        }
      }
    }

    var filterInput = document.getElementById('chFilter');
    if (filterInput && !filterInput._bound) {
      filterInput._bound = true;
      var filterTimer = null;
      filterInput.addEventListener('input', function () {
        clearTimeout(filterTimer);
        var value = this.value.trim();
        filterTimer = setTimeout(function () {
          filter = value;
          limit = 150;
          draw();
        }, 200);
      });
    }
    draw();
  }

  function shelfStore() {
    return get('qm_shelf', []);
  }

  function isInShelf(id) {
    return shelfStore().some(function (b) { return b.id === id; });
  }

  function toggleShelf(book, btn) {
    var shelf = shelfStore();
    var idx = shelf.findIndex(function (b) { return b.id === book.id; });
    if (idx >= 0) {
      shelf.splice(idx, 1);
      btn.textContent = '加入书架';
      toast('已从书架移除');
    } else {
      shelf.unshift({ id: book.id, title: book.title, author: book.author, cover: book.cover, words: book.words });
      btn.textContent = '已在书架';
      toast('已加入书架');
    }
    set('qm_shelf', shelf.slice(0, 200));
  }

  function getHistory() {
    return get('qm_history', {});
  }

  function saveHistory(book, chapter) {
    var history = getHistory();
    history[book.id] = {
      book: { id: book.id, title: book.title, author: book.author, cover: book.cover },
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      time: Date.now()
    };
    var entries = Object.keys(history).map(function (k) { return history[k]; })
      .sort(function (a, b) { return b.time - a.time; })
      .slice(0, 40);
    var trimmed = {};
    entries.forEach(function (e) { trimmed[e.book.id] = e; });
    set('qm_history', trimmed);
  }

  function renderShelf() {
    var shelf = shelfStore();
    var history = getHistory();
    var recent = Object.keys(history).map(function (k) { return history[k]; })
      .sort(function (a, b) { return b.time - a.time; });

    var html = '<div class="section-head"><h2>我的书架</h2></div>';
    if (shelf.length) {
      html += '<div class="grid">' + shelf.map(function (b) {
        return bookCard({ id: b.id, title: b.title, author: b.author, cover: b.cover, words: b.words, tags: [] });
      }).join('') + '</div>';
    } else {
      html += '<div class="empty">书架还是空的，去书城逛逛吧</div>';
    }

    html += '<div class="section-head" style="margin-top:44px"><h2>最近阅读</h2></div>';
    if (recent.length) {
      html += '<div class="grid">' + recent.map(function (h) {
        return (
          '<a class="card" href="#/read/' + esc(h.book.id) + '/' + esc(h.chapterId) + '">' +
          '<div class="cover">' + coverImg(h.book) + '</div>' +
          '<h3>' + esc(h.book.title) + '</h3>' +
          '<div class="meta"><span>' + esc(h.chapterTitle) + '</span></div>' +
          '</a>'
        );
      }).join('') + '</div>';
    } else {
      html += '<div class="empty">暂无阅读记录</div>';
    }
    view.innerHTML = html;
  }

  function getToc(bookId) {
    if (state.tocCache[bookId]) return Promise.resolve(state.tocCache[bookId]);
    return api('/api/chapters?id=' + bookId).then(function (res) {
      res.chapters.forEach(function (c) { c.bookId = bookId; });
      return cacheToc(bookId, res.chapters);
    });
  }

  var navToken = 0;

  function enterReader(bookId, chapterId) {
    document.body.classList.add('reading');
    var token = ++navToken;
    readerBody.innerHTML = '<div class="reader-loading">正在解密章节内容…</div>';
    readerTitle.textContent = '加载中…';

    Promise.all([
      getToc(bookId),
      api('/api/chapter?id=' + bookId + '&chapterId=' + chapterId)
    ])
      .then(function (results) {
        if (token !== navToken) return;
        var chapters = results[0];
        var content = results[1].content;
        var index = chapters.findIndex(function (c) { return c.id === chapterId; });
        if (index < 0) {
          index = 0;
          if (chapters.length) chapterId = chapters[0].id;
        }
        var chapter = chapters[index] || { id: chapterId, title: '正文', bookId: bookId };

        state.reader = { bookId: bookId, chapterId: chapterId, chapters: chapters, index: index, title: chapter.title };
        renderReaderContent(chapter, content, chapters);
        updateReaderNav(chapters, index);
        applyReaderPrefs();
        setBarsHidden(globalPrefs().pure);
        setTitle(chapter.title);

        api('/api/book?id=' + bookId).then(function (res) {
          if (token !== navToken) return;
          saveHistory(res.book, chapter);
        }).catch(function () {});

        var nextCh = chapters[index + 1];
        if (nextCh) {
          api('/api/chapter?id=' + bookId + '&chapterId=' + nextCh.id).catch(function () {});
        }
      })
      .catch(function (err) {
        if (token !== navToken) return;
        readerBody.innerHTML =
          '<div class="reader-error">章节加载失败：' + esc(err.message) +
          '<br><button class="btn btn-primary" id="readerRetry">重试</button></div>';
        var retry = document.getElementById('readerRetry');
        if (retry) retry.addEventListener('click', function () { enterReader(bookId, chapterId); });
      });
  }

  function renderReaderContent(chapter, content, chapters) {
    readerTitle.textContent = chapter.title;
    var paragraphs = String(content).split(/\n+/).filter(function (p) { return p.trim(); });
    readerBody.innerHTML =
      '<article class="reader-article">' +
      '<h1>' + esc(chapter.title) + '</h1>' +
      paragraphs.map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('') +
      '</article>' +
      '<div class="reader-nav">' +
      '<button id="navPrev">上一章</button>' +
      '<button id="navNext">下一章</button>' +
      '</div>';
    document.getElementById('navPrev').addEventListener('click', function () { gotoChapter(-1); });
    document.getElementById('navNext').addEventListener('click', function () { gotoChapter(1); });
    var pos = (get('qm_scroll', {}))[state.reader.bookId + ':' + chapter.id] || 0;
    window.scrollTo(0, pos);
  }

  function updateReaderNav(chapters, index) {
    document.getElementById('readerPrev').disabled = index <= 0;
    document.getElementById('readerNext').disabled = index >= chapters.length - 1;
  }

  function gotoChapter(delta) {
    if (!state.reader) return;
    var target = state.reader.index + delta;
    var chapters = state.reader.chapters;
    if (target < 0 || target >= chapters.length) {
      toast(delta > 0 ? '已经是最后一章了' : '已经是第一章了');
      return;
    }
    location.hash = '#/read/' + state.reader.bookId + '/' + chapters[target].id;
  }

  function saveScroll() {
    if (!state.reader) return;
    var store = get('qm_scroll', {});
    store[state.reader.bookId + ':' + state.reader.chapterId] = window.scrollY;
    var keys = Object.keys(store);
    if (keys.length > 300) delete store[keys[0]];
    set('qm_scroll', store);
  }

  function exitReader() {
    saveScroll();
    navToken++;
    document.body.classList.remove('reading');
    readerEl.classList.remove('bars-hidden');
    settingsPanel.classList.remove('open');
    catalogDrawer.classList.remove('open');
    state.reader = null;
  }

  function clampNumber(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback;
    return Math.min(max, Math.max(min, n));
  }

  function globalPrefs() {
    var stored = get('qm_reader', null);
    var p = stored && typeof stored === 'object' ? stored : {};
    return {
      fontSize: clampNumber(p.fontSize, 14, 30, DEFAULT_PREFS.fontSize),
      lineHeight: clampNumber(p.lineHeight, 1.4, 2.6, DEFAULT_PREFS.lineHeight),
      letterSpacing: clampNumber(p.letterSpacing, 0, 3, DEFAULT_PREFS.letterSpacing),
      paraSpacing: clampNumber(p.paraSpacing, 0.2, 2.4, DEFAULT_PREFS.paraSpacing),
      font: FONT_STACKS[p.font] ? p.font : DEFAULT_PREFS.font,
      width: WIDTHS[p.width] ? p.width : DEFAULT_PREFS.width,
      indent: p.indent !== false,
      pure: !!p.pure
    };
  }

  function currentPaper() {
    if (!state.reader) return 'default';
    var store = get('qm_reader_paper', null);
    var paper = store && typeof store === 'object' ? store[state.reader.bookId] : '';
    return PAPER_THEMES[paper] ? paper : 'default';
  }

  function setCurrentPaper(paper) {
    if (!state.reader) return;
    var store = get('qm_reader_paper', null);
    if (!store || typeof store !== 'object') store = {};
    if (paper === 'default') delete store[state.reader.bookId];
    else store[state.reader.bookId] = paper;
    var keys = Object.keys(store);
    if (keys.length > 200) delete store[keys[0]];
    set('qm_reader_paper', store);
  }

  function setBarsHidden(hidden) {
    readerEl.classList.toggle('bars-hidden', !!hidden);
    if (hidden) settingsPanel.classList.remove('open');
  }

  function toggleBars() {
    if (!state.reader) return;
    setBarsHidden(!readerEl.classList.contains('bars-hidden'));
  }

  function applyReaderPrefs() {
    var prefs = globalPrefs();
    var theme = PAPER_THEMES[currentPaper()];
    readerEl.style.setProperty('--reader-font', prefs.fontSize + 'px');
    readerEl.style.setProperty('--reader-line', prefs.lineHeight);
    readerEl.style.setProperty('--reader-letter', prefs.letterSpacing + 'px');
    readerEl.style.setProperty('--reader-para', prefs.paraSpacing + 'em');
    readerEl.style.setProperty('--reader-family', FONT_STACKS[prefs.font]);
    readerEl.style.setProperty('--reader-width', WIDTHS[prefs.width]);
    readerEl.classList.toggle('no-indent', !prefs.indent);
    if (theme && theme.bg) {
      readerEl.style.setProperty('--paper', theme.bg);
      readerEl.style.setProperty('--paper-text', theme.text);
    } else {
      readerEl.style.removeProperty('--paper');
      readerEl.style.removeProperty('--paper-text');
    }
  }

  function openCatalog() {
    if (!state.reader) return;
    catalogDrawer.classList.add('open');
    catalogSearch.value = '';
    renderCatalog('');
    catalogSearch.focus();
  }

  function renderCatalog(filter) {
    if (!state.reader) return;
    var chapters = state.reader.chapters;
    var current = state.reader.chapterId;
    var data = filter
      ? chapters.filter(function (c) { return c.title.indexOf(filter) >= 0; })
      : chapters;
    var shown = data.slice(0, 800);
    catalogBody.innerHTML =
      '<div class="chapter-list">' +
      shown.map(function (c) { return chapterLinkHtml(c, current); }).join('') +
      '</div>' +
      (shown.length < data.length
        ? '<div class="catalog-note">仅显示前 800 章，请在上方搜索框中输入章节名进行筛选</div>'
        : '');
    var currentEl = catalogBody.querySelector('a.current');
    if (currentEl && !filter) currentEl.scrollIntoView({ block: 'center' });
  }

  function segHtml(attr, options, activeKey) {
    return options.map(function (o) {
      return '<button data-' + attr + '="' + o.key + '" class="' + (o.key === activeKey ? 'active' : '') + '">' +
        o.label + '</button>';
    }).join('');
  }

  function renderReaderSettings() {
    var prefs = globalPrefs();
    var paper = currentPaper();
    var fontOptions = [
      { key: 'serif', label: '宋体' },
      { key: 'sans', label: '黑体' },
      { key: 'kai', label: '楷体' }
    ];
    var widthOptions = [
      { key: 'narrow', label: '窄' },
      { key: 'medium', label: '中' },
      { key: 'wide', label: '宽' }
    ];
    var paperKeys = Object.keys(PAPER_THEMES);

    settingsPanel.innerHTML =
      '<div class="setting-row"><span>字号</span><div class="stepper">' +
      '<button data-step="fontSize" data-dir="-1">A-</button><span class="val">' + prefs.fontSize + '</span>' +
      '<button data-step="fontSize" data-dir="1">A+</button></div></div>' +
      '<div class="setting-row"><span>行距</span><div class="stepper">' +
      '<button data-step="lineHeight" data-dir="-1">-</button><span class="val">' + prefs.lineHeight.toFixed(2) + '</span>' +
      '<button data-step="lineHeight" data-dir="1">+</button></div></div>' +
      '<div class="setting-row"><span>字间距</span><div class="stepper">' +
      '<button data-step="letterSpacing" data-dir="-1">-</button><span class="val">' + prefs.letterSpacing.toFixed(1) + '</span>' +
      '<button data-step="letterSpacing" data-dir="1">+</button></div></div>' +
      '<div class="setting-row"><span>段间距</span><div class="stepper">' +
      '<button data-step="paraSpacing" data-dir="-1">-</button><span class="val">' + prefs.paraSpacing.toFixed(1) + '</span>' +
      '<button data-step="paraSpacing" data-dir="1">+</button></div></div>' +
      '<div class="setting-row"><span>字体</span><div class="seg" data-group="font">' + segHtml('font', fontOptions, prefs.font) + '</div></div>' +
      '<div class="setting-row"><span>宽度</span><div class="seg" data-group="width">' + segHtml('width', widthOptions, prefs.width) + '</div></div>' +
      '<div class="setting-row"><span>首行缩进</span><button class="switch ' + (prefs.indent ? 'on' : '') + '" data-toggle="indent">' + (prefs.indent ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="setting-row"><span>背景</span><div class="theme-swatches">' +
      paperKeys.map(function (k) {
        return '<div class="swatch ' + (paper === k ? 'active' : '') + '" data-paper="' + k + '" title="' +
          esc(PAPER_THEMES[k].label) + '" style="background:' + (SWATCH_COLORS[k] || '#ccc') + '"></div>';
      }).join('') + '</div></div>' +
      '<div class="setting-row"><span>纯阅读模式</span>' +
      '<button class="switch ' + (prefs.pure ? 'on' : '') + '" data-toggle="pure">' + (prefs.pure ? '已开启' : '已关闭') + '</button></div>' +
      '<div class="setting-row reset-row"><button class="reset-btn" data-reset>恢复默认设置</button></div>';

    settingsPanel.querySelectorAll('[data-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.dataset.step;
        var dir = Number(btn.dataset.dir);
        var p = globalPrefs();
        if (field === 'fontSize') p.fontSize = clampNumber(p.fontSize + dir, 14, 30, DEFAULT_PREFS.fontSize);
        if (field === 'lineHeight') p.lineHeight = Math.round(clampNumber(p.lineHeight + dir * 0.1, 1.4, 2.6, DEFAULT_PREFS.lineHeight) * 100) / 100;
        if (field === 'letterSpacing') p.letterSpacing = Math.round(clampNumber(p.letterSpacing + dir * 0.5, 0, 3, DEFAULT_PREFS.letterSpacing) * 10) / 10;
        if (field === 'paraSpacing') p.paraSpacing = Math.round(clampNumber(p.paraSpacing + dir * 0.2, 0.2, 2.4, DEFAULT_PREFS.paraSpacing) * 10) / 10;
        set('qm_reader', p);
        renderReaderSettings();
        applyReaderPrefs();
      });
    });

    settingsPanel.querySelectorAll('[data-group] button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.parentNode.dataset.group;
        var value = group === 'font' ? btn.dataset.font : btn.dataset.width;
        var p = globalPrefs();
        p[group] = value;
        set('qm_reader', p);
        renderReaderSettings();
        applyReaderPrefs();
      });
    });

    settingsPanel.querySelector('[data-toggle="indent"]').addEventListener('click', function () {
      var p = globalPrefs();
      p.indent = !p.indent;
      set('qm_reader', p);
      renderReaderSettings();
      applyReaderPrefs();
    });

    settingsPanel.querySelector('[data-toggle="pure"]').addEventListener('click', function () {
      var p = globalPrefs();
      p.pure = !p.pure;
      set('qm_reader', p);
      setBarsHidden(p.pure);
      renderReaderSettings();
    });

    settingsPanel.querySelectorAll('[data-paper]').forEach(function (sw) {
      sw.addEventListener('click', function () {
        setCurrentPaper(sw.dataset.paper);
        renderReaderSettings();
        applyReaderPrefs();
      });
    });

    settingsPanel.querySelector('[data-reset]').addEventListener('click', function () {
      set('qm_reader', JSON.parse(JSON.stringify(DEFAULT_PREFS)));
      if (state.reader) {
        var store = get('qm_reader_paper', null);
        if (store && typeof store === 'object' && store[state.reader.bookId]) {
          delete store[state.reader.bookId];
          set('qm_reader_paper', store);
        }
      }
      setBarsHidden(false);
      renderReaderSettings();
      applyReaderPrefs();
      toast('已恢复默认设置');
    });
  }

  function applyTheme() {
    var stored = localStorage.getItem('qm_theme');
    var dark = stored === null
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : stored === '"dark"' || stored === 'dark';
    document.body.classList.toggle('theme-dark', dark);
    document.getElementById('themeBtn').textContent = dark ? '☀' : '☾';
  }

  function route() {
    if (!state.config) return;
    var raw = location.hash.slice(1) || '/';
    var parts = raw.split('?');
    var path = parts[0];
    var params = new URLSearchParams(parts[1] || '');
    var seg = path.split('/').filter(Boolean);

    if (seg[0] === 'read' && seg[1] && seg[2]) {
      enterReader(seg[1], seg[2]);
      return;
    }

    exitReader();

    if (seg[0] === 'search') {
      setTitle('搜索：' + (params.get('wd') || ''));
      renderSearch(params);
    } else if (seg[0] === 'book' && seg[1]) {
      renderBook(seg[1]);
    } else if (seg[0] === 'shelf') {
      setTitle('我的书架');
      renderShelf();
    } else {
      setTitle('');
      renderHome();
    }
  }

  function init() {
    applyTheme();

    document.getElementById('searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var wd = document.getElementById('searchInput').value.trim();
      if (!wd) return;
      location.hash = '#/search?wd=' + encodeURIComponent(wd) + '&page=1';
      if (document.body.classList.contains('reading')) exitReader();
    });

    document.getElementById('themeBtn').addEventListener('click', function () {
      set('qm_theme', document.body.classList.contains('theme-dark') ? 'light' : 'dark');
      applyTheme();
    });

    sourceSelect.addEventListener('change', function () {
      switchSource(this.value);
    });

    var darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function () {
      if (localStorage.getItem('qm_theme') === null) applyTheme();
    };
    if (darkMq.addEventListener) darkMq.addEventListener('change', onSchemeChange);
    else if (darkMq.addListener) darkMq.addListener(onSchemeChange);

    document.getElementById('readerBack').addEventListener('click', function () {
      var bookId = state.reader ? state.reader.bookId : null;
      location.hash = bookId ? '#/book/' + bookId : '#/';
    });
    document.getElementById('readerPrev').addEventListener('click', function () { gotoChapter(-1); });
    document.getElementById('readerNext').addEventListener('click', function () { gotoChapter(1); });
    document.getElementById('readerCatalogBtn').addEventListener('click', openCatalog);
    document.getElementById('readerSettingsBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      settingsPanel.classList.toggle('open');
      renderReaderSettings();
    });
    settingsPanel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { settingsPanel.classList.remove('open'); });

    readerBody.addEventListener('click', function (e) {
      if (!state.reader) return;
      if (e.target.closest('a, button, input, textarea, select')) return;
      toggleBars();
    });

    catalogDrawer.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close') || e.target.classList.contains('drawer-mask')) {
        catalogDrawer.classList.remove('open');
      }
    });
    catalogBody.addEventListener('click', function (e) {
      if (e.target.closest('a[data-cid]')) catalogDrawer.classList.remove('open');
    });
    var catalogTimer = null;
    catalogSearch.addEventListener('input', function () {
      clearTimeout(catalogTimer);
      var value = this.value.trim();
      catalogTimer = setTimeout(function () { renderCatalog(value); }, 220);
    });

    document.addEventListener('keydown', function (e) {
      if (!state.reader) return;
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') gotoChapter(-1);
      if (e.key === 'ArrowRight') gotoChapter(1);
      if (e.key === 'Escape') {
        settingsPanel.classList.remove('open');
        catalogDrawer.classList.remove('open');
        setBarsHidden(false);
      }
    });

    window.addEventListener('hashchange', saveScroll);
    window.addEventListener('pagehide', saveScroll);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveScroll();
    });
    window.addEventListener('hashchange', route);

    loadConfig(get('qm_source', ''));
  }

  init();
})();
