import React, { useState } from 'react';

const RobotControlPanel = ({ robots, isOnline, onResetSuccess, selectedCell }) => {
  const [loading, setLoading] = useState({ agv: false, drone: false, reset: false });
  const [log, setLog] = useState('');

  // --- СОСТОЯНИЯ ДЛЯ РУЧНОГО ВВОДА ГРУЗА ---
  const [inputSku, setInputSku] = useState('SKU-6500');
  const [inputWeight, setInputWeight] = useState('12.88');

  // ДИНАМИЧЕСКИЙ АДРЕС БЭКЕНДА: берет IP-адрес текущего хоста (ПК или 192.168.0.112) и подставляет порт 8000
  const backendIp = window.location.hostname;
  const backendBaseUrl = 'https://cloudcollar-backend.onrender.com';

  const handleAction = async (endpoint, robotKey) => {
    if (!isOnline) {
      setLog(`Fehler: Keine Verbindung zum Hauptsystem!`);
      return;
    }

    setLoading(prev => ({ ...prev, [robotKey]: true }));
    setLog(`Befehl für ${robotKey.toUpperCase()} wird gesendet...`);

    try {
      // Используем динамический базовый URL
      const url = robotKey === 'reset'
        ? `${backendBaseUrl}/api/warehouse/${endpoint}`
        : `${backendBaseUrl}/api/robot/${endpoint}`;

      // Создаём тело запроса с параметрами груза и ячейки
      const requestBody = {
        device_id: robotKey === 'agv' ? 'AGV_STARTEN' : robotKey === 'drone' ? 'DROHNE_RUFEN' : 'RESET_BUTTON',
        cell_code: selectedCell || "C1",
        sku: inputSku,
        pallet_weight: parseFloat(inputWeight) || 0
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      const data = await response.json();

      if (response.ok) {
        setLog(`[${data.robot_id || robotKey.toUpperCase()}]: ${data.message}`);

        if (typeof onResetSuccess === 'function') {
          onResetSuccess();
        }
      } else {
        const errorMessage = typeof data.detail === 'object'
          ? JSON.stringify(data.detail)
          : data.detail;

        setLog(`Fehler: ${errorMessage || 'Befehl konnte nicht ausgeführt werden'}`);
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
        <div className="text-xs font-mono text-slate-400 mb-1">
          Ziel-Zelle / Выбрано:{" "}
          <span className={`${selectedCell ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
            {selectedCell ? selectedCell : 'Ничего не выбрано (C1)'}
          </span>
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

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              disabled={loading.agv}
              onClick={() => handleAction('agv/start', 'agv')}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-medium rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-emerald-900/30 text-sm font-mono"
            >
              {loading.agv ? '⏱ AGV LÄUFT...' : '🤖 AGV STARTEN'}
            </button>

            <button
              disabled={loading.drone}
              onClick={() => handleAction('drone/call', 'drone')}
              className="flex-1 py-3 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-medium rounded-xl transition duration-200 active:scale-95 shadow-lg shadow-cyan-900/30 text-sm font-mono"
            >
              {loading.drone ? '⏱ DROHNE FLIEGT...' : '🛸 DROHNE RUFEN'}
            </button>
          </div>

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
