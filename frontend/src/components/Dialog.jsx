import { useEffect, useRef } from 'react';
export default function Dialog({
  title,
  onClose,
  children
}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const close = e => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', close);
    return () => {
      dialog.removeEventListener('cancel', close);
      dialog.close();
    };
  }, []);
  return <dialog ref={ref} className="rr-dialog" aria-label={title}><div className="dialog-heading"><h2>{title}</h2><button onClick={onClose} aria-label="Close dialog">×</button></div>{children}</dialog>;
}
