import { useEffect, useState } from 'react';
import { coverBlob } from '../api.js';
export default function Cover({
  book
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true,
      url;
    setSrc('');
    coverBlob(book).then(value => {
      url = value;
      if (active) setSrc(value);
    }).catch(() => {});
    return () => {
      active = false;
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [book.id, book.cover_ref, book.cover_updated_at]);
  return <div className={`cover-art ${src ? 'has-image' : ''}`}>{src ? <img src={src} alt={`Cover of ${book.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setSrc('')} /> : <div className="cover-placeholder"><span>THE READING ROOM</span><strong>{book.title}</strong><small>{book.author || 'Your personal edition'}</small></div>}{book.cover_kind === 'generated' && <small className="cover-badge">AI artwork</small>}</div>;
}
