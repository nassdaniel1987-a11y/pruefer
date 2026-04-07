import React, { useState, useEffect } from 'react';
import { API } from '../utils/api';
import { toast } from '../utils/toast';
import { confirmDialog } from '../utils/confirm';
import { fmtDate } from '../utils/helpers';
import Spinner from './Spinner';

// ─── ANGEBOTE PAGE ───────────────────────────────────
const STATUS_CFG = {
  vollstaendig:    { label: 'Vollständig',     badgeClass: 'badge-green'  },
  teilweise:       { label: 'Teilweise',        badgeClass: 'badge-orange' },
  nicht_gebucht:   { label: 'Kein Essen',       badgeClass: 'badge-red'    },
  nur_gebucht:     { label: 'Nur gebucht',      badgeClass: 'badge-blue'   },
  nicht_vorhanden: { label: 'Nicht vorhanden',  badgeClass: 'badge-grey'   },
};

// Hilfsfunktion: alle Tage zwischen start und end als YYYY-MM-DD Array
const tageBetween = (start, end) => {
  const days = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
};

const AngebotePage = ({ blocks }) => {
  const [angebote, setAngebote] = useState([]);
  const [selectedAngebot, setSelectedAngebot] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(null);
  const [createForm, setCreateForm] = useState({ name: '', ferienblock_id: '', beschreibung: '', tage: [] });
  const [filterBlock, setFilterBlock] = useState('');
  const [kinderSuche, setKinderSuche] = useState('');
  const [kinderListe, setKinderListe] = useState([]);
  const [kinderGefiltert, setKinderGefiltert] = useState([]);

  const loadAngebote = async (fbId = filterBlock) => {
    setLoadingList(true);
    const res = await API.get('angebote', fbId ? { ferienblock_id: fbId } : {});
    setAngebote(Array.isArray(res) ? res : []);
    setLoadingList(false);
  };

  const loadDetail = async (id) => {
    setLoadingDetail(true);
    setDetailData(null);
    const res = await API.get('angebote', { id });
    setDetailData(res.error ? null : res);
    setLoadingDetail(false);
  };

  const loadKinder = async () => {
    const res = await API.get('kinder');
    setKinderListe(Array.isArray(res) ? res : []);
  };

  useEffect(() => { loadAngebote(); loadKinder(); }, []);

  useEffect(() => {
    if (!kinderSuche.trim()) { setKinderGefiltert([]); return; }
    const q = kinderSuche.toLowerCase();
    const bereits = detailData?.kinder?.map(k => k.id) || [];
    setKinderGefiltert(
      kinderListe.filter(k =>
        !bereits.includes(k.id) &&
        (k.nachname.toLowerCase().includes(q) || k.vorname.toLowerCase().includes(q) || (k.klasse || '').toLowerCase().includes(q))
      ).slice(0, 10)
    );
  }, [kinderSuche, kinderListe, detailData]);

  const handleFilterBlock = (val) => {
    setFilterBlock(val);
    loadAngebote(val);
    setSelectedAngebot(null);
    setDetailData(null);
  };

  const handleSelectAngebot = (a) => {
    setSelectedAngebot(a);
    loadDetail(a.id);
    setKinderSuche('');
    setShowEditForm(null);
  };

  // Datum in createForm/editForm toggeln
  const toggleTag = (datum, form, setForm) => {
    setForm(f => ({
      ...f,
      tage: f.tage.includes(datum) ? f.tage.filter(d => d !== datum) : [...f.tage, datum].sort()
    }));
  };

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.ferienblock_id) {
      toast.error('Name und Ferienblock sind Pflichtfelder');
      return;
    }
    if (createForm.tage.length === 0) {
      toast.error('Bitte mindestens einen Tag auswählen');
      return;
    }
    const res = await API.post('angebote', { action: 'create', ...createForm });
    if (res.success) {
      toast.success('Angebot erstellt');
      setShowCreateForm(false);
      setCreateForm({ name: '', ferienblock_id: '', beschreibung: '', tage: [] });
      await loadAngebote();
    }
  };

  const handleEdit = async () => {
    if (!showEditForm) return;
    if (showEditForm.tage.length === 0) {
      toast.error('Bitte mindestens einen Tag auswählen');
      return;
    }
    const res = await API.post('angebote', { action: 'edit', id: showEditForm.id, name: showEditForm.name, beschreibung: showEditForm.beschreibung, tage: showEditForm.tage });
    if (res.success) {
      toast.success('Angebot aktualisiert');
      setShowEditForm(null);
      await loadAngebote();
      if (selectedAngebot?.id === showEditForm.id) loadDetail(showEditForm.id);
    }
  };

  const handleDelete = async (id, name) => {
    const ok = await confirmDialog('Angebot löschen', `"${name}" und alle zugeordneten Kinder wirklich löschen?`, 'Löschen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'delete', id });
    if (res.success) {
      toast.success('Angebot gelöscht');
      if (selectedAngebot?.id === id) { setSelectedAngebot(null); setDetailData(null); }
      await loadAngebote();
    }
  };

  const handleAddKind = async (kind) => {
    const res = await API.post('angebote', { action: 'add_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} hinzugefügt`);
      setKinderSuche('');
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const handleRemoveKind = async (kind) => {
    const ok = await confirmDialog('Kind entfernen', `${kind.vorname} ${kind.nachname} aus dem Angebot entfernen?`, 'Entfernen');
    if (!ok) return;
    const res = await API.post('angebote', { action: 'remove_kind', angebot_id: selectedAngebot.id, kind_id: kind.id });
    if (res.success) {
      toast.success(`${kind.vorname} ${kind.nachname} entfernt`);
      await loadDetail(selectedAngebot.id);
      await loadAngebote();
    }
  };

  const fmtD = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
  };
  const fmtShort = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
  };

  // Tage-Auswahl Komponente (wiederverwendbar für create + edit)
  const TageAuswahl = ({ blockId, selectedTage, onChange }) => {
    const block = blocks.find(b => String(b.id) === String(blockId));
    if (!block) return <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Erst Ferienblock wählen</p>;
    const alle = tageBetween(block.startdatum, block.enddatum);
    return (
      <div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange(alle)}>Alle</button>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange([])}>Keine</button>
        </div>
        <div className="days-grid">
          {alle.map(d => {
            const dt = new Date(d);
            const wt = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
            const aktiv = selectedTage.includes(d);
            return (
              <span key={d}
                onClick={() => onChange(selectedTage.includes(d) ? selectedTage.filter(x => x !== d) : [...selectedTage, d].sort())}
                className={`day-chip ${aktiv ? 'matched' : ''}`}
                style={{ cursor: 'pointer', opacity: aktiv ? 1 : 0.45, userSelect: 'none' }}>
                {wt} {fmtShort(d)}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>Angebote</h1>
        <p>Gruppen mit bestimmten Tagen erstellen und Buchungsstatus der Kinder prüfen</p>
      </div>

      <div className="two-col" style={{ alignItems: 'flex-start' }}>

        {/* ── Linke Spalte: Liste + Formular ── */}
        <div>
          <div className="card">
            <div className="card-title">
              <span>Angebote</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreateForm(v => !v)}>
                {showCreateForm ? 'Abbrechen' : '+ Neu'}
              </button>
            </div>

            <select className="ferienblock-select" style={{ width: '100%', marginBottom: '1rem' }}
              value={filterBlock} onChange={e => handleFilterBlock(e.target.value)}>
              <option value="">Alle Ferienblöcke</option>
              {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

            {loadingList ? <Spinner /> : angebote.length === 0
              ? <div className="empty-state" style={{ padding: '1.5rem' }}>
                  <div className="icon">🎯</div>
                  <p>Noch keine Angebote</p>
                </div>
              : angebote.map(a => (
                <div key={a.id} className="kind-row"
                  onClick={() => handleSelectAngebot(a)}
                  style={{ background: selectedAngebot?.id === a.id ? 'var(--primary-light)' : undefined }}>
                  <div className="kind-row-info">
                    <div className="kind-row-name" style={{ color: selectedAngebot?.id === a.id ? 'var(--primary)' : undefined }}>
                      {a.name}
                    </div>
                    <div className="kind-row-meta">{a.block_name}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                    <span className="badge badge-blue">{a.kinder_count} Kinder</span>
                    <span className="badge badge-grey">{a.tage_count} Tage</span>
                  </div>
                </div>
              ))
            }
          </div>

          {/* Erstellen-Formular */}
          {showCreateForm && (
            <div className="card">
              <div className="card-title">Neues Angebot</div>
              <div className="form-group">
                <label>Name</label>
                <input className="form-input" placeholder="z.B. Fußball, Schwimmen …" value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Ferienblock</label>
                <select className="ferienblock-select" style={{ width: '100%' }} value={createForm.ferienblock_id}
                  onChange={e => setCreateForm(f => ({ ...f, ferienblock_id: e.target.value, tage: [] }))}>
                  <option value="">Ferienblock wählen</option>
                  {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tage auswählen <span className="badge badge-blue">{createForm.tage.length} gewählt</span></label>
                <TageAuswahl blockId={createForm.ferienblock_id} selectedTage={createForm.tage}
                  onChange={tage => setCreateForm(f => ({ ...f, tage }))} />
              </div>
              <div className="form-group">
                <label>Beschreibung (optional)</label>
                <textarea className="textarea" placeholder="Kurze Beschreibung …" value={createForm.beschreibung}
                  onChange={e => setCreateForm(f => ({ ...f, beschreibung: e.target.value }))}
                  style={{ minHeight: '50px' }} />
              </div>
              <div className="toolbar">
                <button className="btn btn-primary btn-sm" onClick={handleCreate}>Erstellen</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateForm(false)}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Rechte Spalte: Detail ── */}
        <div>
          {!selectedAngebot ? (
            <div className="empty-state card">
              <div className="icon">👈</div>
              <p>Angebot aus der Liste auswählen</p>
            </div>
          ) : (
            <>
              {/* Header-Card */}
              <div className="card">
                {showEditForm?.id === selectedAngebot.id ? (
                  <div>
                    <div className="toolbar" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
                      <input className="form-input" value={showEditForm.name} placeholder="Name"
                        onChange={e => setShowEditForm(f => ({ ...f, name: e.target.value }))}
                        style={{ flex: '1', minWidth: '130px' }} />
                      <input className="form-input" value={showEditForm.beschreibung || ''} placeholder="Beschreibung"
                        onChange={e => setShowEditForm(f => ({ ...f, beschreibung: e.target.value }))}
                        style={{ flex: '2', minWidth: '150px' }} />
                    </div>
                    <div className="form-group">
                      <label>Tage <span className="badge badge-blue">{showEditForm.tage.length} gewählt</span></label>
                      <TageAuswahl blockId={selectedAngebot.ferienblock_id} selectedTage={showEditForm.tage}
                        onChange={tage => setShowEditForm(f => ({ ...f, tage }))} />
                    </div>
                    <div className="toolbar">
                      <button className="btn btn-primary btn-sm" onClick={handleEdit}>Speichern</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowEditForm(null)}>Abbrechen</button>
                    </div>
                  </div>
                ) : (
                  <div className="akte-block-head">
                    <div>
                      <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.25rem' }}>{selectedAngebot.name}</h2>
                      <div className="meta" style={{ marginBottom: '0.5rem' }}>
                        {selectedAngebot.block_name} &nbsp;·&nbsp; {fmtD(selectedAngebot.startdatum)} – {fmtD(selectedAngebot.enddatum)}
                      </div>
                      {/* Tage-Chips anzeigen */}
                      {detailData?.angebot?.tage?.length > 0 && (
                        <div className="days-grid">
                          {detailData.angebot.tage.map(d => {
                            const dt = new Date(d);
                            const wt = ['So','Mo','Di','Mi','Do','Fr','Sa'][dt.getDay()];
                            return <span key={d} className="day-chip matched">{wt} {fmtShort(d)}</span>;
                          })}
                        </div>
                      )}
                      {selectedAngebot.beschreibung && (
                        <div style={{ marginTop: '0.4rem', fontSize: '0.88rem', color: 'var(--text2)' }}>{selectedAngebot.beschreibung}</div>
                      )}
                    </div>
                    <div className="akte-block-badges">
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setShowEditForm({
                          id: selectedAngebot.id,
                          name: selectedAngebot.name,
                          beschreibung: selectedAngebot.beschreibung || '',
                          tage: detailData?.angebot?.tage || []
                        })}>
                        Bearbeiten
                      </button>
                      <button className="btn btn-danger btn-sm" style={{ width: 'auto' }}
                        onClick={() => handleDelete(selectedAngebot.id, selectedAngebot.name)}>
                        Löschen
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {loadingDetail ? <Spinner /> : detailData && (
                <>
                  {/* Stat-Grid */}
                  <div className="stat-grid">
                    {Object.entries(STATUS_CFG).map(([key, cfg]) => (
                      <div key={key} className="stat-card">
                        <div className="stat-label">{cfg.label}</div>
                        <div className={`stat-value ${key === 'vollstaendig' ? 'accent-green' : key === 'nicht_gebucht' ? 'accent-red' : key === 'teilweise' ? 'accent-orange' : ''}`}
                          style={{ fontSize: '1.5rem' }}>
                          {detailData.summary[key]}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Kind hinzufügen */}
                  <div className="card">
                    <div className="card-title">Kind hinzufügen</div>
                    <div className="search-wrap">
                      <span className="search-icon">🔍</span>
                      <input className="form-input" placeholder="Name oder Klasse suchen…"
                        value={kinderSuche} onChange={e => setKinderSuche(e.target.value)}
                        style={{ paddingLeft: '2.2rem' }} />
                      {kinderGefiltert.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                          background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)',
                          maxHeight: '220px', overflowY: 'auto'
                        }}>
                          {kinderGefiltert.map(k => (
                            <div key={k.id} className="kind-row" onMouseDown={() => handleAddKind(k)}>
                              <div className="kind-row-info">
                                <div className="kind-row-name">{k.nachname}, {k.vorname}</div>
                              </div>
                              <span className="badge badge-grey">{k.klasse || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Kindertabelle */}
                  <div className="card">
                    <div className="card-title">
                      Kinder
                      <span className="count-badge">{detailData.kinder.length}</span>
                    </div>
                    {detailData.kinder.length === 0 ? (
                      <div className="empty-state" style={{ padding: '1.5rem' }}>
                        <div className="icon">👶</div>
                        <p>Noch keine Kinder zugeordnet</p>
                      </div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Klasse</th>
                              <th style={{ textAlign: 'center' }}>Liste A</th>
                              <th style={{ textAlign: 'center' }}>Liste B (Essen)</th>
                              <th>Status / fehlende Tage</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailData.kinder.map(k => {
                              const cfg = STATUS_CFG[k.status] || { label: k.status, badgeClass: 'badge-grey' };
                              return (
                                <tr key={k.id}>
                                  <td style={{ fontWeight: 600 }}>{k.nachname}, {k.vorname}</td>
                                  <td style={{ color: 'var(--text2)' }}>{k.klasse || '—'}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    {k.tage_liste_a.length > 0
                                      ? <span className="badge badge-green" title={k.tage_liste_a.map(fmtShort).join(', ')}>{k.tage_liste_a.length} Tage</span>
                                      : <span className="badge badge-red">—</span>
                                    }
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {k.tage_liste_b.length > 0
                                      ? <span className="badge badge-green" title={k.tage_liste_b.map(fmtShort).join(', ')}>{k.tage_liste_b.length} Tage</span>
                                      : <span className="badge badge-red">—</span>
                                    }
                                  </td>
                                  <td>
                                    <span className={`badge ${cfg.badgeClass}`}>{cfg.label}</span>
                                    {k.nur_in_a.length > 0 && (
                                      <div className="days-grid" style={{ marginTop: '4px' }}>
                                        {k.nur_in_a.map(d => (
                                          <span key={d} className="day-chip missing" title="Angemeldet, kein Essen gebucht">
                                            <span className="day-icon">⚠</span>{fmtShort(d)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {k.nur_in_b.length > 0 && (
                                      <div className="days-grid" style={{ marginTop: '4px' }}>
                                        {k.nur_in_b.map(d => (
                                          <span key={d} className="day-chip extra" title="Essen gebucht, nicht angemeldet">
                                            <span className="day-icon">ℹ</span>{fmtShort(d)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                                      onClick={() => handleRemoveKind(k)}>
                                      Entfernen
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AngebotePage;
