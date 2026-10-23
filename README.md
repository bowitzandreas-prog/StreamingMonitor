# StreamingMonitor

Stream-Board für Whatnot-Shows: eine Anzeige für TV, Monitor oder iPad hinter der Kamera. Sie zeigt Live-Chat, Zuschauer, Top-Chatter, Community-Ziel, die laufende Auktion und Giveaways. Bei jedem Verkauf und Giveaway-Gewinn druckt sie ein Label mit Käufername, Artikel und Preis.

Die Daten kommen aus der eigenen Whatnot-Show. Ein Tampermonkey-Script (die „Brücke“) liest die Whatnot-Seite mit und reicht die Ereignisse an das Board weiter. Es läuft alles lokal im Browser, ohne Server und ohne Whatnot-API.

## Dateien

| Datei | Wofür |
| --- | --- |
| `board/collectntrade-board-lokal.html` | Das Board. Diese Datei auf den Desktop legen und in Chrome öffnen. |
| `board/collectntrade-board.html` | Quelle des Boards (ohne `<html>`/`<head>`-Rahmen). Daraus wird die lokale Datei gebaut und die Online-Version veröffentlicht. |
| `bridge/collectntrade-whatnot-bridge.user.js` | Tampermonkey-Script für whatnot.com und das lokale Board. |
| `tools/whatnot-aufnahme.js` | Aufnahme-Script für die Browser-Konsole: zeichnet auf, wie eine Whatnot-Seite aufgebaut ist. |
| `tools/build-lokal.py` | Baut `collectntrade-board-lokal.html` aus der Quelle. |

## Einrichtung

1. **Tampermonkey** in Chrome installieren. Unter `chrome://extensions` → Tampermonkey → Details einschalten:
   - „Zugriff auf Datei-URLs zulassen“ (sonst läuft das Script nicht im lokalen Board)
   - „Nutzerskripts zulassen“, falls Chrome den Schalter anzeigt
2. **Brücke einfügen:** Tampermonkey → Dashboard → „+“ → Inhalt von `bridge/collectntrade-whatnot-bridge.user.js` einfügen → Speichern.
3. **Board öffnen:** `board/collectntrade-board-lokal.html` auf den Desktop legen und in Chrome öffnen. Der Dateiname muss `collectntrade-board` oder `stream-board` enthalten, sonst greift das Script dort nicht.
4. **Im Board:** Einstellungen → Einrichtung → eigenen Whatnot-Namen eintragen. Nur Shows dieses Accounts werden übernommen.
5. **Whatnot öffnen** (Zuschauer-Ansicht der eigenen Show oder Seller-Dashboard) im selben Chrome-Profil wie das Board. Unten links erscheint die Statusanzeige, z. B. `CT-Board 0.7.1 ● Seller-Dashboard @deinname`.

Board und Whatnot müssen im selben Chrome-Profil laufen, weil die Brücke die Ereignisse über den Tampermonkey-Speicher weitergibt.

## Labeldruck ohne Druckdialog

Chrome druckt mit `--kiosk-printing` direkt auf den Windows-Standarddrucker. Den Labeldrucker als Standarddrucker setzen und das Board über eine eigene Verknüpfung starten (eigenes Profil, damit das normale Chrome unberührt bleibt):

```powershell
$desktop = [Environment]::GetFolderPath('Desktop')
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$board  = Join-Path $desktop 'collectntrade-board-lokal.html'
$profil = "$env:LOCALAPPDATA\CollectnTrade-Stream"
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Stream-Board.lnk'))
$lnk.TargetPath = $chrome
$lnk.Arguments  = "--kiosk-printing --user-data-dir=`"$profil`" `"$board`""
$lnk.Save()
```

Im Profil der Verknüpfung müssen Tampermonkey und die Brücke ebenfalls installiert sein, und Whatnot wird in diesem Fenster geöffnet. Labelgröße, Druck bei Verkauf/Giveaway und Shopname auf dem Label stellt man im Board unter Einstellungen → Labels drucken ein.

## Seller-Dashboard: Käufer erkennen

Im Dashboard zeigt Whatnot den Höchstbietenden nicht im Videobild. Die Brücke holt Käufer deshalb aus mehreren Stellen und führt doppelte Meldungen zusammen (ein Label pro Verkauf):

- **Aktivität-Tab** (rechte Spalte): Sofortkauf, Auktionsgewinn und Giveaway-Gewinn mit Name und Artikel. Whatnot füllt die Liste nur, solange der Tab offen ist.
- **Verkauft-Tab** (Shop links): Käufer und „Verkauft für …“, daraus kommt der Preis.
- **Kauf-Banner** oben („… hat gerade 1 … gekauft!“), unabhängig vom offenen Tab.
- **Gewinner-Einblendungen** bei Giveaways.

Wer rechts den Chat offen haben will, öffnet das Dashboard ein zweites Mal in einem eigenen Fenster und stellt dort rechts „Aktivität“ ein. Das Fenster mit sichtbarem Chat sendet ans Board, das andere zeigt `◐ Zweitfenster` und liefert die Käufer zu.

## Diagnose

Tampermonkey-Menü auf der Whatnot-Seite → „Diagnose speichern (nach dem Stream)“. Die Datei enthält, was die Brücke gesendet hat, Texte, die sie nicht kennt, und Schnappschüsse der Seite bei Bestellungen und Verkäufen. Damit lassen sich Änderungen an der Whatnot-Oberfläche nachziehen.

Die Diagnose enthält Namen und Chat-Nachrichten echter Zuschauer. Sie gehört deshalb nicht in dieses öffentliche Repository.

## Entwicklung

Lokale Datei nach Änderungen an der Quelle neu bauen:

```bash
python3 tools/build-lokal.py board/collectntrade-board.html board/collectntrade-board-lokal.html
```

Neue Version der Brücke: die Versionsnummer an allen Stellen in `bridge/collectntrade-whatnot-bridge.user.js` ersetzen (`@version`, Statusanzeige, `VERSION`, Hallo-Nachricht an das Board).

Getestet wird mit Playwright: aufgezeichnete Whatnot-Seiten werden nachgestellt, Brücke und Board laufen echt mit. Die Aufnahmen und Tests liegen wegen der Zuschauerdaten nicht im Repository.

## Stand

- Zuschauer-Ansicht: Chat, Zuschauer, Auktion, Verkauf, Giveaway mit Auslosung getestet.
- Seller-Dashboard: Chat, Zuschauer, Laufzeit, Bestellungen, Giveaway-Gewinner getestet; Käufer über Aktivität/Verkauft-Liste/Banner ab Brücke 0.7.0, Test im echten Stream steht aus.
- Später: englische Whatnot-Oberfläche, Chrome-Erweiterung statt Tampermonkey, Lizenzierung.
