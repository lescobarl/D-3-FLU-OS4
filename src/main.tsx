import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { FLU_CONFIG } from './voice/api/config'
import { configureSessionSink, createHttpSessionSink, disableSessionRecorder, enableSessionRecorder } from './voice/api/sessionLog';
import { logCaughtError } from './lib/caughtError';
import {
    DEV_VALIDATION_CHANNEL,
    DEV_VALIDATION_PARAM,
    runDevValidationCommand,
} from './lib/devValidationReset';
import './index.css';

// Declaración global del tipo de window.FLU_CONFIG (asignado abajo).
declare global {
    interface Window {
        FLU_CONFIG?: typeof FLU_CONFIG;
    }
}

// Solo en desarrollo: la app importa FLU_CONFIG directamente (no hay lectores de
// este global en src/). Publicarlo en produccion no aporta y expone la config interna.
if (import.meta.env.DEV) {
  window.FLU_CONFIG = FLU_CONFIG;

  // Grabación de sesión durable (SOLO DEV): el PCM, los eventos y las
  // instantáneas con vectores completos se vuelcan al dev-server mientras la
  // pestaña vive. Ver src/server/recorderSink.ts.
  configureSessionSink(createHttpSessionSink());

  // Control del AGENTE (archivo control.json del dev-server): `capture` enciende
  // o apaga la bandera y `command` ejecuta un comando de preparación UNA vez
  // (el servidor lo consume al leerlo). Así la validación no depende de que el
  // dueño escriba una URL ni de que recuerde limpiar la base.
  const devCommand = new URLSearchParams(window.location.search).get(DEV_VALIDATION_PARAM);
  void (async () => {
    let control: { capture?: boolean; command?: string } | null = null;
    try {
      const res = await fetch('/__flu/recorder/status');
      if (res.ok) control = await res.json();
    } catch (err) {
      logCaughtError('recorder.control', err);
    }
    if (!control) control = {};
    if (control.capture === true) enableSessionRecorder();
    if (control.capture === false) disableSessionRecorder();
    const command = control.command || devCommand;
    if (command) {
      await runDevValidationCommand(command).catch((err) =>
        logCaughtError('devValidationReset', err),
      );
    }
  })();

  // El comando avisa por este canal cuando la base cambió: las demás pestañas
  // recargan su estado en memoria (una baja en IndexedDB no se refleja sola).
  if (typeof BroadcastChannel !== 'undefined') {
    const devChannel = new BroadcastChannel(DEV_VALIDATION_CHANNEL);
    devChannel.onmessage = (event) => {
      if (event.data?.type === 'reload') window.location.reload();
    };
  }
}

// Registrar el Service Worker de la PWA (notificaciones/offscreen).
// Regla #1: habilitado por FLU_CONFIG.notifications.enabled (sin hardcode).
if (
  'serviceWorker' in navigator &&
  (FLU_CONFIG).notifications?.enabled !== false
) {
  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      // Fuerza la comprobación de una versión nueva del SW en cada arranque.
      registration.update().catch(() => { /* ignorado: la actualizacion del SW no debe romper el arranque */ });
    })
    .catch((err) => logCaughtError('Error al registrar el Service Worker de la PWA', err));

  // Auto-actualización: cuando un SW nuevo toma el control, recargar UNA vez
  // para servir el bundle nuevo. Sin esto, un cliente con la shell cacheada
  // vieja seguía ejecutando código antiguo tras "recargar".
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshed) return;
    swRefreshed = true;
    window.location.reload();
  });
}

// Arnés de comparación ASR: SOLO en desarrollo y solo en /asr-lab.
// En producción el import dinámico se elimina del bundle (import.meta.env.DEV=false).
const isAsrLab =
  import.meta.env.DEV && window.location.pathname.replace(/\/+$/, '') === '/asr-lab'
const AsrLab = isAsrLab ? React.lazy(() => import('./dev/asrLab/AsrLab')) : null

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('main.tsx: falta #root en index.html')
}

ReactDOM.createRoot(rootElement).render(
  isAsrLab && AsrLab ? (
    <React.Suspense fallback={null}>
      <AsrLab />
    </React.Suspense>
  ) : (
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  ),
);
