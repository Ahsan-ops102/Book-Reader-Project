// Explicitly chosen covers are never replaced by the automatic queue.
export function needsPdfCover(book) {
  return book.format !== 'epub' && !book.deleted_at && (!book.cover_kind || book.cover_kind === 'placeholder' || !book.cover_ref);
}
