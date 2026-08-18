import asyncio
import json
import websockets


async def send_commands():
    # Эндпоинт изменен на /ws/control согласно вашей архитектуре
    uri = "ws://127.0.0.1:8000/ws/control"
    print("[Пульт] Подключение к облаку CloudCollar...")

    try:
        async with websockets.connect(uri) as websocket:
            print("[Пульт] Вы вошли в систему как Облачный Воротничок!")
            print("==================================================")
            print("Доступные команды управления:")
            print("1 - Запустить двигатель станка (Команда 'start')")
            print("2 - Увеличить скорость на 200 об/мин (Команда 'speed_up')")
            print("3 - АВАРИЙНАЯ ОСТАНОВКА СТАНКА (Команда 'stop')")
            print("0 - Выйти из пульта управления")
            print("==================================================")

            while True:
                choice = input("\nВведите номер команды: ").strip()

                if choice == "1":
                    payload = {"action": "start"}
                elif choice == "2":
                    payload = {"action": "speed_up"}
                elif choice == "3":
                    payload = {"action": "stop"}
                elif choice == "0":
                    print("[Пульт] Сессия управления завершена.")
                    break
                else:
                    print("[⚠️] Неверный ввод, выберите цифру от 0 до 3.")
                    continue

                # ИСПРАВЛЕНО: используем метод .send() вместо несуществующего .send_text()
                await websocket.send(json.dumps(payload))
                print(f"[📡 Пульт] Команда отправлена в облако: {payload}")

                await asyncio.sleep(0.1)

    except Exception as e:
        print(f"[❌ Пульт] Ошибка связи с сервером: {e}")


if __name__ == "__main__":
    asyncio.run(send_commands())
