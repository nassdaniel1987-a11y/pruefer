// Tests für die signierten Entscheidungslinks aus der täglichen Mail.
//
// Diese Links wirken ohne Anmeldung. Die Signatur ist damit das Einzige, was
// zwischen "der Empfänger entscheidet" und "jeder Beliebige entscheidet" steht
// — entsprechend wird hier vor allem geprüft, was NICHT durchkommt.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let baueToken, pruefeToken, kannSignieren;

before(() => {
  process.env.SETUP_SECRET = 'test-geheimnis-fuer-die-signatur';
  ({ baueToken, pruefeToken, kannSignieren } = require('../netlify/functions/utils/zuordnungToken.js'));
});

describe('zuordnungToken — gültige Token', () => {
  test('Inhalt kommt unverändert zurück', () => {
    const t = baueToken({ nameA: 'Hans Müller', nameB: 'Hans Meier', entscheidung: 'gleich' });
    assert.deepEqual(pruefeToken(t), {
      nameA: 'hans müller', nameB: 'hans meier', entscheidung: 'gleich',
    });
  });

  test('Namen werden normalisiert — Schreibweise darf nicht zwei Einträge erzeugen', () => {
    const a = baueToken({ nameA: '  HANS MÜLLER ', nameB: 'Hans Meier', entscheidung: 'gleich' });
    const b = baueToken({ nameA: 'hans müller', nameB: 'hans meier', entscheidung: 'gleich' });
    assert.equal(a, b);
  });

  test('beide Entscheidungen funktionieren', () => {
    for (const e of ['gleich', 'verschieden']) {
      const t = baueToken({ nameA: 'A B', nameB: 'C D', entscheidung: e });
      assert.equal(pruefeToken(t).entscheidung, e);
    }
  });

  test('unterschiedliche Entscheidung ergibt unterschiedliches Token', () => {
    const g = baueToken({ nameA: 'A B', nameB: 'C D', entscheidung: 'gleich' });
    const v = baueToken({ nameA: 'A B', nameB: 'C D', entscheidung: 'verschieden' });
    assert.notEqual(g, v);
  });
});

describe('zuordnungToken — abgewiesen wird', () => {
  const gueltig = () => baueToken({ nameA: 'Hans Müller', nameB: 'Hans Meier', entscheidung: 'gleich' });

  test('verfälschter Inhalt bei behaltener Signatur', () => {
    const [, sig] = gueltig().split('.');
    const gefaelscht = Buffer.from(JSON.stringify({ a: 'wer', b: 'anders', e: 'gleich' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(pruefeToken(`${gefaelscht}.${sig}`), null);
  });

  test('verfälschte Signatur', () => {
    const [nutz, sig] = gueltig().split('.');
    const andereSig = sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A');
    assert.equal(pruefeToken(`${nutz}.${andereSig}`), null);
  });

  test('Signatur ganz weggelassen', () => {
    const [nutz] = gueltig().split('.');
    assert.equal(pruefeToken(nutz), null);
    assert.equal(pruefeToken(`${nutz}.`), null);
  });

  test('Signatur anderer Länge (darf nicht werfen)', () => {
    const [nutz] = gueltig().split('.');
    assert.equal(pruefeToken(`${nutz}.kurz`), null);
  });

  test('Unsinn und Leerwerte', () => {
    for (const t of ['', null, undefined, 'abc', 'a.b.c', '.', 'null.null']) {
      assert.equal(pruefeToken(t), null, `"${t}" darf nicht durchkommen`);
    }
  });

  test('unbekannte Entscheidung, korrekt signiert', () => {
    // Selbst mit gültiger Signatur darf nur 'gleich'/'verschieden' passieren.
    const crypto = require('crypto');
    const b64u = (b) => Buffer.from(b).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const nutz = b64u(JSON.stringify({ a: 'x', b: 'y', e: 'loeschen' }));
    const sig = b64u(crypto.createHmac('sha256', process.env.SETUP_SECRET).update(nutz).digest());
    assert.equal(pruefeToken(`${nutz}.${sig}`), null);
  });

  test('Token, das mit einem anderen Geheimnis signiert wurde', () => {
    const crypto = require('crypto');
    const b64u = (b) => Buffer.from(b).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const nutz = b64u(JSON.stringify({ a: 'x', b: 'y', e: 'gleich' }));
    const sig = b64u(crypto.createHmac('sha256', 'ein-ganz-anderes-geheimnis').update(nutz).digest());
    assert.equal(pruefeToken(`${nutz}.${sig}`), null);
  });
});

describe('zuordnungToken — ohne SETUP_SECRET', () => {
  test('es werden keine ungeschützten Links erzeugt', async () => {
    // Frisches Modul ohne Geheimnis: lieber gar keine Links in der Mail als
    // solche, die jeder selbst bauen kann.
    const alt = process.env.SETUP_SECRET;
    delete process.env.SETUP_SECRET;
    const pfad = require.resolve('../netlify/functions/utils/zuordnungToken.js');
    delete require.cache[pfad];
    const ohne = require(pfad);

    assert.equal(ohne.kannSignieren(), false);
    assert.equal(ohne.baueToken({ nameA: 'A B', nameB: 'C D', entscheidung: 'gleich' }), null);
    assert.equal(ohne.pruefeToken('irgendwas.irgendwas'), null);

    process.env.SETUP_SECRET = alt;
    delete require.cache[pfad];
  });
});
