import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FLU_CONFIG } from './voice/lib/fluConfig';
import './index.css';

// Exponer la configuración real en window para lecturas del panel de ajustes.
window.FLU_CONFIG = FLU_CONFIG;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
