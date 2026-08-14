import asyncio
import json
import websockets

# Глобальные переменные состояния станка
spindle_speed = 0
is_motor_on = False


async def send_telemetry(websocket):
    """Фоновая задача: раз в секунду шлет отчет о состоянии станка"""
    global spindle_speed, is_motor_on
    try:
        while True:
            telemetry = {
                "type": "telemetry",
                "is_motor_on": is_motor_on,
                "speed": spindle_speed
            }
            await websocket.send(json.dumps(telemetry))
            await asyncio.sleep(1.0)  # Пауза 1 секунда
    except asyncio.CancelledError:
        pass


async def simulate_machine():
    global spindle_speed, is_motor_on
    uri = "ws://127.0.0.1:8000/ws/control"
    print("[Станок] Попытка подключения к облачному серверу CloudCollar...")

    try:
        async with websockets.connect(uri) as websocket:
            print("[Станок] Подключение установлено! Станок транслирует телеметрию.")

            # Запускаем фоновую отправку телеметрии параллельно приему команд
            telemetry_task = asyncio.create_task(send_telemetry(websocket))

            while True:
                message = await websocket.recv()
                command = json.loads(message)

                # Пропускаем пакеты телеметрии, если сервер переслал их обратно
                if command.get("type") == "telemetry":
                    continue

                action = command.get("action")

                if action == "start":
                    is_motor_on = True
                    spindle_speed = 800
                    print(f"[⚙️ Станок] Двигатель запущен: {spindle_speed} об/мин")

                elif action == "speed_up":
                    if is_motor_on:
                        spindle_speed += 200
                        print(f"[⚙️ Станок] Скорость увеличена до {spindle_speed} об/мин")
                    else:
                        print("[⚠️ Станок] Ошибка: двигатель выключен!")

                elif action == "stop":
                    is_motor_on = False
                    spindle_speed = 0
                    print("[🛑 Станок] АВАРИЙНАЯ ОСТАНОВКА. Обороты: 0")

    except Exception as e:
        print(f"[❌ Станок] Ошибка: {e}")
    finally:
        telemetry_task.cancel()


if __name__ == "__main__":
    asyncio.run(simulate_machine())
