import asyncio
import sys
import json
import random
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
                    # Если станок работает и скорость больше нуля, добавляем реалистичный дрифт
                    if self.speed > 0:
                        drift = random.randint(-15, 15)
                        self.speed = max(0, min(self.max_speed, self.speed + drift))
                else:
                    # Если станок выключен, скорость плавно и красиво падает до нуля
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
                    if ":" in message:
                        prefix, content = message.split(":", 1)
                        if prefix == self.machine_id or prefix == "operator_panel":
                            try:
                                command = json.loads(content)
                                action = command.get("action")

                                if action == "TOGGLE":
                                    self.is_running = not self.is_running
                                    # ТЗ: Если станок включают, даем ему стартовые обороты (например, 500)
                                    if self.is_running and self.speed == 0:
                                        self.speed = 500
                                    print(
                                        f"[{self.machine_id}] Состояние изменено. Активен: {self.is_running} (База: {self.speed} RPM)")

                                elif action == "SPEED_UP":
                                    # Защита: разгонять можно только запущенный станок
                                    if self.is_running:
                                        self.speed = min(self.max_speed, self.speed + 300)
                                        print(f"[{self.machine_id}] Разгон! Текущая скорость: {self.speed} RPM")

                                elif action == "SPEED_DOWN":
                                    # Защита: сбрасывать обороты можно только у работающего станка
                                    if self.is_running:
                                        self.speed = max(0, self.speed - 300)
                                        print(f"[{self.machine_id}] Замедление. Текущая скорость: {self.speed} RPM")

                                        # 🎯 Фича: Если оператор затормозил станок кнопкой до 0, переводим статус в STOPPED
                                        if self.speed == 0:
                                            self.is_running = False
                                            print(
                                                f"[{self.machine_id}] Станок полностью остановлен кнопкой замедления.")

                                elif action == "EMERGENCY_STOP":
                                    self.is_running = False
                                    self.speed = 0
                                    print(f"💥 [{self.machine_id}] АВАРИЙНЫЙ ОСТАНОВ!")

                            except json.JSONDecodeError:
                                pass
            except websockets.ConnectionClosed:
                print(f"[{self.machine_id}] Соединение разорвано. Переподключение...")
            finally:
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
