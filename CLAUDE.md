# StreamingMonitor

Stream-Board für Whatnot (CollectnTrade). Antworten auf Deutsch, kurz.

- `board/collectntrade-board.html` ist die Quelle. Nach jeder Änderung `python3 tools/build-lokal.py board/collectntrade-board.html board/collectntrade-board-lokal.html` ausführen und beide Dateien committen.
- Online-Version des Boards: Artifact https://claude.ai/artifact/XT3pfCCzhuRUsZKsMPTtpn (beim Veröffentlichen diese `url` angeben).
- Brücke: `bridge/collectntrade-whatnot-bridge.user.js`. Versionsnummer an allen Stellen gleichzeitig erhöhen. Selektoren stammen aus der deutschen Whatnot-Oberfläche; neue Erkennung nur nach einer Diagnose-Datei oder Aufnahme bauen, nicht raten.
- Keine Diagnosen, Aufnahmen oder echten Whatnot-Namen ins Repository: es ist öffentlich. Testdaten gehören nach `testdata/` (ignoriert).
- Der Nutzer ist IT-Admin (PowerShell), kein Programmierer: Anleitungen mit konkreten Klickpfaden und PowerShell statt Bash.
