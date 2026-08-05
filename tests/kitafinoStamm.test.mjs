// Tests für die Verknüpfung unserer Kinder mit der kitafino-Stammliste.
//
// Der wichtigste Punkt ist nicht, was verknüpft wird, sondern was NICHT:
// eine falsche Verknüpfung wirkt dauerhaft, macht den Abgleich still falsch
// und fiele kaum auf. Deshalb wird automatisch nur verknüpft, was zweifelsfrei
// ist — alles andere geht an einen Menschen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  speichereRoster, verknuepfeEindeutige, ladeIdIndex, nameKey,
} = require('../netlify/functions/utils/kitafinoStamm.js');

// Minimaler Datenbank-Ersatz: hält kinder und kitafino_benutzer im Speicher
// und beantwortet genau die Abfragen, die das Modul stellt.
const machDb = ({ kinder = [], benutzer = [] } = {}) => {
  const db = { kinder: kinder.map(k => ({ ...k })), benutzer: benutzer.map(b => ({ ...b })) };

  db.query = async (q, p = []) => {
    const s = q.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT id, nachname, vorname, klasse, kitafino_id FROM kinder')) {
      return { rows: db.kinder };
    }
    if (s.startsWith('SELECT kitafino_id, nachname, vorname, status FROM kitafino_benutzer')) {
      return { rows: db.benutzer };
    }
    if (s.startsWith('SELECT kitafino_id FROM kitafino_benutzer')) {
      return { rows: db.benutzer.map(b => ({ kitafino_id: b.kitafino_id })) };
    }
    if (s.startsWith('SELECT nachname, vorname, kitafino_id FROM kinder WHERE kitafino_id IS NOT NULL')) {
      return { rows: db.kinder.filter(k => k.kitafino_id) };
    }
    if (s.startsWith('UPDATE kinder SET kitafino_id = $1 WHERE id = $2 AND kitafino_id IS NULL')) {
      const k = db.kinder.find(x => x.id === p[1] && !x.kitafino_id);
      if (k) { k.kitafino_id = p[0]; return { rowCount: 1 }; }
      return { rowCount: 0 };
    }
    if (s.startsWith('INSERT INTO kitafino_benutzer')) {
      for (let i = 0; i < p.length; i += 4) {
        const [id, nach, vor, status] = p.slice(i, i + 4);
        const vorhanden = db.benutzer.find(b => b.kitafino_id === id);
        if (vorhanden) Object.assign(vorhanden, { nachname: nach, vorname: vor, status });
        else db.benutzer.push({ kitafino_id: id, nachname: nach, vorname: vor, status });
      }
      return { rows: [] };
    }
    throw new Error('Unerwartete Abfrage im Test: ' + s.slice(0, 80));
  };
  return db;
};

const kind = (id, nachname, vorname, kitafino_id = null) =>
  ({ id, nachname, vorname, klasse: '3a', kitafino_id });
const ben = (kitafino_id, nachname, vorname) =>
  ({ kitafino_id, nachname, vorname, status: 'aktiv' });

describe('nameKey', () => {
  test('ist vertauschungstolerant', () => {
    assert.equal(nameKey('Müller', 'Hans'), nameKey('Hans', 'Müller'));
  });
  test('ignoriert Groß-/Kleinschreibung und Leerzeichen', () => {
    assert.equal(nameKey('  MÜLLER ', 'hans'), nameKey('müller', 'Hans'));
  });
  test('unterscheidet verschiedene Namen', () => {
    assert.notEqual(nameKey('Müller', 'Hans'), nameKey('Meier', 'Hans'));
  });
});

describe('speichereRoster', () => {
  test('legt neue Einträge an und zählt sie', async () => {
    const db = machDb();
    const r = await speichereRoster(db, [ben('1-1', 'Müller', 'Hans'), ben('1-2', 'Meier', 'Anna')]);
    assert.deepEqual(r, { gesamt: 2, neu: 2, aktualisiert: 0 });
    assert.equal(db.benutzer.length, 2);
  });

  test('ein zweiter Lauf erzeugt keine Dubletten', async () => {
    const db = machDb();
    await speichereRoster(db, [ben('1-1', 'Müller', 'Hans')]);
    const r = await speichereRoster(db, [ben('1-1', 'Müller', 'Hans')]);
    assert.deepEqual(r, { gesamt: 1, neu: 0, aktualisiert: 1 });
    assert.equal(db.benutzer.length, 1);
  });

  test('geänderte Schreibweise wird übernommen', async () => {
    const db = machDb();
    await speichereRoster(db, [ben('1-1', 'Mueller', 'Hans')]);
    await speichereRoster(db, [ben('1-1', 'Müller', 'Hans')]);
    assert.equal(db.benutzer[0].nachname, 'Müller');
  });

  test('unvollständige Zeilen werden verworfen', async () => {
    const db = machDb();
    const r = await speichereRoster(db, [
      ben('1-1', 'Müller', 'Hans'),
      { kitafino_id: '1-2', nachname: '', vorname: 'Ohne' },
      { nachname: 'Ohne', vorname: 'Id' },
      null,
    ]);
    assert.equal(r.gesamt, 1);
  });

  test('leere Liste ist kein Fehler', async () => {
    assert.deepEqual(await speichereRoster(machDb(), []), { gesamt: 0, neu: 0, aktualisiert: 0 });
  });
});

describe('verknuepfeEindeutige — verknüpft automatisch', () => {
  test('genau ein Kind, genau ein Eintrag, gleicher Name', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Müller', 'Hans')] });
    const r = await verknuepfeEindeutige(db);
    assert.equal(r.verknuepft, 1);
    assert.equal(db.kinder[0].kitafino_id, '9-1');
  });

  test('auch bei vertauschtem Vor-/Nachnamen', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Hans', 'Müller')] });
    assert.equal((await verknuepfeEindeutige(db)).verknuepft, 1);
    assert.equal(db.kinder[0].kitafino_id, '9-1');
  });
});

describe('verknuepfeEindeutige — verknüpft bewusst NICHT', () => {
  test('zwei gleichnamige Kinder bleiben unangetastet', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans'), kind(2, 'Müller', 'Hans')],
      benutzer: [ben('9-1', 'Müller', 'Hans')],
    });
    const r = await verknuepfeEindeutige(db);
    assert.equal(r.verknuepft, 0);
    assert.equal(db.kinder[0].kitafino_id, null);
    assert.equal(db.kinder[1].kitafino_id, null);
  });

  test('zwei gleichnamige kitafino-Einträge bleiben unangetastet', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans')],
      benutzer: [ben('9-1', 'Müller', 'Hans'), ben('9-2', 'Müller', 'Hans')],
    });
    const r = await verknuepfeEindeutige(db);
    assert.equal(r.verknuepft, 0);
    assert.equal(db.kinder[0].kitafino_id, null);
  });

  test('ein Kind mit bestehender ID wird nicht überschrieben', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans', 'ALT-1')],
      benutzer: [ben('9-1', 'Müller', 'Hans')],
    });
    assert.equal((await verknuepfeEindeutige(db)).verknuepft, 0);
    assert.equal(db.kinder[0].kitafino_id, 'ALT-1');
  });

  test('eine bereits vergebene ID landet nicht an einem zweiten Kind', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans', '9-1'), kind(2, 'Mueller', 'Hans')],
      benutzer: [ben('9-1', 'Müller', 'Hans')],
    });
    const r = await verknuepfeEindeutige(db);
    assert.equal(r.verknuepft, 0);
    assert.equal(db.kinder[1].kitafino_id, null);
  });

  test('nur ähnliche Namen werden nie automatisch verknüpft', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Mueller', 'Hans')] });
    const r = await verknuepfeEindeutige(db);
    assert.equal(r.verknuepft, 0, 'ähnlich ist nicht gleich');
    assert.equal(db.kinder[0].kitafino_id, null);
    assert.equal(r.vorschlaege.length, 1, 'muss aber vorgeschlagen werden');
  });
});

describe('verknuepfeEindeutige — Vorschläge', () => {
  test('ähnlicher Name kommt mit Kandidat und Punktwert', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Mueller', 'Hans')] });
    const { vorschlaege } = await verknuepfeEindeutige(db);
    assert.equal(vorschlaege.length, 1);
    assert.equal(vorschlaege[0].kind.id, 1);
    assert.equal(vorschlaege[0].kandidaten[0].kitafino_id, '9-1');
    assert.ok(vorschlaege[0].kandidaten[0].score >= 70);
    assert.equal(vorschlaege[0].action, 'suggest');
  });

  test('mehrere exakte Namensgleiche werden als mehrdeutig gekennzeichnet', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans')],
      benutzer: [ben('9-1', 'Müller', 'Hans'), ben('9-2', 'Müller', 'Hans')],
    });
    const { vorschlaege } = await verknuepfeEindeutige(db);
    assert.equal(vorschlaege.length, 1);
    assert.equal(vorschlaege[0].action, 'ambiguous');
    assert.equal(vorschlaege[0].kandidaten.length, 2);
  });

  test('völlig fremde Namen ergeben keinen Vorschlag', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Schmidt', 'Petra')] });
    const { vorschlaege, offen } = await verknuepfeEindeutige(db);
    assert.equal(vorschlaege.length, 0);
    assert.equal(offen, 1, 'das Kind bleibt trotzdem als offen gezählt');
  });

  test('nurAutomatisch überspringt die Vorschläge', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans')], benutzer: [ben('9-1', 'Mueller', 'Hans')] });
    const r = await verknuepfeEindeutige(db, { nurAutomatisch: true });
    assert.deepEqual(r.vorschlaege, []);
    assert.equal(r.offen, 1);
  });

  test('bereits verknüpfte Kinder tauchen nicht auf', async () => {
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans', '9-1')],
      benutzer: [ben('9-1', 'Müller', 'Hans')],
    });
    const { vorschlaege, offen } = await verknuepfeEindeutige(db);
    assert.equal(vorschlaege.length, 0);
    assert.equal(offen, 0);
  });
});

describe('ladeIdIndex', () => {
  test('liefert den Namensschlüssel auf die ID', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans', '9-1')] });
    const idx = await ladeIdIndex(db);
    assert.equal(idx.get(nameKey('Müller', 'Hans')), '9-1');
  });

  test('mehrfach vergebene IDs bleiben draußen', async () => {
    // Solange unklar ist, welches Kind gemeint ist, darf die ID den Abgleich
    // nicht steuern — sonst wird still das falsche Kind zugeordnet.
    const db = machDb({
      kinder: [kind(1, 'Müller', 'Hans', '9-1'), kind(2, 'Meier', 'Anna', '9-1')],
    });
    const idx = await ladeIdIndex(db);
    assert.equal(idx.size, 0);
  });

  test('Kinder ohne ID kommen nicht vor', async () => {
    const db = machDb({ kinder: [kind(1, 'Müller', 'Hans'), kind(2, 'Meier', 'Anna', '9-2')] });
    const idx = await ladeIdIndex(db);
    assert.equal(idx.size, 1);
    assert.equal(idx.get(nameKey('Meier', 'Anna')), '9-2');
  });
});
