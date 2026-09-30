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
from fastapi import FastAPI, HTTPException, Body, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from postmarker.core import requests  # Ваша библиотека requests
from dotenv import load_dotenv  # Подключаем загрузчик .env файлов

# Загрузка переменных окружения
load_dotenv()

# Импорты локальной архитектуры проекта CloudCollar
from app.database import get_db_connection, init_warehouse_db, save_system_log, add_new_warehouse_cell
from app.schemas import ActionRequest, RobotResponse, CellCreate

app = FastAPI(title="CloudCollar Smart Warehouse v2.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Разрешает запросы с любого адреса (включая ваш localhost:5173)
    allow_credentials=True,
    allow_methods=["*"],  # Разрешает любые методы: GET, POST и т.д.
    allow_headers=["*"],  # Разрешает любые заголовки
)

# Инициализируем базу данных при старте сервера
init_warehouse_db()


# Создаем модель для валидации ответа
class RobotResponse(BaseModel):
    status: str
    message: str
    robot_id: str
    payload: dict = {}


# =========================================================================
# 🤖 УМНЫЙ ЭНДПОИНТ ЗАПУСКА AGV (С ПОДДЕРЖКОЙ ЛЮБЫХ ФОРМАТОВ ВЕСА)
# =========================================================================
@app.post("/api/robot/agv/start", response_model=RobotResponse)
async def start_agv(request: dict = Body(...)):  # <-- Принимаем dict вместо ActionRequest, чтобы убрать ошибку 422
    """Принимает выбранную ячейку, SKU и вес из React и сохраняет в SQLite"""

    # 1. Безопасно вытаскиваем SKU. Если пусто или пришла заглушка 'string' — генерируем случайный
    sku_input = request.get("sku")
    sku_id = sku_input if (sku_input and sku_input != "string") else f"SKU-{random.randint(1000, 9999)}"

    # 2. ИСПРАВЛЕНИЕ: Проверяем оба ключа веса — и pallet_weight (от React), и weight (старый макет)
    weight_input = request.get("pallet_weight") if request.get("pallet_weight") is not None else request.get("weight")

    try:
        simulated_weight = float(weight_input) if weight_input else round(random.uniform(10.0, 50.0), 2)
    except (ValueError, TypeError):
        simulated_weight = round(random.uniform(10.0, 50.0), 2)

    # 3. Считываем ячейку назначения
    cell_input = request.get("cell_code")
    target_cell = cell_input if cell_input else "C1"

    try:
        conn = sqlite3.connect("warehouse_core.db")
        cursor = conn.cursor()

        # Записываем в базу именно те данные, которые ввёл пользователь на экране
        cursor.execute("""
                       UPDATE storage_map
                       SET is_occupied   = 1,
                           sku           = ?,
                           pallet_weight = ?
                       WHERE cell_code = ?
                       """, (sku_id, simulated_weight, target_cell))

        # Записываем отчет в transfer_logs для мгновенного отображения в ленте логов
        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'LOAD', ?, ?, ?)
                       """, ("AGV_REACT_PANEL", target_cell, sku_id, simulated_weight))

        conn.commit()
        conn.close()

    except sqlite3.OperationalError as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler: {str(e)}")

    return {
        "status": "success",
        "message": f"AGV-Roboter hat die Zelle {target_cell} erfolgreich с Fracht {sku_id} beladen.",
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
    """Сбрасывает состояние всех ячеек в SQLite (включая C1) в статус FREE"""
    try:
        conn = sqlite3.connect("warehouse_core.db")
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE storage_map
            SET is_occupied = 0,
                sku = NULL,
                pallet_weight = 0.0
        """)
        conn.commit()
        conn.close()
        try:
            save_system_log("SYSTEM", "Warehouse state has been fully reset to initial state.")
        except Exception:
            pass
    except sqlite3.OperationalError as e:
        raise HTTPException(status_code=500, detail=f"Datenbankfehler beim Zurücksetzen: {str(e)}")
    return {"status": "success", "message": "Система склада успешно сброшена. Все ячейки свободны.",
            "robot_id": "SYS_ADMIN", "payload": {}}


# =========================================================================
# 🛸 УМНЫЙ ВЫЗОВ ДРОНА ИЗ REACT ИНТЕРФЕЙСА (ЕДИНСТВЕННЫЙ)
# =========================================================================
@app.post("/api/robot/drone/call", response_model=RobotResponse)
async def call_drone():
    """Обрабатывает нажатие возвращенной кнопки 'DROHNE RUFEN'"""
    simulated_battery = f"{random.randint(70, 100)}%"
    return {
        "status": "success",
        "message": "Inspektionsdrohne wurde erfolgreich gerufen und befindet sich im Anflug.",
        "robot_id": "Drone_Inspector_05",
        "payload": {"battery_level": simulated_battery, "task": "High_Level_Scan"}
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
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code, sku, pallet_weight as weight, is_occupied FROM storage_map")
        rows = cursor.fetchall()
        matrix_data = {}
        for row in rows:
            cell_data = dict(row)
            cell_code = cell_data["cell_code"]
            is_occupied = cell_data["is_occupied"]
            weight = cell_data.get("weight", 0) or 0
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
            dup_cell = duplicate_sku[0] if isinstance(duplicate_sku, tuple) else duplicate_sku.get("cell_code", "A1")
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

        target_cell = row[0] if isinstance(row, tuple) else row.get("cell_code", "C1")
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

        target_cell = row["cell_code"] if not isinstance(row, tuple) else row[0]
        weight = row["pallet_weight"] if not isinstance(row, tuple) else row[1]

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
    await manager.class_connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post("/api/admin/repair-cells")
async def repair_cells():
    """Технический эндпоинт для принудительной разметки ячеек склада."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM storage_map")
        default_cells = [('A1',), ('A2',), ('B1',), ('B2',), ('C1',), ('C2',)]
        cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)
        cursor.execute("INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight, timestamp) VALUES ('SYSTEM_CONTROLLER', 'RESET_WAREHOUSE', 'ALL', 'SYSTEM', 0.0, datetime('now'))")
        conn.commit()
    return {"status": "SUCCESS", "message": "Warehouse storage map successfully initialized!"}


@app.get("/", response_class=HTMLResponse)
async def get_warehouse_dashboard():
    html_content = """<!DOCTYPE html><html><body><h2>Backend Server Working</h2></body></html>"""
    return HTMLResponse(content=html_content)
