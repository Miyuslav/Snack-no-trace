// frontend/src/App.jsx
import React from "react";
import { Routes, Route } from "react-router-dom";

import VirtualSnackApp from "./VirtualSnackApp.jsx";
import MamaConsole from "./components/MamaConsole.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/mama" element={<MamaConsole />} />
      <Route path="/*" element={<VirtualSnackApp />} />
    </Routes>
  );
}
