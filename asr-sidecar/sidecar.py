#!/usr/bin/env python3
"""SIDECAR local de transcripción por tramo (faster-whisper) para FLU OS4.

Implementa el contrato del cable escrito en docs/CONTRATO-ASR-LOCAL.md
§5-octies, que consume el único cliente `crearSidecarTranscripcion`
(src/voice/lib/asr/sidecarTranscriber.ts):

  GET  {url}/salud       -> 2xx = disponible (el modelo ya está cargado).
  POST {url}/transcribir -> JSON {muestras: base64 float32 LE, sampleRate,
                            idioma, formato: 'f32le'} -> JSON {texto, ...}.

Decisiones medidas (opción c, 2026-11-14): small en CPU int8, 8 hilos,
beam 1, UNA ventana de hasta 12 s por petición, SECUENCIAL (un bloqueo cubre
el modelo entero: nunca dos transcripciones a la vez), sin VAD por lotes ni
streaming. El modelo se carga UNA vez al arrancar y el puerto se abre después:
si `/salud` responde, transcribir no paga la carga.

El servicio es local (127.0.0.1) y no tiene autenticación: no exponerlo fuera
de la máquina. No decide nada del producto: la puerta anti-alucinación, la
fila y el commit viven en el módulo de conversación.

UN SOLO HILO (`HTTPServer`, no `ThreadingHTTPServer`): las peticiones se
atienden en el hilo de `serve_forever` y la secuencialidad queda por
construcción, no por bloqueo (una ventana a la vez, sin VAD por lotes).

NO se promete texto bit-reproducible entre arranques. Medido 2026-11-14: el
MISMO spike sin tocar produjo dos variantes de 1–5 palabras por ventana en
momentos distintos, con el mismo audio (sha256 `a8ff47ad…`) y los mismos
parámetros (small, CPU int8, 8 hilos, beam 1); 8 hilos con cuantización int8
no dan esa garantía. Dentro de una ejecución el texto sí es estable. Por eso
el producto prueba la integridad del camino (la fila es EXACTAMENTE la
respuesta del sidecar), no la identidad contra una cadena fija.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
from faster_whisper import WhisperModel

# Rate del modelo: el cliente remuestrea al rate del ASR (16 kHz) y aquí se
# acepta cualquier rate razonable, pero la transcripción SIEMPRE va a 16 kHz.
SR_MODELO = 16000
# Prompt fijo de la medición (§5-quinquies). No cambia por petición: es parte
# de la configuración medida, no un parámetro del cable.
PROMPTS = {
    "es": (
        "Conversación en español con el asistente. Palabras clave: ok flu, "
        "estás ahí, cuéntame, busca en la web, recuérdame, anota."
    ),
    "en": (
        "Conversation in English with the assistant. Keywords: ok flu, "
        "are you there, tell me, search the web, remind me, note."
    ),
}
# Una ventana de 12 s a 16 kHz en f32 son 768 KB; el base64 ronda 1 MB.
MAX_CUERPO_BYTES = 4 * 1024 * 1024
# Tope duro de audio por petición. El módulo ya parte en ventanas de 12 s;
# el margen evita rechazar una ventana límite por redondeo.
MAX_AUDIO_S = 12.5

MODELO: WhisperModel | None = None
OPCIONES: argparse.Namespace
BLOQUEO = threading.Lock()


def resamplear_a_16k(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Lleva PCM mono al rate del modelo.

    Para rates múltiplos (48 kHz, el del producto) usa decimación 1/factor con
    promedio — el mismo anti-alias boxcar del spike medido. Para rates no
    múltiplos interpola linealmente; no hay otro consumidor de esos rates.

    Args:
        audio: Muestras float32.
        sample_rate: Frecuencia de las muestras.

    Returns:
        Muestras float32 a 16 kHz.
    """
    if sample_rate == SR_MODELO:
        return audio.astype(np.float32, copy=False)
    if sample_rate > SR_MODELO and sample_rate % SR_MODELO == 0:
        factor = sample_rate // SR_MODELO
        n = len(audio) // factor * factor
        if n == 0:
            return np.zeros(0, dtype=np.float32)
        return audio[:n].astype(np.float32).reshape(-1, factor).mean(axis=1)
    if len(audio) == 0:
        return np.zeros(0, dtype=np.float32)
    n = max(1, int(round(len(audio) * SR_MODELO / sample_rate)))
    tiempos = np.linspace(0.0, len(audio) - 1, n, dtype=np.float64)
    return np.interp(
        tiempos, np.arange(len(audio), dtype=np.float64), audio
    ).astype(np.float32)


def decodificar(datos: dict) -> tuple[np.ndarray, float]:
    """Valida el cuerpo y devuelve (audio 16 kHz, duración en segundos).

    Raises:
        ValueError: formato, muestras, rate o duración fuera del contrato.
    """
    if datos.get("formato") != "f32le":
        raise ValueError("formato debe ser 'f32le'")
    if not isinstance(datos.get("muestras"), str):
        raise ValueError("muestras debe ser base64")
    sample_rate = int(datos.get("sampleRate") or 0)
    if sample_rate <= 0:
        raise ValueError("sampleRate inválido")
    crudo = base64.b64decode(datos["muestras"], validate=True)
    if len(crudo) == 0 or len(crudo) % 4 != 0:
        raise ValueError("muestras debe ser float32 LE")
    audio = np.frombuffer(crudo, dtype="<f4").astype(np.float32)
    audio = resamplear_a_16k(audio, sample_rate)
    audio_s = len(audio) / SR_MODELO
    if audio_s <= 0:
        raise ValueError("audio vacío")
    if audio_s > MAX_AUDIO_S:
        raise ValueError(
            f"ventana de {audio_s:.2f} s supera el tope de {MAX_AUDIO_S} s"
        )
    return audio, audio_s


def transcribir(audio: np.ndarray, idioma: str) -> str:
    """Transcribe UNA ventana. SECUENCIAL: el bloqueo cubre la llamada entera.

    El generador de faster-whisper se consume dentro del bloqueo; si se
    consumiera fuera, dos peticiones concurrentes usarían el modelo a la vez.
    """
    idioma_modelo = idioma if idioma in PROMPTS else "es"
    with BLOQUEO:
        segmentos, _ = MODELO.transcribe(
            audio,
            language=idioma_modelo,
            initial_prompt=PROMPTS[idioma_modelo],
            beam_size=OPCIONES.beam,
            vad_filter=False,
        )
        return " ".join(segmento.text.strip() for segmento in segmentos).strip()


class ManejadorSidecar(BaseHTTPRequestHandler):
    """Una petición por ventana, atendida en el hilo único de `serve_forever`."""

    server_version = "FLU-ASR-Sidecar/1.0"
    protocol_version = "HTTP/1.1"

    def _json(self, codigo: int, datos: dict) -> None:
        # Servidor de UN hilo: una conexión keep-alive dejaría el `accept`
        # bloqueado y la siguiente sonda /salud caducaría a los 1500 ms (medido
        # 2026-11-14). Cada respuesta cierra su conexión; se conserva HTTP/1.1
        # para que `Expect: 100-continue` siga atendido por la base.
        self.close_connection = True
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self) -> None:  # noqa: N802 - nombre fijado por http.server
        if self.path.split("?", 1)[0] == "/salud":
            self._json(200, {"ok": True, "modelo": OPCIONES.modelo, "cargado": True})
            return
        self._json(404, {"error": "ruta desconocida"})

    def do_POST(self) -> None:  # noqa: N802 - nombre fijado por http.server
        if self.path.split("?", 1)[0] != "/transcribir":
            self._json(404, {"error": "ruta desconocida"})
            return
        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0 or largo > MAX_CUERPO_BYTES:
            self._json(413, {"error": "cuerpo inválido"})
            return
        try:
            datos = json.loads(self.rfile.read(largo).decode("utf-8"))
            if not isinstance(datos, dict):
                raise ValueError("el cuerpo debe ser un objeto JSON")
            audio, audio_s = decodificar(datos)
            idioma = str(datos.get("idioma") or "es").lower()[:2] or "es"
            inicio = time.perf_counter()
            texto = transcribir(audio, idioma)
            latencia_ms = round((time.perf_counter() - inicio) * 1000)
        except ValueError as error:
            self._json(400, {"error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - el servicio no debe caerse
            self._json(500, {"error": f"fallo interno: {error}"})
            return
        palabras = len(texto.split())
        self._json(
            200,
            {
                "texto": texto,
                "latencia_ms": latencia_ms,
                "audio_s": round(audio_s, 2),
                "palabras": palabras,
            },
        )
        print(
            json.dumps(
                {
                    "evento": "transcripcion",
                    "audio_s": round(audio_s, 2),
                    "latencia_ms": latencia_ms,
                    "palabras": palabras,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

    def log_message(self, formato: str, *args) -> None:
        sys.stderr.write("[sidecar] " + (formato % args) + "\n")


def ya_hay_servicio(host: str, puerto: int) -> bool:
    """¿Hay algo respondiendo en el puerto antes de arrancar?

    En Windows el bind con `SO_REUSEADDR` (que `HTTPServer` activa) no falla
    como en Linux si el puerto ya está tomado, así que el error de arranque no
    es una comprobación fiable. La ocupación se comprueba ANTES de cargar el
    modelo: cualquier respuesta HTTP = puerto ocupado. Además evita dos copias
    del modelo en RAM.

    OJO al diagnosticar: el `python.exe` de un venv es un redirector que lanza
    el intérprete base como hijo, con el MISMO `asr-sidecar/sidecar.py` en la
    línea de comandos (medido 2026-11-14). Dos PID con la misma hora de
    creación son UNA sola instancia; no matar solo al hijo.

    Args:
        host: Interfaz del servicio.
        puerto: Puerto del servicio.

    Returns:
        `True` si el puerto ya está atendido; `False` si está libre.
    """
    try:
        with urllib.request.urlopen(
            f"http://{host}:{puerto}/salud", timeout=0.5
        ):
            return True
    except urllib.error.HTTPError:
        # Responde con un estado no-2xx: igual está ocupado.
        return True
    except OSError:
        # Conexión rechazada o sin respuesta: no hay servicio. `URLError` es
        # subclase de OSError; `HTTPError` se atrapó arriba.
        return False


def main() -> int:
    """Carga el modelo UNA vez, abre el puerto y sirve hasta Ctrl+C."""
    global MODELO, OPCIONES
    analizador = argparse.ArgumentParser(
        description="Sidecar local de transcripción (faster-whisper)."
    )
    analizador.add_argument("--host", default="127.0.0.1")
    analizador.add_argument("--puerto", type=int, default=8765)
    analizador.add_argument("--modelo", default="small")
    analizador.add_argument("--hilos", type=int, default=8)
    analizador.add_argument("--beam", type=int, default=1)
    OPCIONES = analizador.parse_args()

    if ya_hay_servicio(OPCIONES.host, OPCIONES.puerto):
        print(
            f"[sidecar] ya hay un servicio en "
            f"http://{OPCIONES.host}:{OPCIONES.puerto}; no arranco una segunda "
            "instancia (Windows repartiría las peticiones entre las dos).",
            file=sys.stderr,
            flush=True,
        )
        return 1

    inicio = time.perf_counter()
    MODELO = WhisperModel(
        OPCIONES.modelo,
        device="cpu",
        compute_type="int8",
        cpu_threads=OPCIONES.hilos,
    )
    carga_ms = round((time.perf_counter() - inicio) * 1000)
    print(
        json.dumps(
            {
                "evento": "modelo.cargado",
                "modelo": OPCIONES.modelo,
                "hilos": OPCIONES.hilos,
                "beam": OPCIONES.beam,
                "carga_ms": carga_ms,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    try:
        servidor = HTTPServer(
            (OPCIONES.host, OPCIONES.puerto), ManejadorSidecar
        )
    except OSError as error:
        print(
            f"[sidecar] no pude abrir {OPCIONES.host}:{OPCIONES.puerto}: {error}",
            file=sys.stderr,
            flush=True,
        )
        return 1
    print(
        f"[sidecar] escuchando en http://{OPCIONES.host}:{OPCIONES.puerto}",
        flush=True,
    )
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
