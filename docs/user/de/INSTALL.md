# Mediamaster installieren

[🇬🇧 English](../en/INSTALL.md) · 🇩🇪 Deutsch

Mediamaster wird als fertig gebautes Programm für **Windows, Linux, macOS, Android und
iOS** bereitgestellt. Diese Anleitung beschreibt die Installation der fertigen App auf
jeder Plattform. Zum Selbst-Kompilieren siehe [CONTRIBUTING.md](../../../CONTRIBUTING.md).

> **Hinweis zum Codenamen:** Die Downloads heißen `reader.*` / `Reader.*` — das ist der
> interne Codename. Die installierte App heißt **Mediamaster**.

---

## Wo gibt es die Downloads?

Alle Builds liegen auf der **[Releases-Seite](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases)**.

Es gibt zwei Kanäle:

| Kanal | Welches Release | Für wen |
|-------|-----------------|---------|
| **Stable** | Getaggte Releases `v1.8.8`, `v1.9.0`, … | Für die meisten — getestete, versionierte Builds |
| **Dev** | Das rollende `dev`-Release (bei jeder Pipeline aktualisiert) | Für alle, die die neuesten Funktionen zuerst wollen |

Die passende Datei für die eigene Plattform im Abschnitt **Assets → Download** des
Releases herunterladen.

| Plattform | Datei(en) |
|-----------|-----------|
| Windows | `Reader-Setup.exe` (Installer), `reader.exe` (portabel) |
| Linux | `Reader.AppImage`, `Reader.deb` |
| macOS | `Reader.dmg` |
| Android | `Reader.apk` — oder über **Neo Store** installieren ([F-Droid-Repo](#-android-neo-store--f-droid-repo), empfohlen) |
| iOS / iPadOS | `Reader.ipa` (stable) · `Reader-dev.ipa` (dev) |

Mediamaster besitzt außerdem einen **integrierten Updater** — nach der Installation
meldet er neue Builds (und lädt sie auf dem Desktop automatisch herunter). Eine manuelle
Installation ist also in der Regel nur einmal nötig.

---

## 🪟 Windows

**Installer (empfohlen)**

1. `Reader-Setup.exe` herunterladen.
2. Datei ausführen. Windows SmartScreen warnt eventuell vor einem unbekannten Herausgeber
   (der Build ist nicht signiert) — auf **Weitere Informationen → Trotzdem ausführen** klicken.
3. Dem Assistenten folgen. Mediamaster wird installiert und legt einen Startmenü-Eintrag an.

**Portabel**

1. `reader.exe` herunterladen.
2. Die Datei in einen beliebigen Ordner legen und direkt starten — keine Installation nötig.
   Offline-Downloads landen im Ordner `dl/` neben der EXE.

---

## 🐧 Linux

**AppImage (funktioniert auf den meisten Distributionen)**

```bash
chmod +x Reader.AppImage
./Reader.AppImage
```

> Startet die Datei nicht, FUSE installieren (`sudo apt install libfuse2` unter
> Debian/Ubuntu) oder mit `./Reader.AppImage --appimage-extract-and-run` entpacken und starten.

**Debian / Ubuntu (.deb)**

```bash
sudo apt install ./Reader.deb
# danach "Mediamaster" im Anwendungsmenü starten oder ausführen: reader
```

---

## 🍎 macOS

1. `Reader.dmg` herunterladen, öffnen und **Mediamaster** in den Ordner **Programme** ziehen.
2. Der Build ist nicht signiert, deshalb blockiert Gatekeeper den ersten Start. Entweder:
   - **Rechtsklick → Öffnen** und im Dialog mit **Öffnen** bestätigen, oder
   - einmalig ausführen: `xattr -dr com.apple.quarantine /Applications/Mediamaster.app`

> Die `.dmg` ist ein unsigniertes Best-Effort-Artefakt und kann in einzelnen Dev-Builds
> fehlen. In dem Fall ein früheres oder ein Stable-Release verwenden.

---

## 🤖 Android (Neo Store / F-Droid-Repo)

Der empfohlene Weg zum Installieren **und automatischen Aktualisieren** unter Android
führt über **[Neo Store](https://github.com/NeoApplications/Neo-Store)** (einen
F-Droid-Client) und das Mediamaster-F-Droid-Repository.

### Einmalig: Mediamaster-Repo hinzufügen

1. **Neo Store** installieren (über [F-Droid](https://f-droid.org/) oder die
   [GitHub-Releases](https://github.com/NeoApplications/Neo-Store/releases)).
2. In Neo Store den Bereich **Repositories** öffnen (Repo-Symbol in der oberen Leiste oder
   *Einstellungen → Repositories*) und auf **➕ Repository hinzufügen** tippen.
3. Folgendes eintragen:

   - **Adresse:**
     ```
     https://gitlab.gpz-hs.de/api/v4/projects/10/packages/generic/reader-fdroid/repo
     ```
   - **Fingerprint:**
     ```
     86f476fdc6d981a0804c3c63f68e6dc4f74bc1ed691507d6c799dc7965628f51
     ```

4. Bestätigen und Neo Store das Repo **synchronisieren** lassen.

> ℹ️ Wird die Repo-Adresse im Browser geöffnet, erscheint ein **404** — das ist normal.
> F-Droid-Clients rufen `<Adresse>/entry.jar` ab, nicht den Pfad selbst.

### Installieren & aktualisieren

Nach der Synchronisierung in Neo Store nach **Mediamaster** (stable) oder
**Mediamaster Dev** suchen und installieren. Beide sind eigenständige Apps
(`com.hammerl.reader` und `com.hammerl.reader.dev`) mit unterschiedlichen IDs und können
parallel installiert bleiben. Neo Store übernimmt danach die Updates automatisch, sobald
ein neuer Build veröffentlicht wird.

### Alternative: APK direkt installieren

Ohne Neo Store lässt sich `Reader.apk` von der
[Releases-Seite](https://gitlab.gpz-hs.de/chhammerl/reader/-/releases) herunterladen und
öffnen; dabei muss die **Installation aus unbekannten Quellen** für den Browser bzw. den
Dateimanager erlaubt werden. Alle Releases sind mit demselben Schlüssel signiert, ein
neueres APK installiert sich also **über** das alte und behält die Daten — automatische
Updates gibt es auf diesem Weg allerdings nicht.

> Die App spricht mit Medienservern im LAN über einfaches `http://` (Klartext ist
> aktiviert), lokale Jellyfin-/Calibre-/ABS-Server funktionieren also ohne Zusatzschritte.

---

## 📱 iOS / iPadOS (SideStore)

iOS-Apps lassen sich nicht direkt aus einer Datei installieren — die `.ipa` wird per
**[SideStore](https://sidestore.io/)** (oder AltStore) geladen. SideStore installiert eine
mit der eigenen Apple-ID signierte Kopie und erneuert die Signatur im Hintergrund, damit
sie nicht abläuft.

### Einmalige SideStore-Einrichtung

1. **SideStore** nach der offiziellen Anleitung auf dem Gerät installieren und einrichten:
   <https://docs.sidestore.io/docs/intro>. Damit wird die SideStore-App installiert und mit
   der Apple-ID gekoppelt.

### Mediamaster-Quelle hinzufügen

Mediamaster veröffentlicht eine **SideStore-/AltStore-Quelle**, über die sich die App
direkt in SideStore installieren und aktualisieren lässt (empfohlen gegenüber der rohen
`.ipa`).

1. **SideStore → Sources → `+` (Hinzufügen)** öffnen.
2. Die Mediamaster-Quell-URL einfügen:

   ```
   https://gitlab.gpz-hs.de/api/v4/projects/10/packages/generic/reader-source/latest/updates.json
   ```

3. Die neue Quelle öffnen und **Mediamaster** (stable) oder **Mediamaster Dev**
   installieren. Beide sind eigenständige Apps mit unterschiedlichen Bundle-IDs und können
   parallel laufen.

### Alternative: rohe .ipa installieren

Wer die Quelle nicht hinzufügen möchte, lädt `Reader.ipa` herunter und öffnet die Datei mit
SideStore (**SideStore → Apps → `+` → `.ipa` auswählen**).

### Server-Voraussetzungen unter iOS

- Lokale Server über `http://` funktionieren — der Build enthält eine Ausnahme für App
  Transport Security. Beim ersten Zugriff im LAN fragt iOS nach der Berechtigung
  **Lokales Netzwerk**; diese muss erlaubt werden.
- Für den **Audiobookshelf-OIDC-Login** muss die Redirect-URI
  `mediamaster://abs-oauth-callback` auf dem ABS-Server eingetragen werden
  (*Einstellungen → Authentifizierung → OpenID → Redirect-URIs für mobile Apps*).

### Hinweis zum Erneuern

Mit SideStore signierte Apps müssen regelmäßig erneuert werden (mit einer kostenlosen
Apple-ID typischerweise alle 7 Tage). SideStore erledigt das automatisch, solange es die
Kopplung erreichen kann; andernfalls SideStore öffnen und **Refresh All** antippen. Die
App-Daten bleiben beim Erneuern erhalten.

---

## 🔧 Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| Windows: „Herausgeber unbekannt“ | Builds sind unsigniert — **Weitere Informationen → Trotzdem ausführen**. |
| macOS: „App ist beschädigt / kann nicht geöffnet werden“ | `xattr -dr com.apple.quarantine /Applications/Mediamaster.app` |
| Linux: AppImage startet nicht | FUSE installieren oder `--appimage-extract-and-run` verwenden. |
| Android blockiert die APK-Installation | „Installation aus unbekannten Quellen“ für Browser/Dateimanager erlauben. |
| Neo Store fügt das Repo nicht hinzu / 404 im Browser | Der 404 ist normal; Adresse und Fingerprint exakt eintragen und Neo Store synchronisieren lassen (es lädt `entry.jar`). |
| iOS: App startet nach einer Woche nicht mehr | SideStore öffnen → **Refresh All** (Zertifikate kostenloser Apple-IDs laufen nach 7 Tagen ab). |
| Lokaler Server nicht erreichbar | LAN-IP bzw. Hostnamen des Servers verwenden; unter iOS die Abfrage **Lokales Netzwerk** erlauben. |

Immer noch Probleme? Bitte ein Issue eröffnen — siehe [CONTRIBUTING.md](../../../CONTRIBUTING.md).
