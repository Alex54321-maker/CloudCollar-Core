# CloudCollar Smart Warehouse v2.5 🚛🤖📦

Dieses Repository enthält den Prototypen eines hochmodernen, automatisierten Logistik-Hubs 4.0. Das System demonstriert die Transformation einer klassischen CNC-Überwachung hin zu einer intelligenten, ereignisgesteuerten Steuerung für autonome Lagerkomponenten (AGV-Roboter und Entladedrohnen) via FastAPI, WebSockets und SQLite.

---

## 🚀 Key Features & Architektur

- **Echtzeit-Kommunikation**: Implementierung eines asynchronen WebSocket-Managers zur nahtlosen Synchronisation paralleler Terminal-Instanzen und Client-Verbindungen.
- **Dynamisches Adressmanagement (Cell Mapping)**: Automatisierte SQL-Abfragen zur Ermittlung und Reservierung freier Lagerplätze (`A1` bis `C2`) bei der Entladung sowie automatische Freigabe nach dem Kommissionierungsprozess (Picking).
- **Robuste Datenvalidierung**: Typsicherheit und strukturierter Datenaustausch durch Pydantic-Modelle (`ActionRequest`).
- **Industrielles Reporting**: Performante Generierung strukturierter CSV-Schichtprotokolle und Logistik-Manifeste via Stream-Response (Excel-optimiert mit UTF-8-BOM).
- **Clean DevOps Setup**: Vollständig bereinigtes Git-Repository. Sensible lokale Laufzeitdaten (`.db`, `.log`) sind strikt über `.gitignore` isoliert.

---

## 📁 Projektstruktur

```text
cloudcollar-smart-warehouse/
│
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI-Kernanwendung & WebSocket-Verwaltung
│   ├── database.py      # SQLite-Verbindung & relationale Tabellen-Initialisierung
│   └── schemas.py       # Pydantic-Datenmodelle zur Validierung der Roboter-Telemetrie
│
├── simulators/
│   └── warehouse_robots.py # Autonomer Simulations-Skript für AGVs & Drohnen
│
├── .gitignore           # Ausschluss von venv, temporären Logs und lokalen Datenbanken
└── requirements.txt     # Projekt-Abhängigkeiten
```

---

## 🛠️ Tech Stack

- **Backend Framework**: FastAPI (Python 3.12+)
- **Asynchroner Server**: Uvicorn
- **Datenbank**: SQLite3 (relationales Datenbankmodell)
- **Kommunikation**: WebSockets & REST API (JSON payloads)
- **Simulations-Umgebung**: Requests (Python-basiertes automatisiertes Test-Scripting)

---

## 🛠️ Installation & Inbetriebnahme

### 1. Repository klonen und Verzeichnis betreten
```bash
git clone https://github.com
cd cloudcollar-smart-warehouse
```

### 2. Virtuelle Umgebung einrichten & aktivieren
```bash
python -m venv .venv
# Unter Windows aktivieren:
.venv\Scripts\activate
```

### 3. Abhängigkeiten installieren
```bash
pip install fastapi uvicorn websockets requests
```

### 4. FastAPI-Server starten
```bash
uvicorn app.main:app --reload
```

### 5. Robotersimulation starten (Zweites Terminal)
```bash
python simulators/warehouse_robots.py
```

---

## 📈 Event-Logik & REST-API-Endpunkte

- `POST /api/action/arrow-up`: Simuliert die **Entladung (Unload)** durch `Drone_02`. Sucht den nächsten freien Lagerplatz in der DB und belegt ihn.
- `POST /api/action/arrow-down`: Simuliert die **Kommissionierung (Picking)** durch `AGV_Robot_01`. Sucht die Ware anhand der SKU, gibt den Lagerplatz frei und transportiert die Palette zum Warenausgangsdock.
- `GET /download-log`: Exportiert das logistische Schichtjournal sofort als Excel-konforme CSV-Datei.
