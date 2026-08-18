import os
import sqlite3
import json
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import logging

app = FastAPI(title="CloudCollar Multi-Machine Backend")

# Разрешаем CORS для локальной разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_FILE = "cloudcollar.db"

# Логирование в консоль оставляем для удобства разработки
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)


def init_db():
    """Инициализация базы данных и создание таблицы метрик ЧПУ"""
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS machine_logs
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           timestamp
                           TEXT
                           NOT
                           NULL,
                           machine_id
                           TEXT
                           NOT
                           NULL,
                           status
                           TEXT
                           NOT
                           NULL,
                           speed
                           REAL
                           NOT
                           NULL
                       )
                       """)
        conn.commit()


def save_telemetry_to_db(machine_id: str, payload_str: str):
    """Безопасный парсинг телеметрии и запись в SQLite"""
    try:
        data = json.loads(payload_str)
        status = data.get("status", "UNKNOWN")
        speed = float(data.get("speed", 0))

        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO machine_logs (timestamp, machine_id, status, speed) VALUES (?, ?, ?, ?)",
                (datetime.now().isoformat(), machine_id, status, speed)
            )
            conn.commit()
    except Exception as e:
        logging.error(f"Ошибка сохранения телеметрии в БД для {machine_id}: {e}")


# Инициализируем базу данных при запуске приложения
init_db()


class ConnectionManager:
    def __init__(self):
        # Структура: { machine_id: WebSocket }
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, machine_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[machine_id] = websocket
        logging.info(f"Станок [{machine_id}] успешно подключен к системе.")

    def disconnect(self, machine_id: str):
        if machine_id in self.active_connections:
            del self.active_connections[machine_id]
            logging.info(f"Станок [{machine_id}] отключен от системы.")

    async def send_to_machine(self, machine_id: str, message: str):
        if machine_id in self.active_connections:
            await self.active_connections[machine_id].send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            await connection.send_text(message)


manager = ConnectionManager()


@app.websocket("/ws/{machine_id}")
async def websocket_endpoint(websocket: WebSocket, machine_id: str):
    await manager.connect(machine_id, websocket)
    try:
        while True:
            # Ждем пакет данных от устройства
            data = await websocket.receive_text()

            # Если это станок, пишем его тики в базу данных и вещаем на пульт оператора
            if machine_id != "operator_panel":
                save_telemetry_to_db(machine_id, data)
                await manager.broadcast(f"{machine_id}:{data}")
            else:
                # Если это пульт, он присылает команды вида "machine_01:{"action":"TOGGLE"}"
                # Разделяем имя целевого станка и саму команду. Проброс SPEED_DOWN работает автоматически!
                if ":" in data:
                    target_machine, cmd_data = data.split(":", 1)
                    await manager.send_to_machine(target_machine, f"operator_panel:{cmd_data}")

    except WebSocketDisconnect:
        manager.disconnect(machine_id)


@app.get("/download-log")
async def download_log():
    """Динамическая генерация CSV-отчета за смену прямо из SQLite базы данных"""
    if not os.path.exists(DB_FILE):
        raise HTTPException(status_code=404, detail="База данных еще не создана. Запустите станки!")

    report_file = "cloudcollar_shift_report.csv"

    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT timestamp, machine_id, status, speed FROM machine_logs ORDER BY id DESC")
            rows = cursor.fetchall()

        if not rows:
            raise HTTPException(status_code=404, detail="В базе данных еще нет записей для отчета!")

        with open(report_file, "w", encoding="utf-8") as f:
            # Записываем заголовки CSV
            f.write("Timestamp;Machine_ID;Status;Speed_RPM\n")
            for row in rows:
                f.write(f"{row[0]};{row[1]};{row[2]};{row[3]}\n")

        return FileResponse(
            path=report_file,
            filename="cloudcollar_shift_report.csv",
            media_type="text/csv"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации отчета: {str(e)}")


# Маршрут для отдачи пульта оператора
@app.get("/")
async def get_dashboard():
    if os.path.exists("index.html"):
        with open("index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200)
    return HTMLResponse(content="<h1>Файл index.html не найден в текущей директории бэкенда!</h1>", status_code=404)
