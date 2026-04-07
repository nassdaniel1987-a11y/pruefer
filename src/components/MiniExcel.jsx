import React, { useState } from 'react';
import { toast } from '../utils/toast';

// MINI-EXCEL KOMPONENTE (Interaktive Tabelle für Copy/Paste)
const MiniExcel = ({ onImport, label }) => {
  const defaultCols = 5;
  const defaultRows = 12;
  const [data, setData] = useState(Array.from({ length: defaultRows }, () => Array(defaultCols).fill('')));

  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const rawRows = text.trim().split('\n').map(row => row.split('\t').map(c => c.trim()));

    // Excel kopiert oft tausende leere Zellen, wenn man ganze Zeilen markiert. Wir kürzen diese weg!
    let maxContentCols = defaultCols;
    const validRows = rawRows.map(row => {
      let lastFilled = row.length - 1;
      while (lastFilled >= 0 && row[lastFilled] === '') lastFilled--;
      const cleanRow = row.slice(0, Math.max(0, lastFilled + 1));
      if (cleanRow.length > maxContentCols) maxContentCols = cleanRow.length;
      return cleanRow;
    });

    let lastFilledRow = validRows.length - 1;
    while (lastFilledRow >= 0 && validRows[lastFilledRow].length === 0) lastFilledRow--;
    const finalRows = validRows.slice(0, Math.max(0, lastFilledRow + 1));

    // Begrenze auf sinnvolle Max-Größen (z.B. max 50 Spalten, falls doch was schiefgeht)
    const newRows = Math.max(data.length, finalRows.length + 2); // 2 Leerzeilen Puffer
    const newCols = Math.min(30, Math.max(data[0].length, maxContentCols + 1));

    const newData = Array.from({ length: newRows }, () => Array(newCols).fill(''));
    finalRows.forEach((r, i) => {
      r.forEach((c, j) => {
        if (i < newRows && j < newCols) newData[i][j] = c;
      });
    });
    setData(newData);
  };

  const handleChange = (r, c, val) => {
    const newData = [...data];
    newData[r] = [...newData[r]];
    newData[r][c] = val;
    setData(newData);
  };

  const submit = () => {
    // Leere Zeilen ignorieren
    const validRows = data.filter(row => row.some(cell => String(cell).trim() !== ''));
    if (validRows.length < 2) {
      toast.error('Gefühlt zu wenig Daten (Kopfzeile + Zeilen).');
      return;
    }
    // Erstelle JSON-Array für den Import, trimme whitespace
    const jsonArrays = validRows.map(r => r.map(c => String(c).trim()));
    onImport(jsonArrays);
  };

  return (
    <div style={{ minWidth: 0, border: '2px solid var(--border)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: 'var(--bg2)', padding: '0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text2)', textAlign: 'center' }}>
        Strg+V drücken, um Zellen direkt als Tabelle einzufügen
      </div>
      <div style={{ minWidth: 0, overflowX: 'auto', overflowY: 'auto', minHeight: '180px', maxHeight: '280px', width: '100%' }} onPaste={handlePaste}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 'max-content', tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              <th style={{ background: 'var(--bg2)', width: '35px', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}></th>
              {data[0].map((_, i) => (
                <th key={i} style={{ background: 'var(--bg2)', width: '100px', padding: '0.2rem', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text2)' }}>
                  {String.fromCharCode(65 + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                <td style={{ background: 'var(--bg2)', textAlign: 'center', fontSize: '0.7rem', color: 'var(--text2)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0, zIndex: 1 }}>{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: 0, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <input
                      style={{ width: '100%', height: '100%', border: 'none', outline: 'none', padding: '0.3rem 0.5rem', fontSize: '0.82rem', background: cell ? 'rgba(var(--primary-rgb),0.06)' : 'transparent', color: 'var(--text)' }}
                      value={cell}
                      onChange={e => handleChange(r, c, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '0.6rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg2)' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text2)' }}>{data.filter(r => r.some(c => String(c).trim())).length} Zeilen erkannt</span>
        <button className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={submit}>✔️ Daten übernehmen</button>
      </div>
    </div>
  );
};

export default MiniExcel;
