import React, {useState, useEffect} from 'react';
import {Box, Truck, Radio} from 'lucide-react';
import RobotControlPanel from './RobotControlPanel';

export default function WarehouseDashboard() {
    const [cells, setCells] = useState({});
    const [logs, setLogs] = useState([]);
    const [activeRobots, setActiveRobots] = useState([]);
    const [isOnline, setIsOnline] = useState(true);

    const fetchDashboardData = async () => {
        try {
            // Подключаемся к вашему реальному эндпоинту бэкенда
            const response = await fetch('/api/cells');
            if (!response.ok) throw new Error('Ошибка сервера');
            const cellsArray = await response.json();

            // Конвертируем массив из базы в объект-словарь для фронтенда
            const formattedCells = {};
            cellsArray.forEach(cell => {
                let status = 'LOAD';
                if (cell.zone_status === 'FREE' || !cell.is_occupied) {
                    status = 'EMPTY';
                } else if (cell.zone_status === 'QUARANTINE') {
                    status = 'QUARANTINE';
                }

                // Подтягиваем правильные поля: cell_code и weight из вашего FastAPI
                formattedCells[cell.cell_code] = {
                    status: status,
                    sku: cell.sku,
                    weight: cell.weight
                };
            });

            setCells(formattedCells);

            // Логи и роботы для заполнения интерфейса
            setLogs([
                {
                    id: 1,
                    time: new Date().toLocaleTimeString(),
                    type: 'SYS',
                    text: '[🤝 API] Успешная синхронизация со storage_map в реальном времени'
                }
            ]);
            setActiveRobots([
                {id: 'AGV_Robot_01', task: 'SCAN_INBOUND', status: 'MOVING'},
                {id: 'Delivery_Drone_02', task: 'HOLD_OUTBOUND', status: 'IDLE'}
            ]);

            if (!isOnline) setIsOnline(true);
        } catch (err) {
            setIsOnline(false);
            setLogs(prev => [
                {
                    id: Date.now(),
                    time: new Date().toLocaleTimeString(),
                    type: 'CONFLICT',
                    text: '[⚠️ NETWORK ERROR] Потеряна связь с ядром FastAPI'
                },
                ...prev.slice(0, 10)
            ]);
        }
    };

    useEffect(() => {
        fetchDashboardData();
        const interval = setInterval(fetchDashboardData, 2000);
        return () => clearInterval(interval);
    }, [isOnline]);

    // Функция для сочной неоновой стилизации ячеек
    const getCellClass = (status, isHeavyA2) => {
        if (isHeavyA2) {
            return 'bg-red-950/40 border-red-500 text-red-200 shadow-[0_0_25px_rgba(239,68,68,0.4)] animate-pulse ring-2 ring-red-500';
        }
        switch (status) {
            case 'LOAD':
                return 'bg-emerald-950/30 border-emerald-500/70 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)]';
            case 'QUARANTINE':
                return 'bg-amber-950/30 border-amber-500 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse';
            case 'EMPTY':
                return 'bg-slate-900/40 border-slate-800 text-slate-500';
            default:
                return 'bg-slate-900/60 border-slate-700 text-slate-300';
        }
    };

    return (
        <div
            className="p-6 max-w-7xl mx-auto bg-slate-950 text-slate-100 min-h-screen font-mono selection:bg-blue-500 selection:text-white">

            {/* Шапка Кибер-Терминала */}
            <div
                className="flex justify-between items-center mb-6 bg-slate-900/60 border border-slate-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl">
                <div>
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-blue-500 animate-ping"></span>
                        <h1 className="text-2xl font-black tracking-wider bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            CLOUDCOLLAR OPERATOR v2.5
                        </h1>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest">Матрица распределения грузов
                        автономного склада</p>
                </div>

                <div
                    className={`flex items-center gap-2 border px-4 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${
                        isOnline
                            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                            : 'bg-rose-500/10 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                    }`}>
                    <Radio className={`w-4 h-4 ${isOnline ? 'animate-pulse text-emerald-400' : 'text-rose-400'}`}/>
                    {isOnline ? 'SYS_ONLINE' : 'CORE_OFFLINE'}
                </div>
            </div>

            {/* ========================================================================= */}
            {/* ВСТРОЕННЫЙ МОДУЛЬ УПРАВЛЕНИЯ РОБОТАМИ (Добавлен между шапкой и сеткой) */}
            <div className="mb-6">
                <RobotControlPanel/>
            </div>
            {/* ========================================================================= */}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* КАРТА СТЕЛЛАЖЕЙ */}
                <div
                    className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl backdrop-blur-md shadow-2xl flex flex-col justify-between">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Box className="w-4 h-4 text-blue-400"/> Сетка physical локаций
                    </h2>

                    <div className="grid grid-cols-2 gap-4 flex-grow content-start">
                        {Object.entries(cells).map(([cellId, cellData]) => {
                            const isHeavyA2 = cellId === 'A2' && cellData.weight > 150;

                            return (
                                <div
                                    key={cellId}
                                    className={`border rounded-xl p-5 flex flex-col justify-between transition-all duration-500 relative overflow-hidden group hover:scale-[1.01] ${getCellClass(cellData.status, isHeavyA2)}`}
                                >
                                    {/* Сетка чертежа */}
                                    <div
                                        className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>

                                    <div className="flex justify-between items-center font-bold z-10">
                                        <span className="text-xl text-white tracking-wider">{cellId}</span>
                                        <span
                                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${
                                                isHeavyA2 ? 'bg-red-500/20 border-red-400 text-red-300' :
                                                    cellData.status === 'LOAD' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'
                                            }`}>
                    {isHeavyA2 ? 'CRIT_WEIGHT' : cellData.status}
                  </span>
                                    </div>

                                    <div className="mt-4 z-10">
                                        {cellData.sku ? (
                                            <>
                                                <div
                                                    className="text-sm font-bold text-slate-200 tracking-wide font-sans truncate">{cellData.sku}</div>
                                                <div className="text-md font-extrabold text-white mt-1">
                                                    {cellData.weight} <span
                                                    className="text-xs text-slate-500 font-normal">кг</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-xs italic text-slate-600 tracking-wider">ЛОКАЦИЯ
                                                СВОБОДНА</div>
                                        )}
                                    </div>

                                    {isHeavyA2 && (
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-red-600 to-rose-600 text-[10px] text-center font-black text-black py-0.5 uppercase tracking-widest z-10 shadow-lg">
                                            ⚠️ КРИТИЧЕСКИЙ ВЕС В ЗОНЕ ⚠️
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {Object.keys(cells).length === 0 && (
                            <div
                                className="col-span-2 text-center py-20 text-slate-600 italic tracking-widest uppercase text-xs animate-pulse">
                                Считывание матрицы хранения...
                            </div>
                        )}
                    </div>
                </div>

                {/* ТЕЛЕМЕТРИЯ РОБОТОВ И ЛОГИ */}
                <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl backdrop-blur-md shadow-2xl">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Truck className="w-4 h-4 text-purple-400"/> Телеметрия юнитов
                    </h2>
                    <div className="space-y-3">
                        {activeRobots.map((robot) => (
                            <div key={robot.id}
                                 className="p-4 bg-slate-950/60 border border-slate-800/60 rounded-xl flex justify-between items-center group hover:border-slate-700 transition-colors">
                                <div>
                                    <div className="font-bold text-sm text-slate-200 tracking-wide">{robot.id}</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">TASK: {robot.task}</div>
                                </div>
                                <span className={`text-[10px] px-2.5 py-1 rounded-md font-bold tracking-widest border ${
                                    robot.status === 'MOVING'
                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 animate-pulse shadow-[0_0_10px_rgba(16 Prompt_85,247,0.1)]'
                                        : 'bg-slate-900 border-slate-800 text-slate-500'
                                }`}>
                {robot.status}
              </span>
                            </div>
                        ))}
                    </div>

                    {/* КОНСОЛЬ СИСТЕМНЫХ ЛОГОВ */}
                    <div
                        className="mt-6 border border-slate-800 bg-slate-950/80 rounded-xl p-4 font-mono text-xs h-48 overflow-y-auto">
                        <div
                            className="text-slate-500 border-b border-slate-900 pb-2 mb-2 uppercase tracking-widest text-[10px]">Системный
                            протокол
                        </div>
                        {logs.map((log) => (
                            <div key={log.id} className="mb-1 text-slate-300">
                                <span className="text-slate-600">[{log.time}]</span> {log.text}
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}