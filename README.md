# CloudCollar v2.0 — Smart Logistics & Multi-Agent Industrial IoT

Dieses Projekt demonstriert die softwareseitige Steuerung und das Echtzeit-Monitoring von autonomer Industrie- und Logistik-Hardware über eine moderne Web-Oberfläche. Entwickelt in **PyCharm** als Prototyp für automatisierte Lager- und Produktionsprozesse (Industrie 4.0).

## 🚀 Kernfunktionen (Aktueller Stand)
* **Multi-Connection-Architektur:** Ein robuster FastAPI-Zentralbroker managt parallele WebSocket-Verbindungen von mehreren autonomen Einheiten (`machine_01`, `machine_02`) ohne Datenkollisionen.
* **Industrielles Dashboard:** Live-Visualisierung der Telemetriedaten über ein interaktives HTML5-Canvas-Diagramm mit dynamischer Tastatursteuerung (Hotkeys für Beschleunigung, Abbremsung und Not-Aus).
* **Automatisierter Datenspeicher:** Nahtlose Migration von unstrukturierten Text-Logfiles auf eine strukturierte **SQLite-Datenbank** zur manipulationssicheren Erfassung aller Systemereignisse.
* **Schichtprotokoll-Export:** Dynamische Generierung von CSV-Berichten direkt aus der SQL-Datenbank per Mausklick — optimiert für die sofortige Weiterverarbeitung im Transportmanagement (z.B. als digitaler Frachtbrief oder Schichtmanifest).

## 🛠 Tech-Stack
* **Backend:** Python 3.14, FastAPI, WebSockets, Asyncio, SQLite3
* **Frontend:** HTML5, CSS3 (Neon-Cyberpunk-UI), JavaScript (Canvas API)
* **DevOps & Environment:** Git, Windows PowerShell, PyCharm Virtual Environments (`.venv`)

## 📅 Roadmap für den Logistik-Pivot (Morgen)
Transformierung des Systems in ein **Smart Warehouse Management System (WMS)**:
1. **AGV & Drohnen-Simulation:** Umbenennung der Entitäten in fahrerlose Transportsysteme (`AGV_Robot_01`, `Delivery_Drone_02`).
2. **Be- und Entladelogik:** Hotkeys steuern die automatisierte Palettenentladung von LKWs an der Rampe (Pfeiltaste Hoch = Einlagerung, Pfeiltaste Runter = Kommissionierung/Picking).
3. **Stellplatzverwaltung (Lagerplatz-Mapping):** SQL-Datenbank-Erweiterung für chaotische Lagerhaltung (Zuweisung von Stellplatz-IDs, Artikelnummern und Palettengewichten).
