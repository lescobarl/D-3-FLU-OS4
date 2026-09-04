# CONTEXTO FLU OS 2.0 — Funcionalidades, Definición y Alcance

> Documento compendio que define **todas** las funcionalidades, arquitectura, módulos, datos, reglas de ingeniería y alcance del sistema FLU OS 2.0.
>
> Fuente base: [`CONTEXTO_FLU_OS.md`](CONTEXTO_FLU_OS.md) — Versión completa sin omisiones.

---

## Índice

1. [Filosofía y Paradigma Operativo](#1-filosofía-y-paradigma-operativo)
2. [Actores del Sistema](#2-actores-del-sistema)
3. [Problemas que Resuelve](#3-problemas-que-resuelve)
4. [Arquitectura del Sistema](#4-arquitectura-del-sistema)
   - 4.1 [IA Local](#41-ia-local)
   - 4.2 [Manejo y Persistencia de Datos](#42-manejo-y-persistencia-de-datos)
   - 4.3 [Avatar Conversacional FLU](#43-avatar-conversacional-flu)
5. [Módulos de Interfaz — El Árbol de Pestañas del Shell](#5-módulos-de-interfaz--el-árbol-de-pestañas-del-shell)
   - 5.1 [Bloque de Identidad Core `flu`](#51-bloque-de-identidad-core-flu)
   - 5.2 [Bloque de Operación de Aula `operaciones`](#52-bloque-de-operación-de-aula-operaciones)
   - 5.3 [Bloque de Gestión Escolar `gestion`](#53-bloque-de-gestión-escolar-gestion)
   - 5.4 [Bloque de Infraestructura y Configuración `configuracion`](#54-bloque-de-infraestructura-y-configuración-configuracion)
6. [Base de Datos Local — Inventario de Tablas](#6-base-de-datos-local--inventario-de-tablas)
   - 6.1 [Catálogos Estructurales de Aplicación y Shell](#61-catálogos-estructurales-de-aplicación-y-shell)
   - 6.2 [Catálogos Escolares, Evaluaciones y Minutas](#62-catálogos-escolares-evaluaciones-y-minutas)
   - 6.3 [Catálogos Geopolíticos e Institucionales SEP](#63-catálogos-geopolíticos-e-institucionales-sep)
   - 6.4 [Soporte de Integridad Transaccional Offline](#64-soporte-de-integridad-transaccional-offline)
   - 6.5 [Monitoreo y Branding (Extensiones)](#65-monitoreo-y-branding-extensiones)
7. [Flujos Operativos del Sistema](#7-flujos-operativos-del-sistema)
   - 7.1 [Arranque y Validación del Sistema](#71-arranque-y-validación-del-sistema)
   - 7.2 [Conversación con FLU y Modo Juntas](#72-conversación-con-flu-y-modo-juntas)
   - 7.3 [Asistencia y Operación de Aula](#73-asistencia-y-operación-de-aula)
   - 7.4 [Tareas, Calificaciones y Validación Familiar](#74-tareas-calificaciones-y-validación-familiar)
   - 7.5 [Sincronización e Integridad de Datos](#75-sincronización-e-integridad-de-datos)
8. [Reglas de Ingeniería y Buenas Prácticas](#8-reglas-de-ingeniería-y-buenas-prácticas)
9. [Stack Tecnológico](#9-stack-tecnológico)
10. [Límites del Proyecto](#10-límites-del-proyecto)
11. [Extensiones Aprobadas](#11-extensiones-aprobadas)

---

## 1. Filosofía y Paradigma Operativo

FLU OS 2.0 (Sovereign Edition) no es simplemente un sistema de gestión escolar, una aplicación educativa tradicional o un cascarón técnico modular; es un **ecosistema de soberanía tecnológica e innovación de alto rendimiento** diseñado bajo el paradigma de *Edge Computing* (Cómputo en el Borde) y una arquitectura de software limpia, desacoplada y orientada al cliente.

En el contexto de la educación pública y privada, la brecha digital extrema y la desconexión geográfica a menudo convierten a la tecnología en un factor de exclusión. FLU OS 2.0 nace bajo la premisa inversa: la innovación pedagógica de vanguardia no debe depender de un cable de red, un módem, una infraestructura en la nube o un plan de datos móviles.

| Principio | Descripción |
|-----------|-------------|
| **Edge Computing** | Toda la inteligencia artificial, procesamiento de voz y datos residen en el dispositivo del usuario. No requiere servidores externos. |
| **Offline-First** | El sistema funciona completamente sin conexión. La sincronización es un evento secundario y opcional. |
| **Costo $0.00 USD por usuario adicional** | Sin servidores centrales, sin costos de infraestructura en la nube. Hosting estático via Cloudflare Pages o GitHub Pages. |
| **Multi-Actor** | Sirve a 6 perfiles distintos con interfaces y permisos diferenciados. |
| **Identidad de Marca** | FLU es un avatar conversacional 3D con personalidad Stitch: carismático, rebelde, empático pero enérgico. |
| **Gobernanza de Datos** | El usuario es dueño de sus datos. No hay servidores centrales. La sincronización es peer-to-peer o por USB. |
| **Lenguas Indígenas** | Soporte para Náhuatl, Maya, Mixteco y Zapoteco además de español. |

---

## 2. Actores del Sistema

El sistema reconoce 6 perfiles de usuario con capacidades y vistas diferenciadas:

### 2.1 Funcionario de la SEP
- **Visión**: *"La Nueva Escuela Mexicana exige la eliminación de la brecha digital. No podemos condicionar el derecho a una educación asistida por IA a la presencia de infraestructura de red."*
- **Objetivo**: Equidad, inclusión y cumplimiento normativo
- **Funcionalidades**: Monitoreo de rezago educativo, supervisión de zonas, estadísticas de aprendizaje, dashboard de indicadores, estandarización de datos con formatos nacionales SEP

### 2.2 Director de Escuela
- **Visión**: *"Nuestras escuelas sufren un desgaste administrativo abrumador. Pasamos más tiempo llenando minutas de CTE y reportes de zona, que coordinando estrategias didácticas."*
- **Objetivo**: Gobernanza, liderazgo y alivio administrativo
- **Funcionalidades**: Gestión de juntas CTE, ceremonias escolares, horarios, reportes institucionales, supervisión de personal, exportación segura via USB Sideloading

### 2.3 Docente
- **Visión**: *"Cada minuto invertido en pasar lista a mano o calificar tareas estandarizadas es un minuto que le resto a la atención personalizada de mis alumnos con rezago o NEE."*
- **Objetivo**: Optimización del tiempo y andamiaje en el aula
- **Funcionalidades**: Pase de lista por voz, asignación de tareas, captura de calificaciones, creación de exámenes por IA, dashboard del grupo, rúbricas ponderadas

### 2.4 Estudiante
- **Visión**: *"Quiero aprender a mi propio ritmo, resolver mis dudas sobre los libros sin miedo a equivocarme o a que se acaben los datos del teléfono de mis papás, y que mi progreso se sienta como un logro real."*
- **Objetivo**: Tutoría inteligente, autonomía y motivación lúdica
- **Funcionalidades**: Dashboard personal de progreso, logros e insignias, tutoría por IA local con método socrático, Materia Gris como gamificación, historial de calificaciones

### 2.5 Padre de Familia
- **Visión**: *"Trabajo todo el día y a veces no entiendo las tareas nuevas ni tengo dinero para recargar megas. Necesito saber cómo va mi hijo en la escuela y firmar de enterado sin que me cueste o me complique la vida."*
- **Objetivo**: Confianza, vinculación práctica y certeza
- **Funcionalidades**: Firma digital de boletas en CanvasFirmaPadre.jsx con hash SHA-256, seguimiento de calificaciones, comunicación con la escuela, acuses de recibo

### 2.6 Arquitecto de Software
- **Visión**: *"El verdadero diseño Offline-First no es solo almacenar texto en caché; es migrar todo el ciclo de procesamiento informático al hardware del cliente."*
- **Objetivo**: Viabilidad técnica, desacoplamiento y mantenibilidad
- **Funcionalidades**: Arquitectura modular con inyección de dependencias, principio de responsabilidad única, offline-first, sincronización multi-escenario, PWA avanzada con Service Worker

---

## 3. Problemas que Resuelve

| # | Problema | Solución FLU OS |
|---|----------|-----------------|
| 1 | **Aislamiento por Brecha Digital Extrema** | Sistema 100% offline con sincronización diferida por USB o WiFi directo. Interfaces interactivas avanzadas funcionan al 100% en regiones remotas. |
| 2 | **Burocracia y Carga Administrativa Docente** | Automatización de pase de lista, calificaciones, reportes y minutas. Elimina tareas manuales del maestro. |
| 3 | **Pérdida de Evidencias de Progreso Alumno-Maestro** | Digitalización y asociación de fotografías de apuntes directamente en el dispositivo de forma local. |
| 4 | **Olvido e Ineficiencia en Acuerdos Directivos CTE** | Bitácora automatizada por voz que extrae y asigna responsabilidades claras en la base de datos local. |
| 5 | **Desconexión y Ausentismo de los Tutores** | Firma digital de boletas, seguimiento en tiempo real de calificaciones, herramientas de validación física y visual en el plantel. |
| 6 | **Saturación Financiera por Consumo de Infraestructura** | Procesamiento local en el hardware del cliente. Costo incremental por usuario de $0.00 USD. |

---

## 4. Arquitectura del Sistema

### 4.1 IA Local

El sistema incorpora un stack completo de inteligencia artificial que opera 100% en el dispositivo del usuario, sin enviar un solo byte a internet.

#### 4.1.1 Motor de Inferencia Local WebLLM
- Carga y ejecuta modelos de lenguaje en el navegador vía WebGPU/WASM
- **Modelos soportados**: DeepSeek-R1-Distill-Llama-8B, Llama-3-8B-Instruct (cuantizados a 4-bits)
- **Modelos de respaldo** para dispositivos de bajos recursos: Phi-3.5-Mini-Instruct, Gemma-2-2B-IT
- **Velocidad de inferencia**: 15 a 25 tokens por segundo
- Proporciona respuestas contextuales sin enviar datos a servidores externos
- Soporta múltiples modos de operación: tutoría, evaluación, reportes, cómputo

#### 4.1.2 Búsqueda Semántica Orama
- Motor de búsqueda vectorial y de texto completo que opera en memoria RAM
- Indexa knowledge bases locales (Libros de Texto Gratuitos LTG, planes curriculares) para consultas rápidas
- Búsqueda por similitud semántica (cosine similarity) en contenido educativo
- Evita que la IA alucine al entregar solo fragmentos exactos del libro como fuente de verdad

#### 4.1.3 Transcripción de Voz Whisper WASM
- Reconocimiento de voz local usando Whisper compilado a WebAssembly
- Transcripción en tiempo real con detección de lenguaje
- Soporta español y lenguas indígenas
- Procesamiento en Web Worker para no bloquear la UI

#### 4.1.4 Síntesis de Voz Piper TTS
- Conversión de texto a voz local con voces naturales via WebAssembly
- No requiere conexión a internet para generar audio
- Soporta múltiples voces y velocidades

#### 4.1.5 Lip-Sync Rhubarb WASM
- Generación de fonemas a partir de audio para sincronización de labios
- Permite que el avatar 3D mueva la boca al ritmo del habla
- Opera completamente en el navegador vía WASM
- Inyecta Morph Targets al modelo 3D

#### 4.1.6 Orquestador de IA IAOrchestrator
- Enruta consultas al motor apropiado según el contexto
- Modos de operación:
  - **TUTOR**: Responder preguntas educativas con guía socrática paso a paso
  - **EVALUATION**: Evaluar respuestas y proporcionar retroalimentación
  - **REPORT**: Generar reportes descriptivos de rendimiento
  - **COMPUTING**: Realizar cálculos (promedios, estadísticas, riesgo de asistencia)
- Integra múltiples knowledge bases temáticas (académica, general, institucional, registro)
- Sistema de prompts con versionado semántico y plantillas categorizadas

#### 4.1.7 Procesador de Comandos de Voz VoiceCommandProcessor
- Analiza texto transcrito para detectar intenciones del usuario
- Tipos de comando soportados:
  - **NAVIGATION**: Navegar a módulos específicos
  - **AVATAR_ACTION**: Acciones del avatar (saludar, levantar mano, alertar)
  - **CONVERSATION**: Iniciar/finalizar conversaciones, crear minutas
  - **SPEAKER_ID**: Identificar quién está hablando mediante "ok flu soy [nombre]"
  - **QUERY**: Preguntas al orquestador de IA
  - **UNKNOWN**: Comandos no reconocidos

#### 4.1.8 Atención Proactiva del Avatar AvatarAttentionEngine
- Monitorea la conversación para detectar cuándo intervenir
- Detecta: errores conceptuales, preguntas sin respuesta, acuerdos no registrados, oportunidades pedagógicas
- Clasifica conversaciones: tutoría, junta, social, resolución de dudas
- Control de tasa (rate limiting) para evitar intervenciones excesivas

#### 4.1.9 Historial de Conversaciones ConversationHistoryService
- Registro completo de conversaciones con FLU
- Generación automática de minutas al finalizar cada conversación
- Cada minuta contiene: fecha, secuencia numérica ascendente, título, resumen, modo (TUTOR/MEETING/GENERAL), duración en segundos, número de mensajes, participantes (JSON array con nombre, perfil, es_flu)
- Los mensajes individuales almacenan: texto, tipo (TEXTO/VOZ/SISTEMA), hablante, timestamp, metadatos de tono (tone: NEUTRAL/EXCITED/CONFUSED/FRUSTRATED, confidence, energy)
- FLU es siempre un participante registrado (es_flu: true) en cada minuta
- Soporta búsqueda por texto y referencia a minutas anteriores por secuencia

#### 4.1.10 Registro de Prompts PromptRegistry
- Sistema de plantillas de prompts con versionado semántico
- Categorías: system, tutor, evaluation, report, computing, attention, meeting, indigenous
- Composición de múltiples prompts para respuestas complejas
- Soporte para refresco dinámico de plantillas

#### 4.1.11 Caché de Respuestas ResponseCache
- Almacena respuestas de IA para evitar recomputación
- Reduce latencia en consultas repetitivas
- Límite configurable de entradas en caché

#### 4.1.12 Servicio de Cómputo ComputingService
- Cálculo de promedios por alumno y por grupo
- Estadísticas descriptivas (media, mediana, desviación estándar, mínimo, máximo)
- Análisis de riesgo de asistencia por faltas
- Cálculo de calificación final

#### 4.1.13 Control de Costos en Escenarios Conectados costCapEngine
- Límite máximo estricto de **3 consultas nuevas en línea al día por usuario**
- Al alcanzar el tope, bloquea el consumo de red y conmuta invisiblemente al motor WebLLM local
- Blinda la economía del proyecto y evita gastos imprevistos

### 4.2 Manejo y Persistencia de Datos

La información se gestiona mediante un esquema de "islas de datos" independientes capaces de unirse mediante un protocolo de reconciliación.

#### 4.2.1 Base de Datos Local IndexedDB
- **Motor**: IndexedDB vía Dexie.js
- **Esquema**: 42 tablas (en especificación original) con relaciones y restricciones de integridad
- **Identidad Única Universal UUIDv4**: Queda estrictamente prohibido el uso de llaves numéricas secuenciales. Toda inserción genera UUIDv4 en texto plano para evitar colisiones en sincronización offline.
- **Estructura de Fila Transaccional**: Cada registro incorpora obligatoriamente `[revision, updated_at, deleted]`. Las modificaciones incrementan `revision` atómicamente y actualizan `updated_at` en UTC. El borrado es estrictamente lógico (`deleted: true`), nunca físico en offline.
- **Patrón Repository**: `BaseRepository<T>` genérico que provee CRUD completo, bulk operations, consultas por timestamp, auditoría de cambios

#### 4.2.2 Repositorios Especializados
- `CatalogoRepository`: Catálogos genéricos con metadatos clave-valor y jerarquías
- `UserRepository`: Usuarios multi-rol con autenticación
- `TareaRepository`: Tareas con fechas límite y estados
- `CalificacionRepository`: Calificaciones con período y materia
- `ExamenRepository`: Exámenes con resoluciones
- `MinutaRepository`: Minutas de conversación con búsqueda por texto
- `MensajeRepository`: Mensajes de conversación por minuta
- `SchoolRepository`: Escuelas, salones, horarios, inscripciones
- `SettingsRepository`: Configuraciones operativas
- `SyncRepository`: Logs y checkpoints de sincronización
- `MonitorRepository`: Eventos de monitoreo
- `KnowledgeBaseRepository`: Entradas de base de conocimiento

#### 4.2.3 Manejo de Evidencias Pesadas Blobs Binarios
- La API del Canvas del navegador procesa imágenes de la cámara
- Escala a resolución máxima de **1280x720 píxeles**
- Reduce calidad a **JPEG optimizado del 60%**
- Convierte a cadena binaria comprimida en Base64
- Almacena en Object Store separado `app_media_blobs` para mantener tablas relacionales limpias

#### 4.2.4 Carga Inicial Seeds
- Archivos JSON en `public/seeds/catalogos/` que se cargan en primera ejecución
- Catálogos incluidos: roles, grados, tipos de junta, lenguas, entidades, regiones, colores FLU, shell tabs, report templates
- Usuarios semilla en `public/seeds/seed_users.json`
- **Usuario semilla incorruptible**: `admin` / `admin123` para bootstrap de emergencia
- Verificación de carga para evitar duplicados

#### 4.2.5 Sincronización SyncEngine
- **Cola de prioridad**: Operaciones pendientes ordenadas por urgencia
- **Cálculo de deltas**: Solo sincroniza cambios incrementales (~20 MB mensuales por plantel)
- **Generación de bundles**: Empaqueta datos para exportación USB (paquete inicial ~2.5 GB)
- **Cost Cap Engine**: Límites de costo de sincronización para evitar consumo excesivo
- **Escenarios**: USB sideloading, WiFi directo, LAN, internet
- **Checkpoints**: Permite reanudar sincronizaciones interrumpidas
- **Resolución de Conflictos LWW**: Last-Write-Wins basada en timestamp UTC `updated_at`
- **syncClient.js**: Script para sincronización inalámbrica cuando detecta conectividad
- **Bundle cifrado**: Archivo `.json` comprimido, cifrado y firmado con hash SHA-256
- **Progreso**: Notifica avance en tiempo real

### 4.3 Avatar Conversacional FLU

FLU es un avatar 3D con personalidad Stitch (carismático, brillante pero rebelde) que sirve como interfaz conversacional del sistema.

#### 4.3.1 Render 3D Three.js + @react-three/fiber
- Modelo 3D del conejo FLU renderizado en un canvas Three.js
- Carga de modelo FBX real con texturas y animaciones (archivos en `public/models/`)
- Sistema de iluminación y cámara orbital
- Modo 2D alternativo para dispositivos de baja capacidad
- Alternativa offline a Spline Runtime con control total y sin dependencia de red

#### 4.3.2 Máquina de Estados AvatarStateMachine
- Estados: `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`, `WAITING`, `ERROR`, `SLEEPING`, `CELEBRATING`
- Transiciones automáticas entre estados con tiempos de espera configurables
- Cola de animaciones para secuencias complejas
- Notificaciones de cambio de estado vía callback

#### 4.3.3 Sistema de Animación AvatarAnimations
- Animaciones basadas en keyframes con interpolación
- Propiedades animables: posición, rotación, escala, opacidad, visibilidad
- Curvas de easing: linear, ease-in, ease-out, ease-in-out, bounce, elastic
- Animaciones predefinidas: idle, listening, thinking, speaking, greeting, wave, celebrate, alert, sleep

#### 4.3.4 Señales Visuales AvatarSignals
- Indicadores visuales superpuestos al avatar:
  - **WAVE**: Onda de sonido (escuchando)
  - **THINK**: Engranaje girando (pensando)
  - **HIGHLIGHT**: Resplandor (hablando)
  - **ALERT**: Signo de exclamación (alerta)
  - **CELEBRATE**: Confeti (logro)
  - **NONE**: Sin señal

#### 4.3.5 Modo de Concentración Computing
- Al arrancar WebLLM para procesar tokens pesados, la máquina de estados cambia el Avatar a modo "Computing"
- Reduce la tasa de refresco del canvas 3D de **60 a 24 FPS** para priorizar la GPU hacia el procesamiento matemático del LLM
- Las gafas del personaje emiten un pulso luminoso cíclico de color **cian** (gradiente de carga computacional)

#### 4.3.6 Pipeline de Audio AudioPipeline
- Captura de audio del micrófono con detección de nivel
- Wake word detection para activar escucha
- **Circular Buffer**: Vaciado cíclico cada 30 segundos para evitar fugas de memoria
- Reproducción de audio con cola de prioridad
- Gestión de estado del pipeline: idle, listening, processing, speaking, error

#### 4.3.7 Reconocimiento de Voz Speech Recognition
- Integración con Web Speech API para transcripción en tiempo real
- Soporte para múltiples idiomas
- Detección de comandos de voz en el texto transcrito
- Resultados interinos para feedback visual inmediato
- **Speaker Diarization**: Identificación de hablante mediante "ok flu soy [nombre]"
- Registro de tono de voz: NEUTRAL, EXCITED, CONFUSED, FRUSTRATED

#### 4.3.8 Síntesis de Voz Speech Synthesis
- Integración con Web Speech API para texto a voz
- Control de velocidad, tono y volumen
- Cola de mensajes para reproducción secuencial
- Soporte para español y lenguas indígenas

#### 4.3.9 Logros e Insignias Gamification
- Sistema de logros con rarezas: común, poco común, raro, épico, legendario
- Categorías: conversación, aprendizaje, asistencia, social, exploración, constancia
- **Materia Gris**: Marcador visible de gamificación del aprendizaje que incrementa según logros
- Seguimiento de rachas (streak tracker) para motivar uso continuo
- Analytics engine para medir engagement

---

## 5. Módulos de Interfaz — El Árbol de Pestañas del Shell

El shell presenta **18 módulos** organizados en **4 bloques**. El original especifica **12 pestañas canónicas** que se inyectan dinámicamente según el rol del usuario mediante un JOIN lógico entre `app_roles`, `app_shell_tabs` y `app_offline_modules`. Los 6 módulos adicionales son extensiones aprobadas implementadas.

Cada módulo se carga lazy mediante `React.lazy()` + `Suspense`.

### 5.1 Bloque de Identidad Core `flu`

| # | Pestaña Canónica | Módulo | Funcionalidad |
|---|-----------------|--------|---------------|
| 1 | *(extensión)* Dashboard | [`FluDashboard.tsx`](flu-os/src/modules/flu/flu_dashboard/FluDashboard.tsx) | Vista general del sistema con indicadores clave, acceso rápido a funcionalidades, resumen de actividad reciente |
| 2 | `flu_profile_view` Perfil | [`FluProfileView.tsx`](flu-os/src/modules/flu/flu_profile_view/FluProfileView.tsx) | Gestión de perfil de usuario, datos personales, preferencias, historial de actividad, PIN numérico 4-6 dígitos, patrón visual dinámico, WebAuthn biométrico |
| 3 | `flu_avatar_center` Centro Avatar | [`FluAvatarCenter.tsx`](flu-os/src/modules/flu/flu_avatar_center/FluAvatarCenter.tsx) | Personalización del avatar FLU (color, accesorios), configuración de voz TTS/STT, comportamiento del avatar, historial de conversaciones (minutas), logros e insignias, tutoría conversacional directa |

### 5.2 Bloque de Operación de Aula `operaciones`

| # | Pestaña Canónica | Módulo | Funcionalidad |
|---|-----------------|--------|---------------|
| 4 | `operaciones_dashboard_alumno` Dashboard Alumno | [`DashboardAlumno.tsx`](flu-os/src/modules/operaciones/operaciones_dashboard_alumno/DashboardAlumno.tsx) | Vista del estudiante con calificaciones, tareas pendientes, progreso, logros, Materia Gris, lector digital con búsqueda semántica Orama, captura de cámara para digitalizar cuadernos |
| 5 | `operaciones_tareas_docente` Tareas Docente | [`TareasDocente.tsx`](flu-os/src/modules/operaciones/operaciones_tareas_docente/TareasDocente.tsx) | Asignación y gestión de tareas con fecha límite, materia, descripción; vista de entregas y calificaciones; co-creación de exámenes por IA; visor de miniaturas de evidencias JPEG |
| 6 | `operaciones_asistencia_panel` Asistencia | [`AsistenciaPanel.tsx`](flu-os/src/modules/operaciones/operaciones_asistencia_panel/AsistenciaPanel.tsx) | Pase de lista con estados (PRESENTE, FALTA, RETARDO, JUSTIFICADO), resumen del día, análisis de riesgo por faltas, vista de tabla, registro dual por voz o táctil |
| 7 | *(extensión)* Exámenes | [`Examenes.tsx`](flu-os/src/modules/operaciones/operaciones_examenes/Examenes.tsx) | Creación y aplicación de exámenes, captura de calificaciones, resolución por alumno |
| 8 | `operaciones_boleta_familia` Boleta Familiar | [`BoletaFamilia.tsx`](flu-os/src/modules/operaciones/operaciones_boleta_familia/BoletaFamilia.tsx) | Visualización de boletas de calificaciones por periodo, firma digital de padres, detalle de materias y promedios. Integra `CanvasFirmaPadre.jsx` con hash SHA-256 del trazo + ID boleta + timestamp |

### 5.3 Bloque de Gestión Escolar `gestion`

| # | Pestaña Canónica | Módulo | Funcionalidad |
|---|-----------------|--------|---------------|
| 9 | `gestion_juntas_cte` Juntas CTE | [`JuntasCTE.tsx`](flu-os/src/modules/gestion/gestion_juntas_cte/JuntasCTE.tsx) | Gestión de juntas de Consejo Técnico Escolar: programación, actas, acuerdos, extracción automática de acuerdos via `meetingAgreementExtract.js`, historial, control de sesión activa, roster de asistencia viva, panel de minuta automatizada |
| 10 | *(extensión)* Horarios | [`Horarios.tsx`](flu-os/src/modules/gestion/gestion_horarios/Horarios.tsx) | Gestión de horarios escolares por salón, materia y docente |
| 11 | `gestion_ceremonias_eventos` Ceremonias | [`Ceremonias.tsx`](flu-os/src/modules/gestion/gestion_ceremonias/Ceremonias.tsx) | Gestión de ceremonias cívicas y eventos escolares, lista de invitados, asistencia, control de traje escolar, instituciones de procedencia |
| 12 | `gestion_reportes_plantel` Reportes | [`Reportes.tsx`](flu-os/src/modules/gestion/gestion_reportes/Reportes.tsx) | Generación de reportes descriptivos, estadísticas de grupo, rendimiento académico, plantillas HTML/Markdown pre-configuradas |

### 5.4 Bloque de Infraestructura y Configuración `configuracion`

| # | Pestaña Canónica | Módulo | Funcionalidad |
|---|-----------------|--------|---------------|
| 13 | *(extensión)* Usuarios | [`ConfiguracionUsuarios.tsx`](flu-os/src/modules/configuracion/configuracion_usuarios/ConfiguracionUsuarios.tsx) | Gestión de usuarios del sistema, roles, permisos, autenticación |
| 14 | *(extensión)* Catálogos | [`ConfiguracionCatalogos.tsx`](flu-os/src/modules/configuracion/configuracion_catalogos/ConfiguracionCatalogos.tsx) | Administración de catálogos del sistema, edición de entradas y metadatos |
| 15 | `configuracion_sync_panel` Sincronización | [`ConfiguracionSyncPanel.tsx`](flu-os/src/modules/configuracion/configuracion_sync_panel/ConfiguracionSyncPanel.tsx) | Panel de control de sincronización, estado de conexión, cola de operaciones, estadísticas de sync, contadores de filas pendientes por tabla, estado del Service Worker, exportación/importación de bundles, monitor de consumo de costCapEngine |
| 16 | *(extensión)* Idioma | [`ConfiguracionIdioma.tsx`](flu-os/src/modules/configuracion/configuracion_idioma/ConfiguracionIdioma.tsx) | Selección de idioma de interfaz: español, náhuatl, maya, mixteco, zapoteco |
| 17 | *(extensión)* Branding | [`ConfiguracionBranding.tsx`](flu-os/src/modules/configuracion/configuracion_branding/ConfiguracionBranding.tsx) | Configuración de branding institucional, colores, logotipos, temporalidad |
| 18 | *(extensión)* Monitoreo | [`MonitorEvents.tsx`](flu-os/src/modules/monitoreo/monitor_events/MonitorEvents.tsx) | Consola de monitoreo de eventos del sistema, logs, alertas, estado de nodos |

**Pestañas canónicas del original aún no implementadas como módulos separados:**
- `configuracion_ia_diagnostico` (Diagnóstico de IA): Verificación de WebGPU, memoria Orama, tokens/segundo, estado de descarga WASM, analizador de espectro de frecuencias
- `configuracion_maestra_roles` (Consola Maestra de Permisos): Vista restringida para modificar árboles de permisos del Shell, mapear roles, habilitar/deshabilitar pestañas

---

---

## 7. Flujos Operativos del Sistema

La lógica algorítmica de la aplicación en el cliente web ejecutará de forma estricta las siguientes secuencias lógicas paso a paso para la operación diaria:

### 7.1 Arranque y Validación del Sistema

1. El usuario accede a la URL de la aplicación web de Flu OS.
2. El **Service Worker** intercepta la petición, valida el almacenamiento en caché local y permite la carga del cascarón de la aplicación PWA de forma 100% offline.
3. El sistema invoca al módulo de datos para inicializar y verificar la integridad de las **42 tablas de IndexedDB**. Si la base de datos local está vacía, inyecta los catálogos raíz sembrados por defecto.
4. Se levanta la pantalla de autenticación segura local (`flu_profile_view`). El sistema solicita las credenciales físicas offline (PIN numérico de 4 a 6 dígitos, patrón geométrico dinámico o llave WebAuthn local vinculada por hardware).
5. El sistema lee de forma local el par relacional cruzado en la tabla `app_offline_modules` basado en el rol del usuario autenticado.
6. El Shell inyecta dinámicamente y expone en el menú de navegación (`FluShell.tsx`) únicamente los identificadores de pestañas canónicas asignados a ese nivel de acceso, bloqueando físicamente el renderizado de cualquier otro módulo del sistema.

### 7.2 Conversación con FLU y Modo Juntas

1. Un usuario interactúa con la pestaña del tutor Flu (`flu_avatar_center`) o el Director arranca un Consejo Técnico Escolar (`gestion_juntas_cte`).
2. La aplicación invoca el API de captura de audio y conecta el flujo de entrada del micrófono hacia un hilo secundario de ejecución (**Web Worker**).
3. El motor **Whisper WASM** dentro del Web Worker procesa de manera continua el flujo de ondas de audio PCM de la voz, convirtiendo la señal acústica en texto plano estructurado en tiempo real.
4. **Identificación de Hablante:** El sistema analiza el texto transcrito en busca del comando de voz **"ok flu soy [nombre]"**. Si se detecta, asigna automáticamente el nombre del hablante a la sesión actual y lo registra en el mapa de hablantes para futuras intervenciones. El tono de voz y energía acústica se extraen del buffer de audio y se almacenan como metadatos en cada mensaje (tone: NEUTRAL/EXCITED/CONFUSED/FRUSTRATED).
5. **Registro Automático de Minuta:** Cada interacción conversacional se registra automáticamente como una **minuta** en la tabla `conversaciones_minutas`, clasificada por **fecha** y **secuencia numérica ascendente**. FLU es siempre incluido como participante (`es_flu: true`). Cada mensaje individual se almacena en `conversaciones_mensajes` con su emisor, tipo (`TEXTO`/`VOZ`/`SISTEMA`) y metadatos de tono.
6. **Si el modo activo es Tutor Escolar:** El texto transcrito se inyecta en el motor **Orama RAM**, ejecutando una consulta semántica para extraer los fragmentos coincidentes de los Libros de Texto Gratuitos (LTG). El orquestador de IA (`IAOrchestrator`) enriquece el contexto con el historial de conversación reciente (últimos 10 mensajes) y las referencias a minutas específicas (ej. *"minuta #5"*). Este contexto depurado se envía al motor local de **WebLLM** (*DeepSeek-R1-Distill-Llama-8B* / *Llama-3-8B-Instruct* cuantizado a 4-bits), el cual formula una respuesta socrática. Flu entra en estado *Computing* (gafas parpadeando en cian y canvas 3D reduciendo su tasa de refresco de 60 a 24 FPS para priorizar los núcleos de sombreado de la GPU hacia los cálculos matemáticos). El texto resultante es sintetizado por **Piper TTS** y articulado mediante **Rhubarb WASM** mapeando los *Morph Targets* del personaje. La respuesta de Flu se registra automáticamente como un mensaje más en la minuta activa con `es_flu: true`.
7. **Si el modo activo es Junta CTE:** El sistema conmuta a comportamiento de auditoría y la interfaz carga el tipo de junta y la sesión activa. El script especializado **`meetingAgreementExtract.js`** monitorea el texto continuo buscando patrones conversacionales de compromiso normativo (ej. *"Queda acordado..."*, *"Me comprometo a..."*). Al aislar un patrón, extrae de forma atómica el texto del acuerdo, calcula la prioridad implícita (`ALTA`, `MEDIA`, `BAJA`) e identifica al maestro responsable cruzándolo con el roster local de la tabla `users`. El sistema actualiza síncronamente la tabla local `juntas_acuerdos`, refresca las tarjetas visuales de la minuta automatizada en vivo y la sesión queda guardada. Paralelamente, toda la conversación de la junta se registra como una minuta en `conversaciones_minutas` para su consulta posterior por secuencia.

### 7.3 Asistencia y Operación de Aula

1. El docente accede a la pestaña `operaciones_asistencia_panel`. El sistema lee e inicializa la lista de alumnos activos desde `users`, `sep_inscripciones` y `sep_salones` proyectando el roster del grupo.
2. El docente ejecuta el pase de lista de forma dual: táctil (interfaz tradicional de grid) o activando el micrófono por comandos de voz continuos (el Web Worker procesa el roster e identifica presentes y faltas automáticamente).
3. El sistema actualiza transaccionalmente la tabla local `asistencias`, marcando la tupla de control, la fecha exacta del día y el método de captura (`VOZ` o `TACTIL`).

### 7.4 Tareas, Calificaciones y Validación Familiar

1. El docente crea una actividad en la pestaña `operaciones_tareas_docente` guardando los criterios en la tabla `tareas`.
2. El alumno visualiza la asignación en su pestaña `operaciones_dashboard_alumno`. Resuelve la actividad en su cuaderno físico, activa la cámara de la PWA y captura el trabajo.
3. El componente del Canvas del navegador intercepta el buffer gráfico de la imagen, escala la resolución a un máximo de **1280x720 píxeles**, reduce la calidad a un **JPEG optimizado al 60%**, almacena la cadena binaria en Base64 dentro del Object Store `app_media_blobs` y genera una referencia en la tabla `calificaciones` asociada al estudiante.
4. El docente evalúa la entrega mediante rúbricas ponderadas, asigna la nota y acumula puntos de **Materia Gris** en la tabla `app_tutor_ia_school`.
5. El padre de familia accede a la pestaña `operaciones_boleta_familia` en el plantel, revisa las notas de los periodos evaluativos e interactúa con el lienzo responsivo **`CanvasFirmaPadre.jsx`**. El trazo vectorial de su dedo es capturado, concatenado junto al ID de la boleta y una marca de tiempo UTC en un **hash SHA-256** inalterable, persistiendo los datos vectoriales en la tabla `firmas_padres`.

### 7.5 Sincronización e Integridad de Datos

1. El usuario administrador o directivo accede a la pestaña técnica `configuracion_sync_panel`.
2. El motor de sincronización ejecuta un barrido transaccional en frío dentro de IndexedDB filtrando todas las filas modificadas de las tablas cuyo valor de la columna `revision` sea superior al último registro de sincronización exitosa.
3. El sistema unifica estas filas en una estructura JSON comprimida, calcula su firma criptográfica de integridad (SHA-256) y genera el **Bundle de Transacciones Locales**.
4. **Ruta Inalámbrica (Sincronización Intermitente):** Si el script `syncClient.js` detecta conectividad de red local o internet satelital, transmite el bundle por HTTPS POST al servidor de laboratorio o backend centralizador.
5. **Ruta Física (USB Sideloading):** Si el plantel opera en aislamiento absoluto, el navegador descarga el bundle cifrado `.json` directo a la raíz de una memoria USB física para ser transportado a la supervisión de zona conectada más cercana.
6. **Resolución de Conflictos en Servidor:** Al colisionar los paquetes en el servidor centralizador, el backend ejecuta una conciliación basada en la regla **Last-Write-Wins (LWW)** contrastando la columna de la estampa de tiempo UTC `updated_at`. La fila con la marca de tiempo más reciente sobreescribe a la anterior, incrementa la revisión global y actualiza el estado transaccional en la tabla `app_sync_logs`.

---

## 8. Reglas de Ingeniería y Buenas Prácticas

Para asegurar que el desarrollo del código fuente sea óptimo para asistentes de programación autónomos, se imponen las siguientes directivas obligatorias de ingeniería:

### 8.1 Exclusión de Metadatos de IA en el Control de Versiones (`.gitignore`)

Es obligatorio aislar los archivos basura, bitácoras operativas o logs generados por asistentes de IA en la raíz del repositorio. El archivo `.gitignore` debe contener explícitamente:

```text
# Exclusión de metadatos de IA de desarrollo y bitácoras de Aider
.aider*
```

### 8.2 Estrategia Git Rigurosa

Queda prohibido realizar confirmaciones (*commits*) directos a las ramas de producción `main` o `master`. El flujo de desarrollo exige el uso de ramas de características aisladas (`feature/*`), condicionando su integración a pruebas locales que validen un rendimiento estable a 60 FPS offline y cero fugas de memoria.

### 8.3 Aislamiento Ciego de Sesiones Conversacionales (Anti-Mezcla de Contexto)

Para erradicar el riesgo crítico de que las respuestas de la Inteligencia Artificial mezclen datos de distintos alumnos o materias debido a la persistencia estática en memoria RAM, el motor conversacional local obliga a que cada llamada de inferencia inicialice un contexto ciego aislado. Este contexto está determinado de forma unívoca por una clave primaria compuesta inalterable:

**ID Contexto Único = escuela_id + alumno_id + materia_id**

Antes de procesar cualquier token de prompt, el sistema purga variables globales residuales de la sesión previa en el Web Worker y carga estrictamente las filas relacionales que correspondan a esa llave compuesta desde el almacén local, blindando la integridad de la tutoría personalizada.

### 8.4 Protección contra Fugas de Memoria en Captura de Audio

El pipeline de audio implementa un sistema de vaciado cíclico en anillo (*Circular Buffer*). Cada 30 segundos, una vez que el bloque de audio es procesado y transcrito localmente por el motor Whisper WASM en el hilo secundario (Web Worker), la memoria cruda del buffer de ondas PCM de audio es destruida explícitamente mediante operaciones de recolección de basura forzadas. Esto previene de forma absoluta el desbordamiento de la memoria RAM del navegador, garantizando estabilidad operativa durante jornadas escolares continuas de más de 8 horas en hardware de bajas especificaciones.

### 8.5 Aislamiento Multihilo para Interfaces Fluidas a 60 FPS

Las lógicas de renderizado del avatar animado 3D se aíslan mediante micro-tareas asíncronas controladas por `requestAnimationFrame`. Toda comunicación de datos entre el hilo que procesa la base de datos (IndexedDB) y la interfaz gráfica del personaje se transmite mediante mensajes serializados asíncronos (`postMessage`), asegurando que la UI mantenga un rendimiento estable y fluido a 60 cuadros por segundo sin sufrir tirones visuales (*lag*).

### 8.6 Pipeline Híbrido de Datos Permanentes e Índices de Memoria

La persistencia en frío descansa en IndexedDB por su capacidad para retener gigabytes de datos sin internet. Al arrancar el sistema, un proceso en background lee los catálogos de libros de texto SEP y documentos vigentes desde IndexedDB y los inyecta para estructurar el índice en memoria RAM del motor Orama. Las consultas semánticas conversacionales resuelven en microsegundos directo en la memoria RAM de Orama, y cualquier modificación relacional o transaccional se escribe de forma atómica en frío dentro de IndexedDB, logrando un balance perfecto entre velocidad y persistencia inalterable.

---

## 9. Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Lenguaje | TypeScript (estricto) | Tipado seguro para 42+ tablas y 18 módulos |
| Build | Vite 5 + React 18 | Rapidez, HMR, PWA |
| Routing | React Router v6 | Navegación lazy de módulos |
| Estado Global | Zustand | Ligero, persistencia selectiva |
| DB Local | Dexie.js (wrapper IndexedDB) | Versioning, queries reactivas |
| Estilos | Tailwind CSS 3 | Utility-first, purge automático |
| PWA | vite-plugin-pwa | Service Worker, caching offline |
| Testing | Vitest + React Testing Library | Tests de inmutabilidad |
| 3D Avatar | Three.js + @react-three/fiber | Alternativa offline a Spline Runtime con control total y sin dependencia de red |
| IA Local | WebLLM + Orama + Whisper WASM + Piper TTS + Rhubarb WASM | Edge computing completo |
| Hosting | Cloudflare Pages o GitHub Pages | Hosting estático $0.00 USD |

---

## 10. Límites del Proyecto

Para mantener la viabilidad del desarrollo y enfocar los esfuerzos de ingeniería de forma realista, el alcance de Flu OS 2.0 define con claridad qué responsabilidades pertenecen al software del cliente y cuáles quedan en manos de la infraestructura del estado en etapas posteriores:

1. **Provisión de Infraestructura de Red y Antenas Satelitales:** El software de Flu OS optimiza el empaquetado de datos (paquete inicial estático ~2.5 GB, deltas mensuales comprimidos ~20 MB), permitiendo su transporte en USB o ráfagas intermitentes. Sin embargo, la provisión, instalación y costos de antenas satelitales, planes de datos móviles o repetidoras de microondas en zonas vulnerables es responsabilidad del estado, permaneciendo el software independiente de dichos medios de transmisión.
2. **Capa Central Gubernamental y Analítica Masiva (BI):** El cliente de Flu OS garantiza el procesamiento autónomo, la consistencia local y el control offline en el aula, plantel o zona escolar. El montaje de Data Centers masivos para albergar la gran base de datos histórica nacional de la SEP, la implementación de firewalls perimetrales centrales, los esquemas de Single Sign-On (SSO) institucionales corporativos y los tableros de analítica masiva (*Business Intelligence*) para la alta dirección política son sistemas externos ajenos al desarrollo core del cliente offline aquí especificado.

---

## 11. Extensiones Aprobadas

### 11.1 Consola de Monitoreo de Actualizaciones por Jerarquía

**Propósito:** Rastrear el estado de sincronización de todos los dispositivos del ecosistema escolar organizados por jerarquía geográfica y administrativa (Escuela -> Zona -> Entidad -> Nacional). Esencial para escenarios donde alumnos y escuelas están permanentemente offline y solo se sincronizan cuando tienen oportunidad.

**Funcionalidad:**
- **Vista por jerarquía:** Navegación descendente desde nivel nacional hasta dispositivo individual
- **Dashboard de estado:** Indicadores visuales tipo semáforo (verde=actualizado, amarillo=pendiente, rojo=rezago)
- **Detalle por nodo:** Muestra `device_uuid`, `escuela_id`, `ultima_sincronizacion`, `paquete_version`, `estatus_conexion`
- **Historial de eventos:** Registro cronológico de cada sincronización por dispositivo
- **Alertas automáticas:** Notificación cuando un nodo supera X días sin sincronizar (configurable por jerarquía)
- **Exportación de reportes:** Generación de informes de estado para supervisión

**Tablas adicionales:** `monitor_nodos`, `monitor_historial_sync`, `monitor_alertas_rezago` (detalladas en sección 6.5)

### 11.2 Módulo de Branding Inteligente por Temporalidad

**Propósito:** Personalizar la apariencia visual de la aplicación según la época del año, festividades mexicanas y eventos escolares, con generación automática por IA local.

**Funcionalidad:**
- **Calendario de temporalidades:** Conocimiento del calendario escolar SEP y festividades mexicanas (Navidad, Día de Muertos, 16 de Septiembre, Día del Niño, Día del Maestro, Día del Padre/Madre, Revolución, etc.)
- **Generación por IA local:** Usando WebLLM se genera paleta de colores temática, ilustraciones y overlays SVG generados proceduralmente, mensajes de bienvenida personalizados, fondos y decoraciones para el Shell
- **Configuración manual:** El administrador puede activar/desactivar branding automático, seleccionar temporalidad manualmente, subir su propio branding (logo, colores), y programar cambios futuros
- **Persistencia offline:** Las configuraciones se almacenan en tabla `app_branding_config` y los assets generados en `app_media_blobs`

**Tabla adicional:** `app_branding_config` (detallada en sección 6.5)

### 11.3 Áreas Adicionales de IA Generativa

Además de las funcionalidades de IA ya especificadas (tutoría socrática en `flu_avatar_center` y extracción de acuerdos en `gestion_juntas_cte`), se incorporan los siguientes casos de uso de IA generativa local:

| # | Funcionalidad | Módulo | Descripción |
|---|--------------|--------|-------------|
| 1 | **Planeaciones Didácticas** | `operaciones_tareas_docente` | El docente solicita una planeación de sesiones y la IA la genera alineada al plan SEP usando los LTG indexados en Orama |
| 2 | **Retroalimentación Automática** | `operaciones_tareas_docente` | Al calificar, la IA genera retroalimentación personalizada para cada alumno basada en la rúbrica y la evidencia |
| 3 | **Reportes Narrativos** | `gestion_reportes_plantel` | A partir de datos crudos, la IA genera reportes en lenguaje natural para padres y supervisores |
| 4 | **Exámenes Adaptativos** | `operaciones_dashboard_alumno` | Basado en el historial de Materia Gris, la IA genera exámenes personalizados al nivel de cada alumno |
| 5 | **Guiones de Ceremonias** | `gestion_ceremonias_eventos` | La IA genera guiones completos, discursos y datos históricos para efemérides y ceremonias cívicas |
| 6 | **Branding Temporal** | `configuracion_branding_temporal` | La IA genera paletas de colores, SVG decorativos y mensajes temáticos según la época del año |

### 11.4 Modelo de Sincronización Multi-Escenario

El sistema de sincronización debe operar en 4 escenarios distintos de conectividad, adaptándose automáticamente al contexto de cada dispositivo:

| Escenario | Escuela | Alumno | Método de Sincronización |
|-----------|---------|--------|-------------------------|
| **A** | Sin internet | Sin datos móviles | USB Sideloading (bundle .json cifrado transportado físicamente) |
| **B** | Con internet | Sin datos móviles | Sync automático escuela-servidor; alumno sincroniza por WiFi escolar o USB |
| **C** | Sin internet | Con datos móviles | Escuela usa USB; alumno sincroniza por datos móviles con límite de `costCapEngine` |
| **D** | Con internet | Con datos móviles | Sync completo bidireccional para ambos |

**Datos sincronizados por dirección:**

| Dirección | Contenido |
|-----------|-----------|
| **Servidor/Escuela -> Alumno** | Exámenes asignados, tareas, libros actualizados (deltas Orama), calificaciones, retroalimentación, configuraciones, paquetes de conocimiento |
| **Alumno -> Servidor/Escuela** | Evidencias de tareas (fotos JPEG), exámenes resueltos, progreso Materia Gris, historial de tutoría con Flu |

---




Debemos estar preparados para una pandemia y tener funcionalidad de clases remotas
transmitir en vivo tipo zoom/teams

Debemos ampliar el alcance a tener lo siguiente

comunicaciones institucionales
publicaciones
noticias
Chat interno
geolocalizacion
Encuestas
Marketplace

## Backlog Técnico — OS4

### 1. Eliminar proxy Gemini y unificar llamadas a IA
- **Problema**: OS4 tiene dos sistemas paralelos para llamar a Gemini:
  - Voice assistant (OS2): `requestFluContract()` → fetch al proxy (`/api/gemini/contract`) → `generateFluContract()` en Node.js
  - Resto de la app (OS3): `geminiService.generateFluContract()` → fetch directo a Google desde el navegador
- El proxy (`src/server/geminiProxy.ts`) corre en Node.js donde no hay `localStorage`, por lo que no puede leer el modelo configurado por el usuario (`flu-text-model`).
- **Solución**: Migrar el voice assistant para que use `geminiService.generateFluContract()` directo (como OS3), eliminando el proxy y el código duplicado en `src/voice/lib/gemini.js`.
- **Dependencia**: Requiere que `useFluVoiceAssistant.js` use `geminiService` en lugar de `requestFluContract()`.

### 2. Implementar costCapEngine (Control de Costos)
- **Definido en**: Sección 4.1.13 — Límite máximo de 3 consultas nuevas en línea al día por usuario.
- **Estado**: No implementado en OS4.
- **Acción**: Crear `costCapEngine` que:
  - Lleve contador de consultas a Gemini por día (localStorage)
  - Al alcanzar el tope, bloquee llamadas a Gemini y conmute a WebLLM local
  - Reseteo diario automático

### 3. Implementar IA Local con WebLLM
- **Definido en**: Sección 4.1.1 — DeepSeek-R1-Distill-Llama-8B, Llama-3-8B-Instruct, Phi-3.5-Mini-Instruct, Gemma-2-2B-IT.
- **Estado**: No implementado en OS4.
- **Acción**: Integrar WebLLM como motor de inferencia local, con conmutación automática cuando se alcance el límite de costCapEngine o no haya conexión.

### 4. Regla de capas de voz (afinado estructural)
- **Qué**: La lógica de voz se separa por capas para evitar que vuelva a crecer el monolito del hook:
  - `src/voice/lib/*` = **lógica pura y testeable** (sin React, sin refs, sin efectos). Ej.: [`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js), [`audioMath.js`](src/voice/lib/audioMath.js), [`configCommands.js`](src/voice/lib/configCommands.js).
  - `src/voice/hooks/*` = **solo orquestación, estado y efectos** (React hooks). Ej.: [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js).
  - `src/core/*` = **dominios de negocio** (catálogos, servicios, parsers). Ej.: [`voiceConfigCatalog.ts`](src/core/config/voiceConfigCatalog.ts).
- **Regla**: Prohibido meter negocio/parseo dentro de un hook gigante. Si una decisión es testeable en aislamiento, debe vivir en `lib/` como función pura y el hook solo orquestarla.
- **Regla de cohesión**: Al añadir helpers, agruparlos en módulos cohesivos por responsabilidad en lugar de crear un archivo por función (evitar fragmentación excesiva).

*Fin del documento — CONTEXTO FLU OS 2.0 — Funcionalidades, Definición y Alcance*
*Fuente base: CONTEXTO_FLU_OS.md — Versión completa sin omisiones.*


