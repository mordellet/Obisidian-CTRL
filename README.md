# CTRL – Steuerungsboard für Obsidian

Persönliches Steuerungsboard: Themen nach Priorität, Energie (Aktivität aus Notizen),
Fortschritt, Blockaden, Fokus und offene Fragen – direkt aus dem Vault.

**Quelle der Wahrheit sind Notizen.** Das Plugin liest und schreibt nur Markdown/Frontmatter.

## Konventionen
- Ordner (Einstellung `Board folder`): `Board.md` (`type: board`) + je Thema eine Notiz (`type: thema`).
- Themen-Frontmatter: `id`, `prio`, `status` (läuft · stockt · blockiert · fertig · tot · pausiert),
  `status_text`, `status_at`, `braucht`, `blockiert_durch`, `rueckfuehrung`, `geprueft`, `confidential`.
- Body: `## Ziele` (optional `### S2.1 Name`), Aufgaben mit `✅ YYYY-MM-DD`, `#fokus`;
  `## Offene Fragen` mit `[?]` Frage · `[!]` Entscheidung/Ask (`@Person`) · `[r]` Risiko; `## Parallel`.
- Ereignisse: jede Notiz in den Ereignis-Ordnern mit `thema: S2` (Gewicht 1.0) oder Link auf die
  Themen-Notiz (0.6). Ohne Bezug → „nicht zugeordnet" (Knopf → setzt `thema:`).

## Ansicht
- Stufe 0 (radial): Radius = Energie, Füllung = Fortschritt, Bogen = Soll laut Priorität,
  Pfeil = Richtung, gepunktet = stale, Körnung = Slop, Farbe nur für Blockade.
- Detail-Karte (Thema) bzw. Übersicht mit **Fokus** und **Zu klären**.
- Statuszeile: `[ID] [kw:] ein Satz` + Enter. Runde-Modus blendet `confidential` aus.
- Demo-Modus (Knopf „demo") lädt die Testdaten des Design-Handoffs (read-only) zum Vergleich.
- Zoom: Klick = Graph (Stufe 2), Rad/Pinch über Sektor = Explosion (Stufe 1, Kamerafahrt), Rad heraus/Esc = zurück.
- Zeitreihe: `jahr` = Gesamtsicht; Regler/▶ = 28-Tage-Fenster wandert durch das Jahr (alle Signale zum Zeitpunkt).
- Bearbeiten: Name (Umbenennen der Notiz), `+ ziel`, `+ schritt` / `+` je Ziel, Schritt wählen → erledigt setzen.
- Ziel-Abhängigkeiten: unter der Ziel-Überschrift `Braucht: S8.1` / `Blockiert durch: S4.1` → im Graph als Senkrechte bzw. Port.

## Entwicklung
```bash
pnpm install
pnpm check            # lint, typecheck, test (inkl. View-Simulation unter jsdom), arch (hexagonal: domain ← ports ← application ← adapters)
pnpm install-vault    # build + Kopie nach <vault>/.obsidian/plugins/ctrl-board (CTRL_VAULT überschreibt)
```
Gerüst übernommen von Filavi (esbuild, eslint-plugin-obsidianmd, vitest, dependency-cruiser).
Design-Referenz: Claude-Design-Handoff „Steuerungsboard" Phase 5 (nicht im Repo).
