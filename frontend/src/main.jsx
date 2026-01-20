import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import VirtualSnackApp from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode は一旦外す
  <VirtualSnackApp />
);
