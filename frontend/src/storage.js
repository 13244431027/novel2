const SHELF_KEY = 'qimao_shelf_v1';
const HISTORY_KEY = 'qimao_history_v1';
const MAX_HISTORY = 100;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

// ---- 书架 ----
export function getShelf() {
  return read(SHELF_KEY) || [];
}

export function isInShelf(bookId) {
  return getShelf().some((b) => String(b.id) === String(bookId));
}

export function addToShelf(book) {
  const shelf = getShelf();
  if (shelf.some((b) => String(b.id) === String(book.id))) return false;
  shelf.unshift({
    id: String(book.id),
    title: book.title || '',
    author: book.author || '',
    image_link: book.image_link || '',
    intro: book.intro || '',
    addedAt: Date.now()
  });
  write(SHELF_KEY, shelf);
  return true;
}

export function removeFromShelf(bookId) {
  const shelf = getShelf().filter((b) => String(b.id) !== String(bookId));
  write(SHELF_KEY, shelf);
}

// ---- 历史 ----
export function getHistory() {
  return read(HISTORY_KEY) || [];
}

export function getLastRead(bookId) {
  return getHistory().find((h) => String(h.book_id) === String(bookId)) || null;
}

export function recordHistory({ book, chapter, chapterTitle }) {
  const history = getHistory().filter((h) => String(h.book_id) !== String(book.id));
  history.unshift({
    book_id: String(book.id),
    title: book.title || '',
    author: book.author || '',
    image_link: book.image_link || '',
    chapter_id: chapter ? String(chapter) : '',
    chapter_title: chapterTitle || '',
    updatedAt: Date.now()
  });
  write(HISTORY_KEY, history.slice(0, MAX_HISTORY));
  // 若书已在书架，同步更新进度信息
  const shelf = getShelf();
  let changed = false;
  const next = shelf.map((b) => {
    if (String(b.id) === String(book.id)) {
      changed = true;
      return {
        ...b,
        title: book.title || b.title,
        author: book.author || b.author,
        image_link: book.image_link || b.image_link,
        chapter_id: chapter ? String(chapter) : b.chapter_id,
        chapter_title: chapterTitle || b.chapter_title
      };
    }
    return b;
  });
  if (changed) write(SHELF_KEY, next);
}

export function clearHistory() {
  write(HISTORY_KEY, []);
}

export function removeFromHistory(bookId) {
  const history = getHistory().filter((h) => String(h.book_id) !== String(bookId));
  write(HISTORY_KEY, history);
}
