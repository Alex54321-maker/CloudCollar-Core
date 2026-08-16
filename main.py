import json
import logging
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# --- НАСТРОЙКА ЛОГИРОВАНИЯ (ЧЕРНЫЙ ЯЩИК СИСТЕМЫ) ---
LOG_FILE = Path(__file__).parent / "cloudcollar_history.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler()  # Дублирует логи в консоль PyCharm
    ]
)

app = FastAPI(title="CloudCollar Teleoperation Server")


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logging.info("Новое подключение: Устройство или оператор подключились к облаку!")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logging.info("Отключение: Устройство отключилось от сервера.")

    async def broadcast_command(self, message: str, sender: WebSocket):
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except Exception:
                    pass


manager = ConnectionManager()


@app.get("/")
def health_check():
    return {"status": "Сервер CloudCollar запущен и готов к маршрутизации команд"}


@app.websocket("/ws/control")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                command = json.loads(data)

                # Умное разделение логов в зависимости от типа пакета
                if isinstance(command, dict) and command.get("type") == "telemetry":
                    logging.info(
                        f"СТАНОК -> Телеметрия: Обороты {command.get('speed')} RPM, Мотор: {command.get('is_motor_on')}")
                else:
                    logging.info(f"ОПЕРАТОР -> Команда управления: {command}")

                await manager.broadcast_command(json.dumps(command), sender=websocket)
            except json.JSONDecodeError:
                logging.warning(f"Ошибка: Получен невалидный JSON: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logging.error(f"Непредвиденная ошибка в сессии: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
