# Sidecar ASR local (faster-whisper)

Servicio local de transcripción **por tramo** para el respaldo del ASR. El
producto lo consulta solo cuando el final de Chrome de un tramo cerrado es
vacío o implausible; el texto pasa la puerta anti-alucinación del módulo de
conversación antes de tocar la fila. No sustituye a Chrome: es su respaldo.

El contrato completo vive en `docs/CONTRATO-ASR-LOCAL.md` (§5-quinquies medida,
§5-octies adaptador). El único cliente es
`src/voice/lib/asr/sidecarTranscriber.ts`.

## Requisitos

- Python 3.12 (medido con 3.12.10).
- Dependencias: `faster-whisper==1.2.1` y `numpy` (`requirements.txt`).
- El modelo `small` (Systran/faster-whisper-small) se descarga la primera vez a
  la caché de Hugging Face (`~/.cache/huggingface`, override con `HF_HOME`).

Instalación desde la raíz del repo (un venv propio; `.agent_tmp/` ya está en
`.gitignore`):

```bat
python -m venv .agent_tmp\venv
.agent_tmp\venv\Scripts\pip install -r asr-sidecar\requirements.txt
```

## Arranque

```bat
asr-sidecar\start-sidecar.cmd
```

El launcher usa `.agent_tmp\venv\Scripts\python.exe` si existe; si no, el
Python del `PATH`. Override: `set FLU_ASR_PYTHON=C:\ruta\al\python.exe`.
Argumentos opcionales: `--puerto 8765 --modelo small --hilos 8 --beam 1`.

El modelo se carga **una vez** al arrancar y el puerto se abre después: si
`GET /salud` responde, transcribir no paga la carga (la carga medida ronda
1–2 s con el modelo ya en caché; la primera descarga tarda más).

**Una sola instancia.** Antes de cargar el modelo el servicio comprueba el
puerto: si `/salud` ya responde, sale con error. En Windows el bind con
`SO_REUSEADDR` no falla como en Linux si el puerto está tomado, así que el
error de arranque no es una comprobación fiable; el guard también evita dos
copias del modelo en RAM. Si el arranque falla por puerto ocupado, cierre el
proceso anterior antes de reintentar.

**Dos PID = una instancia.** El `python.exe` del venv es un redirector que
lanza el intérprete base como hijo, con el mismo `asr-sidecar/sidecar.py` en
la línea de comandos y la misma hora de creación (medido 2026-11-14). No son
dos servicios y no hay que matar solo al hijo.

## Contrato del cable

`GET {url}/salud` → `200 {"ok": true, "modelo": "small", "cargado": true}`.
Cualquier otro estado, error de red o sonda agotada = NO disponible; el
producto sigue con Chrome.

`POST {url}/transcribir` con JSON:

```json
{
  "muestras": "<base64 de float32 little-endian>",
  "sampleRate": 16000,
  "idioma": "es",
  "formato": "f32le"
}
```

Respuesta `200 {"texto": "...", "latencia_ms": 0, "audio_s": 0, "palabras": 0}`.
El cliente solo lee `texto`.

Reglas del servicio:

- UNA ventana por petición, en serie: el servidor atiende en **un solo hilo**,
  el que cargó el modelo; la secuencialidad queda por construcción. Sin
  streaming ni VAD por lotes. **No hay texto bit-reproducible entre
  arranques:** medido 2026-11-14, el mismo spike sin tocar produjo dos
  variantes de 1–5 palabras por ventana en momentos distintos, con el mismo
  audio (sha256 `a8ff47ad…`) y los mismos parámetros. Dentro de una ejecución
  el texto es estable; el producto valida la integridad del camino, no la
  identidad contra una cadena fija.
- Ventana máxima 12,5 s (el módulo parte en 12 s); por encima responde `400`.
- Cualquier `sampleRate` se remuestrea a 16 kHz (48 kHz por decimación 1/3 con
  promedio, el mismo anti-alias del spike medido).
- `idioma` `es`/`en`; cualquier otro valor cae a `es`.
- Errores de cuerpo → `400 {"error": ...}`; fallo interno → `500`; el proceso
  no muere por una petición.

## Medida (2026-11-14)

Parámetros fijados por la medición de §5-quinquies: `small`, CPU `int8`,
8 hilos, `beam_size=1`, ventanas de 12 s, secuencial, sin VAD por lotes.
Sobre el audio real `b6d82bca` (PCM16 48 kHz) el spike midió 3,3–5,4 s por
ventana y 130 / 147–150 palabras por tramo.

**Validación del servicio real por el camino del producto (§5-nonies):** 6
ventanas de producto (12 s; la cola de 1,09 s la omite el disparador), fila
idéntica al texto devuelto por el sidecar, `origen: 'local'`, un solo
`row.committed`, puerta aceptada (`descarte: null`) y cierre de 4,7–6,3 s por
ventana (< `timeoutMs` 8000). Palabras por ventana: 40/44/45 y 38/51/50.

La segunda corrida del mismo spike, sin cambios, dio 41/46/43 y 36/54/55: el
texto varía 1–5 palabras entre arranques (ver reglas). Por eso la validación
compara la fila contra la respuesta del sidecar de esa misma ejecución, no
contra una cadena histórica.

## Config del producto

Fuente única: `LOCAL_FINAL_DEFAULTS` (`src/voice/lib/asr/asrDefaults.js`).

| Clave | Valor | Dueño |
|---|---|---|
| `sidecarUrl` | `http://127.0.0.1:8765` (solo en `fluConfig.js`) | endpoint |
| `sidecarProbeMs` | `1500` | tope de `/salud` |
| `timeoutMs` | `8000` | tope por ventana (transporte) |
| `minAudioSegundos` | `3` | disparador del respaldo |
| `enabled` | `true` (encendido tras §5-nonies) | compuerta del producto |

Con `enabled: false` el producto no sondea ni transcribe: Chrome manda y el
servicio puede estar apagado sin coste. Con `enabled: true`, si el servicio
no responde a `/salud` en `sidecarProbeMs`, el cierre no paga la
transcripción y la fila se queda con Chrome.

## Límites

- Solo local (`127.0.0.1`), sin autenticación: no exponerlo fuera de la máquina.
- Un modelo en memoria (~500 MB con `small` int8); secuencial por diseño, no es
  un servidor de alto rendimiento.
- No decide nada del producto: puerta, fila y commit viven en el módulo de
  conversación.
