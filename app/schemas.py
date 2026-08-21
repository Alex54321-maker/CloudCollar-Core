from pydantic import BaseModel

class ActionRequest(BaseModel):
    device_id: str
    sku: str = "SKU-UNKNOWN"
    weight: float = 0.0

