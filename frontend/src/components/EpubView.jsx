import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { safeHtml } from '../sanitize.js';
import { fetchBookBlob, updatePageCount, saveBookText } from '../api.js';
import { cacheGet } from '../offline.js';
export default function EpubView({
  book,
  page,
  onPages,
  onOutline,
  fontSize = 20,
  onText
}) {
  const [chapters, setChapters] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      const blob = (await cacheGet(`file:${book.id}`)) || (await fetchBookBlob(book.id)),
        zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const total = Object.values(zip.files).reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0);
      if (total > 150 * 1024 * 1024) throw new Error('Expanded EPUB is too large.');
      const parse = s => new DOMParser().parseFromString(s, 'application/xml');
      const container = parse(await zip.file('META-INF/container.xml').async('string')),
        opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
      if (!opfPath || !zip.file(opfPath)) throw new Error('EPUB package could not be found.');
      const opf = parse(await zip.file(opfPath).async('string')),
        base = opfPath.split('/').slice(0, -1).join('/');
      const manifest = new Map([...opf.getElementsByTagName('item')].map(e => [e.getAttribute('id'), e.getAttribute('href')]));
      const loaded = [];
      let imageBytes = 0;
      for (const ref of opf.getElementsByTagName('itemref')) {
        const href = manifest.get(ref.getAttribute('idref'));
        if (!href) continue;
        const name = decodeURIComponent(new URL(href, `https://epub.local/${base ? base + '/' : ''}`).pathname.slice(1));
        const file = zip.file(name);
        if (!file) continue;
        const sourceDoc = new DOMParser().parseFromString(await file.async('string'), 'text/html');
        for (const img of sourceDoc.querySelectorAll('img')) {
          const src = img.getAttribute('src') || '';
          const resolved = new URL(src, `https://epub.local/${name}`);
          const image = resolved.origin === 'https://epub.local' && zip.file(decodeURIComponent(resolved.pathname.slice(1)));
          const ext = resolved.pathname.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
          if (!image || !ext || image._data?.uncompressedSize > 1800000 || imageBytes > 20000000) {
            img.remove();
            continue;
          }
          imageBytes += image._data?.uncompressedSize || 0;
          img.setAttribute('src', `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${await image.async('base64')}`);
        }
        const html = safeHtml(sourceDoc.body.innerHTML);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        loaded.push({
          html,
          title: doc.querySelector('h1,h2,h3')?.textContent || `Section ${loaded.length + 1}`,
          text: doc.body.textContent || ''
        });
      }
      if (!active) return;
      setChapters(loaded);
      onPages(loaded.length);
      onOutline(loaded.map((c, i) => ({
        title: c.title,
        page: i + 1
      })));
      if (!loaded.length) throw new Error('No readable EPUB sections were found. DRM-protected books are not supported.');
      updatePageCount(book.id, loaded.length).catch(() => {});
    })().catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [book.id]);
  useEffect(() => {
    onText(chapters[page - 1]?.text || '');
  }, [page, chapters]);
  return <article className="epub-page" style={{
    fontSize
  }} data-page={page}>{error ? <p role="alert">{error}</p> : chapters[page - 1] ? <div dangerouslySetInnerHTML={{
      __html: chapters[page - 1].html
    }} /> : <p>Opening EPUB…</p>}</article>;
}
