import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import WarehouseDashboard from './WarehouseDashboard';
import CncMachine from './CncMachine';
import HumanHand3D from './HumanHand3D';
import Humanoid3D from './Humanoid3D'; // <-- 1. Импорт

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<WarehouseDashboard />} />
        <Route path="/cnc" element={<CncMachine />} />
        <Route path="/hand" element={<HumanHand3D />} />
        <Route path="/humanoid" element={<Humanoid3D />} /> {/* <-- 2. Маршрут */}
      </Routes>
    </Router>
  );
}

export default App;
