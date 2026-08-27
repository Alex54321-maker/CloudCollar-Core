import csv
import io
import urllib.request
import sqlite3
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.responses import StreamingResponse, HTMLResponse
from app.database import init_warehouse_db, get_db_connection
from app.schemas import ActionRequest
import logging
import re


app = FastAPI(title="CloudCollar Smart Warehouse v2.5")

# Инициализируем базу данных при старте сервера
init_warehouse_db()


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


# --- API ДЛЯ ДРОНОВ И РОБОТОВ ---


# Настройка базового вывода в консоль, если еще не настроена
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


@app.post("/api/action/arrow-up", status_code=status.HTTP_200_OK)
async def arrow_up_unload(data: ActionRequest):
    """Стрелка Вверх: Умная загрузка фуры роботом по ЖЕСТКИМ весовым категориям с Карантином в A2."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Защита от дубликатов SKU на складе
        cursor.execute("SELECT cell_code FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (data.sku,))
        duplicate_sku = cursor.fetchone()
        if duplicate_sku:
            # ЛОГИРОВАНИЕ ОТКАЗА (Дубликат):
            print(
                f"\n[⚠️ 409 CONFLICT] Отказ робота {data.device_id}: SKU {data.sku} уже есть в ячейке {duplicate_sku['cell_code']}\n")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Товар с SKU {data.sku} уже находится в ячейке {duplicate_sku['cell_code']}!"
            )

        # 2. Определение идеальной целевой зоны по весу
        if data.weight > 150.0:
            target_zone = "A"
            target_cells = ('A1', 'A1')
        elif 100.0 <= data.weight <= 150.0:
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
        zone_desc = f"Ярус {target_zone}"

        # Особый случай: если для тяжелого груза ячейка А1 занята, штатно разрешаем ему занять А2
        if not row and target_zone == "A":
            cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code = 'A2' LIMIT 1")
            row = cursor.fetchone()

        # 4. АВАРИЙНЫЙ РЕЗЕРВ: Если родной ярус забит, проверяем Карантин (ячейку A2)
        if not row:
            cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code = 'A2' LIMIT 1")
            row = cursor.fetchone()
            if row:
                is_quarantine = True
                zone_desc = "%s - Направлен в Карантин A2" % target_zone
            else:
                # ЛОГИРОВАНИЕ ОТКАЗА 409 (Переполнение):
                error_msg = f"[🔥 409 CRITICAL] Остановка робота {data.device_id}! Ярус {target_zone} переполнен. Карантинная ячейка A2 также ЗАНЯТА. Груз весом {data.weight} кг отклонен."
                print(f"\n{error_msg}\n")

                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "status": "error",
                        "code": "RACK_OVERFLOW",
                        "message": f"Ярус {target_zone} полностью заполнен. Зона карантина A2 занята. Размещение паллеты ({data.weight} кг) отклонено."
                    }
                )

        target_cell = row["cell_code"]

        # 5. Обновление карты склада в БД
        cursor.execute("""
                       UPDATE storage_map
                       SET sku           = ?,
                           pallet_weight = ?,
                           is_occupied   = 1
                       WHERE cell_code = ?
                       """, (data.sku, data.weight, target_cell))

        # Запись в логи перемещений (Исправлено на 'LOAD', так как робот загружает склад)
        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'LOAD', ?, ?, ?)
                       """, (data.device_id, target_cell, data.sku, float(data.weight)))
        conn.commit()

    ui_zone_status = "QUARANTINE" if is_quarantine else target_zone

    payload = {
        "event": "LOAD_SUCCESS",
        "device": data.device_id,
        "cell": target_cell,
        "sku": data.sku,
        "weight": float(data.weight),
        "zone": zone_desc,
        "zone_status": ui_zone_status
    }

    await manager.broadcast(payload)
    return payload


@app.post("/api/action/arrow-down", status_code=status.HTTP_200_OK)
async def arrow_down_pickup(data: ActionRequest):
    """Стрелка Вниз: Забор груза со склада AGV-роботом и освобождение ячейки."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Ищем, в какой ячейке лежит товар с запрашиваемым SKU
        cursor.execute("SELECT cell_code, pallet_weight FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1",
                       (data.sku,))
        row = cursor.fetchone()

        if not row:
            # Если такого товара нет на складе, отдаем 404 — симулятор поймет, что искать нечего
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Товар с SKU {data.sku} не найден на складе или уже вывезен!"
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

        # 3. Фиксируем успешную выдачу товара в системных логах
        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'LOAD', ?, ?, ?)
                       """, (data.device_id, target_cell, data.sku, weight))
        conn.commit()

    # 4. Формируем payload для мгновенного обновления веб-интерфейса
    payload = {
        "event": "LOAD_SUCCESS",
        "device": data.device_id,
        "cell": target_cell,
        "sku": data.sku,
        "zone_status": "FREE"  # Говорим фронтенду вернуть ячейке нейтральный серый цвет
    }

    await manager.broadcast(payload)
    return payload


# --- ГЕНЕРАЦИЯ ЛОГИСТИЧЕСКОГО МАНИФЕСТА (CSV) ---



@app.get("/download-log")
async def download_warehouse_manifest():
    output = io.StringIO()
    # Используем lineterminator='\n' для предотвращения пустых строк в Windows
    writer = csv.writer(output, delimiter=';', lineterminator='\n')

    # Заголовки на русском, строго соответствующие количеству полей
    writer.writerow(["ID", "Время", "Робот/Дрон", "Операция", "Ячейка", "Артикул (SKU)", "Вес (кг)"])

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
            "VALUES ('ADMIN', 'RESET_WAREHOUSE', 'ALL', 'SYSTEM', 0.0)"
        )
        conn.commit()
    return {"status": "SUCCESS", "message": "Карта склада успешно создана! Доступно 6 ячеек (A1-C2)."}



# --- АВТОНОМНЫЙ ЛОКАЛЬНЫЙ ИНТЕРФЕЙС ОПЕРАТОРА (ОБНОВЛЕННЫЙ) ---
@app.get("/", response_class=HTMLResponse)
async def get_warehouse_dashboard():
    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Warehouse Control v2.5</title>
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
            <p>Статус связи: <span id="status" style="color:#f43f5e;">Disconnected</span></p>

            <div class="controls">
                <a href="/download-log" class="btn">📥 СКАЧАТЬ CSV-ОТЧЕТ</a>
                <button id="repair-btn" class="btn btn-danger">⚙️ СБРОСИТЬ СОСТОЯНИЕ СКЛАДА</button>
            </div>

            <div class="grid" id="warehouse-grid">
                <!-- Динамический рендеринг ячеек происходит через Auto-Sync JS -->
            </div>

            <div id="log"><div style="color:#64748b;">Ожидание запуска симулятора роботов...</div></div>
        </div>

    <script>
    const gridContainer = document.getElementById('warehouse-grid');
    const statusIndicator = document.getElementById('status');
    const repairBtn = document.getElementById('repair-btn');

    // Безотказный Auto-Sync сборщик данных (Опрос раз в 1 секунду вместо WebSockets)
    async function syncWarehouseData() {
        try {
            const response = await fetch('/api/cells');
            if (response.ok) {
                const cells = await response.json();
                
                // Сортируем ярусы задом наперед (C -> B -> A), чтобы легкий C был сверху экрана
                cells.sort((a, b) => b.cell_code.localeCompare(a.cell_code));
                
                gridContainer.innerHTML = ''; // Стираем старую сетку

                cells.forEach(cell => {
                    const cellDiv = document.createElement('div');
                    cellDiv.id = `cell-${cell.cell_code}`;

                    if (cell.is_occupied) {
                        cellDiv.className = 'cell occupied';
                        
                        // --- ИНТЕГРАЦИЯ ЦВЕТОВОГО ЗОНИРОВАНИЯ И КАРАНТИНА ---
                        // 1. КАРАНТИН (ячейка A2, если в ней оказался легкий или средний груз)
                        if (cell.cell_code === 'A2' && cell.weight <= 150.0) {
                            cellDiv.style.backgroundColor = "#faf5ff"; // Нежно-фиолетовый фон
                            cellDiv.style.color = "#7e22ce";           // Фиолетовый текст
                            cellDiv.style.border = "2px dashed #7e22ce"; // Пунктирный бортик
                            cellDiv.innerHTML = `⚠️ <b>${cell.cell_code} [КАРАНТИН]</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} кг</span>`;
                        }
                        // 2. Нижний ярус A (Тяжелые грузы > 150 кг)
                        else if (cell.cell_code.startsWith('A')) {
                            cellDiv.style.backgroundColor = "#fde8e8"; // Кирпично-красный фон
                            cellDiv.style.color = "#9b1c1c";           // Темно-красный текст
                            cellDiv.style.border = "1px solid #f8b4b4";
                            cellDiv.innerHTML = `🔴 <b>${cell.cell_code} (Тяж.)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} кг</span>`;
                        }
                        // 3. Средний ярус B (Средние грузы 100-150 кг)
                        else if (cell.cell_code.startsWith('B')) {
                            cellDiv.style.backgroundColor = "#fef3c7"; // Янтарно-желтый фон
                            cellDiv.style.color = "#92400e";           // Коричнево-желтый текст
                            cellDiv.style.border = "1px solid #fde68a";
                            cellDiv.innerHTML = `🟡 <b>${cell.cell_code} (Сред.)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} кг</span>`;
                        }
                        // 4. Верхний ярус C (Легкие грузы < 100 кг)
                        else if (cell.cell_code.startsWith('C')) {
                            cellDiv.style.backgroundColor = "#ecfdf5"; // Изумрудно-зеленый фон
                            cellDiv.style.color = "#065f46";           // Темно-зеленый текст
                            cellDiv.style.border = "1px solid #a7f3d0";
                            cellDiv.innerHTML = `🟢 <b>${cell.cell_code} (Лег.)</b><br><span class="sku">${cell.sku}</span><br><span class="weight">${cell.weight} кг</span>`;
                        }
                    } else {
                        // Нейтральный стиль для пустой ячейки
                        cellDiv.className = 'cell free';
                        cellDiv.style.backgroundColor = "#f3f4f6";
                        cellDiv.style.color = "#9ca3af";
                        cellDiv.style.border = "1px solid #e5e7eb";
                        cellDiv.innerHTML = `<b>${cell.cell_code}</b><br><span class="sku">Свободно</span>`;
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

    // Интеграция административной кнопки сброса
    repairBtn.addEventListener('click', async () => {
        const confirmed = confirm("ВНИМАНИЕ! Вы действительно хотите принудительно очистить все ячейки склада?");
        if (!confirmed) return;

        try {
            const response = await fetch('/api/admin/repair-cells', { method: 'POST' });
            if (response.ok) {
                alert("Карта склада успешно очищена!");
                syncWarehouseData(); // Мгновенная синхронизация UI
            } else {
                alert("Ошибка выполнения на стороне бэкенда.");
            }
        } catch (error) {
            alert("Сетевая ошибка бэкенда при попытке очистки.");
        }
    });

    // Запускаем фоновый цикл обновления без жесткой перезагрузки всей страницы
    setInterval(syncWarehouseData, 1000);
    syncWarehouseData(); // Первый запуск
</script>
      </body>
    </html>
    """
    return HTMLResponse(content=html_content)
# --- ЭНДПОИНТ ДЛЯ ПОЛНОГО АВТО-ОПРОСА РЕАКТОМ ---
@app.get("/api/warehouse/status")
async def get_full_warehouse_status():
    """Собирает полное состояние склада для React-фронтенда: ячейки, логи и роботов."""
    with get_db_connection() as conn:
        conn.row_factory = sqlite3.Row  # Чтобы данные возвращались в виде словарей
        cursor = conn.cursor()

        # 1. Получаем ячейки
        cursor.execute("SELECT cell_code, sku, pallet_weight as weight, is_occupied FROM storage_map")
        rows = cursor.fetchall()

        cells_dict = {}
        for row in rows:
            cell_data = dict(row)
            weight = cell_data["weight"] or 0.0
            cell_code = cell_data["cell_code"]

            # Маппим статусы бэкенда под стили фронтенда (EMPTY, LOAD, QUARANTINE)
            if not cell_data["is_occupied"]:
                frontend_status = "EMPTY"
            elif cell_code == "A2" and weight > 200.0:
                frontend_status = "QUARANTINE"
            else:
                frontend_status = "LOAD"

            cells_dict[cell_code] = {
                "sku": cell_data["sku"],
                "weight": weight,
                "status": frontend_status
            }

        # 2. Получаем последние 10 логов системы из БД (если у тебя есть таблица системных логов)
        # Если таблицы логов в БД пока нет, отдаем красивую заглушку-запись
        try:
            cursor.execute(
                "SELECT id, log_time as time, log_type as type, message as text FROM logs ORDER BY id DESC LIMIT 10")
            logs_list = [dict(r) for r in cursor.fetchall()]
        except sqlite3.OperationalError:
            # Заглушка, если таблицы логов в SQLite еще нет (сделаем её в Варианте Б)
            import datetime
            logs_list = [
                {"id": 1, "time": datetime.datetime.now().strftime("%H:%M:%S"), "type": "INFO",
                 "text": "🚀 Система мониторинга подключена к SQLite"},
                {"id": 2, "time": datetime.datetime.now().strftime("%H:%M:%S"), "type": "LOAD",
                 "text": f"📊 База данных хранит {len(cells_dict)} ячеек"}
            ]

        # 3. Имитируем статус роботов для панели (или берем из памяти, если они где-то сохраняются)
        robots_list = [
            {"id": "Drone_02", "task": "Мониторинг веса ячеек", "status": "IDLE"},
            {"id": "AGV_Robot_01", "task": "Ожидание команд загрузки", "status": "MOVING"}
        ]

    # Возвращаем идеальный JSON, который разберет наш хук useEffect в React
    return {
        "cells": cells_dict,
        "logs": logs_list,
        "robots": robots_list
    }

