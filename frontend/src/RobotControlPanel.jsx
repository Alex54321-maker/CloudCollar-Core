import { useState } from 'react';

const RobotControlPanel = ({ robots, isOnline, onResetSuccess, selectedCell, onDroneDeliverySuccess }) => {
  const [loading, setLoading] = useState({ agv: false, drone: false, droneProduction: false, reset: false });
  const [log, setLog] = useState('');

  // --- СОСТОЯНИЯ ДЛЯ РУЧНОГО ВВОДА ГРУЗА ---
  const [inputSku, setInputSku] = useState('SKU-6500');
  const [inputWeight, setInputWeight] = useState('12.88');

  // ДИНАМИЧЕСКИЙ АДРЕС БЭКЕНДА: теперь шлем запросы на локальный компьютер
  const backendBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://cloudcollar-backend.onrender.com';
  const handleAction = async (endpoint, robotKey) => {
    if (!isOnline) {
      setLog(`Fehler: Keine Verbindung zum Hauptsystem!`);
      return;
    }

    setLoading(prev => ({ ...prev, [robotKey]: true }));
    setLog(`Befehl для ${robotKey.toUpperCase()} wird gesendet...`);

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


        // Подменяем или берем реальные параметры из инпутов, если бэкенд прислал пустоту
        if (robotKey === 'droneProduction' && typeof onDroneDeliverySuccess === 'function') {
          const fakePayload = {
            sku: inputSku,
            weight_kg: parseFloat(String(inputWeight).replace(',', '.')) || 0
          };
          onDroneDeliverySuccess(fakePayload);
        }

      } else {
        const errorMessage = typeof data.detail === 'object'
          ? JSON.stringify(data.detail)
          : data.detail;

        setLog(`Fehler: ${errorMessage || 'Befehl konnte не выполнен'}`);
      }
    } catch (error) {
      setLog(`Netzwerkfehler: Backend (FastAPI) ist nicht erreichbar`);
    } finally {
      setLoading(prev => ({ ...prev, [robotKey]: false }));
    }
  };

  return (
    <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl max-w-md my-4 shadow-2xl backdrop-blur-md">
      <h3 className="text-sm font-mono font-bold text-emerald-400 mb-4 tracking-widest uppercase">
        ⚡ ROBOTER-STEUERUNG / Управление
      </h3>

      <div className="flex flex-col gap-3 mb-4">
        <div className="text-xs font-mono text-slate-400 flex flex-col gap-1 mb-1">
          <div>
            Abhol-Zelle (AGV) / Откуда:{" "}
            <span className={`${selectedCell ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
              {selectedCell ? selectedCell : 'C1 (По умолчанию)'}
            </span>
          </div>
          <div>
            Zielort / Куда: <span className="text-cyan-400 font-bold">Werk 1 (Цех 1)</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 my-2 p-3 bg-slate-950 border border-slate-800 rounded-xl">
          <label className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Параметры груза / Frachtdaten:</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="bg-slate-900 text-white font-mono text-xs p-2 rounded-lg w-1/2 border border-slate-800 focus:border-emerald-600 outline-none"
              placeholder="SKU-6500"
              value={inputSku}
              onChange={(e) => setInputSku(e.target.value)}
            />
            <input
              type="number"
              step="0.01"
              className="bg-slate-900 text-white font-mono text-xs p-2 rounded-lg w-1/2 border border-slate-800 focus:border-emerald-600 outline-none"
              placeholder="12.88"
              value={inputWeight}
              onChange={(e) => setInputWeight(e.target.value)}
            />
          </div>
        </div>

        {/* БЛОК КНОПОК УПРАВЛЕНИЯ */}
        <div className="flex flex-col gap-2">
          {/* 1. Кнопка AGV */}
          <button
            disabled={loading.agv || !selectedCell || selectedCell.status === 'FREE'}
            onClick={() => handleAction('robot/agv/start', 'agv')}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-emerald-900/30 text-sm font-mono"
          >
            {loading.agv ? '⏱ AGV LÄUFT...' : '🤖 AGV STARTEN'}
          </button>

          {/* 2. Кнопка дрона */}
          <button
            disabled={loading.droneProduction}
            onClick={() => handleAction('robot/drone/production', 'droneProduction')}
            className="w-full py-3 px-4 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-800 text-white font-medium rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-sky-900/30 text-sm font-mono"
          >
            {loading.droneProduction ? '⏱ DROHNE FLIEGT...' : '🛸 DROHNE: LAGER -> PRODUKTIONSHALLE'}
          </button>

          {/* 3. Кнопка RESET */}
          <button
            disabled={loading.reset}
            onClick={() => handleAction('reset', 'reset')}
            className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white font-medium rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-rose-900/30 text-sm font-mono"
          >
            {loading.reset ? '⏱ RESETTING...' : '🚨 SYSTEM RESET'}
          </button>
        </div>
      </div>

      {log && (
        <div className="mt-3 p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {log}
        </div>
      )}
    </div>
  );
};

export default RobotControlPanel;
