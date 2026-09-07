import random
from pydantic import BaseModel
import csv
import datetime
import io
import json
import logging
import os
import random  # Модуль генерации случайного веса и SKU
import re
import sqlite3
import urllib.request
from fastapi import (
    Body,
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import HTMLResponse, StreamingResponse
from postmarker.core import requests  # Ваша библиотека requests
from dotenv import load_dotenv  # ИСПРАВЛЕНО: Подключаем загрузчик .env файловimport sqlite3
from fastapi import APIRouter, HTTPException


# Загрузка переменных окружения (которая вызывала ошибку NameError)
load_dotenv()

# Импорты локальной архитектуры проекта CloudCollar
from app.database import get_db_connection, init_warehouse_db, save_system_log
from app.schemas import ActionRequest  # Схема валидации входящих запросов

app = FastAPI(title="CloudCollar Smart Warehouse v2.5")

# Инициализируем базу данных при старте сервера
init_warehouse_db()


# Создаем модель для валидации ответа
class RobotResponse(BaseModel):
    status: str
    message: str
    robot_id: str
    payload: dict = {}




# ... ваш существующий код, инициализация app и модель RobotResponse ...

@app.post("/api/robot/agv/start", response_model=RobotResponse)
async def start_agv():
    """Запуск робота AGV_Robot_01: генерация груза и запись параметров в SQLite ячейки C1"""
    simulated_weight = round(random.uniform(10.0, 50.0), 2)
    sku_id = f"SKU-{random.randint(1000, 9999)}"

    try:
        # Подключаемся к базе данных
        conn = sqlite3.connect("warehouse_core.db")
        cursor = conn.cursor()

        # Обновляем таблицу по вашему чертежу
        cursor.execute("""
                       UPDATE storage_map
                       SET is_occupied   = 1,
                           sku           = ?,
                           pallet_weight = ?
                       WHERE cell_code = 'C1'
                       """, (sku_id, simulated_weight))

        conn.commit()
        conn.close()

    except sqlite3.OperationalError as e:
        raise HTTPException(status_code=500, detail=f"Ошибка базы данных: {str(e)}")

    return {
        "status": "success",
        "message": f"Робот AGV успешно загрузил ячейку C1 грузом {sku_id}.",
        "robot_id": "AGV_Robot_01",
        "payload": {
            "sku": sku_id,
            "weight_kg": simulated_weight,
            "destination": "Cell_C1"
        }
    }


@app.post("/api/robot/drone/call", response_model=RobotResponse)
async def call_drone():
    """Вызов инспекционного дрона для сканирования верхних ярусов"""
    return {
        "status": "success",
        "message": "Инспекционный дрон успешно вызван на позицию.",
        "robot_id": "Drone_Inspector_05",
        "payload": {
            "battery_level": f"{random.randint(70, 100)}%",
            "task": "High_Level_Scan"
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
    # Безопасное чтение токенов из файла .env
    TOKEN = os.getenv("TELEGRAM_TOKEN")
    CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": message}
    try:
        response = requests.post(url, json=payload, timeout=5)
        if response.status_code != 200:
            print(f"🚨 Telegram API Fehler: {response.text}")
    except Exception as e:
        print(f"Fehler beim Senden an Telegram: {e}")


# --- API ДЛЯ ПОЛУЧЕНИЯ ТЕКУЩЕГО СОСТОЯНИЯ (Для Auto-Sync) ---
@app.get("/api/cells")
async def get_cells_status():
    """Отдает текущее состояние всех ячеек для Auto-Sync с расчетом правильного статуса зоны."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code, sku, pallet_weight as weight, is_occupied FROM storage_map")
        rows = cursor.fetchall()

        cells_list = []
        for row in rows:
            cell_data = dict(row)
            weight = cell_data.get("weight", 0) or 0
            cell_code = cell_data["cell_code"]

            # Рассчитываем правильный статус зоны по весу, если ячейка занята
            if cell_data["is_occupied"]:
                if cell_code == "A2" and weight <= 150.0:
                    cell_data["zone_status"] = "QUARANTINE"
                elif weight > 150.0:
                    cell_data["zone_status"] = "A"
                elif 100.0 <= weight <= 150.0:
                    cell_data["zone_status"] = "B"
                else:
                    cell_data["zone_status"] = "C"
            else:
                cell_data["zone_status"] = "FREE"

            cells_list.append(cell_data)

    return cells_list


# --- API ДЛЯ АВТОНОМНЫХ РОБОТОВ И ДРОНОВ ---

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


@app.post("/api/action/arrow-up", status_code=status.HTTP_200_OK)
async def arrow_up_unload(data: ActionRequest = Body(...)):
    """Стрелка Вверх: Автоматическая приемка товара на склад с защитой от пустых строк из Swagger."""

    # =========================================================================
    # 0. ОЧИСТКА И АВТО-ГЕНЕРАЦИЯ ДАННЫХ
    # =========================================================================
    # Безопасно парсим устройство
    device_id = str(data.device_id)
    if not device_id or device_id == "string":
        device_id = "01"

    # Безопасно парсим вес (обработка чисел и строк-заглушек)
    try:
        current_weight = float(data.weight)
    except (ValueError, TypeError):
        current_weight = 0.0

    if current_weight <= 0.0:
        # Симулируем весы: случайный вес от 10.0 до 220.0 кг
        current_weight = round(random.uniform(10.0, 220.0), 2)

    # Безопасно парсим уникальный SKU
    current_sku = str(data.sku)
    if not current_sku or current_sku == "string" or current_sku == "SKU-UNKNOWN":
        current_sku = f"SKU-{random.randint(1000, 9999)}"

    # =========================================================================
    # 1. ПРОВЕРКА НА ПЕРЕГРУЗ
    # =========================================================================
    if current_weight > 200.0:
        save_system_log(
            level="CRITICAL",
            message=f"KRITISCHES GEWICHT! AGV-Robot {device_id} transportiert {current_weight} kg в зону приемки A",
            cell_id="A"
        )
        print(f"\n[🚨 CRITICAL] Kritisches Gewicht: {current_weight} kg! Log gespeichert.\n")
        send_telegram_alert(
            f"🚨 KRITISCHES GEWICHT! AGV-Robot {device_id} зафиксировал {current_weight} kg!"
        )

    # =========================================================================
    # 2. РАБОТА С БАЗОЙ ДАННЫХ SQLite
    # =========================================================================
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Защита от дубликатов SKU
        cursor.execute("SELECT cell_code FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (current_sku,))
        duplicate_sku = cursor.fetchone()

        if duplicate_sku:
            # Универсальный парсинг для любого формата SQLite (Row или кортеж)
            dup_cell = duplicate_sku["cell_code"] if isinstance(duplicate_sku, dict) or not hasattr(duplicate_sku,
                                                                                                    'keys') else \
            duplicate_sku[0]

            cursor.execute("""
                           INSERT INTO logs (level, message, cell_id)
                           VALUES (?, ?, ?)
                           """, (
                               "WARNING",
                               f"Otkaz AGV_Robot {device_id}: SKU {current_sku} bereits im Lager",
                               dup_cell
                           ))
            conn.commit()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Товар с SKU {current_sku} уже находится в ячейке {dup_cell}!"
            )

        # Определение целевой зоны по весу
        if 100.0 <= current_weight <= 150.0:
            target_zone = "B"
            target_cells = ('B1', 'B2')
        else:
            target_zone = "C"
            target_cells = ('C1', 'C2')

        # 3. Поиск свободной ячейки строго в целевой зоне
        query = "SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code IN (?, ?) LIMIT 1"
        cursor.execute(query, target_cells)
        row = cursor.fetchone()

        is_quarantine = False
        zone_desc = f"Regalzone {target_zone}"

        # 4. АВАРИЙНЫЙ РЕЗЕРВ (Проверяем Карантин А2, если ярусы забиты)
        if not row:
            cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code = 'A2' LIMIT 1")
            row = cursor.fetchone()
            if row:
                is_quarantine = True
                zone_desc = f"Zone {target_zone} - Umgeleitet nach Quarantäne A2"
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Склад полностью переполнен! Свободных ячеек нет."
                )

        # Универсальное извлечение кода ячейки
        target_cell = row["cell_code"] if isinstance(row, dict) or not hasattr(row, 'keys') else row[0]

        # 5. Обновление карты склада в БД
        cursor.execute("""
                       UPDATE storage_map
                       SET sku           = ?,
                           pallet_weight = ?,
                           is_occupied   = 1
                       WHERE cell_code = ?
                       """, (current_sku, current_weight, target_cell))

        # Запись в логи перемещений
        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'LOAD', ?, ?, ?)
                       """, (f"AGV_Robot_{device_id}", target_cell, current_sku, float(current_weight)))
        conn.commit()

    ui_zone_status = "QUARANTINE" if is_quarantine else target_zone

    payload = {
        "event": "LOAD_SUCCESS",
        "device": f"AGV_Robot_{device_id}",
        "cell": target_cell,
        "sku": current_sku,
        "weight": float(current_weight),
        "zone": zone_desc,
        "zone_status": ui_zone_status
    }

    await manager.broadcast(payload)
    return payload


@app.post("/api/action/arrow-down", status_code=status.HTTP_200_OK)
async def arrow_down_pickup(data: ActionRequest):
    """Стрелка Вниз: Экспресс-выдача и доставка груза со склада клиенту с помощью Delivery_Drone_02."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Ищем, в какой ячейке лежит товар с запрашиваемым SKU
        cursor.execute("SELECT cell_code, pallet_weight FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1",
                       (data.sku,))
        row = cursor.fetchone()

        if not row:
            # Если такого товара нет на складе, отдаем 404
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Produkt mit SKU {data.sku} wurde im Lager nicht gefunden или уже доставлен!"
            )

        target_cell = row["cell_code"]
        weight = row["pallet_weight"]

        # 2. Освобождаем ячейку в базе данных (стираем SKU и вес, ставим is_occupied = 0)
        cursor.execute("""
                       UPDATE storage_map
                       SET sku           = NULL,
                           pallet_weight = 0,
                           is_occupied   = 0
                       WHERE cell_code = ?
                       """, (target_cell,))

        # 3. Фиксируем успешную выдачу товара в системных логах (ИСПРАВИЛИ НА 'UNLOAD'!)
        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'UNLOAD', ?, ?, ?)
                       """, (f"Delivery_Drone_{data.device_id}", target_cell, data.sku, weight))
        conn.commit()

    # 4. Формируем payload для мгновенного обновления веб-интерфейса React
    payload = {
        "event": "UNLOAD_SUCCESS",
        "device": f"Delivery_Drone_{data.device_id}",
        "cell": target_cell,
        "sku": data.sku,
        "zone_status": "FREE"  # Возвращаем ячейке нейтральный серый цвет на фронтенде
    }

    await manager.broadcast(payload)
    return payload

# --- ГЕНЕРАЦИЯ ЛОГИСТИЧЕСКОГО МАНИФЕСТА (CSV) ---

    @app.get("/download-log")
    async def download_warehouse_manifest():
        output = io.StringIO()
        # Используем lineterminator='\n' для предотвращения пустых строк в Windows
        writer = csv.writer(output, delimiter=';', lineterminator='\n')

        # Профессиональные международные заголовки для импорта в Excel/BI-системы
        writer.writerow(["ID", "Timestamp", "Operator_ID", "Action_Type", "Target_Cell", "SKU", "Weight_KG"])

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, timestamp, operator_id, action_type, target_cell, sku, weight "
                "FROM transfer_logs ORDER BY id DESC"
            )
            for row in cursor.fetchall():
                # ---- ОЧИСТКА ВЕСА (Пункт 1 сегодняшнего плана) ----
                raw_weight = str(row["weight"]).strip().lower()

                # Удаляем любые случайные буквы (например, 'c', 'кг', 'kg'), оставляя только цифры и точку
                cleaned_weight = re.sub(r'[^0-9.]', '', raw_weight)

                try:
                    # Превращаем в строгое число. Если пустая строка — ставим 0.0
                    weight_float = float(cleaned_weight) if cleaned_weight else 0.0
                except ValueError:
                    weight_float = 0.0

                # Записываем строку с гарантированно числовым весом
                writer.writerow([
                    row["id"],
                    row["timestamp"],
                    row["operator_id"],
                    row["action_type"],
                    row["target_cell"],
                    row["sku"],
                    weight_float  # Теперь это строго число для импорта в Excel!
                ])

        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8-sig")),  # utf-8-sig решает проблему кодировки кириллицы в Excel
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=warehouse_manifest.csv"}
        )

    # --- WEBSOCKET ДЛЯ СИНХРОНИЗАЦИИ С ВЕБ-ПАНЕЛЬЮ ---
    @app.websocket("/ws/warehouse")
    async def websocket_endpoint(websocket: WebSocket):
        await manager.class_connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)

    # --- АДМИНИСТРАТИВНЫЕ СЛУЖЕБНЫЕ ЭНДПОИНТЫ ---
    @app.post("/api/admin/repair-cells")
    async def repair_cells():
        """Технический эндпоинт для принудительной разметки ячеек склада."""
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM storage_map")  # Очищаем старое
            default_cells = [('A1',), ('A2',), ('B1',), ('B2',), ('C1',), ('C2',)]
            cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)

            # Добавляем системную запись в лог об очистке
            cursor.execute(
                "INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight) "
                "VALUES ('SYSTEM_CONTROLLER', 'RESET_WAREHOUSE', 'ALL', 'SYSTEM', 0.0)"
            )
            conn.commit()
        return {"status": "SUCCESS",
                "message": "Warehouse storage map successfully initialized! 6 cells available (A1-C2)."}

    @app.get("/api/warehouse/logs")
    def get_warehouse_logs():
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Выбираем 50 самых свежих логов
            cursor.execute("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    # --- АВТОНОМНЫЙ ЛОКАЛЬНЫЙ ИНТЕРФЕЙС ОПЕРАТОРА (ПОЛНЫЙ И ГОТОВЫЙ) ---


@app.get("/", response_class=HTMLResponse)
async def get_warehouse_dashboard():
    html_content = """
       <!DOCTYPE html>
       <html>
       <head>
           <meta charset="UTF-8">
           <title>Smart Warehouse Control v2.5</title>
           <style>
               body { background: #0f172a; color: #f8fafc; font-family: monospace; padding: 20px; text-align: center; }
               .container { max-width: 800px; margin: 0 auto; }
               .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; max-width: 500px; margin: 30px auto; }
               .cell { background: #1e293b; border: 2px solid #334155; border-radius: 8px; padding: 20px; font-size: 16px; transition: 0.3s; }
               .free { border-color: #10b981; color: #34d399; }
               .occupied { border-color: #f43f5e; color: #fda4af; background: #4c0519; }
               .sku { display: block; font-size: 12px; margin-top: 5px; color: #fff; font-weight: bold; }
               .weight { display: block; font-size: 11px; margin-top: 2px; color: #94a3b8; }
               #log { max-width: 600px; margin: 20px auto; background: #1e293b; padding: 10px; border-radius: 8px; max-h: 150px; overflow-y: auto; text-align: left; font-size: 12px; }
               .btn { display: inline-block; background: #10b981; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 10px; border: none; cursor: pointer; font-family: monospace; }
               .btn-danger { background: #f43f5e; }
               .btn-danger:hover { background: #e11d48; }
               .btn:hover { opacity: 0.9; }
               .controls { max-width: 600px; margin: 0 auto; display: flex; justify-content: center; gap: 10px; }
           </style>
       </head>
       <body>
           <div class="container">
               <h2>🤖 SMART WAREHOUSE CONTROL PANEL v2.5</h2>
               <p>Connection Status: <span id="status" style="color:#f43f5e;">Disconnected</span></p>

               <div class="controls">
                   <a href="/download-log" class="btn">📥 DOWNLOAD CSV MANIFEST</a>
                   <button id="repair-btn" class="btn btn-danger">⚙️ RESET WAREHOUSE SYSTEM</button>
               </div>

               <div class="grid" id="warehouse-grid">
                   <!-- Dynamic rendering occurs via Auto-Sync JS -->
               </div>

               <div id="log"><div style="color:#64748b;">Waiting for fleet telemetry...</div></div>
           </div>

       <script>
       const gridContainer = document.getElementById('warehouse-grid');
       const statusIndicator = document.getElementById('status');
       const repairBtn = document.getElementById('repair-btn');

       // Safe Auto-Sync Data Fetcher (Polls every 1 second for high-precision telemetry)
       async function syncWarehouseData() {
           try {
               const response = await fetch('/api/cells');
               if (response.ok) {
                   const cells = await response.json();

                   // Sort tiers in reverse order (C -> B -> A) so the lightweight tier C stays on top of the dashboard
                   cells.sort((a, b) => b.cell_code.localeCompare(a.cell_code));

                   gridContainer.innerHTML = ''; // Clear old rack rendering

                   cells.forEach(cell => {
                       const cellDiv = document.createElement('div');
                       cellDiv.id = `cell-${cell.cell_code}`;

                       if (cell.is_occupied) {
                           cellDiv.className = 'cell occupied';

                           // --- COLOR ZONING & EMERGENCY QUARANTINE INTEGRATION ---
                           // 1. QUARANTINE (Cell A2 used as emergency backup for lightweight/medium cargo)
                           if (cell.cell_code === 'A2' && cell.weight <= 150.0) {
                               cellDiv.style.backgroundColor = "#faf5ff"; // Light purple background
                               cellDiv.style.color = "#7e22ce";           // Purple text
                               cellDiv.style.border = "2px dashed #7e22ce"; // Dashed border
                               cellDiv.innerHTML = `⚠️ <b>${cell.cell_code} [QUARANTINE]</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} kg</span>`;
                           }
                           // 2. Heavy Cargo Tier A (> 150 kg) - Operated by AGV
                           else if (cell.cell_code.startsWith('A')) {
                               cellDiv.style.backgroundColor = "#fde8e8"; // Soft red background
                               cellDiv.style.color = "#9b1c1c";           // Dark red text
                               cellDiv.style.border = "1px solid #f8b4b4";
                               cellDiv.innerHTML = `🔴 <b>${cell.cell_code} (Heavy)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} kg</span>`;
                           }
                           // 3. Medium Cargo Tier B (100-150 kg)
                           else if (cell.cell_code.startsWith('B')) {
                               cellDiv.style.backgroundColor = "#fef3c7"; // Amber yellow background
                               cellDiv.style.color = "#92400e";           // Brownish-yellow text
                               cellDiv.style.border = "1px solid #fde68a";
                               cellDiv.innerHTML = `🟡 <b>${cell.cell_code} (Medium)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} kg</span>`;
                           }
                           // 4. Lightweight Cargo Tier C (< 100 kg) - Managed by Drones
                           else if (cell.cell_code.startsWith('C')) {
                               cellDiv.style.backgroundColor = "#ecfdf5"; // Emerald green background
                               cellDiv.style.color = "#065f46";           // Dark green text
                               cellDiv.style.border = "1px solid #a7f3d0";
                               cellDiv.innerHTML = `🟢 <b>${cell.cell_code} (Light)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} kg</span>`;
                           }
                       } else {
                           // Neutral styling for an empty storage slot
                           cellDiv.className = 'cell free';
                           cellDiv.style.backgroundColor = "#f3f4f6";
                           cellDiv.style.color = "#9ca3af";
                           cellDiv.style.border = "1px solid #e5e7eb";
                           cellDiv.innerHTML = `<b>${cell.cell_code}</b><br><span class="sku">Available</span>`;
                       }
                       gridContainer.appendChild(cellDiv);
                   });

                   statusIndicator.innerText = "Connected (Auto-Sync: OK)";
                   statusIndicator.style.color = "#10b981";
               } else {
                   throw new Error();
               }
           } catch (error) {
               statusIndicator.innerText = "Server Unreachable";
               statusIndicator.style.color = "#f43f5e";
           }
       }

       // Administrative Reset Button Handler
       repairBtn.addEventListener('click', async () => {
           const confirmed = confirm("WARNING! Are you sure you want to force clear all warehouse storage slots?");
           if (!confirmed) return;

           try {
               const response = await fetch('/api/admin/repair-cells', { method: 'POST' });
               if (response.ok) {
                   alert("Warehouse grid successfully re-initialized!");
                   syncWarehouseData(); // Instant UI update
               } else {
                   alert("Backend error during execution.");
               }
           } catch (error) {
               alert("Network connection failure with backend server.");
           }
       });

       // Run synchronization loop seamlessly without hard page reloads
       setInterval(syncWarehouseData, 1000);
       syncWarehouseData(); // Initial execution
       </script>
       </body>
       </html>
       """
    return HTMLResponse(content=html_content)
