import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { stripHtml, fmtWord, fmtScore } from '../utils.js';
import { isInShelf, addToShelf, removeFromShelf } from '../storage.js';

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inShelf, setInShelf] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    setInShelf(isInShelf(id));
    Promise.all([
      fetch(`/api/book/${id}`).then((r) => r.json()),
      fetch(`/api/book/${id}/chapters`).then((r) => r.json())
    ])
      .then(([bd, cl]) => {
        if (bd.error || bd.errors) throw new Error(bd.error || bd.errors.title);
        if (cl.error || cl.errors) throw new Error(cl.error || cl.errors.title);
        setBook(bd.book || bd);
        setChapters(cl.chapter_lists || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">加载失败：{error}</div>;
  if (!book) return <div className="error">书籍不存在</div>;

  const firstChapter = chapters[0];
  const lastChapter = chapters[chapters.length - 1];
  const tags = Array.isArray(book.book_tag_list)
    ? book.book_tag_list.map((t) => t.title).filter(Boolean)
    : [];

  function toggleShelf() {
    if (inShelf) {
      removeFromShelf(id);
      setInShelf(false);
    } else {
      addToShelf({
        id,
        title: book.title,
        author: book.author,
        image_link: book.image_link,
        intro: book.intro
      });
      setInShelf(true);
    }
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <Link className="logo" to="/">七猫阅读</Link>
          <nav className="top-nav" style={{ marginLeft: 'auto' }}>
            <Link to="/shelf">书架 / 历史</Link>
          </nav>
        </div>
      </header>

      <div className="container">
        <div className="detail">
          <div className="detail-cover">
            {book.image_link ? <img src={book.image_link} alt={book.title} /> : null}
          </div>
          <div className="detail-info">
            <h1>{stripHtml(book.title)}</h1>
            <div className="detail-meta">
              <span>{book.author}</span>
              {book.chapters ? <span>共 {book.chapters} 章</span> : null}
              {book.words_num ? <span>{fmtWord(book.words_num)}</span> : null}
              {book.score ? <span>{fmtScore(book.score)}</span> : null}
              {book.category1_name ? <span>{book.category1_name}</span> : null}
              {book.category2_name ? <span>{book.category2_name}</span> : null}
              {book.is_over === '1' ? <span>已完结</span> : <span>连载中</span>}
            </div>
            {tags.length > 0 && (
              <div className="detail-tags">{tags.map((t) => <span key={t}>{t}</span>)}</div>
            )}
            <div className="detail-intro">
              {book.intro ? stripHtml(book.intro) : '暂无简介'}
            </div>
            <div className="detail-btns">
              {firstChapter && (
                <button
                  className="read-btn"
                  onClick={() => navigate(`/read/${id}/${firstChapter.id}`)}
                >
                  开始阅读
                </button>
              )}
              {lastChapter && lastChapter.id !== firstChapter.id && (
                <button
                  className="read-btn ghost"
                  onClick={() => navigate(`/read/${id}/${lastChapter.id}`)}
                >
                  看结局
                </button>
              )}
              <button
                className={`read-btn ${inShelf ? 'shelved' : ''}`}
                style={{ marginLeft: 12 }}
                onClick={toggleShelf}
              >
                {inShelf ? '已在书架' : '加入书架'}
              </button>
            </div>
          </div>
        </div>

        <div className="chapters">
          <h2 className="section-title">目录（{chapters.length} 章）</h2>
          <div className="chapter-grid">
            {chapters.map((c) => (
              <div
                key={c.id}
                className="chapter-item"
                onClick={() => navigate(`/read/${id}/${c.id}`)}
                title={stripHtml(c.title)}
              >
                {stripHtml(c.title)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
