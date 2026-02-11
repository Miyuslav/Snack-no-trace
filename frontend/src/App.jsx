// frontend/src/App.jsx
import React, { useEffect, useMemo } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";

import GuestApp from "./GuestApp.jsx";
import MamaConsole from "./components/MamaConsole.jsx";
import Return from "./components/Return.jsx";

function RoleRedirect() {
  const location = useLocation();
  const nav = useNavigate();

  const role = useMemo(() => {
    const qs = new URLSearchParams(location.search);
    return qs.get("role"); // "mama" | "guest" | null
  }, [location.search]);

  useEffect(() => {
    if (role === "mama") {
      nav("/mama", { replace: true });
    }
  }, [role, nav]);

  return null;
}

export default function App() {
  return (
    <>
      <RoleRedirect />

      <Routes>
        {/* Stripe return */}
        <Route path="/return" element={<Return />} />

        {/* Mama */}
        <Route path="/mama" element={<MamaConsole />} />

        {/* Guest */}
        <Route path="/" element={<GuestApp />} />
        <Route path="/waiting" element={<GuestApp />} />
        <Route path="/session" element={<GuestApp />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
