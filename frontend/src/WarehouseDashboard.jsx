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

    // --- 3. СОСТОЯНИЯ ДЛЯ БЕСКОНЕЧНОЙ ПРОКРУТКИ ЛОГОВ ---
    const [realLogs, setRealLogs] = useState([]);       // Массив логов из SQLite
    const [offset, setOffset] = useState(0);            // Смещение для пагинации
    const [hasMore, setHasMore] = useState(true);       // Флаг: есть ли еще данные в БД
    const [isLoadingLogs, setIsLoadingLogs] = useState(false); // Флаг процесса загрузки

    // --- 4. АСИНХРОННАЯ ФУНКЦИЯ ЗАГРУЗКИ ЛОГОВ ПОРЦИЯМИ ---
    const fetchNextLogs = async () => {
        if (isLoadingLogs || !hasMore) return;
        setIsLoadingLogs(true);
        try {
            // Запрос напрямую к запущенному FastAPI (порт 8000)
            const response = await fetch(`http://127.0.0.1:8000/api/warehouse/logs?offset=${offset}&limit=20`);
            if (!response.ok) throw new Error('Ошибка загрузки логов');
            const data = await response.json();

            if (data.length === 0) {
                setHasMore(false); // Если бэкенд пустой, останавливаем запросы
            } else {
                setRealLogs((prev) => [...prev, ...data]); // Приклеиваем логи в конец
                setOffset((prev) => prev + 20);           // Сдвигаем маркер на шаг вперед
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
            const response = await fetch('http://127.0.0.1:8000/api/cells');
            if (response.ok) {
                const data = await response.json();
                setCells(data.cells || {});
                setActiveRobots(data.robots || []);
                setIsOnline(true);
            }
        } catch (err) {
            console.error("Ошибка обновления дашборда:", err);
            setIsOnline(false);
        }
    };

    // --- 6. ЭФФЕКТЫ (EFFECTS) ---
    // Слушатель скролла: срабатывает, когда нижний маяк виден на экране
    useEffect(() => {
        if (inView) {
            fetchNextLogs();
        }
    }, [inView]);

    // Периодическое обновление карты склада и роботов (каждые 5 секунд)
    useEffect(() => {
        fetchDashboardData(); // Первая загрузка при старте
        const interval = setInterval(fetchDashboardData, 5000);
        return () => clearInterval(interval);
    }, []);

    // --- 7. ВЁРСТКА ИНТЕРФЕЙСА (ТАЙЛВИНД СЕТКА) ---
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono selection:bg-emerald-500 selection:text-black">
            {/* Хедер системы */}
            <header className="border-b border-slate-800 pb-4 mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black tracking-wider text-emerald-400">CLOUDCOLLAR // WAREHOUSE OS v2.0</h1>
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
                    <RobotControlPanel robots={activeRobots} isOnline={isOnline} />
                </div>

                {/* КОЛОНКА 2: Интерактивная карта стеллажей */}
                <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col">
                    <div className="border-b border-slate-800 pb-2 mb-4">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400">Layout Matrix / Карта стеллажей</h2>
                    </div>
                    <div className="grid grid-cols-5 gap-2 flex-1 items-center justify-center p-2">
                        {Object.entries(cells).map(([cellId, status]) => (
                            <div
                                key={cellId}
                                className={`aspect-square border flex flex-col items-center justify-center rounded text-[10px] transition-all duration-300 ${
                                    status === 'busy' ? 'bg-rose-950/40 border-rose-800 text-rose-400' :
                                    status === 'reserved' ? 'bg-amber-950/40 border-amber-800 text-amber-400' :
                                    'bg-slate-950 border-slate-800 text-slate-500 hover:border-emerald-800'
                                }`}
                            >
                                <span className="font-bold">{cellId}</span>
                                <span className="text-[8px] opacity-60 uppercase">{status}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* КОЛОНКА 3: Лог-поток Systemprotokoll с Infinite Scroll */}
                <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col h-[600px]">
                    <div className="border-b border-slate-800 pb-2 mb-4 flex justify-between items-center">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400">Systemprotokoll / Логи SQLite</h2>
                        <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">Chrono: ASC</span>
                    </div>

                    {/* Контейнер скролла логов */}
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

                        {/* Индикатор загрузки в процессе получения данных */}
                        {isLoadingLogs && (
                            <div className="text-center py-2 text-slate-500 animate-pulse text-[11px]">
                                Загрузка следующей порции логов...
                            </div>
                        )}

                        {/* НЕВИДИМЫЙ ДАТЧИК-МАЯК ДЛЯ REACTION-INTERSECTION-OBSERVER */}
                        {hasMore && <div ref={ref} className="h-4 bg-transparent w-full" />}

                        {/* Сообщение об окончании логов */}
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
