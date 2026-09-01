# Agent Note: Das Modell baut seinen eigenen Web-Host neu (`rebuild_harness`)

Status: implemented

[English](2026-08-27-tool-triggered-harness-rebuild.md) | 中文

## Problem

Ein Agent, der am Harness innerhalb der Web-GUI arbeitet, konnte seine eigenen Quellcode-Änderungen nicht anwenden: Das Neubauen und Neustarten des Hosts war eine manuelle Terminal-Aufgabe, und wer es bei laufenden Sessions machte, tötete Background-Jobs ohne Aufzeichnung darüber, was lief. Der bestehende Self-Update-Flow (`host.applyUpdate`) ist browser-seitig, macht immer einen Fast-Forward auf Upstream und erreicht nie eine Modellanfrage — das Modell konnte nicht sagen „baue neu, was auf der Platte liegt, und komme zurück“.

## Decision

Das Modell baut seinen eigenen Web-Host über genau ein Tool neu auf, `rebuild_harness` (`@deepseek-ai/dsh-tool-rebuild`), das drei bestehende Teile kombiniert, statt einen neuen Restart-Mechanismus zu bauen: die Job-Registry für sicheres Beenden der Jobs, den Self-Update-Service für Agent-Quiescence und den detached Helper sowie den `ctx.appLifecycle.restart` des Launchers für die Prozess-Übergabe. Der Helper erhält ein `pull: false`-Plan-Flag (`createWebUpdateHandoff(address, { pull: false })`), damit derselbe Runner sowohl Upstream-Updates als auch Rebuild-only-Restarts bedient; der Build bleibt im Helper, weil der laufende Host beendet sein muss, bevor `pnpm run build` die Artefakte ersetzen darf, aus denen er ausgeführt wird.

Der Neustart wird vom Tool bewaffnet, feuert aber erst am `whenIdle()`-Punkt des aufrufenden Agents, nie innerhalb von `execute()`. Diese Reihenfolge macht den Job-Eintrag dauerhaft: Das Tool killt die laufenden Jobs seines Owners, wartet jedes Settlement ab (begrenzt durch `jobStopTimeoutMs`) und liefert sie im kanonischen Ergebnis zurück; der Turn endet dann, loggt das `tool/result`, und erst der Idle-Callback quiesct alle Agents (`quiesceAgents`, Inbox bleibt) und übergibt. Ein Neustart innerhalb von `execute()` würde den Turn abbrechen, der den Eintrag trägt, um den es geht.

Der Job-Wiederanlauf nach dem Neustart läuft über das Transkript, nicht über einen neuen Runtime-Mechanismus: Das geloggte Ergebnis listet jeden gestoppten Job auf und weist das Modell an, sie neu zu starten — eine fortgesetzte Session spielt die Anweisung als gewöhnliche History ab. Das Tool wird host-plane im `dsh-web-app`-Bundle gemountet (jeder Web-Session-Agent sieht es), weil ein Prozess-Neustart prozessweit ist; auf einem Host ohne Restart-Fähigkeit, `ctx.selfUpdate` oder `ctx.webServer` schlägt der Aufruf fehl — nicht das Laden.

## Alternatives considered

- **Neustart innerhalb von `execute()`** wäre in sich geschlossen, zerstört aber das eigene Ergebnis: Der Turn wird mitten im Flug abgebrochen, die Job-Liste erreicht nie das Log, und das Modell setzt blind fort. Die Idle-Arm-Reihenfolge ist der ganze Entwurf.
- **Ein eigener dauerhafter „Pending Jobs“-Store** (neues Session-Event oder Datei) wurde verworfen, weil das geloggte Tool-Ergebnis bereits der dauerhafte Eintrag ist, den das Modell liest; ein zweiter Store würde ihn duplizieren und bräuchte eine eigene Replay-Story.
- **`host.applyUpdate` für das Modell zu öffnen** koppelte das Modell an einen Git-Pull, um den es nicht gebeten hat; der Flow des Nutzers ist „baue neu, was auf der Platte liegt“, daher pinnt das Tool `pull: false`.

## Consequences

- Ein per Tool ausgelöster Rebuild zeigt dem Browser nur einen Verbindungsabbruch: Das Update-Overlay der GUI verfolgt ausschließlich GUI-initiierte Updates über den Update-Store, und der Tool-Pfad umgeht ihn bewusst. Im Paket-README dokumentiert statt erweitert.
- Fremde und unowned Jobs enumeriert das Tool nicht (owner-geführter Zugriff ist die Grenze der Registry); sie enden weiterhin sicher durch Agent-Quiescence und Registry-Disposal, fehlen aber im dauerhaften Eintrag — nur der aufrufende Agent bekommt seine Jobs neu angetrieben.
- `verify-cordis-config` hält das Bundle ehrlich: Das Paket der neuen Row ist eine `dsh-web-app`-Abhängigkeit.
