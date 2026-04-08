const fs = require('fs');

let code = fs.readFileSync('src/components/KinderVerzeichnis.jsx', 'utf8');

// 1. Remove the entire legacy early-return block for selectedKindId
const legacyStart = code.indexOf('// AKTE-DETAILANSICHT (Design-Upgrade)');
const legacyEnd = code.indexOf('// LISTENANSICHT (Design-Upgrade)');
if (legacyStart !== -1 && legacyEnd !== -1) {
  // Find the 'if (selectedKindId) {' before the start marker
  const preStart = code.lastIndexOf('if (selectedKindId)', legacyStart);
  if (preStart !== -1) {
     code = code.substring(0, preStart) + code.substring(legacyEnd);
  }
}

// 2. Remove the sidebar layout wrapper
// Change <div className="flex-1 w-full lg:w-3/5 space-y-6"> to full width
code = code.replace(/<div className="flex-1 w-full lg:w-3\/5 space-y-6">/, '<div className="w-full space-y-6">');

// 3. Find the sidebar block and convert it to a Modal.
// The sidebar starts right after the 'Zeige {filtered.length} Ergebnisse' div
// Find `<div className="w-full lg:w-96 shrink-0 lg:sticky lg:top-24">`
const sidebarRegex = /<div className="w-full lg:w-96 shrink-0 lg:sticky lg:top-24">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*\{editKind && \(/;

const sidebarMatch = code.match(sidebarRegex);
if (sidebarMatch) {
  // The content of the sidebar is basically selectedKindId && akte ? (...) : (...)
  // We want to extract it and wrap it in a modal.
  const modalUI = `
      {selectedKindId && akte && (
        <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedKindId(null)}>
          <div className="bg-surface-container-lowest rounded-3xl w-full max-w-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="relative h-28 bg-gradient-to-br from-primary-container to-primary shrink-0">
              <div className="absolute -bottom-8 left-6">
                <div className="border-4 border-surface-container-lowest rounded-2xl shadow-lg bg-surface-container-lowest">
                  <Avatar vorname={akte.kind.vorname} nachname={akte.kind.nachname} size="lg" />
                </div>
              </div>
              <div className="absolute top-4 right-4 flex gap-2">
                <button className="bg-white/20 hover:bg-white/30 p-1.5 rounded-full text-white transition-all backdrop-blur-md" onClick={() => startEdit(akte.kind)}>
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <button className="bg-white/20 hover:bg-white/30 p-1.5 rounded-full text-white transition-all backdrop-blur-md" onClick={() => setSelectedKindId(null)}>
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            <div className="pt-12 px-6 pb-6 flex-1 overflow-y-auto space-y-8">
              <div>
                <h3 className="text-2xl font-extrabold text-on-surface tracking-tight">{akte.kind.nachname}, {akte.kind.vorname}</h3>
                <div className="flex items-center gap-2 mt-2">
                  {akte.kind.klasse && <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">Klasse {akte.kind.klasse}</span>}
                  <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
                  <span className="text-xs text-on-surface-variant font-medium">ID: #{akte.kind.id}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-surface-container-low rounded-xl p-3 text-center border border-outline-variant/5">
                  <div className="text-xl font-bold text-primary">{akte.summary?.total_anmeldungen || 0}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">Anmeldungen</div>
                </div>
                <div className="bg-surface-container-low rounded-xl p-3 text-center border border-outline-variant/5">
                  <div className="text-xl font-bold text-emerald-600">{akte.summary?.total_buchungen || 0}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">Buchungen</div>
                </div>
              </div>

              {akte.kind.notizen && (
                <div className="bg-amber-500/10 border-l-4 border-l-amber-500 p-3 rounded-r-xl">
                  <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1">Notizen</p>
                  <p className="text-sm text-amber-900">{akte.kind.notizen}</p>
                </div>
              )}

              <div className="space-y-4">
                <h4 className="text-[11px] font-bold text-outline uppercase tracking-widest border-b border-outline-variant/10 pb-2">Verlauf / Enrollment</h4>
                {!akte.blocks || akte.blocks.length === 0 ? (
                  <p className="text-xs text-on-surface-variant">Keine Einträge in den Listen vorhanden.</p>
                ) : (
                  <div className="space-y-3">
                    {akte.blocks.map(b => (
                      <div key={b.ferienblock_id} className="p-4 bg-surface-container-low/50 rounded-xl border border-outline-variant/5">
                        <div className="flex items-start gap-3 mb-2">
                          <div className={\`mt-1 w-2 h-2 rounded-full shrink-0 \${b.match_status==='exact'||b.match_status==='fuzzy_accepted' ? 'bg-emerald-500' : 'bg-primary-container'}\`}></div>
                          <div className="flex-1">
                            <p className="text-sm font-bold text-on-surface leading-tight">{b.block_name}</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">{fmtDate(b.startdatum)} – {fmtDate(b.enddatum)}</p>
                          </div>
                          {b.klasse && <span className="text-[10px] bg-white dark:bg-surface-container-high px-1.5 py-0.5 rounded border border-outline-variant/20">Kl. {b.klasse}</span>}
                        </div>
                        
                        <div className="pl-5 grid grid-cols-2 gap-2 mt-3">
                           <div className="bg-white dark:bg-surface-container px-3 py-2 rounded-lg text-left shadow-sm border border-outline-variant/5">
                              <div className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Anmeldungen (A)</div>
                              <div className="text-sm font-bold text-primary">{b.anmeldungen.length} Tage</div>
                           </div>
                           <div className="bg-white dark:bg-surface-container px-3 py-2 rounded-lg text-left shadow-sm border border-outline-variant/5">
                              <div className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Buchungen (B)</div>
                              <div className="text-sm font-bold text-emerald-600">{b.buchungen.length} Tage</div>
                           </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editKind && (`;

  code = code.replace(sidebarMatch[0], '</div></div>\n' + modalUI);
}

fs.writeFileSync('src/components/KinderVerzeichnis.jsx', code);
console.log('Refactoring complete');
