import asyncio
import sys
import json
import websockets

# Получаем ID станка из аргументов командной строки, либо ставим дефолт
MACHINE_ID = sys.argv[1] if len(sys.argv) > 1 else "machine_01"
URI = f"ws://localhost:8000/ws/{MACHINE_ID}"


class MachineSimulator:
    def __init__(self, machine_id):
        self.machine_id = machine_id
        self.is_running = False
        self.speed = 0
        self.max_speed = 3000

    async def telemetry_loop(self, websocket):
        """Фоновая задача генерации телеметрии"""
        try:
            while True:
                if self.is_running:
                    # Если станок работает, скорость немного колеблется (реалистичность)
                    import random
                    drift = random.randint(-20, 20)
                    self.speed = max(0, min(self.max_speed, self.speed + drift))
                else:
                    # Если стоим, скорость плавно падает до нуля
                    self.speed = max(0, self.speed - 100)

                payload = {
                    "machine_id": self.machine_id,
                    "status": "RUNNING" if self.is_running else "STOPPED",
                    "speed": self.speed
                }
                await websocket.send(json.dumps(payload))
                await asyncio.sleep(1)  # Тик раз в секунду
        except asyncio.CancelledError:
            pass

    async def start(self):
        print(f"Запуск симулятора [{self.machine_id}]. Подключение к {URI}...")
        async for websocket in websockets.connect(URI):
            print(f"[{self.machine_id}] Успешно подключен к бэкенду CloudCollar.")
            telemetry_task = None
            try:
                # Сразу запускаем фоновую отправку телеметрии
                telemetry_task = asyncio.create_task(self.telemetry_loop(websocket))

                # Защищенный цикл обработки команд от сервера/пульта
                async for message in websocket:
                    # Так как сервер вещает в формате "machine_id:json_string", проверяем префикс
                    if ":" in message:
                        prefix, content = message.split(":", 1)
                        # Обрабатываем команду, только если она адресована НАМ или пришла с пульта напрямую
                        if prefix == self.machine_id or prefix == "operator_panel":
                            try:
                                command = json.loads(content)
                                action = command.get("action")

                                if action == "TOGGLE":
                                    self.is_running = not self.is_running
                                    print(f"[{self.machine_id}] Переключение состояния. Активен: {self.is_running}")

                                elif action == "SPEED_UP" and self.is_running:
                                    self.speed = min(self.max_speed, self.speed + 300)
                                    print(f"[{self.machine_id}] Разгон! Текущая базовая скорость: {self.speed}")

                                elif action == "SPEED_DOWN" and self.is_running:
                                    self.speed = max(0, self.speed - 300)
                                    print(f"[{self.machine_id}] Замедление. Текущая базовая скорость: {self.speed}")

                                elif action == "EMERGENCY_STOP":
                                    self.is_running = False
                                    self.speed = 0
                                    print(f"💥 [{self.machine_id}] АВАРИЙНЫЙ ОСТАНОВ!")
                            except json.JSONDecodeError:
                                pass
            except websockets.ConnectionClosed:
                print(f"[{self.machine_id}] Соединение разорвано. Переподключение...")
            finally:
                # Безопасный сброс фоновых задач (теперь строго внутри async def)
                if telemetry_task:
                    telemetry_task.cancel()
                    await asyncio.gather(telemetry_task, return_exceptions=True)
                    telemetry_task = None


if __name__ == "__main__":
    simulator = MachineSimulator(MACHINE_ID)
    try:
        asyncio.run(simulator.start())
    except KeyboardInterrupt:
        print(f"\nСимулятор [{MACHINE_ID}] остановлен оператором.")
