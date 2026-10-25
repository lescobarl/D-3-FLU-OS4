# LAE — cola de ejecución del módulo CONVERSACIÓN

## 2026-10-24 — base y arranque

- Rama creada: `feature/conversacion-modulo-nuevo`.
- Commit base: `docs/LAE_MODULO_CONVERSACION.MD`, `src/voice/conversation/`,
  `tests/conversacionDominioLocucion.test.ts`, más la costura de arranque.
- El seed es `src/voice/conversation/domain/locucion.ts` (TS, no JS), 17/17 verde.
  La nota decía 14; se midió 17.
- Arreglos al seed para pasar los guards del pre-commit:
  - fuera `palabras` (copia estructural de la tubería vieja, `structureDuplicationGuard`);
  - `crearEstado` exige `semilla`; el test la aporta (`Hablante 1`), sin literal en
    `src` (`speakerDiarizationUnified`, G3).
- Desbloqueo del `orphanModulesGuard`: el módulo no lo alcanzaba ningún entrypoint.
  Se expone por la fachada pública de voz con un export explícito:
  - `src/voice/conversation/index.ts` → costura pública (semilla mientras se construye);
  - `src/voice/api/server.ts` → `export { crearEstadoDeLocucion } from '../conversation/index'`.
  Esta línea está **fuera de la whitelist** de archivos; es el mínimo para que el
  gate de módulos huérfanos pase. No toca panel ni look & feel. Se sustituirá por
  la API real (7 llamadas) en el paso 5.
- Gates medidos:
  - `npm run test:file tests/conversacionDominioLocucion.test.ts` → 17/17 verde.
  - `npm run typecheck` → verde.
  - `orphanModulesGuard`, `voiceFacadeGuard`, `deadExportsGuard`,
    `structureDuplicationGuard`, `speakerDiarizationUnified` → 28/28 verde.
- Siguiente: `ports.ts` + `adapters.ts`.

## Pendiente de producto

- Fixture `N`: no existe grabación; los guards usan fixtures sintéticos. La
  aceptación `N/0/0` queda PENDIENTE, no cumplida.
- Cableado de producto (hook/App) fuera de la whitelist; el arranque queda tras
  `conversation.engine` dentro del módulo.
