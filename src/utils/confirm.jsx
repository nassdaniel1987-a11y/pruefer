import React, { useState, useEffect } from 'react';

// ─── CONFIRM DIALOG ───────────────────────────────────
let _confirmResolver = null;
let _confirmState = null;
let _confirmListeners = [];

const confirmDialog = (title, message, dangerLabel = 'Löschen') => {
  return new Promise(resolve => {
    _confirmResolver = resolve;
    _confirmState = { title, message, dangerLabel };
    _confirmListeners.forEach(fn => fn({ ..._confirmState }));
  });
};

const ConfirmDialog = () => {
  const [state, setState] = useState(null);
  useEffect(() => { _confirmListeners.push(setState); return () => { _confirmListeners = _confirmListeners.filter(f => f !== setState); }; }, []);
  if (!state) return null;
  const close = (val) => { setState(null); _confirmState = null; if (_confirmResolver) { _confirmResolver(val); _confirmResolver = null; } };
  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center" onClick={() => close(false)}>
      <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-on-surface mb-2">{state.title}</h3>
        <p className="text-on-surface-variant text-sm mb-5">{state.message}</p>
        <div className="flex gap-2 justify-end">
          <button className="px-4 py-2 text-sm font-medium rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => close(false)}>Abbrechen</button>
          <button className="px-4 py-2 text-sm font-medium rounded-xl bg-error text-on-error hover:bg-error/90 transition-colors" onClick={() => close(true)}>{state.dangerLabel}</button>
        </div>
      </div>
    </div>
  );
};

export { confirmDialog, ConfirmDialog };
