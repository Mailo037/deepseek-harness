# Agent Note: Composer-Dateianhänge und das Anhang-Menü am Plus-Button

Status: implemented

[English](2026-08-22-composer-file-attachments.md) | 中文

## Problem

Der Plus-Button im Composer öffnete die Slash-Befehlsliste — den einzigen Startpunkt für ein Menü, das der `/`-Trigger bereits besitzt — während Anhänge auf Bilder beschränkt waren: eingefügte oder ausgewählte Nicht-Bilddateien wurden mit einem Format-Hinweis abgelehnt, und das Einfügen eines sehr großen Textblocks blähte den Draft auf, statt eine Anlage zu werden. Es gab keinen Weg, der Session eine Datei zu übergeben, die kein Rasterbild ist.

## Entscheidung

- **Plus-Button → Anhang-Kontextmenü.** Der Plus-Launcher öffnet jetzt sein eigenes `Menu` (heute der Upload-Eintrag; später mehr), das von einem versteckten Multi-File-Picker gespeist wird, dessen Intake über einen injizierten `addFiles`-Pfad läuft. Die Slash-Befehlsliste behält ihren einzigen Trigger: die Eingabe von `/` im Textfeld; die Bar ruft `toggleCommandMenu` nicht mehr auf, und das Inject-Face hat es gestrichen.
- **Anhänge sind eine Union, keine Bilder.** `ComposerAttachment` ist `'image' | 'text' | 'workspace-file'`; die Id-Liste der Input-Maschine war bereits artagnostisch, daher ist das Umbenennen (`imageIds`→`attachmentIds`, `addImages`→`addAttachments`, …) mechanisch, und jeder bestehende Ablauf (Leer-Draft-Sende, Queue-Edit-Stash, Workspace-Wechsel-Transfer, Command-Claim-Gates) trägt Dateien gratis mit. Der Submit serialisiert je Art: Bilder als Image-Blöcke, `text` als fenced `[Attached file: …]`-Promptblock (Zaun länger als jede Backtick-Folge im Inhalt), `workspace-file` als einzeilige Pfadreferenz. Alle Blöcke sind Teil der durable user message — model-visible ⟺ logged gilt ohne neues Session-Event.
- **Binär- und Übergrößen-Dateien werden in den Workspace hochgeladen.** Der neue RPC `session.uploadAttachment` schreibt die Bytes nach `<session cwd>/.uploads/<Zeitstempel>-<Name>` (Basename-säubernt, feste 25-MiB-Grenze, traversal-geschützt) und liefert den workspace-relativen Pfad; der Promptblock nennt diesen Pfad, damit der Agent die Bytes selbst mit seinen File-Tools liest. Textdateien bis 1 MiB fahren stattdessen inline (NUL-Byte-Probe über die ersten 8 KiB entscheidet textual vs. binär).
- **Große Pastes werden wiederherstellbare Anhänge.** Ein Paste ab 50.000 Zeichen registriert eine `text`-Anlage namens `pasted-text.txt` (bei Kollision `-2`, `-3`, …) mit `restorable: true`; das Undo-Control am Rail-Chip fügt den Inhalt per einer Maschinentransaktion am Caret wieder in den Draft ein und entfernt den Chip.
- **Rail-Chips.** Nicht-Bild-Einträge im Rail rendern als Dokument-Chips (Paperclip, Name, Größe, hover-eingeblendete Remove/Restore-Kontrollen); nur Bildeinträge behalten Thumbnails und die Lightbox.

## Geprüfte Alternativen

- **Ein durabler Nicht-Bild-Anhangsspeicher nach Bildvorbild** (Sha256-Store + Transkript-Galerie + Provider-Transport) — vorerst verworfen: nichts konsumiert beliebigen Binärinhalt an der Modellgrenze, während der Agent bereits File-Tools gegen den Workspace besitzt; eine Pfadreferenz liefert dieselbe Fähigkeit ohne zweite Storage-Ebene.
- **Inline-Base64 für Binärdateien** — verworfen: es bläht den Prompt auf, und das Modell kann PDFs oder Archive aus Base64 nicht besser dekodieren als einen Pfad lesen.
- **Upload-beim-Senden für Workspace-Dateien** — verworren: Submit-seitige Uploads würden Enter genau dann langsam und fehleranfällig machen, wenn der Nutzer Versand erwartet; Intake-seitiges Hochladen hält den Chip ehrlich (der Pfad existiert, bevor der Draft gesendet werden kann).

## Konsequenzen

Dateianhänge überleben Session-Wechsel, aber kein Neuladen der Seite — derselbe browser-eigene Lebenszyklus, den Draft-Bilder immer hatten. Befehle mit Annexakzeptanz bleiben bild-only: ein claimter Befehl, der auf eine Datei-Anlage trifft, wird zur Sendezeit über den lokalisierten Hinweis „Befehle akzeptieren nur Bildanhänge“ abgelehnt. `.uploads/` erscheint im Projektverzeichnis der Session und ist bewusst unbehandelt (kein Gitignore-Injekt, kein Pruning); die Host-Grenze begrenzt Missbrauch. Das Lifecycle-Chrome-E2E-Golden für das gestartete Slash-Menü ist mit dem Plus-Button-Startpfad entfallen; das getippte-`/`-Fuzzy-Golden bleibt.
