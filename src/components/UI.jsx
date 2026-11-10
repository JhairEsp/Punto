import React, { useEffect } from 'react';
import { Check, X, MapPin, AlertCircle, LoaderCircle } from 'lucide-react';

export function Logo({ light = false, compact = false }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}>
    <span className="brand-mark"><MapPin size={20} strokeWidth={2.7} /><span className="brand-check"><Check size={10} strokeWidth={4} /></span></span>
    {!compact && <span className="brand-word">punto<span>.</span></span>}
  </div>;
}

export function Avatar({ user, size = 'md', className = '' }) {
  const name = user?.name || 'U';
  return <span className={`avatar avatar-${size} ${className}`} style={{ background: user?.avatarColor || user?.avatar_color || '#D9F99D' }}>
    {name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()}
  </span>;
}

export function Spinner({ light = false, size = 20 }) {
  return <LoaderCircle className={`spin ${light ? 'icon-light' : ''}`} size={size} />;
}

export function Modal({ children, onClose, className = '', full = false, labelledBy }) {
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = old; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return <div className={`modal-backdrop ${full ? 'modal-full-backdrop' : ''}`} onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
    <section role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`modal-sheet ${full ? 'modal-full' : ''} ${className}`}>
      {children}
    </section>
  </div>;
}

export function CloseButton({ onClick, light = false, label = 'Cerrar' }) {
  return <button type="button" className={`icon-button close-button ${light ? 'icon-button-light' : ''}`} onClick={onClick} aria-label={label}><X size={21} /></button>;
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return <div className="empty-state">
    <div className="empty-icon">{Icon && <Icon size={28} />}</div>
    <h3>{title}</h3><p>{text}</p>{action}
  </div>;
}

export function Skeleton({ className = '' }) { return <div className={`skeleton ${className}`} />; }

export function Field({ label, icon: Icon, children, hint }) {
  return <label className="field"><span className="field-label">{label}</span><span className="field-control">{Icon && <Icon size={18} />}{children}</span>{hint && <small>{hint}</small>}</label>;
}

export function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onClose, 4200);
    return () => clearTimeout(id);
  }, [toast, onClose]);
  if (!toast) return null;
  return <div className={`toast toast-${toast.type || 'success'}`} role="status">
    <span className="toast-icon">{toast.type === 'error' ? <AlertCircle size={19} /> : <Check size={19} />}</span>
    <span>{toast.message}</span><button onClick={onClose} aria-label="Cerrar aviso"><X size={17} /></button>
  </div>;
}
