import React, { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import RobotControlPanel from './RobotControlPanel';

const WarehouseDashboard = () => {
    // --- 1. ИНИЦИАЛИЗАЦИЯ ДАТЧИКА СКРОЛЛА ---
    const { ref, inView } = useInView({ threshold: 0.1 });

    // --- 2. СОСТОЯНИЯ (STATES) ИНТЕРФЕЙСА ---
    const [cells, setCells] = useState({});
    const [activeRobots, setActiveRobots] = useState([]);
    const [isOnline, setIsOnline] = useState(true);
    const [productionItems, setProductionItems] = useState([]);
    const [selectedCell, setSelectedCell] = useState('');

    // --- 3. СОСТОЯНИЯ ДЛЯ БЕСКОНЕЧНОЙ ПРОКРУТКИ ЛОГОВ ---
    const [realLogs, setRealLogs] = useState([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    // ДИНАМИЧЕСКИЙ АДРЕС БЭКЕНДА
    const backendBaseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://cloudcollar-backend.onrender.com'


    // ЖЕСТКАЯ ГЕНЕРАЦИЯ БУКВЕННО-ЦИФРОВОГО ШАБЛОНА НА СТРОГО 20 ЯЧЕЕК (5x4)
    const defaultCells = (() => {
        const rows = ['A', 'B', 'C', 'D'];
        const cols = ['1', '2', '3', '4', '5'];
        const acc = {};

        rows.forEach(r => {
            cols.forEach(c => {
                const cellId = `${r}${c}`;
                acc[cellId] = { status: 'free', pallet_weight: 0 };
            });
        });
        return acc;
    })();



    // Безопасное слияние дефолта и ответа бэкенда (dict1 | dict2)
    const mergedCells = { ...defaultCells, ...cells };

    // --- 4. АСИНХРОННАЯ ФУНКЦИЯ ЗАГРУЗКИ ЛОГОВ ПОРЦИЯМИ ---
    const fetchNextLogs = async () => {
        if (isLoadingLogs || !hasMore) return;
        setIsLoadingLogs(true);
        try {
            const response = await fetch(`${backendBaseUrl}/api/warehouse/logs?offset=${offset}&limit=20`);
            if (!response.ok) throw new Error('Ошибка загрузки логов');
            const data = await response.json();

            if (data.length === 0) {
                setHasMore(false);
            } else {
                setRealLogs((prev) => [...prev, ...data]);
                setOffset((prev) => prev + 20);
            }
        } catch (err) {
            console.error("Ошибка Infinite Scroll:", err);
        } finally {
            setIsLoadingLogs(false);
        }
    };

    // --- 5. ФУНКЦИЯ ЗАГРУЗКИ ДАННЫХ ДАШБОРДА (КАРТА И РОБОТЫ) ---
    const fetchDashboardData = async () => {
        try {
            const response = await fetch(`${backendBaseUrl}/api/cells`);
            if (response.ok) {
                const data = await response.json();
                setCells(data);
                setIsOnline(true);
            }
        } catch (err) {
            console.error("Ошибка обновления дашборда:", err);
            setIsOnline(false);
        }
    };

    const handleResetSuccess = () => {
        fetchDashboardData();
        setSelectedCell('');
        setProductionItems([]);
    };

    // --- 6. ЭФФЕКТЫ (EFFECTS) ---
    useEffect(() => {
        if (inView) {
            fetchNextLogs();
        }
    }, [inView]);

    useEffect(() => {
        fetchDashboardData();
        const interval = setInterval(fetchDashboardData, 5000);
        return () => clearInterval(interval);
    }, []);
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono selection:bg-emerald-500 selection:text-black">
            {/* Хедер системы */}
            <header className="border-b border-slate-800 pb-4 mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black tracking-wider text-emerald-400">CLOUDCOLLAR // WAREHOUSE OS v2.5</h1>
                    <p className="text-xs text-slate-500 mt-1">Автоматизированный программный комплекс управления логистическим хабом</p>
                </div>
                <div className="flex items-center gap-3 bg-slate-900 px-4 py-2 border border-slate-800 rounded">
                    <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-rose-500 shadow-[0_0_10px_#f43f5e]'}`}></span>
                    <span className="text-xs uppercase tracking-widest">{isOnline ? 'SYSTEM ONLINE' : 'LINK DISCONNECTED'}</span>
                </div>
            </header>

            {/* Трехколоночный кибер-интерфейс */}
            <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* КОЛОНКА 1: Управление роботами */}
                <div className="space-y-6">
                    <RobotControlPanel
                        robots={activeRobots}
                        isOnline={isOnline}
                        selectedCell={selectedCell}
                        cells={mergedCells}
                        onResetSuccess={handleResetSuccess}
                        onDroneDeliverySuccess={(payload) => {
                            // ВОЗВРАЩАЕМ ТВОЮ ОРИГИНАЛЬНУЮ ЛОГИКУ: берем sku и weight_kg
                            setProductionItems(prev => [...prev, {
                                sku: payload.sku,
                                weight: payload.weight_kg,
                                timestamp: new Date().toLocaleTimeString()
                            }]);
                        }}
                    />
                </div>

                {/* КОЛОНКА 2: Интерактивная карта стеллажей */}
                <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col justify-between">
                    <div>
                        <div className="border-b border-slate-800 pb-2 mb-4">
                            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400">Layout Matrix / Карта стеллажей</h2>
                        </div>

                        <div className="grid grid-cols-5 gap-2 p-2">
                            {Object.entries(mergedCells).map(([cellId, cellData]) => {
                                const status = typeof cellData === 'object' ? cellData.status : cellData;
                                const weight = typeof cellData === 'object' ? cellData.pallet_weight : null;
                                const isSelected = selectedCell === cellId;

                                return (
                                    <div
                                        key={cellId}
                                        onClick={() => setSelectedCell(cellId)}
                                        className={`aspect-square border flex flex-col items-center justify-center rounded text-[10px] transition-all duration-300 cursor-pointer ${
                                            isSelected ? 'bg-amber-500/20 border-amber-400 text-amber-300 scale-105 ring-2 ring-amber-500/50' :
                                            status === 'busy' || status === 'occupied' ? 'bg-rose-950/40 border-rose-800 text-rose-400' :
                                            status === 'reserved' ? 'bg-amber-950/40 border-amber-800 text-amber-400' :
                                            'bg-slate-950 border-slate-800 text-slate-500 hover:border-emerald-500 hover:text-slate-300'
                                        }`}
                                    >
                                        <span className="font-bold">{cellId}</span>
                                        <span className="text-[8px] opacity-60 uppercase">{status}</span>
                                        {weight > 0 && (
                                            <span className="text-[9px] text-amber-400 font-mono mt-1 px-1 bg-amber-500/10 rounded border border-amber-500/20 animate-pulse">
                                                ⚖️ {weight} kg
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ИЗОЛИРОВАННАЯ ЗОНА ПРОИЗВОДСТВА */}
                    <div className="mt-6 p-4 bg-sky-950/20 border border-sky-500/30 rounded-xl backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
                                🏭 Produktionsbereich / Цех выгрузки
                            </h3>
                            <span className="text-[9px] bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20 font-mono">
                                Складской списан
                            </span>
                        </div>
                        <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                            {productionItems.length === 0 ? (
                                <div className="text-center py-3 text-[10px] text-slate-600 uppercase tracking-widest border border-dashed border-slate-800 rounded-lg">
                                    Зона пуста. Ждем дрона...
                                </div>
                            ) : (
                                productionItems.map((item, idx) => (
                                    <div key={idx} className="text-[10px] flex justify-between items-center bg-slate-950/80 p-2 border border-slate-800 rounded-lg">
                                        <span className="text-emerald-400 font-bold font-mono">🛸 {item.sku}</span>
                                        <span className="text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">{item.weight} kg</span>
                                        <span className="text-slate-500 font-mono text-[9px]">{item.timestamp}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* КОЛОНКА 3: Лог-поток Systemprotokoll */}
                <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col h-[600px]">
                    <div className="border-b border-slate-800 pb-2 mb-4 flex justify-between items-center">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400">Systemprotokoll / Логи SQLite</h2>
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">Chrono: ASC</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 text-xs scrollbar-thin scrollbar-thumb-slate-800">
                        {realLogs.map((log) => (
                            <div key={log.id} className="p-2 bg-slate-950 border-l-2 border-slate-700 hover:border-emerald-500 rounded-r transition-colors">
                                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                    <span>ID: {log.id} // {log.timestamp}</span>
                                    <span className="uppercase text-slate-400 px-1 bg-slate-900 rounded">{log.level}</span>
                                </div>
                                <p className="text-slate-300 font-sans">{log.message}</p>
                            </div>
                        ))}

                        {isLoadingLogs && (
                            <div className="text-center py-2 text-slate-500 animate-pulse text-[11px]">
                                Загрузка следующей порции логов...
                            </div>
                        )}

                        {hasMore && <div ref={ref} className="h-4 bg-transparent w-full" />}

                        {!hasMore && (
                            <div className="text-center py-4 text-slate-600 border-t border-slate-900 text-[10px] uppercase tracking-widest">
                                Конец протокола логов / Все данные загружены
                            </div>
                        )}
                    </div>
                </div>

            </main>
        </div>
    );
};

export default WarehouseDashboard;
