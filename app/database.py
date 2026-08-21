import sqlite3

DB_NAME = "warehouse_core.db"

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_warehouse_db():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS storage_map (
                cell_code TEXT PRIMARY KEY,
                sku TEXT DEFAULT NULL,
                pallet_weight REAL DEFAULT 0.0,
                is_occupied INTEGER DEFAULT 0
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transfer_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                operator_id TEXT,
                action_type TEXT,
                target_cell TEXT,
                sku TEXT,
                weight REAL
            )
        """)
        cursor.execute("SELECT COUNT(*) FROM storage_map")
        if cursor.fetchone() == 0:
            default_cells = [('A1',), ('A2',), ('B1',), ('B2',), ('C1',), ('C2',)]
            cursor.executemany("INSERT INTO storage_map (cell_code) VALUES (?)", default_cells)
            conn.commit()
