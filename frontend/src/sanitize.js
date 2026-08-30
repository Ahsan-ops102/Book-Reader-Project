export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[c]);
export function safeHtml(value) {
  const doc = new DOMParser().parseFromString(String(value), 'text/html');
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'SPAN', 'MARK', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG']);
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'LINK', 'META', 'BASE'].includes(el.tagName)) {
      el.remove();
      continue;
    }
    if (!allowed.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const color = el.style.color,
      bg = el.style.backgroundColor,
      align = el.style.textAlign;
    const href = el.getAttribute('href'),
      src = el.getAttribute('src'),
      alt = el.getAttribute('alt');
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
    if (el.tagName === 'IMG') {
      if (src && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length < 2500000) {
        el.setAttribute('src', src);
        el.setAttribute('alt', alt || 'Document image');
      } else {
        el.remove();
        continue;
      }
    }
    if (color) el.style.color = color;
    if (bg) el.style.backgroundColor = bg;
    if (['left', 'right', 'center', 'justify'].includes(align)) el.style.textAlign = align;
    if (el.tagName === 'A' && href) {
      try {
        const url = new URL(href);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
          el.setAttribute('href', url.href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      } catch {}
    }
  }
  return doc.body.innerHTML;
}
export function plainToHtml(value) {
  return String(value).split(/\n\n+/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}
