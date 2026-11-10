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
      } catch (e) { console.error(e); }
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
        // Мгновенно переключаем экран в режим обработки, не дожидаясь таймера
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
        // Мгновенно сбрасываем параметры на экране на дефолтные
        setStatus('IDLE');
        setRpm(0);
        // Оставляем имя продукта, чтобы React вывел картинку готового болта!
      }
    } catch (error) {
      console.error("Ошибка сброса станка:", error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-mono flex flex-col items-center justify-center">
      <div className="bg-slate-900 border-2 border-cyan-500 p-6 rounded-2xl max-w-md w-full shadow-2xl">
             <h2 className="text-cyan-400 font-bold tracking-widest text-center mb-6">⚡ CNC-DREHMASCHINE // KONTROLLPANEL</h2>

        {/* Экран параметров станка */}
        <div className="bg-black p-4 rounded-xl border border-slate-800 mb-6 space-y-2">
          <p>STATUS: <span className={status === 'PROCESSING' ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}>{status}</span></p>
          <p>SPINDELDREHZAHL: <span className="text-cyan-400 font-bold">{rpm} U/min</span></p>
          {product && <p>WERKSTÜCK: <span className="text-white">{product}</span></p>}
          <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-500">
            <div>VORSCHUB X: <span className="text-cyan-400/80">0.00 mm/U</span></div>
            <div>VORSCHUB Z: <span className="text-cyan-400/80">0.00 mm/U</span></div>
            <div className="col-span-2">WERKZEUG-ID: <span className="text-amber-400/80">T0101 (Drehmeißel)</span></div>
          </div>
        </div>


               {/* КНОПКИ УПРАВЛЕНИЯ */}
        <div className="flex gap-4 mb-6">
          <button onClick={handleStart} disabled={status === 'PROCESSING'} className="w-1/2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white text-xs font-bold rounded-xl uppercase">
            {status === 'PROCESSING' ? '⚙️ Bearbeitung...' : '▶️ Anlagenstart'}
          </button>
          <button onClick={handleReset} className="w-1/2 py-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl uppercase">
            🚨 Reset
          </button>
        </div>


              {status === 'PROCESSING' ? (
          <div className="mt-4 p-4 border border-dashed border-amber-500/50 rounded-xl text-center text-xs text-amber-400">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-current border-t-transparent text-amber-500 rounded-full mb-2"></div>
            <p>Gewindeschneiden... Späne fliegen!</p>
          </div>
        ) : product ? (
          <div className="mt-4 p-4 bg-slate-950 border border-emerald-500/30 rounded-xl text-center">
            <p className="text-[10px] text-emerald-400 uppercase mb-2">Bauteil erfolgreich bearbeitet:</p>
            <img src="/bolt.png" alt="Fertiger Bolzen" className="mx-auto w-32 object-contain filter drop-shadow-[0_0_10px_rgba(16,185,129,0.3)] animate-bounce" />
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-slate-600 uppercase border border-dashed border-slate-800 rounded-xl">Maschine wartet auf Befehl...</div>
        )}

      </div>
    </div>
  );
}
