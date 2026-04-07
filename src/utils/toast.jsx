import React, { useState, useEffect } from 'react';

// ─── TOAST SYSTEM ─────────────────────────────────────
let _toastListeners = [];
const toast = {
  _list: [],
  _notify() { _toastListeners.forEach(fn => fn([...this._list])); },
  show(msg, type = 'info', duration = 4000) {
    const id = Date.now() + Math.random();
    this._list.push({ id, msg, type });
    this._notify();
    setTimeout(() => { this._list = this._list.filter(t => t.id !== id); this._notify(); }, duration);
  },
  error(msg) { this.show(msg, 'error', 6000); },
  success(msg) { this.show(msg, 'success', 3000); },
  info(msg) { this.show(msg, 'info', 4000); },
  warn(msg) { this.show(msg, 'warning', 5000); },
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);
  useEffect(() => { _toastListeners.push(setToasts); return () => { _toastListeners = _toastListeners.filter(f => f !== setToasts); }; }, []);
  if (!toasts.length) return null;
  return React.createElement('div', { className: 'toast-container' },
    toasts.map(t => React.createElement('div', { key: t.id, className: `toast toast-${t.type}` }, t.msg))
  );
};

export { toast, ToastContainer };
