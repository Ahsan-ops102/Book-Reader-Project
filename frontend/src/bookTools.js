import { pdfjs } from 'react-pdf';
import { uploadCover, updateBook, updatePageCount, saveBookText } from './api.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
export async function openPdf(source) {
  return pdfjs.getDocument(source).promise;
}
export async function pageImage(pdf, pageNumber = 1, width = 500) {
  const page = await pdf.getPage(pageNumber),
    natural = page.getViewport({
      scale: 1
    }),
    viewport = page.getViewport({
      scale: width / natural.width
    }),
    canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport
  }).promise;
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
export async function extractBook(file, book, onProgress = () => {}, {
  preserveMetadata = false
} = {}) {
  if (book.format === 'epub' || /\.epub$/i.test(file.name || '')) return;
  const pdf = await openPdf({
    data: new Uint8Array(await file.arrayBuffer())
  });
  try {
    await updatePageCount(book.id, pdf.numPages);
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info || {};
    const patch = {};
    if (info.Author && !book.author) patch.author = info.Author.slice(0, 200);
    if (!preserveMetadata && info.Title && !/^(untitled|microsoft|document)/i.test(info.Title)) patch.title = info.Title.slice(0, 300);
    let opening = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
      const page = await pdf.getPage(p),
        text = await page.getTextContent();
      opening += text.items.map(t => t.str).join(' ') + ' ';
    }
    const isbn = opening.match(/ISBN(?:-1[03])?\s*:?\s*([\d][\d\s-]{8,22}[\dXx])/i)?.[1]?.replace(/[\s-]/g, '');
    if (!book.isbn && isbn && [10, 13].includes(isbn.length)) patch.isbn = isbn;
    if (Object.keys(patch).length) await updateBook(book.id, patch);
    onProgress('Saving PDF cover');
    await uploadCover(book.id, new File([await pageImage(pdf)], 'cover.png', {
      type: 'image/png'
    }), 'extracted');
  } finally {
    await pdf.destroy();
  }
}
export async function indexPdf(pdf, bookId, onProgress = () => {}, signal) {
  let pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    if (signal?.aborted) throw new Error('Indexing cancelled');
    const page = await pdf.getPage(p),
      content = await page.getTextContent();
    pages.push({
      page: p,
      text: content.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').slice(0, 60000)
    });
    if (pages.length === 20 || p === pdf.numPages) {
      await saveBookText(bookId, pages);
      pages = [];
    }
    onProgress(`${p} / ${pdf.numPages} pages indexed`);
  }
}
export async function composeCover(image, title, author) {
  const img = new Image();
  img.src = image;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 600, 900);
  const gradient = ctx.createLinearGradient(0, 0, 0, 420);
  gradient.addColorStop(0, 'rgba(0,0,0,.85)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 420);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px Georgia';
  const words = title.split(/\s+/);
  let line = '',
    y = 65;
  for (const word of words) {
    if (ctx.measureText(line + word).width > 510) {
      ctx.fillText(line, 45, y);
      y += 49;
      line = '';
    }
    line += word + ' ';
  }
  ctx.fillText(line, 45, y);
  ctx.font = '22px sans-serif';
  ctx.fillText(author || '', 45, y + 45, 510);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
