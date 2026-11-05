import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WarehouseDashboard from './WarehouseDashboard';
import CncMachine from './CncMachine'; // Чистый дефолтный импорт, без фигурных скобок

function App() {
  return (
    <Router>
      <Routes>
        {/* Главный экран: Карта цифрового двойника склада 10x10 */}
        <Route path="/" element={<WarehouseDashboard />} />

        {/* Виртуальный экран: Автономный пульт ЧПУ-станка */}
        <Route path="/cnc" element={<CncMachine />} />
      </Routes>
    </Router>
  );
}

export default App;
