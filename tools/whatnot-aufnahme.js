// CollectnTrade – Whatnot-Aufnahme
// Zeichnet auf, wie die Whatnot-Seite aufgebaut ist und was sich während eines Streams ändert
// (neue Chat-Nachrichten, Verkäufe, Giveaways). Liest keine Cookies, Passwörter oder Speicher,
// schickt nichts ins Netz. Die Datei entsteht nur lokal über „Speichern“.
(() => {
  if (window.__ctRec) { console.log('Aufnahme läuft schon.'); return; }
  const MAX_EVENTS = 5000;      // Obergrenze für Ereignisse
  const MAX_HTML = 6000;        // max. Zeichen pro neuem Element
  const MAX_TEXT_PER_PATH = 6;  // Text-Änderungen pro Element (z. B. Countdown) begrenzen
  const AUTO_STOP_MIN = 30;     // stoppt nach 30 Minuten von selbst

  const start = Date.now();
  const events = [];
  const snapshots = [];
  const seen = new Set();
  const textCount = new Map();
  let stopped = false;

  // Skripte, Styles, Icon-Pfade und eingebettete Bilder raus: macht die Datei klein und
  // entfernt eingebettete Seitendaten (z. B. Session-Infos in Script-Tags).
  const clean = (html) => html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/\s(d|points|transform)="[^"]{40,}"/gi, '')
    .replace(/\s(src|srcset|href|style)="data:[^"]{40,}"/gi, ' $1="data:…"')
    .replace(/\s{2,}/g, ' ');

  const cssPath = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 10) {
      let s = el.tagName.toLowerCase();
      const id = el.getAttribute('id');
      if (id) s += '#' + id;
      for (const a of ['data-testid', 'data-cy', 'role', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v) s += `[${a}="${v.slice(0, 40)}"]`;
      }
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };

  // Kleiner Bedienkasten unten links
  const box = document.createElement('div');
  box.setAttribute('style', [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483647', 'display:flex', 'gap:8px',
    'align-items:center', 'padding:10px 12px', 'border-radius:10px', 'background:#0e1b4d', 'color:#f5f5f5',
    'font:600 13px/1.3 system-ui,sans-serif', 'box-shadow:0 6px 24px rgba(0,0,0,.4)'
  ].join(';'));
  const status = document.createElement('span');
  const mkBtn = (label, bg, fg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('style', `font:700 12px system-ui,sans-serif;padding:6px 10px;border:0;border-radius:6px;cursor:pointer;background:${bg};color:${fg}`);
    return b;
  };
  const snapBtn = mkBtn('Schnappschuss', '#0271ca', '#fff');
  const saveBtn = mkBtn('Speichern', '#9aeae3', '#0e1b4d');
  const stopBtn = mkBtn('Stopp', '#ff568b', '#0e1b4d');
  box.append(status, snapBtn, saveBtn, stopBtn);
  document.documentElement.append(box);

  const takeSnapshot = (label) => {
    snapshots.push({ t: Date.now() - start, label, url: location.href, html: clean(document.body.outerHTML) });
  };
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const updateStatus = () => {
    status.textContent = `${stopped ? '■ Gestoppt' : '● Aufnahme'} ${fmt(Date.now() - start)} · ${events.length} Ereignisse · ${snapshots.length} Schnappschüsse`;
  };

  const obs = new MutationObserver((muts) => {
    if (stopped) return;
    for (const m of muts) {
      if (events.length >= MAX_EVENTS) break;
      if (box.contains(m.target)) continue;
      const t = Date.now() - start;
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) {
            const txt = n.data.trim();
            const el = m.target;
            if (!txt || !el || el.nodeType !== 1) continue;
            const p = cssPath(el);
            const c = textCount.get(p) || 0;
            if (c >= MAX_TEXT_PER_PATH) continue;
            textCount.set(p, c + 1);
            events.push({ t, type: 'text', path: p, text: txt.slice(0, 300) });
            continue;
          }
          if (n.nodeType !== 1 || box.contains(n)) continue;
          const html = clean(n.outerHTML);
          if (html.length < 15) continue;
          const key = html.slice(0, 400);
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({ t, type: 'added', path: cssPath(n), parent: cssPath(m.target), text: (n.textContent || '').trim().slice(0, 300), html: html.slice(0, MAX_HTML) });
        }
      } else if (m.type === 'characterData') {
        const el = m.target.parentElement;
        if (!el) continue;
        const p = cssPath(el);
        const c = textCount.get(p) || 0;
        if (c >= MAX_TEXT_PER_PATH) continue;
        textCount.set(p, c + 1);
        events.push({ t, type: 'text', path: p, text: m.target.data.trim().slice(0, 300) });
      }
    }
    updateStatus();
  });

  const stop = () => {
    if (stopped) return;
    takeSnapshot('ende');
    stopped = true;
    obs.disconnect();
    clearInterval(tick);
    updateStatus();
  };
  const save = () => {
    const data = {
      meta: { tool: 'ct-whatnot-aufnahme', version: 1, start: new Date(start).toISOString(), saved: new Date().toISOString(), url: location.href, userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight] },
      snapshots: stopped ? snapshots : [...snapshots, { t: Date.now() - start, label: 'beim-speichern', url: location.href, html: clean(document.body.outerHTML) }],
      events
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `whatnot-aufnahme-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  snapBtn.addEventListener('click', () => { takeSnapshot('markiert'); updateStatus(); });
  saveBtn.addEventListener('click', save);
  stopBtn.addEventListener('click', stop);

  takeSnapshot('start');
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  const tick = setInterval(() => { updateStatus(); if (Date.now() - start > AUTO_STOP_MIN * 60000) stop(); }, 1000);
  updateStatus();
  window.__ctRec = { stop, save };
  console.log('Aufnahme gestartet. Kasten unten links: Schnappschuss, Speichern, Stopp.');
})();
