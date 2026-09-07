import React, { useState } from 'react';

// ВАЖНО: Мы убрали вторую строчку импорта, так как файл не должен импортировать сам себя!

export default function RobotControlPanel() {
  const [loading, setLoading] = useState({ agv: false, drone: false });
  const [log, setLog] = useState('');

  const handleAction = async (endpoint, robotKey) => {
    setLoading(prev => ({ ...prev, [robotKey]: true }));
    setLog(`Отправка команды для ${robotKey.toUpperCase()}...`);

    try {
      const response = await fetch(`/api/robot/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      if (response.ok) {
        setLog(`[${data.robot_id}]: ${data.message} (${JSON.stringify(data.payload)})`);
      } else {
        setLog(`Ошибка: ${data.detail || 'Не удалось выполнить команду'}`);
      }
    } catch (error) {
      setLog(`Ошибка сети: бэкенд недоступен`);
    } finally {
      setLoading(prev => ({ ...prev, [robotKey]: false }));
    }
  };

  // МЫ ДОБАВИЛИ ЭТОТ БЛОК RETURN — ОН ОТРИСОВЫВАЕТ КНОПКИ НА ЭКРАНЕ
  return (
    <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl max-w-md my-4 shadow-2xl backdrop-blur-md">
      <h3 className="text-sm font-mono font-bold text-emerald-400 mb-4 tracking-widest uppercase">
        ⚡ Управление Роботизацией
      </h3>

      <div className="flex gap-4 mb-4">
        {/* Кнопка AGV */}
        <button
          onClick={() => handleAction('agv/start', 'agv')}
          disabled={loading.agv}
          className="flex-1 font-mono font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-200
                     bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 hover:shadow-[0_0_15px_rgba(245,158,11,0.4)]
                     disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading.agv ? 'Запуск...' : 'Запустить AGV'}
        </button>

        {/* Кнопка Дрона */}
        <button
          onClick={() => handleAction('drone/call', 'drone')}
          disabled={loading.drone}
          className="flex-1 font-mono font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-200
                     bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500 hover:text-slate-950 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]
                     disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading.drone ? 'Вызов...' : 'Вызвать Дрон'}
        </button>
      </div>

      {/* Консоль статуса команды */}
      <div className="p-3 bg-black/50 border border-slate-800/80 rounded-xl font-mono text-[11px] text-slate-400 min-h-[50px] break-all flex items-start gap-1">
        <span className="text-emerald-500 animate-pulse">&gt;</span>
        <span>{log || 'Ожидание команд оператора...'}</span>
      </div>
    </div>
  );
} // <-- Эта фигурная скобка теперь четко и правильно закрывает всю функцию компонента
