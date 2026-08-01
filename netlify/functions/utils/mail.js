// Mailversand über Resend.
//
// Bewusst als einzige Funktion gekapselt: ein Wechsel auf eine eigene Domain
// oder auf SMTP betrifft nur diese Datei.
//
// Absender ist vorerst die Resend-Testadresse. Das spart die Verifizierung
// einer eigenen Domain, hat aber eine harte Grenze: Resend stellt damit nur an
// die Adresse zu, mit der das Resend-Konto angelegt wurde. Wird ein anderer
// Empfänger eingetragen, lehnt Resend das ab — der Fehler wird unten in
// Klartext übersetzt, damit das nicht als rätselhafter Fehlschlag endet.

const ABSENDER_STANDARD = 'Prüfer <onboarding@resend.dev>';

/**
 * @param {{an:string[], betreff:string, html:string, text:string}} opts
 * @returns {Promise<{id:string}>}
 */
const sendeMail = async ({ an, betreff, html, text }) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const err = new Error('RESEND_API_KEY ist nicht gesetzt — kein Mailversand möglich');
    err.code = 'NO_MAIL_KEY';
    throw err;
  }
  const empfaenger = (an || []).filter(Boolean);
  if (empfaenger.length === 0) {
    const err = new Error('Kein Empfänger hinterlegt');
    err.code = 'NO_RECIPIENT';
    throw err;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_ABSENDER || ABSENDER_STANDARD,
      to: empfaenger,
      subject: betreff,
      html,
      text,
    }),
  });

  const daten = await res.json().catch(() => ({}));

  if (!res.ok) {
    const roh = daten.message || daten.error || `HTTP ${res.status}`;
    // Der häufigste Fall bei der Testadresse: Empfänger ist nicht der
    // Kontoinhaber. Resends Meldung dazu ist wenig aussagekräftig.
    const istTestbeschraenkung = /own email address|testing emails|verify a domain/i.test(String(roh));
    const err = new Error(istTestbeschraenkung
      ? 'Resend nimmt derzeit nur die Adresse des Kontoinhabers an. Für weitere Empfänger wird eine eigene, bei Resend verifizierte Absenderdomain benötigt.'
      : `Mailversand fehlgeschlagen: ${roh}`);
    err.code = istTestbeschraenkung ? 'MAIL_RECIPIENT_BLOCKED' : 'MAIL_FAILED';
    throw err;
  }

  return { id: daten.id };
};

module.exports = { sendeMail };
