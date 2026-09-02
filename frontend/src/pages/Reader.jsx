import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { stripHtml } from '../utils.js';
import { recordHistory } from '../storage.js';

export default function Reader() {
  const { bookId, chapterId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [bookTitle, setBookTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(17);
  const bookRef = useRef(null);
  const recorded = useRef('');

  useEffect(() => {
    setLoading(true);
    setError('');
    setData(null);
    let canceled = false;
    Promise.all([
      fetch(`/api/chapter/${bookId}/${chapterId}`).then((r) => r.json()),
      fetch(`/api/book/${bookId}`).then((r) => r.json()),
      fetch(`/api/book/${bookId}/chapters`).then((r) => r.json())
    ])
      .then(([cd, bd, cl]) => {
        if (canceled) return;
        if (cd.error || cd.errors) throw new Error(cd.error || cd.errors.title);
        if (bd.error || bd.errors) throw new Error(bd.error || bd.errors.title);
        if (cl.error || cl.errors) throw new Error(cl.error || cl.errors.title);
        setData(cd);
        const rawBook = bd.book || bd;
        bookRef.current = rawBook;
        setBookTitle(stripHtml(rawBook.title || ''));
        setChapters(cl.chapter_lists || []);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [bookId, chapterId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [chapterId]);

  useEffect(() => {
    const bk = bookRef.current;
    if (!bk) return;
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx < 0) return;
    const chapterTitle = stripHtml(chapters[idx].title);
    if (recorded.current === chapterId) return;
    recorded.current = chapterId;
    recordHistory({
      book: {
        id: bookId,
        title: bk.title || bookTitle,
        author: bk.author || '',
        image_link: bk.image_link || ''
      },
      chapter: chapterId,
      chapterTitle
    });
  }, [chapters, chapterId, bookId, bookTitle]);

  const idx = chapters.findIndex((c) => c.id === chapterId);
  const prev = idx > 0 ? chapters[idx - 1] : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
  const curTitle = idx >= 0 ? stripHtml(chapters[idx].title) : (data?.title || '');

  return (
    <div className="reader">
      <div className="reader-top">
        <div className="reader-top-inner">
          <Link className="book-link" to={`/book/${bookId}`}>返回书籍</Link>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{bookTitle}</span>
          <div>
            <Link className="page-btn" to="/shelf" style={{ marginTop: 0, marginRight: 8 }}>书架</Link>
            <button className="page-btn" style={{ marginTop: 0, marginRight: 8 }} onClick={() => setFontSize(Math.max(13, fontSize - 1))}>A-</button>
            <button className="page-btn" style={{ marginTop: 0 }} onClick={() => setFontSize(Math.min(28, fontSize + 1))}>A+</button>
          </div>
        </div>
      </div>

      <div className="reader-body">
        {loading && <div className="loading">加载中...</div>}
        {error && <div className="error">加载失败：{error}</div>}
        {data && (
          <>
            <h1>{curTitle || '未命名章节'}</h1>
            <div className="content" style={{ fontSize }}>
              {data.content || '本章暂无内容'}
            </div>
            <div className="reader-nav">
              {prev ? (
                <button onClick={() => navigate(`/read/${bookId}/${prev.id}`)}>上一章：{stripHtml(prev.title)}</button>
              ) : <button disabled>已是第一章</button>}
              {next ? (
                <button onClick={() => navigate(`/read/${bookId}/${next.id}`)}>下一章：{stripHtml(next.title)}</button>
              ) : <button disabled>已是最后一章</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
