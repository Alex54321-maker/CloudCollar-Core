import { useState } from 'react';

const RobotControlPanel = ({ robots, isOnline, onResetSuccess, selectedCell, cells = {}, onDroneDeliverySuccess, onAgvSuccess }) => {
  const [loading, setLoading] = useState({ agv: false, drone: false, droneProduction: false, reset: false });
  const [log, setLog] = useState('');

  // --- СОСТОЯНИЯ ДЛЯ РУЧНОГО ВВОДА ГРУЗА ---
  const [inputSku, setInputSku] = useState('SKU-6500');
  const [inputWeight, setInputWeight] = useState('12.88');

  // ДИНАМИЧЕСКИЙ АДРЕС БЭКЕНДА
  const backendBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
     ? 'http://localhost:8000'
    : 'https://cloudcollar-backend.onrender.com';

  // ВЫЧИСЛЯЕМ СТАТУС ВЫБРАННОЙ ЯЧЕЙКИ (Принудительно переводим ключ в строку)
  const cellKey = selectedCell ? String(selectedCell) : '';
  const currentCellData = cells[cellKey];

  const rawStatus = typeof currentCellData === 'object' ? currentCellData.status : currentCellData;

  // Безопасно переводим в нижний регистр
  const cellStatus = rawStatus ? String(rawStatus).toLowerCase() : '';

  // Для AGV: кнопка заблокирована, если ячейка ЗАНЯТА или не выбрана
  const isAgvDisabled = !cellKey || cellStatus === 'occupied' || cellStatus === 'busy';

  // Для Дрона: кнопка заблокирована, если ячейка ПУСТАЯ или не выбрана
  const isDroneDisabled = !cellKey || cellStatus === 'free' || cellStatus === '';
  const handleAction = async (endpoint, robotKey) => {
    if (!isOnline) {
      setLog(`Fehler: Keine Verbindung zum Hauptsystem!`);
      return;
    }

    setLoading(prev => ({ ...prev, [robotKey]: true }));
    setLog(`Befehl für ${robotKey.toUpperCase()} wird gesendet...`);

    try {
      const url = robotKey === 'reset'
        ? `${backendBaseUrl}/api/warehouse/${endpoint}`
        : `${backendBaseUrl}/api/${endpoint}`;

      const requestBody = {
        device_id: robotKey === 'agv' ? 'AGV_STARTEN' : robotKey === 'droneProduction' ? 'DROHNE_PRODUCTION' : 'RESET_BUTTON',
        cell_code: selectedCell || "C1",
        destination: robotKey === 'droneProduction' ? 'Produktionshalle' : 'Logistikhub',
        sku: inputSku,
        pallet_weight: parseFloat(String(inputWeight).replace(',', '.')) || 0
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data = await response.json();

      if (response.ok) {
        setLog(`[${data.robot_id || robotKey.toUpperCase()}]: ${data.message}`);

        if (robotKey === 'reset' && typeof onResetSuccess === 'function') {
          onResetSuccess();
        }

        // МГНОВЕННЫЙ КИШ-МИШ КАРТЫ СРАЗУ ПОСЛЕ AGV
        if (robotKey === 'agv' && typeof onAgvSuccess === 'function') {
          onAgvSuccess();
        }

        if (robotKey === 'droneProduction' && typeof onDroneDeliverySuccess === 'function') {
          const fakePayload = {
            sku: inputSku,
            weight_kg: parseFloat(String(inputWeight).replace(',', '.')) || 0
          };
          onDroneDeliverySuccess(fakePayload);
        }

      } else {
        setLog(`Fehler: ${data.detail || 'Befehl fehlgeschlagen'}`);
      }
    } catch (error) {
      setLog(`Netzwerkfehler: Бэкенд недоступен`);
    } finally {
      setLoading(prev => ({ ...prev, [robotKey]: false }));
    }
  };

  return (
    <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl max-w-md my-4 shadow-2xl">
      <h3 className="text-sm font-mono font-bold text-emerald-400 mb-4 tracking-widest uppercase">
        ⚡ ROBOTER-STEUERUNG / Управление
      </h3>

      <div className="flex flex-col gap-3 mb-4">
        <div className="text-xs font-mono text-slate-400 flex flex-col gap-1 mb-1">
          <div>
            Abhol-Zelle / Откуда:{" "}
            <span className={`${selectedCell ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
              {selectedCell ? `Ячейка №${selectedCell} (${cellStatus})` : 'Выберите ячейку на карте'}
            </span>
          </div>
          <div>
            Zielort / Куда: <span className="text-cyan-400 font-bold">Werk 1 (Цех 1)</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 my-2 p-3 bg-slate-950 border border-slate-800 rounded-xl">
          <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Параметры груза:</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="bg-slate-900 text-white font-mono text-xs p-2 rounded-lg w-1/2 border border-slate-800 outline-none"
              value={inputSku}
              onChange={(e) => setInputSku(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              className="bg-slate-900 text-white font-mono text-xs p-2 rounded-lg w-1/2 border border-slate-800 outline-none"
              value={inputWeight}
              onChange={(e) => setInputWeight(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            disabled={loading.agv || isAgvDisabled}
            onClick={() => handleAction('robot/agv/start', 'agv')}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium rounded-xl text-sm font-mono"
          >
            {loading.agv ? '⏱ AGV LÄUFT...' : '🤖 AGV STARTEN'}
          </button>

          <button
            disabled={loading.droneProduction || isDroneDisabled}
            onClick={() => handleAction('robot/drone/production', 'droneProduction')}
            className="w-full py-3 px-4 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium rounded-xl text-sm font-mono"
          >
            {loading.droneProduction ? '⏱ DROHNE FLIEGT...' : '🛸 DROHNE: LAGER -> PRODUKTIONSHALLE'}
          </button>

          <button
            disabled={loading.reset}
            onClick={() => handleAction('reset', 'reset')}
            className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white font-medium rounded-xl text-sm font-mono"
          >
            {loading.reset ? '⏱ RESETTING...' : '🚨 SYSTEM RESET'}
          </button>
        </div>
      </div>

      {log && (
        <div className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-300 max-h-32 overflow-y-auto">
          {log}
        </div>
      )}
    </div>
  );
};

export default RobotControlPanel;
