import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Search from './pages/Search.jsx';
import BookDetail from './pages/BookDetail.jsx';
import Reader from './pages/Reader.jsx';
import Shelf from './pages/Shelf.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/book/:id" element={<BookDetail />} />
      <Route path="/read/:bookId/:chapterId" element={<Reader />} />
      <Route path="/shelf" element={<Shelf />} />
    </Routes>
  );
}
