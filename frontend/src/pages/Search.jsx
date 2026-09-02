import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { stripHtml, fmtWord } from '../utils.js';

export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [wd, setWd] = useState(params.get('wd') || '');
  const [input, setInput] = useState(params.get('wd') || '');
  const [books, setBooks] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!wd) return;
    setLoading(true);
    setError('');
    fetch(`/api/search?wd=${encodeURIComponent(wd)}&page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBooks(data.books || []);
        setTotalPage(Math.max(1, Math.ceil((data.meta?.total_page || 1) / 10)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [wd, page]);

  function doSearch(e) {
    e.preventDefault();
    if (input.trim()) {
      setPage(1);
      navigate(`/search?wd=${encodeURIComponent(input.trim())}`);
      setWd(input.trim());
    }
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="/">七猫阅读</a>
          <form className="search-box" onSubmit={doSearch}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="搜索小说、作者" />
            <button type="submit">搜索</button>
          </form>
          <nav className="top-nav">
            <Link to="/shelf">书架 / 历史</Link>
          </nav>
        </div>
      </header>

      <div className="container">
        <h2 className="section-title">搜索：{wd}</h2>

        {loading && <div className="loading">加载中...</div>}
        {error && <div className="error">搜索失败：{error}</div>}

        {!loading && books.length === 0 && !error && (
          <div className="loading">未找到相关书籍</div>
        )}

        <div className="book-grid">
          {books.map((b) => (
            <div key={b.id} className="book-card" onClick={() => navigate(`/book/${b.id}`)}>
              <div className="book-cover">
                {b.image_link ? <img src={b.image_link} alt={stripHtml(b.original_title || b.title)} loading="lazy" /> : null}
              </div>
              <div className="title">{stripHtml(b.original_title || b.title)}</div>
              <div className="author">{b.original_author || b.author}</div>
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
