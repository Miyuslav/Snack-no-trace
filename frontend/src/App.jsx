import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import VirtualSnackApp from './VirtualSnackApp';
import Return from './components/Return';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/return" element={<Return />} />
        <Route path="/*" element={<VirtualSnackApp />} />
      </Routes>
    </BrowserRouter>
  );
}
