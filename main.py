import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="CloudCollar Teleoperation Server")


class ConnectionManager:
    def __init__(self):
        # Храним активные WebSocket соединения
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("\n[CloudCollar] Новое устройство или оператор подключились к облаку!")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print("\n[CloudCollar] Устройство отключилось от сервера.")

    async def broadcast_command(self, message: str, sender: WebSocket):
        # Отправляем команду всем, КРОМЕ отправителя (пульта)
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
                print(f"[Управление] Получена команда телеуправления: {command}")
                await manager.broadcast_command(json.dumps(command), sender=websocket)
            except json.JSONDecodeError:
                print(f"[⚠️ Сервер] Получен невалидный JSON: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[❌ Сервер] Непредвиденная ошибка в сессии: {e}")
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    # Запуск uvicorn с автоперезапуском при изменении кода
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
