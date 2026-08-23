import * as SecureStore from 'expo-secure-store';

/**
 * SIP-Zugangsdaten aus dem CRM holen und sicher ablegen.
 *
 * Die App hat keinen eigenen Login — angemeldet ist nur die WebView über ihr
 * Sitzungs-Cookie. Das SIP-Passwort läuft trotzdem NICHT durch die WebView:
 *
 *   1. Die eingeloggte Seite holt einen kurzlebigen Einmal-Schein
 *      (`phone_ticket`) und reicht nur diesen an die App.
 *   2. Die App löst ihn NATIV ein (`fetch` außerhalb der WebView) und
 *      bekommt die Zugangsdaten.
 *   3. Ablage in `expo-secure-store`.
 *
 * Der Umweg kostet einen Handgriff und nimmt ein echtes Risiko: Ein Passwort
 * im WebView-Kontext wäre für jedes dort eingebettete Skript lesbar und
 * landete potenziell in Protokollen. Der Schein dagegen ist nach einmaliger
 * Verwendung wertlos.
 *
 * `keychainAccessible: AFTER_FIRST_UNLOCK` ist Absicht: Ein eingehender Anruf
 * muss die Daten auch bei gesperrtem Bildschirm lesen können (später mit
 * VoIP-Push). Der Standard `WHEN_UNLOCKED` würde das verhindern.
 */

const SCHLUESSEL = 'nexoro.sip.zugang.v1';

let zwischenspeicher = null;

/** Der Nutzer hat Nexoro Communications gewählt und Zugangsdaten sind da. */
export async function holeSipZugang()
{
  if (zwischenspeicher) return zwischenspeicher;
  try
  {
    const roh = await SecureStore.getItemAsync(SCHLUESSEL, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    if (!roh) return null;
    const daten = JSON.parse(roh);
    if (!daten?.server || !daten?.benutzer || !daten?.passwort) return null;
    zwischenspeicher = daten;
    return daten;
  } catch (err)
  {
    console.warn('[phone] Zugangsdaten nicht lesbar', err);
    return null;
  }
}

async function speichereSipZugang(daten)
{
  zwischenspeicher = daten;
  try
  {
    await SecureStore.setItemAsync(SCHLUESSEL, JSON.stringify(daten), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch (err) { console.warn('[phone] Zugangsdaten nicht speicherbar', err); }
}

export async function loescheSipZugang()
{
  zwischenspeicher = null;
  try { await SecureStore.deleteItemAsync(SCHLUESSEL); } catch (e) { /* egal */ }
}

/**
 * Löst einen Einmal-Schein ein. Wird aus der WebView-Brücke aufgerufen,
 * sobald die Seite einen Schein bereitgestellt hat.
 *
 * @param {string} basisUrl  z. B. "https://averio.nexoro.net"
 * @param {string} schein    der Einmal-Schein aus dem CRM
 */
export async function loeseScheinEin(basisUrl, schein)
{
  if (!basisUrl || !schein) return null;
  try
  {
    const antwort = await fetch(`${ basisUrl.replace(/\/+$/, '') }/telefonie/redeem.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: schein }),
    });
    if (!antwort.ok) return null;

    const daten = await antwort.json();
    if (!daten?.success || !daten.sip) return null;

    const zugang = {
      server: daten.sip.server,
      benutzer: daten.sip.username,
      passwort: daten.sip.password,
      wsUrl: daten.sip.ws_url || `wss://${ daten.sip.server }/ws`,
      // Für die Notiz: unter welcher Instanz wurde eingelöst?
      basisUrl: basisUrl.replace(/\/+$/, ''),
    };
    await speichereSipZugang(zugang);
    return zugang;
  } catch (err)
  {
    console.warn('[phone] Schein konnte nicht eingelöst werden', err);
    return null;
  }
}

/**
 * Skript für die WebView: fragt einen Schein an und reicht ihn nach nativ.
 *
 * Läuft bei jedem Seitenaufruf. Ist niemand angemeldet, antwortet das Backend
 * mit 401 und es passiert schlicht nichts — beim nächsten Aufruf erneut.
 * Steht der Telefonie-Modus auf 3CX, liefert das Backend `mode: '3cx'`, und
 * die App meldet sich gar nicht erst an.
 */
export function bauScheinSkript()
{
  return `
(function() {
  try {
    if (!window.NEXORO_NATIVE || !window.ReactNativeWebView) return;

    // Nur einmal je Seitenaufbau nachfragen: Dieses Skript laeuft bei JEDER
    // Navigation innerhalb der Instanz erneut, und jeder Aufruf erzeugt einen
    // Datenbankeintrag.
    //
    // Die Sperre haengt bewusst am window-Objekt und NICHT am sessionStorage.
    // Vorher lag sie dort - mit der Folge, dass nach einem Wechsel von "3CX"
    // auf "Nexoro" nie wieder gefragt wurde: Die Sperre war beim ersten Laden
    // (noch mit Modus 3cx) gesetzt worden und ueberlebte jede Navigation.
    // Genau das war der Grund fuer "Keine Zugangsdaten in der App".
    if (window.__nexoroSipTicketLaeuft) return;
    window.__nexoroSipTicketLaeuft = true;

    fetch('/telefonie/backend.php?action=issue_ticket', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d || !d.success) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'nexoro:sip-ticket',
        mode: d.mode || '3cx',
        ticket: d.ticket || null,
        origin: window.location.origin
      }));
    })
    .catch(function() {
      // Fehlgeschlagen: Sperre wieder loesen, damit die naechste Navigation
      // es erneut versucht. Sonst bliebe die App bis zum Neustart ohne
      // Zugangsdaten.
      window.__nexoroSipTicketLaeuft = false;
    });
  } catch (e) {}
})();
true;
`;
}

/**
 * Notiz zum laufenden Gespräch ans CRM schicken.
 *
 * Nutzt den bestehenden Endpunkt `save_call_note`: Der ordnet die Notiz über
 * Benutzer + gewählte Nummer + Zeitfenster der passenden Anrufzeile zu und
 * legt notfalls eine eigene an. Genau dafür wurde er gebaut — die Log-Zeile
 * entsteht am Telefonserver asynchron und existiert beim Notieren oft noch
 * gar nicht.
 */
export async function notizSenden({ nummer, notiz, auftragId = 0 })
{
  const zugang = await holeSipZugang();
  const basis = zugang?.basisUrl;
  if (!basis) return false;

  try
  {
    const koerper = new URLSearchParams({
      action: 'save_call_note',
      called_number: String(nummer || ''),
      notiz: String(notiz || ''),
      order_id: String(auftragId || 0),
    }).toString();

    const antwort = await fetch(`${ basis }/telefonie/backend.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: koerper + `&sip_user=${ encodeURIComponent(zugang.benutzer) }`
          + `&sip_secret=${ encodeURIComponent(zugang.passwort) }`,
    });
    if (!antwort.ok) return false;
    const daten = await antwort.json();
    return !!daten?.success;
  } catch (err)
  {
    console.warn('[phone] Notiz nicht gesendet', err);
    return false;
  }
}
