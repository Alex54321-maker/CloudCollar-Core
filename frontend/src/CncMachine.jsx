import React, { useState, useEffect } from 'react';

export default function CncMachine() {
  const [status, setStatus] = useState('IDLE');
  const [rpm, setRpm] = useState(0);
  const [product, setProduct] = useState(null);
  const backendBaseUrl = 'https://cloudcollar-backend.onrender.com';

  // Опрос состояния станка каждые 2 секунды
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${backendBaseUrl}/api/cnc/status`);
        const data = await res.json();
        setStatus(data.status);
        setRpm(data.rpm);
        setProduct(data.current_product);
      } catch (e) {
        console.error(e);
      }
    };
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      const res = await fetch(`${backendBaseUrl}/api/cnc/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ product: 'Gewindebolzen M10' })
      });

      if (res.ok) {
        setStatus('PROCESSING');
        setRpm(1500);
        setProduct('Gewindebolzen M10');
      }
    } catch (error) {
      console.error("Ошибка запуска станка:", error);
    }
  };

  const handleReset = async () => {
    try {
      const res = await fetch(`${backendBaseUrl}/api/cnc/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        setStatus('IDLE');
        setRpm(0);
      }
    } catch (error) {
      console.error("Ошибка сброса станка:", error);
    }
  };

  const isRunning = status === 'PROCESSING';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-mono flex flex-col items-center justify-center">

      {/* ВЕРХНЯЯ СИГНАЛЬНАЯ БАШНЯ СТАНКА */}
      <div className="flex items-end gap-6 max-w-4xl w-full px-8">
        <div className="flex flex-col items-center">
          <div className="w-6 h-4 bg-rose-950 border border-slate-700 rounded-t-md"></div>
          <div className={`w-6 h-4 border-x border-slate-700 transition-all duration-300 ${isRunning ? 'bg-amber-400 shadow-[0_0_15px_#fbbf24] animate-pulse' : 'bg-amber-950'}`}></div>
          <div className={`w-6 h-4 border border-slate-700 transition-all duration-300 ${!isRunning ? 'bg-emerald-400 shadow-[0_0_15px_#34d399]' : 'bg-emerald-950'}`}></div>
          <div className="w-2 h-6 bg-slate-600"></div>
        </div>

        <div className="flex-1 h-4 bg-slate-800 border-t-2 border-x-2 border-slate-600 rounded-t-xl flex items-center justify-between px-6">
          <span className="text-[10px] text-slate-400 tracking-widest uppercase">CLOUD-COLLAR // CNC-500 TURN</span>
          <span className="text-[10px] text-cyan-500">SINUMERIK 840D sl</span>
        </div>
      </div>

      {/* ОСНОВНОЙ КОРПУС СТАНКА */}
      <div className="bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 border-4 border-slate-700 rounded-2xl max-w-4xl w-full shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">

        <div className="bg-cyan-950/80 border-b-2 border-cyan-500/40 px-6 py-3 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${isRunning ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`}></span>
            <h1 className="text-cyan-400 font-bold tracking-widest text-sm md:text-base">
              ⚡ CNC-DREHMASCHINE // ARBEITSZELLE 01
            </h1>
          </div>
          <div className="text-[11px] bg-black/50 px-3 py-1 rounded border border-slate-700 text-slate-300">
            SCHUTZTÜR: <span className="text-emerald-400 font-bold">VERRIEGELT 🔒</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
          {/* ЛЕВАЯ ЧАСТЬ: СМОТРОВОЕ ОКНО КАМЕРЫ ОБРАБОТКИ */}
          <div className="lg:col-span-7 flex flex-col">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex justify-between">
              <span>Arbeitsraum // Sichtfenster (Panzerglas)</span>
              <span>Kühlmittel: {isRunning ? 'AKTIV 💧' : 'AUS'}</span>
            </div>

            <div className="relative h-64 bg-slate-950 rounded-xl border-4 border-slate-700 shadow-inner overflow-hidden flex items-center">
              <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'radial-gradient(#22d3ee 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
              <div className={`absolute inset-0 transition-opacity duration-500 ${isRunning ? 'bg-amber-500/5' : 'bg-cyan-500/5'}`}></div>

              {/* 1. ШПИНДЕЛЬНАЯ БАБКА */}
              <div className="relative z-10 h-44 w-16 bg-gradient-to-r from-slate-700 to-slate-600 border-r-2 border-slate-500 flex flex-col justify-between py-3 px-1 shadow-xl">
                <div className="text-[8px] text-center text-slate-300 font-bold">SPINDEL</div>
                <div className="w-full h-1 bg-slate-800"></div>
                <div className="w-full h-1 bg-slate-800"></div>
                <div className="text-[8px] text-center text-cyan-400">{rpm}</div>
              </div>

              {/* 2. КУЛАЧКОВЫЙ ПАТРОН */}
              <div className="relative z-10 flex flex-col items-center">
                <div className={`w-8 h-5 bg-slate-400 border border-slate-600 rounded-tr-md transition-transform ${isRunning ? 'animate-pulse' : ''}`}></div>
                <div className="w-10 h-20 bg-gradient-to-b from-slate-500 via-slate-300 to-slate-600 border-y border-slate-400 flex flex-col justify-around py-1">
                  <div className={`h-1 bg-slate-800 w-full ${isRunning ? 'animate-bounce' : ''}`}></div>
                  <div className={`h-1 bg-slate-800 w-full ${isRunning ? 'animate-pulse' : ''}`}></div>
                </div>
                <div className={`w-8 h-5 bg-slate-400 border border-slate-600 rounded-br-md transition-transform ${isRunning ? 'animate-pulse' : ''}`}></div>
              </div>

              {/* 3. ЗАГОТОВКА / БОЛТ */}
              <div className="relative z-10 flex items-center">
                <div className="w-4 h-12 bg-gradient-to-b from-slate-300 via-white to-slate-500 border border-slate-400 rounded-sm"></div>
                <div className="w-28 h-6 bg-gradient-to-b from-slate-400 via-slate-200 to-slate-500 border-y border-slate-400 flex items-center overflow-hidden relative">
                  <div className={`flex gap-1.5 w-full px-1 ${isRunning ? 'animate-pulse' : ''}`}>
                    {[...Array(10)].map((_, i) => (
                      <div key={i} className="w-1 h-6 bg-slate-600/60 -skew-x-12"></div>
                    ))}
                  </div>
                </div>

                {isRunning && (
                  <div className="absolute right-2 -bottom-3 flex items-center justify-center">
                    <span className="w-3 h-3 bg-amber-300 rounded-full animate-ping"></span>
                    <span className="w-2 h-2 bg-orange-500 rounded-full animate-bounce ml-1"></span>
                    <span className="text-amber-400 text-xs animate-spin ml-1">✦</span>
                  </div>
                )}
              </div>

              {/* 4. СУППОРТ И РЕЗЕЦ T0101 */}
              <div
                className={`absolute right-4 bottom-6 z-20 flex flex-col items-start transition-all duration-700 ease-in-out ${
                  isRunning ? '-translate-x-16 -translate-y-12' : 'translate-x-0 translate-y-0'
                }`}
              >
                <div className="w-4 h-4 bg-amber-400 border border-amber-200 rotate-45 -mb-2 -ml-1 shadow-[0_0_8px_#fbbf24]"></div>
                <div className="w-20 h-5 bg-slate-600 border border-slate-400 rounded-r flex items-center justify-center text-[9px] text-white font-bold shadow-lg">
                  T0101
                </div>
                <div className="w-24 h-8 bg-cyan-900 border border-cyan-500/50 rounded-b-md ml-2 flex items-center justify-center text-[8px] text-cyan-300">
                  X/Z-SCHLITTEN
                </div>
              </div>

              {/* Станина */}
              <div className="absolute bottom-0 inset-x-0 h-5 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 border-t border-slate-600 flex items-center justify-between px-4 text-[9px] text-slate-400">
                <span>BETTBAHN // GEHÄRTET</span>
                <span>SPÄNEFÖRDERER ➔</span>
              </div>
            </div>

            {/* ОТСЕК ВЫДАЧИ ГОТОВОЙ ДЕТАЛИ */}
            <div className="mt-4 bg-black/60 border border-slate-800 rounded-xl p-3 flex items-center justify-between min-h-[76px]">
              {isRunning ? (
                <div className="flex items-center gap-3 text-amber-400 text-xs w-full justify-center py-2">
                  <div className="animate-spin w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full"></div>
                  <span>GEWINDESCHNEIDEN LÄUFT... SPÄNE FLIEGEN!</span>
                </div>
              ) : product ? (
                <div className="flex items-center justify-between w-full px-2">
                  <div>
                    <span className="text-[10px] text-emerald-400 uppercase block">✓ Fertigteil im Ausgabefach:</span>
                    <span className="text-sm font-bold text-white">{product}</span>
                  </div>
                  <img
                    src="/bolt.png"
                    alt="Fertiger Bolzen"
                    className="h-12 w-24 object-contain filter drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                  />
                </div>
              ) : (
                <div className="text-center w-full text-xs text-slate-500 uppercase tracking-wider">
                  Ausgabefach leer — Maschine bereit
                </div>
              )}
            </div>
          </div>
          {/* ПРАВАЯ ЧАСТЬ: ПРОМЫШЛЕННАЯ СТОЙКА УПРАВЛЕНИЯ ЧПУ */}
          <div className="lg:col-span-5 bg-slate-950 border-2 border-slate-700 rounded-xl p-4 flex flex-col justify-between shadow-inner">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <span className="text-xs font-bold text-cyan-400">CNC-STEUERPULT</span>
                <span className="text-[10px] text-slate-500">MODE: AUTO</span>
              </div>

              <div className="bg-black p-3.5 rounded-lg border border-cyan-900/60 space-y-2.5 text-xs shadow-inner">
                <div className="flex justify-between">
                  <span className="text-slate-400">STATUS:</span>
                  <span className={isRunning ? 'text-amber-400 font-bold animate-pulse' : 'text-emerald-400 font-bold'}>
                    {status}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">SPINDELDREHZAHL:</span>
                  <span className="text-cyan-400 font-bold">{rpm} U/min</span>
                </div>

                {product && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">PROGRAMM:</span>
                    <span className="text-white">{product}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px] text-slate-400">
                  <div>
                    VORSCHUB X:{' '}
                    <span className="text-cyan-400">{isRunning ? '0.15 mm/U' : '0.00 mm/U'}</span>
                  </div>
                  <div>
                    VORSCHUB Z:{' '}
                    <span className="text-cyan-400">{isRunning ? '0.40 mm/U' : '0.00 mm/U'}</span>
                  </div>
                  <div className="col-span-2">
                    WERKZEUG: <span className="text-amber-400">T0101 (Hartmetall-Drehmeißel)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Befehlsgeber</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleStart}
                  disabled={isRunning}
                  className="py-3.5 px-2 bg-emerald-600 hover:bg-emerald-500 active:translate-y-0.5 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold rounded-lg border-b-4 border-emerald-800 disabled:border-slate-900 uppercase transition-all cursor-pointer"
                >
                  {isRunning ? '⚙️ Läuft...' : '▶️ Start'}
                </button>

                <button
                  onClick={handleReset}
                  className="py-3.5 px-2 bg-rose-600 hover:bg-rose-500 active:translate-y-0.5 text-white text-xs font-bold rounded-lg border-b-4 border-rose-800 uppercase transition-all cursor-pointer"
                >
                  🚨 Reset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* НИЖНЯЯ ОПОРНАЯ ТУМБА СТАНКА */}
        <div className="bg-slate-950 border-t-2 border-slate-800 px-6 py-2 flex justify-between items-center text-[10px] text-slate-500">
          <span>HYDRAULIKDRUCK: 65 BAR</span>
          <span>NOT-AUS-KREIS: OK</span>
        </div>
      </div>
    </div>
  );
}
