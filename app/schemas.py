from pydantic import BaseModel

class CellCreate(BaseModel):
    cell_code: str

class RobotActionPayload(BaseModel):
    sku: str
    weight_kg: float
    destination: str

class RobotResponse(BaseModel):
    status: str
    message: str
    robot_id: str
    payload: RobotActionPayload

# Обновляем схему запроса к роботам, добавляя cell_code
class ActionRequest(BaseModel):
    device_id: str
    cell_code: str = "C1"  # Если фронтенд ничего не пришлет, по умолчанию будет C1
    sku: str = "SKU-UNKNOWN"
    weight: float = 0.0
