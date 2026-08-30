// Anchor the bottom of the whole popover above the first selected line.
// Its height may change as the answer arrives; no guessed toolbar height is used.
export function selectionPopoverStyle(box, viewportWidth) {
  const width = Math.min(360, viewportWidth - 24);
  return {
    left: Math.max(width / 2 + 12, Math.min(viewportWidth - width / 2 - 12, box.left + box.width / 2)),
    top: Math.max(0, box.top - 10), width,
    maxHeight: Math.max(0, box.top - 18)
  };
}

export function selectWordAtPoint(doc, x, y, container) {
  const caret = doc.caretPositionFromPoint?.(x, y);
  const fallback = caret ? null : doc.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || fallback?.startContainer;
  const offset = caret?.offset ?? fallback?.startOffset;
  if (!node || node.nodeType !== 3 || !container.contains(node)) return false;
  const value = node.textContent;
  // Segment Unicode words, including languages without space-separated words.
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, {granularity:'word'}).segment(value)].filter(s => s.isWordLike)
    : [...value.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)].map(m=>({index:m.index,segment:m[0]}));
  const word = segments.find(s => offset >= s.index && offset < s.index + s.segment.length)
    || segments.find(s => offset === s.index + s.segment.length);
  if (!word) return false;
  const range = doc.createRange();
  range.setStart(node, word.index); range.setEnd(node, word.index + word.segment.length);
  const selection = doc.defaultView.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  return true;
}
