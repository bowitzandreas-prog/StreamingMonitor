// ==UserScript==
// @name         Stream-Board: Whatnot-Brücke
// @namespace    https://collectntrade.de/
// @version      0.7.0
// @description  Liest Chat, Zuschauer, Auktion, Verkäufe und Giveaways aus deiner eigenen Whatnot-Show und schickt sie an das lokale Stream-Board.
// @match        https://www.whatnot.com/*
// @match        file:///*collectntrade-board*
// @match        file:///*stream-board*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Zwei Rollen in einem Script:
 *  - Auf whatnot.com (Live-Seite): liest die Seite mit und legt Ereignisse in den Tampermonkey-Speicher.
 *  - In der lokalen Board-Datei: hört auf den Speicher und reicht die Ereignisse per postMessage ans Board weiter.
 * Gesendet wird nur aus Shows deines eigenen Accounts. Den Whatnot-Namen trägst du im Board unter
 * Einstellungen → Einrichtung ein; das Board gibt ihn an dieses Script weiter (Ersatz: Tampermonkey-Menü)
 * und immer nur aus einem Tab. Fremde Shows lassen sich zum Testen einzeln freigeben.
 * Stand der Whatnot-Selektoren: deutsche Oberfläche (de-DE), Zuschauer-Ansicht und Seller-Dashboard, Tests vom 19./20.10.2026.
 * Käufer kommen im Dashboard aus Aktivität-Tab, Verkauft-Liste, Kauf-Banner und Einblendungen; ein zweites
 * Dashboard-Fenster derselben Show liefert seine Käufer an das sendende Fenster.
 */
(() => {
  'use strict';
  const BUS = 'ct_bus';

  // ---------- Rolle 1: Board-Seite ----------
  if (location.protocol === 'file:') {
    const current = GM_getValue(BUS, null);
    let lastId = current && Array.isArray(current.events) && current.events.length
      ? current.events[current.events.length - 1]._id : 0;
    GM_addValueChangeListener(BUS, (_key, _old, val) => {
      const list = (val && Array.isArray(val.events)) ? val.events : [];
      for (const evt of list) {
        if (!evt || !(evt._id > lastId)) continue;
        lastId = evt._id;
        window.postMessage(evt, '*');
      }
    });
    // Einstellungen aus dem Board übernehmen (Whatnot-Name)
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.type !== 'ctcfg') return;
      if (typeof e.data.whatnotUser === 'string') GM_setValue('ct_host', e.data.whatnotUser.trim().replace(/^@/, '').toLowerCase());
    });
    window.postMessage({ type: 'ctbridge-hello', version: '0.7.0', whatnotUser: GM_getValue('ct_host', '') }, '*');
    console.log('[Stream-Board] Board-Brücke aktiv, warte auf Whatnot.');
    return;
  }

  // ---------- Rolle 2: Whatnot-Seite ----------
  // Statusanzeige kommt als Erstes, damit man auch einen Startfehler sieht
  const pillHost = document.createElement('ct-board-status');
  pillHost.setAttribute('style', 'all:initial;position:fixed;left:10px;bottom:10px;z-index:2147483647;display:block;pointer-events:none');
  const pill = document.createElement('div');
  (pillHost.attachShadow ? pillHost.attachShadow({ mode: 'open' }) : pillHost).append(pill);
  pill.setAttribute('style', 'padding:5px 10px;border-radius:999px;background:#0e1b4d;color:#9aeae3;font:700 11px/1.2 system-ui,sans-serif;opacity:.92');
  pill.textContent = 'CT-Board 0.7.0 startet …';
  const attachPill = () => { if (!pillHost.isConnected) document.documentElement.append(pillHost); };
  attachPill();
  console.log('[Stream-Board] Brücke 0.7.0 geladen auf', location.href);
  try {
    reader();
  } catch (err) {
    pill.style.background = '#5a0b1e';
    pill.style.color = '#ffd1dc';
    pill.textContent = `CT-Board 0.7.0 Fehler beim Start: ${err && err.message ? err.message : err}`;
    console.error('[Stream-Board] Fehler beim Start:', err);
  }

  function reader() {
  const T = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  const money = (s) => {
    const m = String(s).replace(/ /g, ' ').match(/([\d.]+(?:,\d{1,2})?)\s*€/);
    return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
  };
  const TAB = Math.random().toString(36).slice(2);

  // Ereignisse landen in einem Ringpuffer; das Board verarbeitet alles mit höherer _id.
  // Date.now() als Startwert hält die IDs auch nach einem Neuladen steigend.
  let nextId = Date.now();
  const ring = [];
  let dirty = false;
  const sent = { chat: 0, sold: 0, giveaway: 0 };
  function emit(evt) {
    if (evt.type === 'ct-sold' || evt.type === 'ct-show' || (evt.type === 'ct-giveaway' && evt.winner)) {
      diagLog(evt.type, { user: evt.user || evt.winner || evt.host || '', title: evt.title || '', price: evt.price ?? null });
    }
    ring.push({ ...evt, _id: ++nextId });
    if (ring.length > 80) ring.splice(0, ring.length - 80);
    dirty = true;
  }
  function flush() {
    if (!dirty) return;
    dirty = false;
    GM_setValue(BUS, { events: ring.slice() });
  }
  setInterval(flush, 250);

  // ---- Diagnose: merkt sich, was die Brücke nicht versteht (Grundlage für Anpassungen) ----
  const VERSION = '0.7.0';
  const diag = { start: new Date().toISOString(), events: [], unknown: [], snaps: [], pages: [] };
  const diagSeen = new Set();
  let lastSnapAt = 0;
  let lastPageAt = 0;
  let lastChatSeenAt = Date.now();
  let lastPlayerSeenAt = Date.now();
  let dashBaselineDone = false;
  const cleanHtml = (html) => html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/\s(d|points|transform)="[^"]{40,}"/gi, '')
    .replace(/\s(src|srcset|href|style)="data:[^"]{40,}"/gi, ' $1="data:…"')
    .replace(/\s{2,}/g, ' ');
  function diagLog(type, info) {
    diag.events.push({ t: Date.now(), type, ...info });
    if (diag.events.length > 600) diag.events.splice(0, diag.events.length - 600);
  }
  function diagUnknown(where, text, extra) {
    const key = where + ':' + text.replace(/\d+/g, '#');
    if (diagSeen.has(key)) return;
    diagSeen.add(key);
    if (diag.unknown.length < 800) diag.unknown.push({ t: Date.now(), where, text: text.slice(0, 200), ...extra });
  }
  // Ganze Seite im Moment einer Bestellung oder eines Verkaufs: zeigt, wo Whatnot Käufer und Preis anzeigt
  let lastEvtSnapAt = 0;
  function diagSnap(why) {
    const now = Date.now();
    if (now - lastEvtSnapAt < 2000 || diag.snaps.length >= 60) return;
    lastEvtSnapAt = now;
    diag.snaps.push({ t: now, why, html: cleanHtml(document.body.outerHTML).slice(0, 300000) });
  }
  // Texte im Player, die die Brücke kennt; alles andere landet in der Diagnose
  const KNOWN = [/^[\d.]+(,\d{1,2})?\s*€$/, /^\d+\s+Gebot/, /^\d{1,2}:\d{2}$/, /erhält den Zuschlag/, /hat gewonnen/,
    /^Zuschlag!?$/, /hat die Auktion gewonnen/, /^Verkauft$/, /^Giveaway$/, /^Teilnehmer$/, /Gewinner wird gewählt/, /hat das Giveaway gewonnen/, /^Giveaway-Gewinner/,
    /^Warte auf den nächsten Artikel$/, /Versandkosten/, /^Gebot:/, /^Definiert$/, /^[\d.]+$/, /^\d,\d$/, /^Giveaway mit [\d.]+ Teilnehm/];
  function diagScan(p) {
    const now = Date.now();
    if (p) {
      lastPlayerSeenAt = now;
      const host = hostName();
      const productBox = p.querySelector('[data-testid="show-product-title"]')?.closest('section');
      let fresh = false;
      for (const s of p.querySelectorAll('strong')) {
        if (s.parentElement?.closest('strong')) continue; // verschachtelte Texte zählen als ein Satz
        if (s.closest('[data-testid="chat-message"]')) continue; // Chat-Einblendungen im Player
        const txt = T(s);
        if (!txt || txt.length > 160 || txt.toLowerCase() === host) continue;
        if (productBox && productBox !== p && productBox.contains(s)) continue; // Titel und Beschreibung des Artikels
        if (KNOWN.some((re) => re.test(txt))) continue;
        const key = txt.replace(/\d+/g, '#');
        if (diagSeen.has(key)) continue;
        diagSeen.add(key);
        if (diag.unknown.length < 800) {
          diag.unknown.push({ t: now, where: 'player', text: txt, testid: s.closest('[data-testid]')?.getAttribute('data-testid') || '' });
          fresh = true;
        }
      }
      if (fresh && now - lastSnapAt > 10000 && diag.snaps.length < 25) {
        lastSnapAt = now;
        diag.snaps.push({ t: now, html: cleanHtml(p.outerHTML).slice(0, 80000) });
      }
    }
    // Einträge in der Chat-Liste, die keine normale Nachricht sind (z. B. Kauf- oder Systemmeldungen)
    for (const it of chatItems()) {
      lastChatSeenAt = now;
      if (it.querySelector('[data-testid="chat-message"]')) continue;
      const sm = it.querySelector('[data-testid="seller-live-chat-message"]');
      if (sm) continue; // normale Nachricht oder Beitritt im Dashboard
      const txt = T(it).slice(0, 200);
      const key = 'chat:' + txt.replace(/\d+/g, '#');
      if (!txt || diagSeen.has(key)) continue;
      diagSeen.add(key);
      if (diag.unknown.length < 800) diag.unknown.push({ t: now, where: 'chat', text: txt, html: cleanHtml(it.outerHTML).slice(0, 6000) });
    }
    // Seller-Dashboard: alles, was nach dem Öffnen neu auftaucht (Auktion, Gebote, Gewinner, Giveaway), mitschreiben
    if (isDashboard()) {
      lastPlayerSeenAt = now;
      const root = document.body;
      // Chat, Shop, Kennzahlen und Auswahllisten (z. B. 250 Länder beim Versand) sind kein Show-Geschehen
      const skip = '[data-testid="seller-live-chat"], [data-testid="seller-live-shop-listing"], [data-testid="seller-live-metrics"], ' +
        '[data-testid="seller-live-activity"], [data-testid="header-v1"], [data-testid="footer-v1"], ct-board-status, ' +
        '[role="listbox"], [role="option"], [role="menu"], [role="combobox"], select, datalist';
      let fresh = false;
      let added = 0;
      for (const s of root.querySelectorAll('strong, button, [role="status"], [role="alert"]')) {
        if (s.parentElement?.closest('strong') || s.closest(skip)) continue;
        if (s.tagName === 'BUTTON' && s.querySelector('strong')) continue;
        const txt = T(s);
        if (!txt || txt.length > 160) continue;
        const key = 'dash:' + txt.replace(/\d+/g, '#');
        if (diagSeen.has(key)) continue;
        diagSeen.add(key);
        if (!dashBaselineDone) continue; // alles, was beim Öffnen schon da war, ist Grundlinie
        if (++added > 25) continue; // ein ganzer Dialog auf einmal: der Anfang reicht
        if (diag.unknown.length < 800) {
          diag.unknown.push({ t: now, where: 'dashboard', text: txt, testid: s.closest('[data-testid]')?.getAttribute('data-testid') || '' });
          fresh = true;
        }
      }
      dashBaselineDone = true;
      if (added > 25) diag.unknown.push({ t: now, where: 'dashboard', text: `… ${added - 25} weitere Texte auf einmal` });
      logView();
      if (fresh && now - lastSnapAt > 8000 && diag.snaps.length < 40) {
        lastSnapAt = now;
        diag.snaps.push({ t: now, html: cleanHtml(root.outerHTML).slice(0, 200000) });
      }
    }
    // Seite sieht anders aus als erwartet: ab und zu die ganze Seite sichern
    const noPlayer = now - lastPlayerSeenAt > 30000;
    const noChat = now - lastChatSeenAt > 60000;
    if ((noPlayer || noChat) && now - lastPageAt > 120000 && diag.pages.length < 5) {
      lastPageAt = now;
      diag.pages.push({ t: now, why: noPlayer ? 'kein Player gefunden' : 'keine Chat-Liste gefunden', url: location.href,
        html: cleanHtml(document.body.outerHTML).slice(0, 1500000) });
    }
  }
  // Welche Tabs im Dashboard offen sind (Chat/Aktivität rechts, Shop-Liste links)
  let lastView = '';
  function logView() {
    const sel = (p) => document.querySelector(`[data-wn-action^="${p}"][aria-selected="true"]`)?.getAttribute('data-wn-action').slice(p.length) || '-';
    const v = `rechts=${sel('seller_live.right_panel.tab.')} links=${sel('seller_live.shop.tab.')} chat=${chatVisible() ? 'sichtbar' : 'zu'}`;
    if (v !== lastView) { lastView = v; diagLog('ansicht', { view: v }); }
  }
  function saveDiag() {
    if (isLive()) diag.pages.push({ t: Date.now(), why: 'beim Speichern', url: location.href, html: cleanHtml(document.body.outerHTML).slice(0, 1500000) });
    const data = { meta: { tool: 'stream-board-diagnose', version: VERSION, saved: new Date().toISOString(), url: location.href, myHost, state, owner: isOwner, userAgent: navigator.userAgent },
      sent, sales: sales.map((s) => ({ ...s, src: [...s.src] })), ...diag };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `whatnot-diagnose-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- Einstellungen im Tampermonkey-Menü ----
  let mute = GM_getValue('ct_mute', true);
  let myHost = GM_getValue('ct_host', '');
  let testShow = ''; // fremde Show, die bis zum Neuladen trotzdem senden darf
  GM_addValueChangeListener('ct_host', (_k, _o, v) => { myHost = v || ''; scan(); });
  GM_registerMenuCommand('Eigenen Whatnot-Namen festlegen', () => {
    const v = prompt('Dein Whatnot-Benutzername. Nur Shows dieses Accounts werden ans Board geschickt.', myHost || '');
    if (v == null) return;
    myHost = v.trim().replace(/^@/, '').toLowerCase();
    GM_setValue('ct_host', myHost);
    scan();
  });
  GM_registerMenuCommand('Diese Show trotzdem verbinden (Test)', () => {
    testShow = showId();
    scan();
  });
  GM_registerMenuCommand('Diagnose speichern (nach dem Stream)', () => saveDiag());
  GM_registerMenuCommand('Ton der Show stumm: an/aus', () => {
    mute = !mute;
    GM_setValue('ct_mute', mute);
    if (!mute) document.querySelectorAll('video').forEach((v) => { v.muted = false; });
    updatePill();
  });

  const isLive = () => /\/live\//.test(location.pathname);
  // Seller-Dashboard (wenn du selbst vom PC streamst): gehört immer dir
  const isDashboard = () => /\/dashboard\/live\//.test(location.pathname);
  const chatRoot = () => document.querySelector('[data-testid="seller-live-chat"], [data-testid="desktop-chat-panel"]');
  const chatVisible = () => { const c = chatRoot(); return !!c && !c.closest('.hidden'); };
  const chatItems = () => (chatRoot() || document).querySelectorAll('[data-testid="virtuoso-item-list"] > div[data-index]');
  const showId = () => (location.pathname.match(/\/live\/([^/?#]+)/) || [])[1] || '';
  const player = () => document.querySelector('section[data-testid="live-player"]');
  function hostName() {
    if (isDashboard()) return myHost;
    const href = player()?.querySelector('header a[href*="/user/"]')?.getAttribute('href') || '';
    const m = href.match(/\/user\/([^/?#]+)/);
    try { return m ? decodeURIComponent(m[1]).toLowerCase() : ''; } catch { return m ? m[1].toLowerCase() : ''; }
  }

  // Nur ein Tab darf senden: wer zuletzt ein Lebenszeichen geschrieben hat, behält das Recht.
  // Zwei Dashboard-Fenster derselben Show: das mit sichtbarem Chat übernimmt, das andere liefert Käufer zu.
  let lastClaim = 0;
  let lastClaimVis = null;
  function ownsBus() {
    const o = GM_getValue('ct_owner', null);
    const now = Date.now();
    const vis = chatVisible();
    const other = o && o.tab !== TAB && now - o.ts < 6000;
    const takeover = other && vis && o.chat === false && o.show === showId();
    if (other && !takeover) return false;
    if (now - lastClaim > 2000 || takeover || vis !== lastClaimVis) {
      lastClaim = now;
      lastClaimVis = vis;
      GM_setValue('ct_owner', { tab: TAB, ts: now, show: showId(), chat: vis });
    }
    return true;
  }
  function releaseBus() {
    const o = GM_getValue('ct_owner', null);
    if (o && o.tab === TAB) GM_setValue('ct_owner', { tab: TAB, ts: 0, show: '' });
    lastClaim = 0;
  }
  window.addEventListener('pagehide', releaseBus);

  // Verbindungszustand für Statusanzeige und Sendefreigabe
  let state = { ok: false, why: '' };
  function checkState() {
    if (!isLive()) return { ok: false, why: 'wartet auf eine Live-Show' };
    if (isDashboard()) return { ok: true, why: `Seller-Dashboard${myHost ? ' @' + myHost : ''}` };
    const host = hostName();
    if (testShow && testShow === showId()) return { ok: true, why: `Test-Freigabe @${host || '?'}` };
    if (!myHost) return { ok: false, why: 'Whatnot-Namen im Board unter Einstellungen → Einrichtung eintragen' };
    if (!host) return { ok: false, why: 'Show-Host nicht erkannt' };
    if (host !== myHost) return { ok: false, why: `fremde Show (@${host}), nicht verbunden` };
    return { ok: true, why: `@${host}` };
  }

  // ---- Chat ----
  const seenChat = new Set();
  const seenOrder = [];
  // Liest Name, Text und Verkäufer-Kennzeichen aus einem Chat-Eintrag (Zuschauer-Ansicht oder Dashboard)
  function parseChatItem(it) {
    const viewerMsg = it.querySelector('[data-testid="chat-message"]');
    if (viewerMsg) {
      const href = viewerMsg.querySelector('[data-testid="chat-message-avatar-link"]')?.getAttribute('href') || '';
      const m = href.match(/\/user\/([^/?#]+)/);
      let user = '';
      try { user = m ? decodeURIComponent(m[1]) : ''; } catch { user = m ? m[1] : ''; }
      if (!user) user = T(viewerMsg.querySelector('button strong'));
      const texts = viewerMsg.querySelectorAll('button > strong');
      return { user, text: T(texts[texts.length - 1]), seller: false };
    }
    const dashMsg = it.querySelector('[data-testid="seller-live-chat-message"]');
    if (dashMsg) {
      const label = dashMsg.querySelector('button[aria-label*="@"]')?.getAttribute('aria-label') || '';
      const user = (label.match(/@([^\s]+)\s*$/) || [])[1] || T(dashMsg.querySelector('button strong'));
      const texts = [...dashMsg.querySelectorAll('strong')].filter((x) => !x.closest('button') && !x.closest('.inline-flex'));
      const seller = [...dashMsg.querySelectorAll('.inline-flex strong')].some((x) => /^(Verkäufer|Seller)$/i.test(T(x)));
      return { user, text: T(texts[texts.length - 1]), seller };
    }
    return null;
  }
  function scanChat() {
    for (const it of chatItems()) {
      const parsed = parseChatItem(it);
      if (!parsed) continue;
      const { user, text, seller } = parsed;
      if (!user || !text) continue;
      if (/^ist beigetreten/.test(text) || /^(joined|has joined)/i.test(text)) continue; // Beitritte sind keine Nachrichten
      const key = showId() + '|' + it.getAttribute('data-index') + '|' + user + '|' + text;
      if (seenChat.has(key)) continue;
      seenChat.add(key);
      seenOrder.push(key);
      if (seenOrder.length > 3000) seenChat.delete(seenOrder.shift());
      emit({ type: 'ct-chat', user, text, seller, id: 'wn:' + key });
      sent.chat++;
    }
  }
  // Wenn jemand im Chat hochscrollt, rendert Whatnot keine neuen Nachrichten mehr. Also wieder runter.
  function keepChatAtBottom() {
    for (const b of (chatRoot() || document).querySelectorAll('button')) {
      if (/^(Nach unten scrollen|Scroll to bottom)$/i.test(T(b))) { b.click(); break; }
    }
  }

  // ---- Zuschauer ----
  let lastViewers = null;
  function scanViewers() {
    const el = document.querySelector('[data-testid="seller-live-viewer-chip"] .tabular-nums') ||
      player()?.querySelector('header button strong.tabular-nums');
    const n = el ? Number(T(el).replace(/\./g, '')) : NaN;
    if (Number.isFinite(n) && n !== lastViewers) {
      lastViewers = n;
      emit({ type: 'ct-viewers', count: n });
    }
  }

  // ---- Dashboard: Laufzeit und Bestellungen ----
  let lastUptimeSent = 0;
  let lastOrders = null;
  // ---- Dashboard: laufender Artikel (Einblendung unten im Videobild) und Giveaway-Karte ----
  const dash = { title: '', sig: '', cycle: false, leader: '', bid: null, endedAt: 0, gwSig: '', gwTitle: '', gwWinner: '', gwWinAt: 0 };
  function resetDash() {
    Object.assign(dash, { title: '', sig: '', cycle: false, leader: '', bid: null, endedAt: 0, gwSig: '', gwTitle: '', gwWinner: '', gwWinAt: 0 });
  }
  const isPrice = (txt) => /^[\d.]+(,\d{1,2})?\s*€$/.test(txt);

  // ---- Verkäufe im Dashboard: mehrere Quellen, ein Ergebnis ----
  // Aktivität-Tab, Verkauft-Liste, Kauf-Banner, Einblendungen und ein zweites Fenster melden, was sie sehen.
  // Gleicher Käufer und gleicher Artikel innerhalb von 10 Minuten sind ein Verkauf, solange nicht dieselbe
  // Quelle ihn ein zweites Mal meldet (dann ist es ein zweiter echter Kauf). Gesendet wird nach kurzer
  // Wartezeit, damit Preis und Menge aus den anderen Quellen noch dazukommen.
  const SALE_WAIT = 1500;
  let sales = [];
  let pendingOrders = [];
  const priceByTitle = new Map(); // Artikel → zuletzt gesehener Preis (Einblendung, Shop-Liste)
  const nName = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
  const nTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function sameSale(x, o, now) {
    if (now - x.t > 600000 || nName(x.user) !== nName(o.user)) return false;
    const k = o.kind || '';
    if ((x.kind === 'giveaway') !== (k === 'giveaway')) return false;
    if (x.kind && k && x.kind !== k) return false;
    const t = nTitle(o.title);
    if (!t || !x.titleN || x.titleN === t || x.titleN.includes(t) || t.includes(x.titleN)) return true;
    return k === 'giveaway' && now - x.t < 90000; // Giveaway-Namen schreibt Whatnot nicht überall gleich
  }
  let sink = reportSale;
  function reportSale(o) {
    const user = String(o.user || '').trim().replace(/^@/, '');
    if (!user) return null;
    const now = Date.now();
    let s = sales.find((x) => !x.src.has(o.src) && sameSale(x, o, now));
    if (s) { s.src.add(o.src); mergeSale(s, o); return s; }
    s = { t: now, user, kind: o.kind || '', title: o.title || '', titleN: nTitle(o.title), price: o.price ?? null,
      qty: o.qty || 0, src: new Set([o.src]), sent: false, order: false };
    sales.push(s);
    if (sales.length > 300) sales.splice(0, sales.length - 300);
    diagLog('quelle', { src: o.src, kind: s.kind, user, title: s.title, price: s.price });
    diagSnap('verkauf ' + o.src);
    setTimeout(schedule, SALE_WAIT + 50);
    return s;
  }
  function mergeSale(s, o) {
    if (!s.kind && o.kind) s.kind = o.kind;
    if (!s.title && o.title) { s.title = o.title; s.titleN = nTitle(o.title); }
    if (s.price == null && o.price != null) s.price = o.price;
    if (!s.qty && o.qty) s.qty = o.qty;
  }
  // Nur ergänzen (z. B. Preis aus der Verkauft-Liste), nie einen neuen Verkauf anlegen
  function enrichSale(o) {
    const now = Date.now();
    const s = sales.find((x) => !x.sent && sameSale(x, o, now));
    if (s) mergeSale(s, o);
  }
  function sweepSales() {
    const now = Date.now();
    for (const s of sales) {
      if (s.sent || now - s.t < SALE_WAIT) continue;
      s.sent = true;
      if (s.kind === 'giveaway') {
        dash.gwWinAt = now;
        emit({ type: 'ct-giveaway', winner: s.user, title: s.title || dash.gwTitle || undefined, names: [] });
        sent.giveaway++;
      } else {
        if (s.price == null) s.price = priceByTitle.get(s.titleN) ?? null;
        emit({ type: 'ct-sold', user: s.user, price: s.price, title: s.title, kind: s.kind || undefined, qty: s.qty > 1 ? s.qty : undefined });
        sent.sold++;
      }
    }
  }
  // Jede neue Bestellung sucht sich einen gemeldeten Verkauf (auch Giveaways zählen als Bestellung).
  // Findet sich nach 8 s keiner, war es der letzte Höchstbietende einer gerade beendeten Auktion, falls bekannt.
  function onNewOrder(n) {
    if (!isDashboard()) return;
    for (let i = 0; i < n; i++) {
      pendingOrders.push({ t: Date.now(), title: dash.title, leader: dash.leader, bid: dash.bid, cycle: dash.cycle, endedAt: dash.endedAt, snap: false });
    }
    diagSnap('bestellung');
  }
  function sweepOrders() {
    const now = Date.now();
    pendingOrders = pendingOrders.filter((o) => {
      const s = sales.find((x) => !x.order && Math.abs(x.t - o.t) < 30000);
      if (s) { s.order = true; return false; }
      if (!o.snap && now - o.t > 3000) { o.snap = true; diagSnap('bestellung +3s'); }
      if (now - o.t < 8000) return true;
      if (o.cycle && o.leader && o.endedAt && o.t - o.endedAt < 20000) {
        dash.cycle = false;
        const s2 = reportSale({ kind: 'auktion', user: o.leader, title: o.title, price: o.bid, src: 'bestellung' });
        if (s2) s2.order = true;
      } else {
        diagLog('bestellung-ohne-käufer', { title: o.title, leader: o.leader, cycle: o.cycle });
      }
      return false;
    });
  }

  // Aktivität-Tab rechts: „max_muster hat im Laden eingekauft•jetzt“, „… hat die Auktion gewonnen•vor 3 m“,
  // „… hat das Giveaway gewonnen“, darunter der Artikel. Whatnot rendert die Liste nur bei offenem Tab.
  const ACT = [
    [/^(.+?) hat im Laden eingekauft$/, 'kauf'],
    [/^(.+?) hat die Auktion gewonnen$/, 'auktion'],
    [/^(.+?) hat das Giveaway gewonnen$/, 'giveaway'],
    [/^(.+?) (?:bought|purchased) (?:from|in) the shop$/i, 'kauf'],
    [/^(.+?) won the auction$/i, 'auktion'],
    [/^(.+?) won the giveaway$/i, 'giveaway'],
  ];
  // „jetzt“ = gerade passiert. Ohne Zeitangabe: unbekannt.
  const isFresh = (when) => (!when ? null : /^(jetzt|gerade|now|just)/i.test(when) || /\b\d+\s*(s|sek\.?|sec)\b/i.test(when));
  const actMax = new Map();
  let actOpen = false;
  function scanActivity(first) {
    const list = document.querySelector('[data-testid="seller-live-activity-list"]');
    if (!list) { actOpen = false; return; }
    const rows = [];
    for (const row of list.querySelectorAll('[data-testid^="seller-live-activity-row-"]')) {
      const st = row.querySelectorAll('strong');
      if (!st.length) continue;
      const head = (st[0].getAttribute('title') || T(st[0])).replace(/\s+/g, ' ').trim();
      const [what, when = ''] = head.split(/\s*•\s*/);
      const item = st[1] ? (st[1].getAttribute('title') || T(st[1])).replace(/\s+/g, ' ').trim() : '';
      let hit = null;
      for (const [re, kind] of ACT) {
        const m = what.match(re);
        if (m) { hit = { user: m[1].trim(), kind }; break; }
      }
      if (hit) rows.push({ ...hit, item, when });
      else diagUnknown('aktivität', head);
    }
    // Älteste zuerst zählen: ein zweiter gleicher Kauf ist dann der neue Eintrag oben
    const counts = new Map();
    const appeared = !actOpen;
    actOpen = true;
    for (const r of rows.reverse()) {
      const key = r.kind + '|' + nName(r.user) + '|' + nTitle(r.item);
      const c = (counts.get(key) || 0) + 1;
      counts.set(key, c);
      if (c <= (actMax.get(key) || 0)) continue;
      actMax.set(key, c);
      if (first) continue;
      const fresh = isFresh(r.when);
      // Tab gerade geöffnet oder Filter gewechselt: nur, was „jetzt“ passiert ist
      if (appeared ? fresh !== true : fresh === false) continue;
      sink({ kind: r.kind, user: r.user, title: r.item, src: 'aktivität' });
    }
  }

  // Shop links, Tab „Verkauft“: Karte mit „Käufer: max_muster“ oder „Gewinner: max_muster“ und „Verkauft für 2 €“.
  // Neue Verkäufe stehen oben (data-index 0); weiter unten Gescrolltes ist alt und wird nur zum Ergänzen genutzt.
  const soldMax = new Map();
  let soldOpen = false;
  function readListing(card) {
    const strongs = [...card.querySelectorAll('strong')];
    const title = T(strongs[0]);
    const who = strongs.find((s) => /^(Käufer|Gewinner|Buyer|Winner):/i.test(T(s)));
    const priceEl = strongs.find((s) => /^(Verkauft für|Sold for)\b/i.test(T(s)));
    if (!who) {
      // offener Artikel: Preis für spätere Käufe merken
      const p = strongs.map((s) => T(s)).find(isPrice);
      if (title && p) priceByTitle.set(nTitle(title), money(p));
      return null;
    }
    const user = T(who.querySelector('button strong') || who).replace(/^(Käufer|Gewinner|Buyer|Winner):\s*/i, '');
    const qty = Number((strongs.map((s) => T(s)).find((x) => /^(Menge|Quantity):\s*\d+/i.test(x)) || '').replace(/\D+/g, '')) || 0;
    const idx = Number(card.closest('[data-index]')?.getAttribute('data-index'));
    return { user, title, kind: /^(Gewinner|Winner)/i.test(T(who)) ? 'giveaway' : '', price: priceEl ? money(T(priceEl)) : null,
      qty, top: !Number.isFinite(idx) || idx < 3 };
  }
  function scanSoldList(first) {
    const cards = [...document.querySelectorAll('[data-testid="seller-live-shop-listing"]')].map(readListing).filter(Boolean);
    if (!cards.length) { soldOpen = false; return; }
    const appeared = !soldOpen;
    soldOpen = true;
    const counts = new Map();
    for (const c of cards.reverse()) {
      if (c.price != null && c.kind !== 'giveaway') priceByTitle.set(nTitle(c.title), c.price);
      enrichSale(c);
      const key = c.kind + '|' + nName(c.user) + '|' + nTitle(c.title);
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      if (n <= (soldMax.get(key) || 0)) continue;
      soldMax.set(key, n);
      if (first || appeared || !c.top) continue;
      sink({ kind: c.kind, user: c.user, title: c.title, price: c.price, qty: c.qty, src: 'verkauft-liste' });
    }
  }

  // Banner oben: „max_muster hat gerade 1 #104 Dark Thoughts … gekauft!“. Es bleibt nach dem Ausblenden im DOM
  // (dann mit -translate-y-full), deshalb zählt nur ein neuer Text oder erneutes Einblenden.
  let toastSig = '';
  function scanToast(first) {
    let sig = '';
    for (const box of document.querySelectorAll('[class*="z-[9999]"]')) {
      const leaf = [...box.querySelectorAll('div')].find((d) => d.children.length === 0 && /\S/.test(d.textContent || ''));
      const text = T(leaf);
      if (!text) continue;
      const shown = !/-translate-y-full/.test(box.className);
      sig = text + '|' + shown;
      if (sig === toastSig) return;
      toastSig = sig;
      if (first || !shown) return;
      const m = text.match(/^(.+?) hat gerade (\d+)\s*x?\s+(.+?) gekauft!?$/) || text.match(/^(.+?) just bought (\d+)\s*x?\s+(.+?)!?$/i);
      if (m) sink({ kind: '', user: m[1], title: m[3], qty: Number(m[2]), src: 'banner' });
      else diagUnknown('banner', text);
      return;
    }
    toastSig = sig;
  }

  // ---- Zweites Dashboard-Fenster: schickt seine Käufer über den Tampermonkey-Speicher ans sendende Fenster ----
  let isOwner = false;
  const side = [];
  function sideReport(o) {
    side.push({ ...o, id: ++nextId, t: Date.now() });
    if (side.length > 40) side.splice(0, side.length - 40);
    GM_setValue('ct_side', { tab: TAB, show: showId(), items: side.slice() });
  }
  const sideSeen = {};
  GM_addValueChangeListener('ct_side', (_k, _o, v) => {
    if (!isOwner || !v || v.tab === TAB || v.show !== showId() || !Array.isArray(v.items)) return;
    for (const it of v.items) {
      if (!(it.id > (sideSeen[v.tab] || 0))) continue;
      sideSeen[v.tab] = it.id;
      if (Date.now() - it.t > 20000) continue; // alte Einträge eines gerade erst gesehenen Fensters
      reportSale({ kind: it.kind, user: it.user, title: it.title, price: it.price, qty: it.qty, src: 'fenster2:' + it.src });
    }
    schedule();
  });
  function resetSaleSources() {
    sales = [];
    pendingOrders = [];
    priceByTitle.clear();
    actMax.clear();
    soldMax.clear();
    actOpen = false;
    soldOpen = false;
    toastSig = '';
  }
  function scanDashboardShow(first) {
    const ov = document.querySelector('[class*="z-seller-live-stream-controls"]');
    if (!ov) return;
    const strongs = [...ov.querySelectorAll('strong')].filter((x) => !x.closest('button') && !x.getAttribute('data-testid'));
    const titleEl = strongs.find((x) => /text-title2/.test(x.className)) || strongs.find((x) => !/Zuschlag|gewonnen/.test(T(x)));
    const title = T(titleEl);
    if (!title) return;
    const priceEl = [...ov.querySelectorAll('div, strong, span')].find((x) => x.children.length === 0 && isPrice(T(x)));
    const bid = priceEl ? money(T(priceEl)) : null;
    const tm = T(ov.querySelector('[data-testid="show-timer"]')).match(/^(\d+):(\d{2})$/);
    const secondsLeft = tm ? Number(tm[1]) * 60 + Number(tm[2]) : null;
    const status = T(document.querySelector('[data-testid="show-winning-status"]'));
    const lead = status.match(/^(.+?)\s+(erhält den Zuschlag|hat gewonnen)/);
    const soldNow = !!(lead && lead[2] === 'hat gewonnen');

    if (bid != null) priceByTitle.set(nTitle(title), bid);
    if (title !== dash.title) {
      if (dash.title) diagLog('artikel', { title, bid, secondsLeft });
      dash.title = title;
      dash.leader = '';
      dash.cycle = !first && !soldNow && secondsLeft != null;
    }
    if (!soldNow && secondsLeft != null && secondsLeft > 0 && !first) dash.cycle = true;
    if (lead) dash.leader = lead[1];
    if (bid != null) dash.bid = bid;
    if (dash.cycle && (secondsLeft == null || secondsLeft === 0) && !dash.endedAt) { dash.endedAt = Date.now(); diagSnap('auktion-ende'); }
    if (secondsLeft) dash.endedAt = 0;

    const sig = [title, bid, dash.leader, secondsLeft, soldNow].join('|');
    if (sig !== dash.sig) {
      dash.sig = sig;
      emit({ type: 'ct-auction', title, bid, bidder: dash.leader, secondsLeft: soldNow ? 0 : secondsLeft, meta: '' });
    }
    // Verkauf: Gewinner-Einblendung oder Status „hat gewonnen“
    const winMsg = T(document.querySelector('[data-testid="show-winner-message"]')).match(/^(.+?)\s+hat die Auktion gewonnen/);
    const winner = winMsg ? winMsg[1] : (soldNow ? lead[1] : null);
    if (winner && dash.cycle && !first) {
      dash.cycle = false;
      reportSale({ kind: 'auktion', user: winner, title, price: dash.bid, src: 'einblendung' });
    }
  }
  function scanDashboardGiveaway(first) {
    const card = document.querySelector('[data-testid="seller-live-giveaway-card"]');
    if (card) {
      const strongs = [...card.querySelectorAll('strong')];
      const title = T(strongs.find((x) => /line-clamp/.test(x.className)) || strongs[0]);
      const btn = card.querySelector('[data-entry-count]');
      let entrants = btn ? Number(btn.getAttribute('data-entry-count')) : NaN;
      if (!Number.isFinite(entrants)) {
        const m = T(card).match(/(\d+)\s*Teilnehm/);
        entrants = m ? Number(m[1]) : null;
      }
      const tm = T(card.querySelector('.tabular-nums')).match(/^(\d+):(\d{2})$/);
      const secondsLeft = tm ? Number(tm[1]) * 60 + Number(tm[2]) : null;
      if (title) dash.gwTitle = title;
      const sig = [title, entrants, secondsLeft].join('|');
      if (sig !== dash.gwSig) {
        dash.gwSig = sig;
        emit({ type: 'ct-giveaway', title, entrants, secondsLeft });
      }
    } else {
      dash.gwSig = '';
    }
    // Gewinner-Einblendung „Giveaway-Gewinner 🎉 … hat das Giveaway gewonnen!“ (liegt außerhalb des Layouts)
    const winEl = [...document.querySelectorAll('strong')].find((x) => /hat das Giveaway gewonnen/.test(T(x)) && x.querySelector('strong'));
    const name = winEl ? T(winEl.querySelector('strong')) : '';
    if (name && name !== dash.gwWinner) {
      dash.gwWinner = name;
      dash.gwWinAt = Date.now();
      if (!first) reportSale({ kind: 'giveaway', user: name, title: dash.gwTitle, src: 'giveaway-einblendung' });
    }
    if (!name && Date.now() - dash.gwWinAt > 120000) dash.gwWinner = '';
  }

  function scanDashboard() {
    if (!isDashboard()) return;
    const up = T(document.querySelector('[data-testid="seller-live-elapsed-time"] .tabular-nums')).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (up && Date.now() - lastUptimeSent > 30000) {
      lastUptimeSent = Date.now();
      emit({ type: 'ct-uptime', seconds: Number(up[1] || 0) * 3600 + Number(up[2]) * 60 + Number(up[3]) });
    }
    const orders = Number(T(document.querySelector('[data-testid="seller-live-metric-orders-value"]')).replace(/\./g, ''));
    if (Number.isFinite(orders) && orders !== lastOrders) {
      if (lastOrders != null && orders > lastOrders) {
        diagLog('bestellung', { orders });
        onNewOrder(orders - lastOrders);
      }
      lastOrders = orders;
      emit({ type: 'ct-orders', count: orders });
    }
  }

  // ---- Auktion und Verkauf ----
  let lastAuction = '';
  let lastTitle = '';
  let cycleOpen = false; // läuft gerade eine Auktion, deren Ende wir noch nicht gemeldet haben?
  function scanAuction(first) {
    const p = player();
    if (!p) return;
    const title = T(p.querySelector('[data-testid="show-product-title"]'));
    if (!title) return;
    // Preis, Gebote und „Verkauft“ stehen je nach Zustand im Footer oder daneben: rund um den Player suchen, ohne Kopfzeile und Shop
    const scope = p.parentElement || p;
    const strongs = [...scope.querySelectorAll('strong')].filter((s) =>
      !s.closest('header, [data-testid="live-shop-panel"], [data-testid="listing-card"], [data-testid="livestream-card"]'));
    const prices = strongs.filter((s) => /^[\d.]+(,\d{1,2})?\s*€$/.test(T(s)));
    const priceEl = prices.find((s) => /text-right/.test(s.className)) || prices[0];
    const bid = priceEl ? money(T(priceEl)) : null;
    const bidsText = T(strongs.find((s) => /^\d+\s+Gebot/.test(T(s))));
    const timer = T(p.querySelector('[data-testid="show-timer"]')).match(/^(\d+):(\d{2})$/);
    const secondsLeft = timer ? Number(timer[1]) * 60 + Number(timer[2]) : null;
    const status = T(p.querySelector('[data-testid="show-winning-status"]'));
    const lead = status.match(/^(.+?)\s+(erhält den Zuschlag|hat gewonnen)/);
    const soldNow = strongs.some((s) => T(s) === 'Verkauft') || (lead && lead[2] === 'hat gewonnen');
    if (!soldNow && secondsLeft != null && !first) cycleOpen = true;
    if (!first && lastTitle && title !== lastTitle) cycleOpen = !soldNow || cycleOpen;
    if (title !== lastTitle) diagLog('artikel', { title, bid, secondsLeft, soldNow });
    lastTitle = title;

    const sig = [title, bid, lead ? lead[1] : '', secondsLeft, bidsText, soldNow].join('|');
    if (sig !== lastAuction) {
      lastAuction = sig;
      emit({ type: 'ct-auction', title, bid, bidder: lead ? lead[1] : '', secondsLeft: soldNow ? 0 : secondsLeft, meta: bidsText });
    }

    // Verkauf nur melden, wenn wir die Auktion laufen gesehen haben (nie für alte Zustände beim Öffnen)
    const winMsg = T(p.querySelector('[data-testid="show-winner-message"]')).match(/^(.+?)\s+hat die Auktion gewonnen/);
    const winner = winMsg ? winMsg[1] : (soldNow && lead && lead[2] === 'hat gewonnen' ? lead[1] : null);
    if (winner && cycleOpen) {
      cycleOpen = false;
      emit({ type: 'ct-sold', user: winner, price: bid, title });
      sent.sold++;
    }
  }

  // ---- Giveaway ----
  let gwCount = null;
  let drawNames = new Set();
  let drawSeen = false; // Gewinner nur melden, wenn wir die Auslosung live gesehen haben
  let lastGwWinner = '';
  let lastGwWinnerAt = 0;
  function scanGiveaway(first) {
    const p = player();
    if (!p) return;
    // Teilnehmerzahl: Seitenleiste neben dem Player (nicht Karten anderer Shows)
    const area = p.closest('main') || document;
    let count = null;
    for (const s of area.querySelectorAll('strong')) {
      if (s.closest('[data-testid="livestream-card"]')) continue;
      const m = T(s).match(/^Giveaway mit ([\d.]+) Teilnehm/);
      if (m) { count = Number(m[1].replace(/\./g, '')); break; }
    }
    if (count != null && count !== gwCount) emit({ type: 'ct-giveaway', entrants: count });
    gwCount = count;

    const strs = [...p.querySelectorAll('strong')];
    // Whatnot lässt während „Gewinner wird gewählt“ Namen durchlaufen; die sammeln wir für die Walze im Board.
    const head = strs.find((s) => T(s) === 'Gewinner wird gewählt');
    if (head) {
      if (!first) drawSeen = true;
      const box = head.closest('div.flex') || head.parentElement;
      box.querySelectorAll('strong').forEach((s) => {
        const n = T(s);
        if (n && n !== 'Gewinner wird gewählt' && n.length <= 40) drawNames.add(n);
      });
    }
    const winEl = strs.find((s) => /hat das Giveaway gewonnen/.test(T(s)) && s.querySelector('strong'));
    if (winEl) {
      const name = T(winEl.querySelector('strong'));
      if (name && (name !== lastGwWinner || Date.now() - lastGwWinnerAt > 120000)) {
        lastGwWinner = name;
        lastGwWinnerAt = Date.now();
        if (!first && drawSeen) {
          emit({ type: 'ct-giveaway', winner: name, names: [...drawNames].slice(-60) });
          sent.giveaway++;
        }
        drawNames = new Set();
        drawSeen = false;
      }
    }
  }

  // ---- Statusanzeige auf der Whatnot-Seite ----
  function updatePill() {
    attachPill();
    const ok = state.ok;
    pill.setAttribute('style', 'padding:5px 10px;border-radius:999px;' +
      `background:${ok || state.helper ? '#0e1b4d' : '#3a1020'};color:${ok ? '#9aeae3' : state.helper ? '#ffd27a' : '#ff8fb0'};font:700 11px/1.2 system-ui,sans-serif;pointer-events:none;opacity:.92`);
    const d = diag.unknown.length ? ` · Diagnose: ${diag.unknown.length} neu` : '';
    pill.textContent = (ok
      ? `CT-Board ${VERSION} ● ${state.why} · ${sent.chat} Chat · ${sent.sold} Verkäufe · ${sent.giveaway} Giveaways${mute ? ' · stumm' : ''}`
      : state.helper ? `CT-Board ${VERSION} ◐ ${state.why} · ${side.length} gemeldet`
        : `CT-Board ${VERSION} ⏸ ${state.why}`) + d;
  }

  // ---- Takt ----
  let firstScan = true;
  let lastShow = '';
  let scanTimer = null;
  let lastScanAt = 0;
  function resetShowState() {
    resetDash();
    lastUptimeSent = 0;
    lastOrders = null;
    lastAuction = '';
    lastTitle = '';
    cycleOpen = false;
    gwCount = null;
    drawNames = new Set();
    drawSeen = false;
    lastViewers = null;
    resetSaleSources();
  }
  // Zweitfenster: nur Käufer lesen und weiterreichen
  let sideFirst = true;
  let sideShow = '';
  function sideScan() {
    if (showId() !== sideShow) { sideShow = showId(); resetSaleSources(); sideFirst = true; }
    sink = sideReport;
    try {
      scanActivity(sideFirst);
      scanSoldList(sideFirst);
      scanToast(sideFirst);
    } catch (err) {
      console.warn('[Stream-Board] Lesefehler im Zweitfenster:', err);
    } finally {
      sink = reportSale;
    }
    sideFirst = false;
  }
  function scan() {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    lastScanAt = Date.now();
    if (isLive()) {
      try { diagScan(player()); } catch (err) { console.warn('[Stream-Board] Diagnosefehler:', err); }
    }
    state = checkState();
    const active = state.ok && ownsBus();
    isOwner = active;
    if (state.ok && !active) {
      const helper = isDashboard() && (GM_getValue('ct_owner', null) || {}).show === showId();
      state = helper ? { ok: false, helper, why: 'Zweitfenster: liefert Käufer ans sendende Fenster' } : { ok: false, why: 'ein anderer Whatnot-Tab sendet bereits' };
    }
    if (!active) {
      if (state.helper) sideScan();
      else { sideFirst = true; if (!state.ok) releaseBus(); }
      firstScan = true;
      updatePill();
      return;
    }
    sideFirst = true;
    if (showId() !== lastShow) {
      lastShow = showId();
      resetShowState();
      firstScan = true;
      emit({ type: 'ct-show', show: lastShow, host: hostName() });
    }
    try {
      scanChat();
      scanViewers();
      scanDashboard();
      if (isDashboard()) {
        scanDashboardShow(firstScan);
        scanDashboardGiveaway(firstScan);
        scanActivity(firstScan);
        scanSoldList(firstScan);
        scanToast(firstScan);
        sweepOrders();
        sweepSales();
      } else {
        scanAuction(firstScan);
        scanGiveaway(firstScan);
      }
    } catch (err) {
      console.warn('[Stream-Board] Lesefehler:', err);
    }
    firstScan = false;
    flush();
    updatePill();
  }
  const schedule = () => { if (!scanTimer) scanTimer = setTimeout(scan, 80); };
  const onMutate = () => { if (Date.now() - lastScanAt > 150) scan(); else schedule(); };
  new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(schedule, 1000);
  setInterval(() => {
    if (mute && state.ok) document.querySelectorAll('video').forEach((v) => { if (!v.muted) v.muted = true; });
    if (state.ok) keepChatAtBottom();
  }, 3000);
  scan();
  console.log('[Stream-Board] Whatnot-Brücke aktiv.');
  }
})();
