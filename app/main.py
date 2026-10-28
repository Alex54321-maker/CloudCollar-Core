import random
from pydantic import BaseModel
import csv
import datetime
import io
import json
import logging
import os
import re
import sqlite3
from contextlib import asynccontextmanager  # Менеджер для lifespan
from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from postmarker.core import requests
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

# Импорты локальной архитектуры проекта CloudCollar
from app.database import get_db_connection, init_warehouse_db, save_system_log, add_new_warehouse_cell
from app.schemas import ActionRequest, RobotResponse, CellCreate

logger = logging.getLogger("uvicorn.error")


# =========================================================================
# 🌅 АВТОМАТИЧЕСКИЙ LIFESPAN ДЛЯ ИНИЦИАЛИЗАЦИИ СЕТКИ 5x4 (20 ЯЧЕЕК)
# =========================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """При каждом старте сервера гарантированно размечает 20 ячеек в SQLite"""
    try:
        logger.info("🤖 [LOGISTIC OS]: Запуск инициализации базы данных...")
        init_warehouse_db()  # Создаем таблицы, если их нет

        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Очищаем старую разметку, чтобы избавиться от старой сетки из 6 ячеек
            cursor.execute("DELETE FROM storage_map")

            default_cells = []
            for row in ['A', 'B', 'C', 'D']:
                for col in range(1, 6):
                    default_cells.append((f"{row}{col}",))

            cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)
            cursor.execute(
                "INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight, timestamp) "
                "VALUES ('SYSTEM_CONTROLLER', 'RESET_WAREHOUSE', 'ALL', 'SYSTEM', 0.0, datetime('now'))"
            )
            conn.commit()
        logger.info("✅ [LOGISTIC OS]: База успешно инициализирована. Сетка 5x4 (20 ячеек) активна.")
    except Exception as e:
        logger.error(f"🚨 [LOGISTIC OS] Ошибка при старте lifespan: {e}")
    yield


# Инициализируем FastAPI с привязкой к жизненному циклу сервера
app = FastAPI(title="CloudCollar Smart Warehouse v2.5", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Модель для валидации ответа роботов
class RobotResponse(BaseModel):
    status: str
    message: str
    robot_id: str
    payload: dict = {}
# =========================================================================
# 🤖 УМНЫЙ ЭНДПОИНТ ЗАПУСКА AGV (С ПОДДЕРЖКОЙ ЛЮБЫХ ФОРМАТОВ ВЕСА)
# =========================================================================
@app.post("/api/robot/agv/start", response_model=RobotResponse)
async def start_agv(request: dict = Body(...)):
    """Принимает выбранную ячейку, SKU и вес из React и сохраняет в SQLite"""
    sku_input = request.get("sku")
    sku_id = sku_input if (sku_input and sku_input != "string") else f"SKU-{random.randint(1000, 9999)}"

    weight_input = request.get("pallet_weight") if request.get("pallet_weight") is not None else request.get("weight")
    try:
        simulated_weight = float(weight_input) if weight_input else round(random.uniform(10.0, 50.0), 2)
    except (ValueError, TypeError):
        simulated_weight = round(random.uniform(10.0, 50.0), 2)

    cell_input = request.get("cell_code")
    target_cell = cell_input if cell_input else "C1"

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                           UPDATE storage_map
                           SET is_occupied   = 1,
                               sku           = ?,
                               pallet_weight = ?
                           WHERE cell_code = ?
                           """, (sku_id, simulated_weight, target_cell))

            cursor.execute("""
                           INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                           VALUES (?, 'LOAD', ?, ?, ?)
                           """, ("AGV_REACT_PANEL", target_cell, sku_id, simulated_weight))
            conn.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {str(e)}")

    return {
        "status": "success",
        "message": f"AGV-Roboter hat die Zelle {target_cell} erfolgreich mit Fracht {sku_id} beladen.",
        "robot_id": "AGV_Robot_01",
        "payload": {
            "sku": sku_id,
            "weight_kg": simulated_weight,
            "destination": target_cell
        }
    }

# =========================================================================
# 🚨 АДМИНИСТРАТИВНЫЙ СБРОС СИСТЕМЫ СКЛАДА
# =========================================================================
@app.post("/api/warehouse/reset")
async def reset_warehouse():
    """Сбрасывает состояние всех ячеек в SQLite в статус FREE"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE storage_map
                SET is_occupied = 0,
                    sku = NULL,
                    pallet_weight = 0.0
            """)
            conn.commit()
            try:
                save_system_log("SYSTEM", "Warehouse state has been fully reset to initial state.")
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler beim Zurücksetzen: {str(e)}")
    return {"status": "success", "message": "Система склада успешно сброшена. Все ячейки свободны.",
            "robot_id": "SYS_ADMIN", "payload": {}}

# =========================================================================
# 🛸 УМНЫЙ ВЫЗОВ ДРОНА ИЗ REACT ИНТЕРФЕЙСА (СВЯЗАННЫЙ С ЛОГИСТИКОЙ СКЛАДА)
# =========================================================================
@app.post("/api/robot/drone/call", response_model=RobotResponse)
async def call_drone(request: dict = Body(...)):
    """Принимает ячейку забора и отправляет дрон с грузом в Цех 1 (Werk 1), освобождая ячейку"""
    pickup_cell = request.get("cell_code") or request.get("cell")
    if not pickup_cell or pickup_cell == "string":
        pickup_cell = "C1"

    destination = request.get("destination", "Werk 1")
    sku_id = request.get("sku", "SKU-6500")
    weight_input = request.get("pallet_weight", 0.0)

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                           UPDATE storage_map
                           SET is_occupied   = 0,
                               sku           = NULL,
                               pallet_weight = 0.0
                           WHERE cell_code = ?
                           """, (pickup_cell,))

            cursor.execute("""
                           INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                           VALUES (?, 'UNLOAD', ?, ?, ?)
                           """, ("Delivery_Drone_02", pickup_cell, sku_id, weight_input))
            conn.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {str(e)}")

    simulated_battery = f"{random.randint(75, 99)}%"
    return {
        "status": "success",
        "message": f"Drohne hat Fracht {sku_id} aus Zelle {pickup_cell} abgeholt und fliegt zu {destination}.",
        "robot_id": "Delivery_Drone_02",
        "payload": {
            "battery_level": simulated_battery,
            "departure_cell": pickup_cell,
            "destination": destination
        }
    }

# =========================================================================
# 🛸 АВТОМАТИЧЕСКИЙ ДРОН: ИЗ ЛАГЕРА В ПРОДУКЦИОННУЮ ЗОНУ
# =========================================================================
@app.post("/api/robot/drone/production", response_model=RobotResponse)
async def start_drone_to_production(request: dict = Body(...)):
    """Дрон забирает груз из выбранной ячейки склада и переносит в изолированную зону цеха"""
    pickup_cell = request.get("cell_code") or request.get("cell")
    if not pickup_cell or pickup_cell == "string":
        raise HTTPException(status_code=400, detail="Bitte wählen Sie zunächst eine Zelle auf der Karte!")

    try:
        with get_db_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT sku, pallet_weight, is_occupied FROM storage_map WHERE cell_code = ?", (pickup_cell,))
            row = cursor.fetchone()

            if not row or row["is_occupied"] == 0:
                raise HTTPException(status_code=400, detail=f"Zelle {pickup_cell} ist leer! Es gibt nichts für den Drohnenflug.")

            sku_id = row["sku"]
            weight_input = row["pallet_weight"]

            cursor.execute("""
                           UPDATE storage_map
                           SET is_occupied   = 0,
                               sku           = NULL,
                               pallet_weight = 0.0
                           WHERE cell_code = ?
                           """, (pickup_cell,))

            cursor.execute("""
                           INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                           VALUES (?, 'PRODUCTION_DELIVERY', 'PROD_ZONE', ?, ?)
                           """, ("Drone_To_Production", sku_id, weight_input))
            conn.commit()
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {str(e)}")

    return {
        "status": "success",
        "message": f"Drohne_01 hat Fracht {sku_id} ({weight_input} kg) aus Zelle {pickup_cell} erfolgreich in den Produktionsbereich geliefert.",
        "robot_id": "Drohne_01",
        "payload": {
            "sku": sku_id,
            "weight_kg": weight_input,
            "origin": pickup_cell,
            "destination": "Produktionsbereich"
        }
    }
# --- МЕНЕДЖЕР МУЛЬТИ-ПОДКЛЮЧЕНИЙ (WebSocket) ---
class WarehouseConnectionManager:
    def __init__(self):
        self.active_connections = []
    async def class_connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = WarehouseConnectionManager()

def send_telegram_alert(message: str):
    TOKEN = os.getenv("TELEGRAM_TOKEN")
    CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
    url = f"https://telegram.org{TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        response = requests.post(url, json=payload, timeout=5)
        if response.status_code != 200:
            print(f"🚨 Telegram API Fehler: {response.text}")
    except Exception as e:
        print(f"Fehler beim Senden an Telegram: {e}")

@app.get("/api/cells")
async def get_cells_status():
    """Отдает текущее состояние всех ячеек для Auto-Sync"""
    with get_db_connection() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code, sku, pallet_weight, is_occupied FROM storage_map")
        rows = cursor.fetchall()
        matrix_data = {}
        for row in rows:
            cell_code = row["cell_code"]
            is_occupied = row["is_occupied"]
            weight = row["pallet_weight"] or 0.0
            status_str = "occupied" if is_occupied == 1 else "free"
            matrix_data[cell_code] = {
                "status": status_str,
                "pallet_weight": weight
            }
    return matrix_data

@app.post("/api/cells", summary="Add New Warehouse Cell")
def create_cell(cell_data: CellCreate):
    try:
        add_new_warehouse_cell(cell_data.cell_code)
        return {"status": "success", "message": f"Cell {cell_data.cell_code} added successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

@app.post("/api/action/arrow-up", status_code=status.HTTP_200_OK)
async def arrow_up_unload(data: ActionRequest = Body(...)):
    """Стрелка Вверх: Автоматическая приемка товара на склад"""
    device_id = str(data.device_id) if data.device_id and data.device_id != "string" else "01"
    try:
        current_weight = float(data.weight)
    except (ValueError, TypeError):
        current_weight = 0.0

    if current_weight <= 0.0:
        current_weight = round(random.uniform(10.0, 220.0), 2)

    current_sku = str(data.sku) if data.sku and data.sku != "string" and data.sku != "SKU-UNKNOWN" else f"SKU-{random.randint(1000, 9999)}"

    if current_weight > 200.0:
        save_system_log(level="CRITICAL", message=f"KRITISCHES GEWICHT! AGV-Robot {device_id} transportiert {current_weight} kg", cell_id="A")
        send_telegram_alert(f"🚨 KRITISCHES GEWICHT! AGV-Robot {device_id} зафиксировал {current_weight} kg!")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (current_sku,))
        duplicate_sku = cursor.fetchone()

        if duplicate_sku:
            dup_cell = duplicate_sku if isinstance(duplicate_sku, tuple) else duplicate_sku.get("cell_code", "A1")
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Товар с SKU {current_sku} уже в ячейке {dup_cell}!")

        if 100.0 <= current_weight <= 150.0:
            target_zone = "B"
            target_cells = ('B1', 'B2')
        else:
            target_zone = "C"
            target_cells = ('C1', 'C2')

        query = "SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code IN (?, ?) LIMIT 1"
        cursor.execute(query, target_cells)
        row = cursor.fetchone()
        is_quarantine = False
        zone_desc = f"Regalzone {target_zone}"

        if not row:
            cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code = 'A2' LIMIT 1")
            row = cursor.fetchone()
            if row:
                is_quarantine = True
                zone_desc = f"Zone {target_zone} - Umgeleitet nach Quarantäne A2"
            else:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Склад переполнен!")

        target_cell = row if isinstance(row, tuple) else row.get("cell_code", "C1")
        cursor.execute("UPDATE storage_map SET sku = ?, pallet_weight = ?, is_occupied = 1 WHERE cell_code = ?", (current_sku, current_weight, target_cell))
        cursor.execute("INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight) VALUES (?, 'LOAD', ?, ?, ?)", (f"AGV_Robot_{device_id}", target_cell, current_sku, float(current_weight)))
        conn.commit()

    ui_zone_status = "QUARANTINE" if is_quarantine else target_zone
    payload = {"event": "LOAD_SUCCESS", "device": f"AGV_Robot_{device_id}", "cell": target_cell, "sku": current_sku, "weight": float(current_weight), "zone": zone_desc, "zone_status": ui_zone_status}
    await manager.broadcast(payload)
    return payload


@app.post("/api/action/arrow-down", status_code=status.HTTP_200_OK)
async def arrow_down_pickup(data: ActionRequest):
    """Стрелка Вниз: Экспресс-выдача груза клиенту с помощью Delivery_Drone_02."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code, pallet_weight FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (data.sku,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Produkt mit SKU {data.sku} nicht gefunden!")

        target_cell = row["cell_code"] if not isinstance(row, tuple) else row
        weight = row["pallet_weight"] if not isinstance(row, tuple) else row

        cursor.execute("UPDATE storage_map SET sku = NULL, pallet_weight = 0, is_occupied = 0 WHERE cell_code = ?", (target_cell,))
        cursor.execute("INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight) VALUES (?, 'UNLOAD', ?, ?, ?)", (f"Delivery_Drone_{data.device_id}", target_cell, data.sku, weight))
        conn.commit()

    payload = {"event": "UNLOAD_SUCCESS", "device": f"Delivery_Drone_{data.device_id}", "cell": target_cell, "sku": data.sku, "zone_status": "FREE"}
    await manager.broadcast(payload)
    return payload


@app.get("/api/warehouse/logs")
def get_warehouse_logs(offset: int = 0, limit: int = 20):
    """Умный эндпоинт логов для Infinite Scroll"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM transfer_logs ORDER BY id ASC LIMIT ? OFFSET ?", (limit, offset))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    except sqlite3.OperationalError:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM logs ORDER BY id ASC LIMIT ? OFFSET ?", (limit, offset))
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
        except sqlite3.OperationalError:
            return []


@app.websocket("/ws/warehouse")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await manager.class_connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post("/api/admin/repair-cells")
async def repair_cells():
    """Технический эндпоинт для ручной принудительной разметки."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM storage_map")
        default_cells = []
        for row in ['A', 'B', 'C', 'D']:
            for col in range(1, 6):
                default_cells.append((f"{row}{col}",))
        cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)
        conn.commit()
    return {"status": "SUCCESS", "message": "Warehouse storage map successfully initialized with 20 cells (A1-D5)!"}


@app.get("/", response_class=HTMLResponse)
async def get_warehouse_dashboard():
    html_content = """<!DOCTYPE html><html><body><h2>Backend Server Working</h2></body></html>"""
    return HTMLResponse(content=html_content)
