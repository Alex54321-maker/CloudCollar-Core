import sqlite3

DB_NAME = "warehouse_core.db"


def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_warehouse_db():
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Таблица карты склада
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS storage_map
                       (
                           cell_code
                           TEXT
                           PRIMARY
                           KEY,
                           sku
                           TEXT
                           DEFAULT
                           NULL,
                           pallet_weight
                           REAL
                           DEFAULT
                           0.0,
                           is_occupied
                           INTEGER
                           DEFAULT
                           0
                       )
                       """)

        # 2. Таблица логов перемещений
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS transfer_logs
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           timestamp
                           DATETIME
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           operator_id
                           TEXT,
                           action_type
                           TEXT,
                           target_cell
                           TEXT,
                           sku
                           TEXT,
                           weight
                           REAL
                       )
                       """)

        # 3. Таблица системных алертов и логов
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS logs
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           timestamp
                           DATETIME
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           level
                           TEXT
                           NOT
                           NULL, -- INFO, WARNING, CRITICAL
                           message
                           TEXT
                           NOT
                           NULL, -- Текст алертов
                           cell_id
                           TEXT  -- Идентификатор ячейки
                       )
                       """)

        # Инициализация дефолтных ячеек (временная очистка при перезапуске для тестов)
        cursor.execute("DELETE FROM storage_map")

        cursor.execute("SELECT COUNT(*) FROM storage_map")
        if cursor.fetchone()[0] == 0:
            default_cells = [('A1',), ('A2',), ('B1',), ('B2',), ('C1',), ('C2',)]
            cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)
            conn.commit()


def save_system_log(level: str, message: str, cell_id: str = None):
    """
    Безопасно записывает новый системный лог (алерт) в БД
    и строго удерживает размер таблицы в пределах 50 последних записей.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Записываем новый лог через безопасные кортежи (?, ?, ?)
        cursor.execute(
            """
            INSERT INTO logs (level, message, cell_id)
            VALUES (?, ?, ?);
            """,
            (level, message, cell_id)
        )

        # 2. Авто-очистка: удаляем всё, что не входит в ТОП-50 самых свежих ID
        cursor.execute(
            """
            DELETE
            FROM logs
            WHERE id NOT IN (SELECT id
                             FROM logs
                             ORDER BY id DESC
                LIMIT 50
                );
            """
        )

        conn.commit()
