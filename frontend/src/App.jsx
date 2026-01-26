import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import VirtualSnackApp from './VirtualSnackApp';
import Return from './components/Return';

function FatalOverlay({ error }) {
  if (!error) return null;
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:999999,
      background:'#fff', color:'#000', padding:16,
      fontSize:14, whiteSpace:'pre-wrap', overflow:'auto'
    }}>
      <div style={{fontWeight:700, marginBottom:8}}>💥 Frontend Crash</div>
      {String(error?.stack || error?.message || error)}
    </div>
  );
}

export default function App() {
  const [err, setErr] = useState(null);

  useEffect(() => {
    const onError = (e) => setErr(e?.error || e?.message || e);
    const onRejection = (e) => setErr(e?.reason || e);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <>
      <FatalOverlay error={err} />
      <BrowserRouter>
        <Routes>
          <Route path="/return" element={<Return />} />
          <Route path="/*" element={<VirtualSnackApp />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}
