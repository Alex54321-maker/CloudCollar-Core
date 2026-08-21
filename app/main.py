import csv
import io
import urllib.request
import sqlite3
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.responses import StreamingResponse, HTMLResponse
from app.database import init_warehouse_db, get_db_connection
from app.schemas import ActionRequest

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
async def get_cells():
    """Возвращает текущий статус всех ячеек для фронтенд-панели."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT cell_code, sku, pallet_weight, is_occupied FROM storage_map")
        rows = cursor.fetchall()
        return [
            {
                "cell_code": row["cell_code"],
                "sku": row["sku"],
                "weight": row["pallet_weight"],
                "is_occupied": bool(row["is_occupied"])
            } for row in rows
        ]


# --- API ДЛЯ ДРОНОВ И РОБОТОВ ---

@app.post("/api/action/arrow-up", status_code=status.HTTP_200_OK)
async def arrow_up_unload(data: ActionRequest):
    """Стрелка Вверх: Разгрузка фуры дроном Drone_02 и резервирование ячейки."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Защита от дубликатов SKU на складе
        cursor.execute("SELECT cell_code FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (data.sku,))
        duplicate_sku = cursor.fetchone()
        if duplicate_sku:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Товар с SKU {data.sku} уже находится в ячейке {duplicate_sku['cell_code']}!"
            )

        # Поиск первой свободной ячейки
        cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 LIMIT 1")
        row = cursor.fetchone()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Склад полностью заполнен! Нет свободных ячеек для размещения груза."
            )

        target_cell = row["cell_code"]

        cursor.execute("""
                       UPDATE storage_map
                       SET sku           = ?,
                           pallet_weight = ?,
                           is_occupied   = 1
                       WHERE cell_code = ?
                       """, (data.sku, data.weight, target_cell))

        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'UNLOAD', ?, ?, ?)
                       """, (data.device_id, target_cell, data.sku, data.weight))
        conn.commit()

    payload = {"event": "UNLOAD_SUCCESS", "device": data.device_id, "cell": target_cell, "sku": data.sku}
    await manager.broadcast(payload)
    return payload


@app.post("/api/action/arrow-up", status_code=status.HTTP_200_OK)
async def arrow_up_unload(data: ActionRequest):
    """Стрелка Вверх: Умная разгрузка фуры дроном по весовым категориям."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Защита от дубликатов SKU на складе
        cursor.execute("SELECT cell_code FROM storage_map WHERE sku = ? AND is_occupied = 1 LIMIT 1", (data.sku,))
        duplicate_sku = cursor.fetchone()
        if duplicate_sku:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Товар с SKU {data.sku} уже находится в ячейке {duplicate_sku['cell_code']}!"
            )

        # 2. Умное определение целевых ячеек на основе веса паллеты
        if data.weight > 150.0:
            target_prefixes = ('A1', 'A2')
            zone_desc = "Нижний ярус (Тяжелый груз > 150кг)"
        elif 100.0 <= data.weight <= 150.0:
            target_prefixes = ('B1', 'B2')
            zone_desc = "Средний ярус (Средний груз 100-150кг)"
        else:
            target_prefixes = ('C1', 'C2')
            zone_desc = "Верхний ярус (Легкий груз < 100кг)"

        # 3. Поиск первой свободной ячейки строго в выделенной зоне
        query = "SELECT cell_code FROM storage_map WHERE is_occupied = 0 AND cell_code IN (?, ?) LIMIT 1"
        cursor.execute(query, target_prefixes)
        row = cursor.fetchone()

        # Если целевая весовая зона забита, ищем любую ближайшую альтернативу
        if not row:
            cursor.execute("SELECT cell_code FROM storage_map WHERE is_occupied = 0 LIMIT 1")
            row = cursor.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Склад полностью заполнен! Нет свободных ячеек ни в одной зоне."
                )
            zone_desc += " [ПЕРЕНАПРАВЛЕН - Целевая зона занята!]"

        target_cell = row["cell_code"]

        # 4. Обновление карты склада и логов
        cursor.execute("""
                       UPDATE storage_map
                       SET sku           = ?,
                           pallet_weight = ?,
                           is_occupied   = 1
                       WHERE cell_code = ?
                       """, (data.sku, data.weight, target_cell))

        cursor.execute("""
                       INSERT INTO transfer_logs (operator_id, action_type, target_cell, sku, weight)
                       VALUES (?, 'UNLOAD', ?, ?, ?)
                       """, (data.device_id, target_cell, data.sku, data.weight))
        conn.commit()

    payload = {
        "event": "UNLOAD_SUCCESS",
        "device": data.device_id,
        "cell": target_cell,
        "sku": data.sku,
        "zone": zone_desc
    }
    await manager.broadcast(payload)
    return payload

# --- ГЕНЕРАЦИЯ ЛОГИСТИЧЕСКОГО МАНИФЕСТА (CSV) ---
@app.get("/download-log")
async def download_warehouse_manifest():
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow(["ID", "Время", "Робот/Дрон", "Операция", "Ячейка", "Артикул (SKU)", "Вес (кг)"])

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, timestamp, operator_id, action_type, target_cell, sku, weight "
            "FROM transfer_logs ORDER BY id DESC"
        )
        for row in cursor.fetchall():
            writer.writerow(
                [row["id"], row["timestamp"], row["operator_id"], row["action_type"], row["target_cell"], row["sku"],
                 row["weight"]])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
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
                        // ВСТАВЛЕНО СЮДА: Сортируем ярусы задом наперед (C -> B -> A)
                        cells.sort((a, b) => b.cell_code.localeCompare(a.cell_code));
                        
                        gridContainer.innerHTML = ''; // Стираем старую сетку

                        cells.forEach(cell => {
                            const cellDiv = document.createElement('div');
                            cellDiv.id = `cell-${cell.cell_code}`;

                            if (cell.is_occupied) {
                                cellDiv.className = 'cell occupied';
                                cellDiv.innerHTML = `${cell.cell_code}<span class="sku">${cell.sku}</span><span class="weight">${cell.weight} кг</span>`;
                            } else {
                                cellDiv.className = 'cell free';
                                cellDiv.innerHTML = `${cell.cell_code}<span class="sku">Свободно</span>`;
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
