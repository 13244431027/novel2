import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { stripHtml, fmtWord } from '../utils.js';

const CATEGORIES = [
  { label: '玄幻奇幻', gender: '2', category_id: '202' },
  { label: '都市人生', gender: '2', category_id: '203' },
  { label: '武侠仙侠', gender: '2', category_id: '205' },
  { label: '历史', gender: '2', category_id: '56' },
  { label: '科幻', gender: '2', category_id: '64' },
  { label: '现代言情', gender: '3', category_id: '1' },
  { label: '总裁豪门', gender: '3', category_id: '8' },
  { label: '古代言情', gender: '3', category_id: '2' },
  { label: '幻想言情', gender: '3', category_id: '4' },
  { label: '悬疑推理', gender: '3', category_id: '262' }
];

export default function Home() {
  const navigate = useNavigate();
  const [wd, setWd] = useState('');
  const [activeCat, setActiveCat] = useState(0);
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState([]);
  const [totalPage, setTotalPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cat = CATEGORIES[activeCat];

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        gender: cat.gender,
        category_id: cat.category_id,
        page: String(page)
      });
      const res = await fetch(`/api/category?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBooks(data.books || []);
      setTotalPage(Math.max(1, Math.ceil((data.meta?.total || 1) / 10)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [activeCat]);

  useEffect(() => {
    load();
  }, [activeCat, page]);

  function doSearch(e) {
    e.preventDefault();
    if (wd.trim()) navigate(`/search?wd=${encodeURIComponent(wd.trim())}`);
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <span className="logo">七猫阅读</span>
          <form className="search-box" onSubmit={doSearch}>
            <input
              value={wd}
              onChange={(e) => setWd(e.target.value)}
              placeholder="搜索小说、作者"
            />
            <button type="submit">搜索</button>
          </form>
          <nav className="top-nav">
            <Link to="/shelf">书架 / 历史</Link>
          </nav>
        </div>
      </header>

      <div className="container">
        <div className="cat-nav">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.label}
              className={i === activeCat ? 'active' : ''}
              onClick={() => setActiveCat(i)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <h2 className="section-title">{cat.label} · 热门作品</h2>

        {loading && <div className="loading">加载中...</div>}
        {error && <div className="error">加载失败：{error}</div>}

        <div className="book-grid">
          {books.map((b) => (
            <div key={b.id} className="book-card" onClick={() => navigate(`/book/${b.id}`)}>
              <div className="book-cover">
                {b.image_link ? <img src={b.image_link} alt={stripHtml(b.title)} loading="lazy" /> : null}
              </div>
              <div className="title">{stripHtml(b.title)}</div>
              <div className="author">{b.author}</div>
              <div className="intro">{stripHtml(b.intro)}</div>
            </div>
          ))}
        </div>

        {!loading && books.length > 0 && (
          <div className="pager">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span>第 {page} / {totalPage} 页</span>
            <button disabled={page >= totalPage} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        )}
      </div>
    </div>
  );
}
