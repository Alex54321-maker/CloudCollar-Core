import time
import random
import requests

# Адрес нашего FastAPI сервера
SERVER_URL = "http://127.0.0.1:8000"

# Пул тестовых артикулов для симуляции оборота склада
SKU_POOL = ["BOX-101-OK", "CARGO-404-NFT", "PALLET-777-VIP", "GEAR-99-PRO", "PART-55-MINI"]


def simulate_drone_unload():
    """Имитация работы Дрона-разгрузчика (Стрелка Вверх)"""
    sku = random.choice(SKU_POOL)
    weight = round(random.uniform(50.0, 250.0), 1)

    payload = {
        "device_id": "Drone_02",
        "sku": sku,
        "weight": weight
    }

    try:
        response = requests.post(f"{SERVER_URL}/api/action/arrow-up", json=payload)

        # Если сервер вернул ошибку (например, склад полон или SKU дублируется)
        if response.status_code != 200:
            error_detail = response.json().get("detail", "Неизвестная ошибка")
            print(f"🚛 [ДРОН]: Сбой разгрузки (Код {response.status_code}) ❌ {error_detail}")
            return None

        data = response.json()
        print(f"🛸 [ДРОН]: Разгрузил фуру! Товар {data['sku']} ({weight} кг) отправлен в ячейку {data['cell']} ✅")
        return sku

    except requests.exceptions.RequestException as e:
        print(f"⚠️ Ошибка связи с сервером у Дрона: {e}")
    except Exception as e:
        print(f"⚠️ Непредвиденная ошибка у Дрона: {e}")
    return None


def simulate_agv_picking(sku):
    """Имитация работы напольного робота-погрузчика AGV (Стрелка Вниз)"""
    if not sku:
        return

    payload = {
        "device_id": "AGV_Robot_01",
        "sku": sku
    }

    try:
        time.sleep(2)  # Робот спокойно едет к стеллажу
        response = requests.post(f"{SERVER_URL}/api/action/arrow-down", json=payload)

        # Если товар не найден на складе
        if response.status_code != 200:
            error_detail = response.json().get("detail", "Неизвестная ошибка")
            print(f"🤖 [AGV-РОБОТ]: Ошибка комплектации (Код {response.status_code}) ❌ {error_detail}")
            return

        data = response.json()
        print(f"📦 [AGV-РОБОТ]: Забрал товар {data['sku']} из ячейки {data['cell']} и повез к доку! 🚚")

    except requests.exceptions.RequestException as e:
        print(f"⚠️ Ошибка связи с сервером у AGV: {e}")
    except Exception as e:
        print(f"⚠️ Непредвиденная ошибка у AGV: {e}")


if __name__ == "__main__":
    print("🚀 Автоматический симулятор роботов Smart Warehouse переведен в ШТАТНЫЙ РЕЖИМ!")
    print("Для остановки нажмите Ctrl + C в терминале\n" + "=" * 50)

    while True:
        # 1. Дрон берет паллету и загружает в свободную ячейку
        active_sku = simulate_drone_unload()
        time.sleep(3)

        # 2. Робот AGV едет и забирает этот же SKU со склада
        if active_sku:
            simulate_agv_picking(active_sku)

        print("-" * 50)
        time.sleep(4)
