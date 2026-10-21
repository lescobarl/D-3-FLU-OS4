# Fixtures de audio REAL (no sintético)

Extraídas de la grabación de la sesión del dueño `d4c1c8f3-76f8-400b-b89e-e8e428cfdff7`
(20-oct-2026), PCM16 mono remuestreado a 16 kHz con el `downsample` real del proyecto.

| Fichero | Origen (ms) | Duración | speechLike | RMS | Qué demuestra |
|---|---|---|---|---|---|
| `habla-real-600ms.wav` | 7255 | 600 ms | **600 ms** | 0.0466 | habla real corta SIN wake: el gate NO la descarta |
| `no-habla-800ms.wav` | 81300 | 800 ms | **0 ms** | 0.0214 | audio real sin habla con energía > piso (0.02): el criterio viejo (solo RMS) lo aceptaba; el gate lo descarta |
| `fondo-con-voz-800ms.wav` | 112175 | 800 ms | **710 ms** | 0.0480 | LIMITACIÓN declarada: voz de fondo (TV/sala) pasa el gate |

`habla-real-500ms-borde.wav` | 8335 | 500 ms | **120 ms** | 0.0229 | DECISIÓN (a): el borde se acepta; el gate la descarta |

`speechLike` = `countSpeechLikeSamples` (dueño `src/voice/lib/voicedActivity.js`).

No se editan a mano: son recortes del audio real. Si se cambia el criterio de habla,
estos números se vuelven a MEDIR (no se ajusta el fichero).
