import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import logging
import asyncio

app = FastAPI(title="CloudCollar Multi-Machine Backend")

# Разрешаем CORS для локальной разработки
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_FILE = "cloudcollar_history.log"

# Настройка черного ящика
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()
    ]
)


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
    # Сервер принимает соединение и запоминает устройство по его machine_id
    await manager.connect(machine_id, websocket)
    try:
        while True:
            # Ждем пакет данных от устройства
            data = await websocket.receive_text()

            # Если это станок, пишем его тики в лог и вещаем на пульт оператора
            if machine_id != "operator_panel":
                logging.info(f"[{machine_id}] Данные: {data}")
                await manager.broadcast(f"{machine_id}:{data}")
            else:
                # Если это пульт, он присылает команды вида "machine_01:{"action":"TOGGLE"}"
                # Разделяем имя целевого станка и саму команду
                if ":" in data:
                    target_machine, cmd_data = data.split(":", 1)
                    # Пересылаем команду конкретному станку
                    await manager.send_to_machine(target_machine, f"operator_panel:{cmd_data}")

    except WebSocketDisconnect:
        # Если станок или пульт отключились — бережно удаляем их из списка активных
        manager.disconnect(machine_id)


@app.get("/download-log")
async def download_log():
    """Эндпоинт для мгновенного скачивания лога смены (Вариант 2)"""
    if os.path.exists(LOG_FILE):
        return FileResponse(
            path=LOG_FILE,
            filename="cloudcollar_shift_history.log",
            media_type="text/plain"
        )
    raise HTTPException(status_code=404, detail="Файл логов еще не создан. Запустите станки!")


# Маршрут для отдачи пульта оператора (если index.html лежит в той же папке)
@app.get("/")
async def get_dashboard():
    if os.path.exists("index.html"):
        with open("index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200)
    return HTMLResponse(content="<h1>Файл index.html не найден в текущей директории бэкенда!</h1>", status_code=404)
