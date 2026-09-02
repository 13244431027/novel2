import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShelf, getHistory, removeFromShelf, removeFromHistory, clearHistory } from '../storage.js';
import { stripHtml } from '../utils.js';

function BookRow({ book, onOpen, onRemove }) {
  return (
    <div className="row-card">
      <div className="row-cover" onClick={onOpen}>
        {book.image_link ? <img src={book.image_link} alt={stripHtml(book.title)} loading="lazy" /> : null}
      </div>
      <div className="row-info" onClick={onOpen}>
        <div className="row-title">{stripHtml(book.title)}</div>
        <div className="row-author">{book.author}</div>
        <div className="row-progress">
          {book.chapter_title ? `读到：${stripHtml(book.chapter_title)}` : ''}
        </div>
        <div className="row-time">
          {book.updatedAt || book.addedAt ? new Date(book.updatedAt || book.addedAt).toLocaleString('zh-CN', { hour12: false }) : ''}
        </div>
      </div>
      {book.chapter_id ? (
        <button
          className="row-action"
          onClick={() => onOpen(book.chapter_id)}
        >
          继续阅读
        </button>
      ) : (
        <button className="row-action" onClick={onOpen}>查看</button>
      )}
      {onRemove && (
        <button className="row-action danger" onClick={() => onRemove(book)}>
          {book.addedAt ? '移出书架' : '删除'}
        </button>
      )}
    </div>
  );
}

export default function Shelf() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('shelf');
  const [shelf, setShelf] = useState([]);
  const [history, setHistory] = useState([]);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setShelf(getShelf());
    setHistory(getHistory());
  }, [refresh, tab]);

  function remove(book) {
    if (book.addedAt) {
      removeFromShelf(book.id);
    } else {
      removeFromHistory(book.book_id);
    }
    setRefresh((r) => r + 1);
  }

  function open(book, chapterId) {
    if (chapterId) {
      navigate(`/read/${book.id || book.book_id}/${chapterId}`);
    } else {
      navigate(`/book/${book.id || book.book_id}`);
    }
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="/">七猫阅读</a>
          <nav className="top-nav">
            <a href="/" style={{ marginRight: 16 }}>首页</a>
          </nav>
        </div>
      </header>

      <div className="container">
        <div className="tab-bar">
          <button className={tab === 'shelf' ? 'active' : ''} onClick={() => setTab('shelf')}>
            我的书架（{shelf.length}）
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            阅读历史（{history.length}）
          </button>
          {tab === 'history' && history.length > 0 && (
            <button className="tab-clear" onClick={() => { clearHistory(); setRefresh((r) => r + 1); }}>
              清空历史
            </button>
          )}
        </div>

        {tab === 'shelf' && (
          <>
            {shelf.length === 0 ? (
              <div className="empty-tip">
                书架还是空的，去首页逛逛吧
                <br />
                <button className="page-btn" onClick={() => navigate('/')}>去选书</button>
              </div>
            ) : (
              <div className="row-list">
                {shelf.map((b) => (
                  <BookRow key={b.id} book={b} onRemove={remove} onOpen={(cid) => open(b, cid)} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {history.length === 0 ? (
              <div className="empty-tip">
                暂无阅读记录
                <br />
                <button className="page-btn" onClick={() => navigate('/')}>去读书</button>
              </div>
            ) : (
              <div className="row-list">
                {history.map((h) => (
                  <BookRow key={h.book_id} book={h} onRemove={remove} onOpen={(cid) => open(h, cid)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
