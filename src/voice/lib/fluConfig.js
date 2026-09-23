/** Configuración central de FLU. */
import { OPENROUTER_DEFAULTS } from '../../core/config/sharedConfig'
import { SPEECH_LOCALES, DEFAULT_SPEECH_LOCALE, BILINGUAL_LOCALES } from '../../core/config/localeConfig'
import { DEFAULT_SAMPLE_RATE } from './audioConstants.js'

/** Entorno de desarrollo: los defaults de diagnostico solo se encienden aqui. */
const IS_DEV = import.meta.env.DEV

/**
 * Wake words + alias ASR (Chrome confunde flu → flow/blue/flo).
 * Fuente ÚNICA del wake word (§9.4): `voiceCommands.wakeWords` y el sesgo del
 * decoder (`initialPrompt`) derivan de aquí. Configurable en Ajustes.
 */
export const FLU_WAKE_WORDS = Object.freeze([
  'oye flu',
  'oye flow',
  'oye blue',
  'oye flo',
  'ok flu',
  'ok flow',
  'ok blue',
  'ok flo',
  'okay flu',
  'okay flow',
  'okay blue',
  'okay flo',
  'hey flu',
  'hey flow',
  'hey blue',
  'hey flo',
])

/** Primer alias de wake para un prefijo dado (deriva de FLU_WAKE_WORDS). */
const firstWakeWith = (prefix) => FLU_WAKE_WORDS.find((w) => w.startsWith(prefix)) || ''

const LISTENING_ACK_PHRASES = Object.freeze([
  'estas escuchando',
  'me escuchas',
  'estas ahi',
  'estas ahí',
  'estas por ahi',
  'estas por ahí',
  `${firstWakeWith('oye ')} estas escuchando`,
  'are you listening',
  'can you hear me',
  `${firstWakeWith('hey ')} are you listening`,
])

/** Allowlist curada del navegador: fuente unica de los sitios permitidos. */
const CURATED_ALLOWLIST = ['wikipedia.org', 'educ.ar']
/** Variante Familiar: la allowlist curada mas video. */
const CURATED_ALLOWLIST_FAMILIAR = [...CURATED_ALLOWLIST, 'youtube.com']

export const FLU_CONFIG = {
  sessionDefaults: {
    role: 'Asistente del Maestro',
    theme: 'sesion general',
    userId: '',
  },
  limits: {
    auditLogMax: 200,
    /** Tope visible del log de conversación para evitar crecimiento infinito. */
    conversationLogMax: 180,
    /** Máximo de filas de minutas que entran al prompt de consulta. */
    minuteKnowledgePromptMax: 24,
    /** Máximo de filas de conversación que entran al prompt de resumen. */
    conversationSummaryWindowMax: 80,
    /** Filas recientes usadas para recortar interinos acumulativos de Chrome. */
    priorRowsMax: 64,
    /** Tope del archivo interno de sesión (caracteres); evita crecimiento infinito. */
    sessionTranscriptMaxChars: 80000,
    contextHistoryMax: 12,
    /** Límites del análisis de documentos (F1). Centralizados aquí (Rule #1: NO HARDCODE). */
    documentAnalysis: {
      /** Tope del archivo a analizar (bytes). */
      maxFileSizeBytes: 25 * 1024 * 1024,
      /** Tope de caracteres de texto extraído que se conservan. */
      maxTextChars: 200000,
      /** Tope de chunks que alimentan el map-reduce del LLM. */
      maxChunks: 48,
      /** Tamaño objetivo de cada chunk (caracteres). */
      chunkChars: 4000,
      /** Tope de hojas/páginas/slides inspeccionadas. */
      maxSheets: 40,
      /** Tope de celdas inspeccionadas por hoja. */
      maxCellsPerSheet: 12000,
    },
  },
  voiceIdentity: {
    labels: {
      fallbackSpeaker: 'Hablante 1',
      /** Plantilla de etiqueta automática («Hablante {n}») — sin literales quemados. */
      template: 'Hablante {n}',
    },
    confidence: {
      display: {
        high: '',
        medium: '',
        low: '(?)',
      },
    },
    capture: {
      passiveBufferMs: 30000,
      /** Fallback OFFLINE (§1/§9): errores de Chrome SpeechRecognition que
       *  degradan al motor local Whisper WASM. Sin hardcode: la lista vive
       *  aquí y puede afinarse desde config. */
      recognition: {
        fallbackErrors: ['network', 'no-speech'],
      },
      conversationSpeakerTailMs: 5000,
      /** Tope de ventana de audio en límite de turno (ms). */
      turnBoundaryTailCapMs: 900,
      /** Voz mínima para analizar timbre (ms). Más bajo = más sensible. */
      conversationMinVoicedMs: 8,
      /** Voz mínima para nuevo hablante (ms); bajo en sala/TV para no perder cambios de voz. */
      conversationMinVoicedForNewMs: 2200,
      conversationMaxAutoSpeakers: 0,
      /** Umbrales de similitud coseno entre embeddings WavLM-SV 512-D (mayor = misma persona). */
      conversationSpeakerThresholds: {
        /** Misma persona con variación natural de tono NO crea H2/H3. Subido para separar voces claras. */
        cosineMatchThreshold: 0.85,
        /** Re-identificación room-rematch estricta (512-D L2 + coseno). */
        roomRematchThreshold: 0.80,
        roomRematchThresholdMax: 0.80,
        roomRematchShortThreshold: 0.80,
        cosineContinuityThreshold: 0.80,
        cosineNewVoiceThreshold: 0.75,
        /** Caída de similitud coseno que indica cambio abrupto de voz en ingress. */
        abruptSimilarityDrop: 0.08,
        cosineRegisteredMatchThreshold: 0.76,
        /** Distancia coseno máxima para pegar al hablante del turno anterior. */
        lastTurnSignatureContinuityDistance: 0.075,
        /** Reutilización de cluster en producción (512-D real). */
        productionClusterReuseThreshold: 0.78,
        shortUtteranceMaxMs: 1500,
        shortUtteranceThresholdRelax: 0.04,
        /** Con ≥N clusters y frase no corta: sube umbral (evita colapsar voces distintas). */
        roomRematchMultiClusterAfter: 3,
        roomRematchMultiClusterBoost: 0.03,
        /** Tras N ecos committed-echo consecutivos, rebuild SR (Chrome atascado). */
        committedEchoRebuildAfter: 3,
        /** Ventana (ms) para clasificar un eco ASR real: la misma fila re-emitida DENTRO
         * de esta ventana es un loop de Chrome (atascado). Si la misma frase vuelve tras
         * una pausa real (>= esta ventana), es repetición genuina del usuario: se trata
         * como voz nueva, NO se descarta ni se cuenta como eco. */
        committedEchoStreakWindowMs: 1200,
        turnBoundaryVoicedFactor: 0.32,
        turnBoundaryNewVoiceFactor: 0.82,
        /** Frases cortas inestables: unificar con histórico si coseno ≥ este valor (evita H7/H8). */
        shortUtteranceHistoricalMatch: 0.74,
        /** <4 palabras: mantener locutor anterior si coseno ≥ 0.68 (evita H5/H7). */
        shortUtteranceImmediateContinuity: 0.76,
        shortUtteranceImmediateMaxWords: 4,
      },
      /** Matching de perfiles guardados vs clusters (identificación por segmento). */
      profileMatch: {
        registeredProfileMaxDistance: 0.12,
        clusterMatchMaxDistance: 0.09,
        clusterSignatureBlendWeight: 0.5,
      },
      embedding: {
        modelId: 'Xenova/wavlm-base-plus-sv',
        targetSampleRate: 16000,
        minSampleRatio: 0.35,
        quantized: true,
        logProgress: false,
      },
      /** Sala / TV: captura pasiva sin AEC; reglas anti-clusters fantasma. */
      roomCapture: {
        deferNewSpeakerUntilCommit: true,
        pruneGhostClusters: true,
        stickySpeaker: true,
        /** Tras «ok flu soy …» mantener ese nombre en turnos siguientes (misma voz). */
        pinRegisteredSpeaker: true,
        /**
         * Nombre propio solo vía wake + comando (REGISTRAR_PARTICIPANTE).
         * Sin wake: diarización genérica (Hablante N); no inferir «Luis» del texto pasivo.
         */
        requireWakeWordForSpeakerName: true,
        /** Al registrar por wake, renombrar todas las filas con etiquetas auto que coincidan por voz. */
        renameSessionAutoLabelsOnRegister: true,
        /** Umbral relajado para no crear Hablante N tras registro con nombre propio. */
        registeredMatchRelax: 1.42,
        /**
         * Misma voz no salta H1→H2 por ruido/TV; si el timbre es distinto sí abre H2, H3…
         * (reuniones variables). No significa «solo una persona en la sala».
         */
        soloSpeakerSticky: false,
        strictCosineDiarization: true,
        /** En límite de turno: nueva voz acústica abre cluster (Hablante 2+). */
        turnBoundaryAllowNewCluster: true,
        /** Relaja match al mismo timbre entre frases cortas (a ver / qué pasa). */
        turnBoundaryMatchRelax: 2.35,
        /** En pausa/final exige más distancia para «otra voz» (TV no abre H2; sala sí). */
        turnBoundaryDistinctFactor: 1.18,
        /** Con ≥2 hablantes en sesión: match más estricto (mic real no colapsa a H1). */
        turnBoundaryMatchRelaxMulti: 1.12,
        /** Margen para no reabsorber cluster antiguo si voz distinta del turno actual. */
        turnBoundaryClusterReabsorbMargin: 0.035,
        /** Con varios hablantes: umbral «nueva voz» más bajo (mic laptop). */
        turnBoundaryNewVoiceMultiFactor: 0.72,
        /** Cambio de voz vs turno anterior (mic débil, misma sala). */
        turnBoundaryLastTurnFactor: 0.48,
        /** Reutilizar cluster si distancia < match × factor (re-identificación en junta). */
        roomRematchFactor: 1.12,
        /** Un solo cluster (TV/junta inicio): match estricto; no confundir hija con H1. */
        roomRematchSingleCluster: 1.08,
        /** Margen coseno mínimo para saltar de lastSpeaker a otro cluster (evita H1→H3 por TV). */
        lastSpeakerSwitchMargin: 0.1,
        /** Si lastSim ≥ NEW_VOICE × factor, no abrir hablante nuevo por audio débil. */
        lastSpeakerLowSimRetainFactor: 0.72,
        /** Crear hablante solo si lejos del mejor cluster Y del último turno. */
        newPersonMinFactor: 1.05,
        /**
         * Distancia mínima (× newVoice) para abrir H2+ en commit.
         * Alto = no fragmentar tu misma voz por ruido; bajo solo con timbre muy distinto (hija).
         */
        roomNewPersonFactor: 2.0,
        /** Con ≥1 cluster: timbre distinto pero < factor estricto (mic laptop). */
        roomSessionNewFactor: 1.4,
        /** 0 = sin tope duro por salón (N personas reales → N hablantes). */
        maxAutoSpeakersInRoom: 0,
        /** 0 = sin tope blando; anti-fantasma vía productionClusterReuseThreshold + segmentChronoSplit. */
        maxAutoSpeakersSoftCap: 0,
        /** No escribir clusters en preflight continuo; solo al commit de turno. */
        deferClusterWritesUntilCommit: true,
        /** Desactivado: pausas no abren H2+ en la misma voz (causa H46 en monólogo/TV). */
        segmentChronoSplit: false,
        /** No vaciar openLine al límite de turno (evita perder frase al cambiar hablante). */
        preservePreviewOnTurnBoundary: true,
        /** No bloquear previews más cortos (TV/ASR fluctúa). */
        preserveAllPreview: true,
        /**
         * Cerrar preview al cambiar hablante. Desactivado en sala solo: generaba
         * commits fantasma (H1→H4) y huecos percibidos como «congelado».
         */
        commitPreviewOnSpeakerChange: false,
        commitPreviewOnSoloAutoDrift: false,
        minCharsToCommitOnSpeakerChange: 6,
        /** Con ≥N clusters: preferir re-identificación a timbre histórico vs anclar al último. */
        preferHistoricalClusterInMultiSpeakerRoom: true,
        multiSpeakerRoomClusterMin: 3,
        /**
         * Sala de clase: varios hablantes reales (relaja anclaje H1, alarga ventana al commit).
         * No desactiva captura total ni filtros TV; solo ajusta umbrales de diarización.
         */
        classroomMultiSpeaker: true,
        classroomTurnBoundaryTailCapMs: 1800,
        classroomMinVoicedForNewMs: 1400,
        classroomLastSpeakerSwitchMargin: 0.06,
        classroomMultiSpeakerRoomClusterMin: 2,
        classroomReuseRelax: 0.03,
        classroomNewVoiceRelax: 0.04,
        /** Factor de relajación de "solo". 1.0 = sin relajación: una voz claramente
         *  distinta separa aunque solo haya hablado 1 persona (hombre/mujer/niño).
         *  La protección anti "hola hola" la aporta el coalesce de frase corta. */
        soloNewVoiceFactor: 1.0,
        /** Tras ≥N clusters auto: no forzar production-primary-rematch si otro cluster encaja mejor. */
        classroomPrimaryRematchMaxClusters: 1,
        /**
         * Vincular la voz del participante activo (perfil creado: Juan/Luis) a su nombre.
         * Cuando hay un participante real con nombre propio activo, se siembra como
         * sessionPrimary para que la diarización etiquete sus turnos con su nombre
         * (no «Hablante N»). Solo aplica con participante real (no anónimo/default).
         */
        seedSessionPrimaryFromActiveParticipant: true,
        /** Crear el cluster del participante primario si aún no existe (primer turno). */
        sessionPrimaryCreateCluster: true,
      },
      /** Factores de diarización (sin hardcode): los literales 0.82/0.88/0.92/0.95/… viven aquí. */
      diarizationFactors: {
        /** Gate de continuidad en límite de turno: CONTINUITY × factor. */
        continuityBoundaryFactor: 0.82,
        /** Factor de voz nueva en límite de turno (fallback si no hay threshold configurado). */
        newVoiceBoundaryFactor: 0.88,
        /** Match al sticky fuera de límite: MATCH × factor. */
        stickyMatchFactor: 0.92,
        /** Match al último cluster fuera de límite: MATCH × factor. */
        lastClusterMatchFactor: 0.95,
        /** Margen para no reabsorber el cluster sticky con voz distinta. */
        stickyClusterReidentifyMargin: 0.025,
        /** Umbral de voz nueva más estricto al alcanzar el tope de auto-hablantes. */
        strictNewVoiceAtCapFactor: 0.88,
        /** Umbral de voz nueva más estricto con sticky en tope blando. */
        strictNewVoiceStickySoftCapFactor: 0.82,
      },
      /** Siempre mic sala al escuchar (máx sensibilidad, también antes de «Iniciar conversación»). */
      maxSensitivity: true,
      conversationUsePassiveAudio: true,
      conversationAutoDiarize: true,
      conversationTurnAlignedDiarize: true,
      captureRoomAudio: true,
      conversationPassiveAudioDelayMs: 0,
      /** Snapshots de identidad durante interinos (ms). */
      identityPipeline: {
        snapshotIntervalMs: 800,
        /** Pausa mínima (ms) tras commit para forzar nuevo hablante por segmento. */
        segmentSilenceGapMs: 1200,
      },
      conversationAudio: {
        /** false = no atenuar eco de TV/altavoz (máx captura de sala). */
        echoCancellation: false,
        noiseSuppression: false,
        /** AGC del navegador atenúa TV — desactivado en sala. */
        autoGainControl: false,
        /** Ganancia digital (mayor = más sensible). */
        captureGain: 30,
        /** Umbral adaptativo: por debajo se considera silencio (dBFS). */
        silenceThresholdDb: -45,
        /** Pausas naturales antes de cortar segmento de voz (ms). */
        voiceHoldMs: 1200,
        analyserSmoothing: 0.1,
        processEvery: 1,
      },
    },
  },
  timing: {
    resumeListeningMs: 50,
    resumeAfterSpeechMs: 50,
    /** Fase 7 — reanudación dinámica según longitud de respuesta (clamp [min,max]). */
    resumeAfterSpeechMinMs: 50,
    resumeAfterSpeechMaxMs: 500,
    /** Factor por carácter para escalar el retraso dentro de [min, max]. */
    resumeAfterSpeechPerCharMs: 0.5,
    workspaceImageMs: 140,
    recognitionStopMs: 250,
    recognitionFinalizeMs: 200,
    transcriptSettleStepMs: 40,
    transcriptSettleStableMs: 120,
    transcriptSettleMaxMs: 200,
    /** Agrupa refrescos de «última frase» (menos re-renders React). */
    liveTranscriptDebounceMs: 32,
    /**
     * Ventana de idempotencia de la RESPUESTA: la misma respuesta para el mismo
     * turno dentro de este margen se considera re-captura/eco y NO se repite.
     */
    responseDedupWindowMs: 8000,
    /** @deprecated Interinos ya no escriben al log; solo aplica a rutas legacy. */
    streamLogThrottleMs: 0,
    wakeWordCommandDelayMs: 3000,
    interimCommandDelayMs: 1400,
    /**
     * Espera antes de abrir la escucha al COMPLETAR el onboarding (el TTS de
     * cierre y el cierre del overlay tienen que asentarse). Config-driven:
     * antes vivía como un `700` literal en App.tsx.
     */
    onboardingStartListeningDelayMs: 700,
    /**
     * Consolidación de BUSCAR: los reinicios del reconocedor entregan el mismo
     * comando en varias revisiones (parcial → completo). Para NO buscar 2 veces,
     * la búsqueda se ejecuta cuando el turno se asienta (la última revisión gana).
     */
    searchCommandSettleMs: 2800,
    /**
     * Estabilización de fragmentos (Bug #3/#4): si el turno quedó en un comando
     * incompleto que espera contenido ("busca en la web", "navega", "crea un
     * video"…) se espera este margen desde el último fragmento final antes de
     * ejecutar, para dar tiempo a que el ASR entregue la continuación en un
     * fragmento posterior sin disparar consultas vacías.
     */
    incompleteCommandWaitMs: 6000,
    /**
     * Dictado: cuanto más larga es la frase en curso, más margen se da antes de
     * auto-procesar. Evita cortar al usuario que dicta una lista pensando y
     * hablando entre ítems ("estoy pensando y hablando, lleva tiempo… no puedes
     * cortarlo"). Los comandos cortos siguen disparando rápido.
     */
    dictationGraceWords: 2,
    dictationGraceBaseMs: 800,
    dictationGracePerWordMs: 120,
    dictationGraceMaxMs: 4000,
    conversationMinMsAfterLastResult: 250,
    interimFinalizeGraceMs: 250,
    conversationSettleStableMs: 300,
    /** Retraso antes de auto-stop en modo pasivo (ms). */
    scheduleAutoProcessDelayMs: 150,
    /** Reintento mientras hay commit en curso (ms). */
    scheduleAutoProcessWhileCommittingMs: 15,
    /** Retraso por defecto al reiniciar SpeechRecognition (ms). */
    recognitionRestartDefaultDelayMs: 120,
    /** Duración del banner de error recuperable en conversación (ms). */
    errorBannerClearMs: 2000,
    /** Backoff onend pasivo: base + streak * step, cap max (ms). */
    passiveRestartStreakBaseMs: 60,
    passiveRestartStreakStepMs: 30,
    passiveRestartStreakMaxMs: 280,
    passiveRestartStreakThreshold: 4,
  },
  /** TTS del navegador (Chrome corta utterances largos; SR activo puede bloquear audio). */
  speech: {
    chunkMaxChars: 220,
    resumeBeforeSpeak: true,
    // Tope duro de una locución: si el navegador no dispara `onend`/`onerror`
    // (bug de Chrome), el watchdog libera el habla y la escucha no se bloquea.
    watchdogMs: 20000,
  },
  /** Audio del motor de voz: sample rate de captura (fuente única, sin hardcode). */
  audio: {
    sampleRate: DEFAULT_SAMPLE_RATE,
  },
  /** Escucha activa local (SpeechRecognition del navegador). */
  activeListen: {
    languages: { ...SPEECH_LOCALES },
    /** Escucha bilingüe: alterna locale SR según detectTranscriptLanguage. */
    bilingual: {
      defaultLocale: DEFAULT_SPEECH_LOCALE,
      locales: [...BILINGUAL_LOCALES],
      /** Interinos consecutivos en otro idioma antes de cambiar SR. */
      stableInterims: 2,
      minCharsToSwitch: 10,
    },
    recognition: {
      interimResults: true,
      continuous: true,
      maxAlternatives: 3,
    },
    restart: {
      delayMs: 0,
      retryBackoffMs: 150,
      /** 0 = reintentos ilimitados en conversación (Chrome corta solo). */
      maxRetries: 0,
      maxBackoffMs: 1800,
      /** Reconocimiento activo pero sin onresult → rebuild (mic colgado). */
      silentMicStallMs: 6500,
      /** Pausas largas TV / anuncios sin cortar escucha (modo pasivo). */
      stallMs: 52000,
      /** En conversación: sin texto nuevo (ignorando ecos SR) → rebuild. */
      conversationStallMs: 4200,
      stallCheckMs: 350,
      stallRebuildMinMs: 6000,
      /** Mínimo entre rebuilds en conversación activa. */
      conversationStallRebuildMinMs: 1600,
      /** Tras onend en conversación, reinicio SR si no hay onstart. */
      conversationDeadRecognitionMs: 900,
      /** Tras onend, si sigue sin onstart → reinicio rápido. */
      deadRecognitionMs: 2500,
    },
    logRelateWindowMs: 12000,
    speakers: {
      /** Mínimo entre diarizaciones por audio (ms). Más bajo = más sensible. */
      diarizeIntervalMs: 120,
      defaultLabel: 'Hablante 1',
      maxSpeakers: 0,
      labelTemplate: 'Hablante {n}',
      paragraphBreakMs: 2200,
      paragraphBreakOnPause: true,
      autoAdvanceOnPause: false,
    },
    listeningAck: {
      phrases: LISTENING_ACK_PHRASES,
      message: 'Te escucho',
      durationMs: 2200,
    },
  },
  /**
   * Escucha continua — solo reinicio tras onend / no-speech (ciclo normal de Chrome).
   */
  listening: {
    watchdogMs: 900,
    restartAfterEndMs: 0,
    restartAfterNoSpeechMs: 0,
    restartAfterNetworkMs: 0,
  },
  navigation: {
    sessionResetCommand: 'INICIAR_CONVERSACION',
  },
  knowledgeBase: {
    general: 'KB general',
    minutes: 'KB minutas',
  },
  /** Parámetros Gemini (contrato, resumen, participación). */
  gemini: {
    contract: {
      temperature: 0.2,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    },
    summary: {
      temperature: 0.15,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
    participantEval: {
      temperature: 0.35,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 512,
    },
  },
  /**
   * Agenda / orden del día: compila pendientes de minutas guardadas
   * y los inyecta en el contexto de Gemini para que FLU los recuerde
   * naturalmente al usuario.
   */
  agenda: {
    enabled: true,
    maxItems: 5,
    minImportance: 0.3,
    injectOnStartup: true,
    proactiveReminder: true,
    // Fase 2 — B5: cuántos recordatorios pendientes se fusionan a la agenda.
    maxReminders: 5,
    // Solape mínimo de tokens (0-1) para casar la etiqueta de una serie de
    // agenda (cancelar/editar/consultar por voz). Fuente única del matcher.
    labelMatchMinTokenOverlap: 0.6,
    // Etiquetas de sección del listado DETERMINISTA "¿qué hay para hoy?"
    // (src/core/agenda/todayAgenda.ts). Sin hardcode: texto editable aquí.
    voice: {
      horario: { es: 'Agenda de hoy', en: "Today's agenda" },
      reminders: { es: 'Recordatorios y citas', en: 'Reminders and appointments' },
      alarms: { es: 'Alarmas', en: 'Alarms' },
      notes: { es: 'Notas pendientes', en: 'Pending notes' },
      empty: { es: 'No tienes nada programado para hoy.', en: "You have nothing scheduled for today." },
    },
    // Color POR TIPO (derivado en lectura, nunca guardado). Fuente única del
    // calendario unificado: un solo lugar decide el color de cada kind.
    colors: {
      recordatorio: '#f59e0b',
      cita: '#3b82f6',
      junta: '#8b5cf6',
      clase: '#22c55e',
      alarma: '#ef4444',
    },
    // Nombres legibles por tipo (sin literales en la UI).
    labels: {
      recordatorio: 'Recordatorio',
      cita: 'Cita',
      junta: 'Junta',
      clase: 'Clase',
      alarma: 'Alarma',
    },
  },
  vision: {
    temperature: 0.2,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 2048,
    /**
     * Saludo proactivo de FLU después de analizar una imagen/documento.
     * Templates con placeholders: {materia}, {nivel}, {items}
     * Organizado por perfil (profesor, administrativo, estudiante) e idioma (es, en).
     * Si no hay template para el perfil activo, se usa el default.
     * Si no hay coincidencia de idioma, se usa español.
     */
    visionGreeting: {
      default: {
        es: '¡Hola! He analizado el documento. {items} ¿Cómo te gustaría que te ayude?',
        en: 'Hi! I have analyzed the document. {items} How would you like me to help you?',
      },
      profesor: {
        es: '¡Hola! Veo que tienes material sobre {materia} de nivel {nivel}. {items} ¿En qué te gustaría que te ayude?',
        en: 'Hi! I see you have material about {materia} at {nivel} level. {items} How can I help you with this?',
      },
      administrativo: {
        es: 'Hola, he revisado el documento. {materia}{nivel}{items} ¿Qué necesitas que haga con esta información?',
        en: 'Hello, I have reviewed the document. {materia}{nivel}{items} What do you need me to do with this information?',
      },
      estudiante: {
        es: '¡Qué onda! Ya vi lo que subiste. {materia}{nivel}{items} ¿Por dónde le entramos?',
        en: 'Hey! I checked out what you uploaded. {materia}{nivel}{items} Where should we start?',
      },
      animador: {
        es: '¡Hola, hola! Ya vi lo que trajiste. {materia}{nivel}{items} ¡Vamos a sacarle jugo a esto y a pasarla bien!',
        en: 'Hello, hello! I already took a look at what you brought. {materia}{nivel}{items} Let’s make the most of it and have a great time!',
      },
    },
  },
  /**
   * Asistente personal — Fase 1: notificaciones, onboarding y no molestar.
   * Regla #1: toda la lógica de asistente vive aquí (config-driven, sin hardcode).
   */
  notifications: {
    enabled: true,
    channel: 'toast', // 'none' | 'toast' | 'voice' | 'both'
    toastDurationMs: 6000,
    defaultTitle: 'FLU OS4',
    maxStack: 4,
    webApiEnabled: true,
    mutedCategories: [],
  },
  /**
   * Recordatorios — Fase 2 (B1/B3/B4): persistencia, scheduler y parser de intención.
   * Regla #1: sin hardcode — el comportamiento vive aquí (config-driven).
   */
  reminders: {
    enabled: true,
    defaultReminderOffsetMinutes: 10,
    maxPerDay: 20,
    defaultCategory: 'reminder',
    soundEnabled: true,
    // Scheduler (useReminders): frecuencia de revisión y margen de vencimiento.
    tickMs: 30000,
    graceMs: 15000,
    ui: {
      panelTitle: 'Recordatorios',
      addLabel: 'Recordarme',
      placeholder: 'Ej: Reunión con el equipo mañana a las 9',
      whenLabel: '¿Cuándo?',
      whenPlaceholder: 'Ej: mañana a las 9',
      emptyState: 'No tienes recordatorios pendientes.',
      pendingLabel: 'Pendientes',
      doneLabel: 'Completados',
      removeTitle: 'Eliminar recordatorio',
      completeTitle: 'Marcar como hecho',
      dismissTitle: 'Descartar',
    },
    voice: {
      added: 'Listo, te lo recuerdo.',
      removed: 'Recordatorio eliminado.',
      completed: 'Recordatorio completado.',
      due: 'Tienes un recordatorio pendiente:',
    },
  },
  /**
   * Historial de documentos/imágenes generados o cargados (por usuario).
   * El Pizarrón (Doc/Vídeo) es el resultado vivo del turno; este panel es el
   * listado persistente. Regla #1: etiquetas aquí (sin hardcode).
   */
  documents: {
    ui: {
      title: { es: 'Historial', en: 'History' },
      empty: { es: 'Sin documentos todavía.', en: 'No documents yet.' },
      removeTitle: { es: 'Eliminar', en: 'Delete' },
      downloadTitle: { es: 'Descargar', en: 'Download' },
    },
    /**
     * Normalización del par título/contenido del artefacto generado: si el
     * cuerpo (carta/documento) llega en `titulo` y `contenido` viene vacío, se
     * reasigna el cuerpo a `contenido` y se deriva un rótulo corto. Regla #1:
     * los umbrales viven aquí, no en la lógica.
     * - bodyMinChars: longitud a partir de la cual un título se juzga cuerpo.
     * - titleMaxChars: longitud máxima del rótulo derivado del cuerpo.
     */
    normalize: {
      bodyMinChars: 80,
      titleMaxChars: 60,
    },
  },
  /**
   * Horario de clases — Pizarrón (Fase 1C): clases semanales por voz/OCR.
   * Regla #1: sin hardcode — días, modos, colores y textos config-driven.
   * - grid: rango de horas y altura por hora de la vista semanal (mockup).
   * - colores: catálogo de tokens válidos para el registro (m1..m6).
   * - colorHex: mapa token → color hex para render (sin hardcode en la UI).
   */
  horario: {
    enabled: true,
    // Horario GENÉRICO (Regla #1: sin hardcode): sirve para cualquier
    // tipo de agenda (escuela, consultas médicas/IMSS, trabajo, gimnasio…).
    // Cada entrada lleva un campo libre "tipo" que etiqueta su naturaleza;
    // "titulo" es el rótulo legible y "lugar" la ubicación opcional.
    maxClasesPorDia: 16,
    diaMin: 1,
    diaMax: 7,
    defaultColor: 'm1',
    // Adaptador OCR→horario: mínimo de entradas para PROPONER una importación.
    // Evita que un documento genérico (carta/reunión con una hora) dispare horario.
    ocrAdapter: { minEntries: 2 },
    // Duración por defecto (minutos) cuando se dicta una entrada sin hora de fin.
    defaultDurationMinutes: 60,
    // Etiquetas sugeridas para el campo libre "tipo" (NO son obligatorias).
    tipoSuggestions: ['escuela', 'medico', 'trabajo', 'gimnasio', 'personal'],
    grid: {
      startHour: 7,
      endHour: 18,
      hourPx: 40,
    },
    dayLabels: ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
    dayLabelsShort: ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    modos: {
      semana: { label: 'Semana' },
      dia: { label: 'Hoy' },
      proxima: { label: 'Próximo' },
      recordatorios: { label: 'Recordatorios' },
    },
    colores: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    colorHex: {
      m1: '#4f8cff',
      m2: '#ff7a59',
      m3: '#35c48b',
      m4: '#ffc53d',
      m5: '#b48cff',
      m6: '#ff6b9d',
    },
    ui: {
      panelTitle: 'Horario',
      horaLabel: 'Hora',
      modoLabel: 'Ver',
      emptyState:
        'Sin entradas registradas. Pide a Flu que lea una foto de tu horario o dicta una cita o actividad.',
      addLabel: 'Registrar',
      tituloLabel: 'Título',
      tipoLabel: 'Tipo (opcional)',
      tipoPlaceholder: 'p. ej. escuela, médico, trabajo…',
      diaLabel: 'Día',
      inicioLabel: 'Inicio',
      finLabel: 'Fin',
      lugarLabel: 'Lugar (opcional)',
      colorLabel: 'Color',
      proximaEmpty: 'No hay ninguna entrada próxima registrada.',
      hoyEmpty: 'Hoy no tienes entradas registradas.',
      semanaTitle: 'Horario de la semana',
      diaTitle: 'Entradas de hoy',
      proximaTitle: 'Próxima entrada',
      recordatoriosTitle: 'Recordatorios',
      removeTitle: 'Quitar entrada',
      editTitle: 'Editar entrada',
      // Badge de resumen y confirmación visual al registrar una entrada.
      claseCountOne: { es: '1 entrada', en: '1 entry' },
      claseCountMany: { es: 'entradas', en: 'entries' },
      addedToast: {
        es: '✓ "{titulo}" agregado el {dia} {hora}',
        en: '✓ "{titulo}" added on {dia} {hora}',
      },
      addError: {
        es: 'No se pudo registrar la entrada. Inténtalo de nuevo.',
        en: 'Could not register the entry. Try again.',
      },
      // Confirmación del parseo de una imagen de horario (digitalización → HOY).
      // Genérico: sin hardcode; el usuario da su visto bueno antes de escribir.
      importTitle: {
        es: 'Leí un horario en la imagen',
        en: 'I read a schedule in the image',
      },
      importHint: {
        es: 'Revisa las entradas detectadas. Al confirmar, quedan registradas en tu horario.',
        en: 'Review the detected entries. On confirm, they are saved to your schedule.',
      },
      importConfirm: {
        es: 'Confirmar y guardar',
        en: 'Confirm and save',
      },
      importCancel: {
        es: 'Descartar',
        en: 'Discard',
      },
      importBusy: {
        es: 'Guardando…',
        en: 'Saving…',
      },
      importCountOne: {
        es: '1 entrada detectada',
        en: '1 entry detected',
      },
      importCountMany: {
        es: '{n} entradas detectadas',
        en: '{n} entries detected',
      },
    },
    voice: {
      added: 'Listo, registré la entrada.',
      removed: 'Entrada eliminada.',
      updated: 'Entrada actualizada.',
      empty: 'Aún no hay entradas en el horario.',
      proxima: 'Tu próxima entrada es',
      hoy: 'Hoy tienes estas entradas:',
      structureEmpty: 'No encontré entradas legibles en la imagen.',
      structureOk: 'Registré las entradas del horario.',
      // Respuestas deterministas para el dictado por voz (agregar/consultar/quitar).
      addOk: {
        es: 'Listo, agregué "{titulo}" el {dia} {hora} al horario.',
        en: 'Done, I added "{titulo}" on {dia} {hora} to the schedule.',
      },
      addError: {
        es: 'No pude registrar "{titulo}". Inténtalo de nuevo.',
        en: 'I could not register "{titulo}". Try again.',
      },
      removeOk: {
        es: 'Listo, quité "{titulo}" del horario.',
        en: 'Done, I removed "{titulo}" from the schedule.',
      },
      removeNotFound: {
        es: 'No encontré "{titulo}" en el horario.',
        en: 'I could not find "{titulo}" in the schedule.',
      },
      askMateria: {
        es: '¿Qué entrada quieres agregar al horario y en qué día?',
        en: 'What entry would you like to add to the schedule, and on which day?',
      },
      askMateriaRemove: {
        es: '¿Qué entrada quieres quitar del horario?',
        en: 'Which entry would you like to remove from the schedule?',
      },
      askTime: {
        es: '¿A qué hora es "{titulo}" el {dia}?',
        en: 'At what time is "{titulo}" on {dia}?',
      },
      queryEmpty: {
        es: 'No tienes entradas registradas para ese día.',
        en: 'You have no entries registered for that day.',
      },
      queryEmptyAll: {
        es: 'Aún no hay entradas en el horario.',
        en: 'There are no entries in the schedule yet.',
      },
    },
  },
  /**
   * Panel lateral "Hoy" — Pizarrón consolidado (Paso 2): vista compacta
   * de HOY (próxima clase + clases del día), DIARIO (+ánimo) y NOTAS.
   * Regla #1: sin hardcode — etiquetas viven aquí (config-driven).
   */
  hoy: {
    enabled: true,
    ui: {
      panelTitle: 'Hoy',
      // Punto 8: el bloque usa solo su ícono (sin la palabra "Hoy"); "Próxima"
      // lleva su ícono a la izquierda.
      hoyTitle: { es: '📅', en: '📅' },
      diarioTitle: { es: '📓 Diario', en: '📓 Diary' },
      notasTitle: { es: '📝 Notas', en: '📝 Notes' },
      verHorarioCompleto: { es: 'Ver horario completo', en: 'View full schedule' },
      proximaClaseLabel: { es: '🕐 Próxima', en: '🕐 Next' },
      stopAlarmLabel: { es: 'Detener', en: 'Stop' },
      agendaTitle: { es: 'Recordatorios y citas', en: 'Reminders and appointments' },
      sinAgenda: { es: 'Sin recordatorios próximos', en: 'No upcoming reminders' },
      alarmasTitle: { es: '⏰ Alarmas', en: '⏰ Alarms' },
      sinTemporales: { es: 'Sin alarmas ni temporizadores', en: 'No alarms or timers' },
      clasesHoyLabel: { es: 'Agenda de hoy', en: "Today's agenda" },
      sinProxima: { es: 'Sin próxima entrada', en: 'No upcoming entry' },
      sinClasesHoy: { es: 'Hoy no tienes entradas', en: 'No entries today' },
      sinDiario: { es: 'Aún no hay entradas en el diario.', en: 'No diary entries yet.' },
      sinNotas: { es: 'Aún no hay notas.', en: 'No notes yet.' },
      sinAnimo: { es: 'Sin ánimo', en: 'No mood' },
      notasPendientes: { es: 'pendientes', en: 'pending' },
    },
  },
  /**
   * Motor temporal genérico — Alarmas, despertador y temporizador (Fase 1D).
   * Regla #1: sin hardcode — un solo motor (trigger + recurrencia + entrega)
   * para recordatorios, alarmas y temporizadores. Textos config-driven.
   * - tickMs: frecuencia del scheduler; graceMs: margen de vencimiento.
   * - maxActive: tope de ítems activos (alarmas + temporizadores).
   * - sound: tono WebAudio (frecuencia, duración, beeps, pausa, volumen).
   */
  temporal: {
    enabled: true,
    tickMs: 30000,
    graceMs: 15000,
    maxActive: 12,
    defaultAlarmTimeOfDay: '07:00',
    defaultTimerMinutes: 5,
    sound: {
      frequency: 880,
      durationMs: 500,
      beeps: 3,
      gapMs: 150,
      volume: 0.4,
    },
    ui: {
      panelTitle: 'Alarmas y temporizadores',
      alarmsLabel: 'Alarmas',
      timersLabel: 'Temporizadores',
      addAlarmLabel: 'Poner alarma',
      addTimerLabel: 'Poner temporizador',
      alarmPlaceholder: 'Ej: a las 7 de la mañana',
      timerPlaceholder: 'Ej: de 5 minutos para la pasta',
      emptyState: 'No tienes alarmas ni temporizadores.',
      emptyAlarms: 'Sin alarmas.',
      emptyTimers: 'Sin temporizadores.',
      timeLabel: 'Hora',
      durationLabel: 'Duración',
      labelLabel: 'Nombre (opcional)',
      remainingLabel: 'Restante',
      nextAtLabel: 'Próximo disparo',
      addTitle: 'Agregar',
      removeTitle: 'Eliminar',
      cancelTitle: 'Cancelar',
    },
    voice: {
      alarmAdded: 'Listo, puse la alarma.',
      alarmCancelled: 'Alarma cancelada.',
      alarmDue: 'Es la hora de tu alarma:',
      timerStarted: 'Listo, puse el temporizador.',
      timerCancelled: 'Temporizador cancelado.',
      timerDue: '¡Tiempo cumplido!',
      needAlarmTime: '¿A qué hora quieres la alarma?',
      needTimerDuration: '¿De cuánto tiempo quieres el temporizador?',
    },
  },
  /**
   * Lista de compras — Fase 2 (B10): persistencia y parser de intención.
   * Regla #1: sin hardcode — textos de UI y voz config-driven.
   */
  shopping: {
    enabled: true,
    defaultCategory: 'shopping',
    ui: {
      panelTitle: 'Lista de compras',
      addLabel: 'Agregar',
      placeholder: 'Ej: leche, huevos, pan',
      emptyState: 'Tu lista de compras está vacía.',
      pendingLabel: 'Pendientes',
      checkedLabel: 'Comprados',
      addHint: 'Escribe un ítem y presiona Enter',
      removeTitle: 'Quitar de la lista',
      clearCheckedLabel: 'Vaciar comprados',
    },
    voice: {
      added: 'Listo, lo agregué a la lista de compras.',
      removed: 'Listo, lo quité de la lista.',
      toggled: 'Listo, lo marqué.',
      cleared: 'Lista de compras vaciada.',
    },
  },
  /**
   * Notas — Pizarrón consolidado (Paso 1/2): lista de notas rápidas
   * con marca de hecho (done) y vínculo opcional a participante.
   * Regla #1: sin hardcode — etiquetas viven aquí (config-driven).
   */
  notes: {
    enabled: true,
    ui: {
      panelTitle: 'Notas',
      addLabel: 'Agregar',
      placeholder: 'Escribe una nota…',
      emptyState: 'Aún no hay notas.',
      pendingLabel: 'Pendientes',
      doneLabel: 'Hechas',
      addHint: 'Escribe una nota y presiona Enter',
      removeTitle: 'Quitar nota',
      editTitle: 'Editar nota',
      clearDoneLabel: 'Vaciar hechas',
    },
    voice: {
      added: 'Listo, lo agregué a las notas.',
      removed: 'Listo, lo quité de las notas.',
      toggled: 'Listo, lo marqué.',
      cleared: 'Notas hechas vaciadas.',
    },
  },
  /**
   * Multi-usuario — Fase 3 (A3/A4/A5/B9): participantes del hogar/equipo.
   * Regla #1: sin hardcode — roles, voces y textos viven aquí (config-driven).
   * - A3: speakerLabel vincula la diarización ↔ participante
   * - A4: profileId asigna un perfil de asistente al participante
   * - A5: defaultVoice + resolveTtsVoice definen el TTS por participante
   * - B9: birthdayAdvanceDays define la ventana de cumpleaños próximos
   */
  multiuser: {
    enabled: true,
    roles: ['Familiar', 'Amigo', 'Estudiante', 'Colega', 'Otro'],
    // "¿Niño o Adulto?" (onboarding) → rol del participante. El rol customiza
    // el navegador automáticamente (defaultsByRole en browser). Config-driven.
    kindToRole: {
      'niño': 'Estudiante', 'niña': 'Estudiante', 'nino': 'Estudiante',
      'chico': 'Estudiante', 'chica': 'Estudiante', 'estudiante': 'Estudiante',
      'adulto': 'Familiar', 'adulta': 'Familiar', 'adult': 'Familiar', 'familiar': 'Familiar',
    },
    // Defaults al pulsar "Omitir" en el onboarding. Fail-safe: omitir SIEMPRE
    // cae al perfil más restrictivo (Estudiante). "Familiar" solo se obtiene
    // respondiendo explícitamente "adulto". Config-driven (Regla #1).
    skipDefaults: {
      anonymousName: 'Anónimo',
      defaultKind: 'niño',
    },
    birthdayAdvanceDays: 7,
    defaultVoice: {
      voiceURI: '',
      voiceName: 'Voz por defecto',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
    },
    ui: {
      panelTitle: 'Participantes',
      addLabel: 'Registrar participante',
      nameLabel: 'Nombre',
      namePlaceholder: 'Ej: Mamá, Luis, Ana…',
      roleLabel: 'Rol',
      roleEmpty: '— Sin rol —',
      birthdayLabel: 'Cumpleaños',
      speakerLabel: 'Etiqueta de hablante',
      speakerPlaceholder: 'Ej: Hablante_01 (opcional)',
      birthdayNearLabel: 'Cumpleaños próximos',
      listLabel: 'Participantes registrados',
      emptyState: 'Aún no hay participantes.',
      removeTitle: 'Eliminar participante',
    },
    voice: {
      registered: 'Listo, he registrado a',
      removed: 'He eliminado a',
      birthdayNear: 'Cumpleaños próximos:',
    },
  },
  /**
   * Personalización profunda — FASE P: perfil de comunicación por persona.
   * Regla #1: sin hardcode — niveles, tonos y TTS viven aquí (config-driven).
   * - defaultTone/defaultExplanationLevel: valores por defecto (fuente de verdad)
   * - ttsRateByLevel: multiplicador de rate de voz por nivel de explicación
   */
  personalization: {
    enabled: true,
    defaultTone: 'friendly',
    defaultExplanationLevel: 'detallado',
    ttsRateByLevel: {
      simple: 1.05,
      detallado: 0.95,
      avanzado: 0.9,
    },
    ui: {
      panelTitle: 'Perfil de comunicación',
      explanationLabel: 'Nivel de explicación',
      toneLabel: 'Tono',
      autoHint: 'FLU aprende el nivel y el tono según cómo le hablas.',
      autoPlaceholder: 'Auto',
      resetLabel: 'Restablecer',
      emptyState: 'Sin perfil personalizado todavía.',
      level_simple: 'Simple',
      level_detallado: 'Detallado',
      level_avanzado: 'Avanzado',
      tone_formal: 'Formal',
      tone_casual: 'Casual',
      tone_friendly: 'Amigable',
      tone_professional: 'Profesional',
      tone_energetic: 'Enérgico',
      tone_calm: 'Sereno',
    },
  },
  /**
   * Navegador curado — Punto 2: perfil del navegador por persona.
   * Regla #1: sin hardcode — catálogo de categorías, defaults por rol y
   * textos viven aquí (config-driven). La resolución es:
   * manual (perfil guardado) > defaults por rol > default global.
   */
  browser: {
    enabled: true,
    // Esquema base para los enlaces de la allowlist. Solo el esquema (sin "://")
    // para no hardcodear URLs (Regla #1) y poder cambiarlo desde config.
    allowlistScheme: 'https',
    // Verbos/conectores para extraer el nombre del sitio de una frase por voz
    // ("navega en wikipedia" → "wikipedia", "open youtube" → "youtube").
    // Sin hardcode: la lista vive aquí y puede afinarse desde config.
    siteStopwords: [
      // español
      'navega', 'navegar', 'navegá', 'navegamos',
      'vamos', 'vayamos', 'ir',
      'abre', 'abrir', 'abrí', 'abrimos', 'abreme',
      'busca', 'buscar', 'búscame', 'buscame', 'busquemos',
      'explora', 'explorar', 'visita', 'visitar', 'mira', 'mirar',
      'la', 'el', 'los', 'las', 'en', 'a', 'de', 'al', 'del',
      'por', 'favor', 'me', 'página', 'pagina', 'páginas',
      'web', 'sitio', 'site', 'hacia', 'sobre',
      // inglés
      'navigate', 'go', 'open', 'the', 'to', 'page', 'website',
    ],
    categories: {
      educacion: 'Educación',
      cuentos: 'Cuentos',
      juegos: 'Juegos',
      musica: 'Música',
    },
    readingLevels: ['simple', 'detallado', 'avanzado'],
    languages: ['es', 'en', 'both'],
    // Idioma (F1): marcadores que el usuario dice por voz para pedir un
    // idioma ("en inglés", "in english") y el mapeo idioma→subdominio de
    // cada host ("wikipedia.org" → "es.wikipedia.org"). Regla #1: sin
    // hardcode — todo vive aquí y puede afinarse desde config.
    languageWords: {
      es: ['en español', 'en castellano', 'español', 'castellano', 'habla español'],
      en: ['in english', 'english please', 'english', 'en inglés', 'en ingles', 'speak english'],
    },
    languageHosts: {
      'wikipedia.org': { es: 'es', en: 'en' },
    },
    defaultProfile: {
      categories: ['educacion', 'cuentos'],
      allowlist: CURATED_ALLOWLIST,
      readingLevel: 'detallado',
      language: 'es',
      homeTiles: ['educacion', 'cuentos'],
    },
    defaultsByRole: {
      Estudiante: {
        categories: ['educacion', 'cuentos', 'juegos'],
        allowlist: CURATED_ALLOWLIST,
        readingLevel: 'simple',
        language: 'es',
        homeTiles: ['educacion', 'cuentos', 'juegos'],
      },
      Familiar: {
        categories: ['educacion', 'cuentos', 'juegos', 'musica'],
        allowlist: CURATED_ALLOWLIST_FAMILIAR,
        readingLevel: 'detallado',
        language: 'es',
        homeTiles: ['educacion', 'cuentos', 'juegos', 'musica'],
      },
    },
    ui: {
      panelTitle: 'Navegador curado',
      categoriesLabel: 'Categorías',
      allowlistLabel: 'Sitios permitidos',
      readingLevelLabel: 'Nivel de lectura',
      languageLabel: 'Idioma',
      resetLabel: 'Restablecer',
      emptyState: 'Sin perfil de navegador todavía.',
      level_simple: 'Simple',
      level_detallado: 'Detallado',
      level_avanzado: 'Avanzado',
      // Resultado por voz → Pizarrón (Regla #1: sin hardcode).
      resultTitle: 'Navegación curada',
      blockedTitle: 'Sitio no permitido',
      invalidTitle: 'No pude entender la dirección',
      pointSite: 'Sitio: ',
      pointUrl: 'URL: ',
      pointQuery: 'Búsqueda: ',
      // Modo lectura curada: cuando el sitio NO puede cargarse (red, timeout).
      fetchErrorTitle: 'No pude cargar el sitio',
    },
    // Modo lectura curada: proxy server-side que trae el contenido real
    // del sitio permitido al Pizarrón (evita CORS). Todo config-driven.
    fetch: {
      endpoint: '/api/browser/fetch',
      timeoutMs: 10000,
      maxContentChars: 6000,
      maxParagraphs: 40,
    },
    // Tiles de inicio del navegador curado. Única fuente de verdad de los
    // sitios built-in (los consume el catálogo de búsqueda vía panel.tiles).
    panel: {
      tiles: [
        { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org', category: 'educacion' },
        { id: 'educar', label: 'Educ.ar', domain: 'educ.ar', category: 'educacion' },
        { id: 'youtube', label: 'YouTube', domain: 'youtube.com', category: 'musica' },
      ],
    },
    catalog: {
      panelTitle: 'Catálogo de sitios',
      subtitle: 'Sitios aprobados que FLU puede usar en voz, barra, tiles y resultados',
      hint: 'Agregar un sitio aprobado lo hace aparecer en voz, barra, tiles y resultados sin tocar código.',
      domainLabel: 'Dominio',
      domainPlaceholder: 'Ej: khanacademy.org',
      labelLabel: 'Nombre',
      labelPlaceholder: 'Ej: Khan Academy',
      categoriesLabel: 'Categorías',
      languagesLabel: 'Idiomas',
      levelLabel: 'Nivel de lectura',
      approvedLabel: 'Aprobado',
      createLabel: 'Nuevo sitio',
      saveLabel: 'Guardar sitio',
      cancelLabel: 'Cancelar',
      editLabel: 'Editar',
      removeLabel: 'Eliminar',
      builtinBadge: 'Sistema',
      emptyState: 'No hay sitios en el catálogo todavía.',
      loadingLabel: 'Cargando catálogo…',
      duplicateError: 'Ya existe un sitio con ese dominio.',
      reservedError: 'Ese dominio pertenece al catálogo de sistema y no se puede modificar.',
      notFoundError: 'El sitio no existe o ya fue eliminado.',
      invalidError: 'Revisa los datos: el dominio debe ser un host válido (ej: wikipedia.org).',
      removeConfirm: '¿Eliminar este sitio del catálogo?',
      lang_es: 'Español',
      lang_en: 'English',
      lang_both: 'Ambos',
    },
    // Fase 3 — Buscador web + IA (núcleo Google).
    // Regla #1: sin hardcode — proveedores, etiquetas, límites y fallback
    // viven aquí (config-driven) y pueden afinarse sin tocar código.
    search: {
      // Proxy server-side (mismo patrón que browser.fetch, evita CORS).
      endpoint: '/api/search/web',
      // F4 — Endpoints por tipo (el hook los usa; `endpoint` se conserva
      // para compatibilidad con lecturas previas).
      endpoints: {
        web: '/api/search/web',
        images: '/api/search/images',
        video: '/api/search/video',
      },
      timeoutMs: 8000,
      providers: {
        // Proveedores web. El ORDEN es la cadena de respaldo: se agrupa por
        // `priority` (menor primero); dentro de un escalón se consulta en
        // paralelo, y si un escalón no trae resultados se pasa al siguiente.
        //   Tavily (1) → OpenRouter web (2) → Wikipedia (3, keyless).
        // `method`, `headers`, `body` y `model` son config-driven: el proxy
        // rellena {q}/{lang}/{key}/{model}/{n}. La `key` y el `model` de
        // OpenRouter se editan en el configurador (NUNCA en .env).
        web: [
          {
            id: 'tavily',
            label: 'Tavily',
            enabled: true,
            method: 'POST',
            endpoint: 'https://api.tavily.com/search',
            headers: { Authorization: 'Bearer {key}', 'Content-Type': 'application/json' },
            body: { query: '{q}', max_results: '{n}', search_depth: 'basic', safe_search: true },
            key: null,
            priority: 1,
            maxResults: 5,
            timeoutMs: 5000,
            externalConfig: true,
          },
          {
            id: 'openrouter',
            label: 'OpenRouter (web)',
            enabled: true,
            method: 'POST',
            endpoint: `${OPENROUTER_DEFAULTS.API_URL}/chat/completions`,
            headers: { Authorization: 'Bearer {key}', 'Content-Type': 'application/json' },
            body: { model: '{model}', messages: [{ role: 'user', content: '{q}' }] },
            key: null,
            model: `${OPENROUTER_DEFAULTS.MODEL}:online`,
            priority: 2,
            maxResults: 5,
            timeoutMs: 8000,
            externalConfig: true,
          },
          {
            id: 'wikipedia',
            label: 'Wikipedia',
            enabled: true,
            endpoint: 'https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={q}&format=json',
            articleUrlTemplate: 'https://{lang}.wikipedia.org/wiki/{title}',
            key: null,
            priority: 3,
            maxResults: 5,
            timeoutMs: 8000,
          },
        ],
        // F4 — Imágenes y vídeo.
        // Sin clave: Wikimedia Commons (images/video, keyless) funciona de
        // serie. YouTube Data API v3 (con key) e Invidious (self-hosted)
        // están deshabilitados por defecto; al activarlos y poner su key/
        // instancia, FLU los usa junto a Commons (todo config-driven).
        images: [
          {
            id: 'commons',
            label: 'Wikimedia Commons',
            enabled: true,
            endpoint: 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={q}&gsrnamespace=6&prop=imageinfo&iiprop=url|size&iiurlwidth=320&format=json',
            key: null,
            maxResults: 12,
            timeoutMs: 8000,
          },
        ],
        video: [
          {
            id: 'commons-video',
            label: 'Commons vídeo',
            enabled: true,
            endpoint: 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={q}%20filetype:video&gsrnamespace=6&prop=videoinfo&viprop=url|size&viurlwidth=320&format=json',
            key: null,
            maxResults: 6,
            timeoutMs: 8000,
          },
          {
            id: 'youtube',
            label: 'YouTube',
            enabled: false,
            key: '',
            endpoint: 'https://www.googleapis.com/youtube/v3/search?part=snippet&q={q}&type=video&maxResults={n}&key={key}',
            embedUrlTemplate: 'https://www.youtube.com/embed/{id}',
            watchUrlTemplate: 'https://www.youtube.com/watch?v={id}',
            maxResults: 6,
            timeoutMs: 8000,
          },
          {
            id: 'invidious',
            label: 'Invidious',
            enabled: false,
            key: null,
            endpoint: '',
            maxResults: 6,
            timeoutMs: 8000,
          },
        ],
      },
      maxResultsByType: {
        web: 8,
        images: 24,
        video: 8,
      },
      aiOverview: {
        enabled: true,
        maxChars: 2000,
        overviewMaxResults: 8,
      },
      // Clave de mensaje en search.ui: cuándo no hay resultados, FLU usa
      // este texto como respuesta en el Pizarrón (sin hardcode).
      offlineFallback: 'respuesta_ia_sin_resultados',
      // Etiquetas de la UI del buscador (Regla #1: sin hardcode).
      ui: {
        searchLabel: 'Buscar',
        // Placeholder vacío: el usuario pidió quitar el texto "Busca algo"
        // de la barra de búsqueda del Pizarrón. Se conserva un aria-label
        // accesible separado (searchInputLabel) para no perder la etiqueta.
        placeholder: '',
        searchInputLabel: 'Buscar en el Pizarrón',
        languageLabel: 'Idioma',
        levelLabel: 'Nivel',
        level_simple: 'Simple',
        level_detallado: 'Detallado',
        level_avanzado: 'Avanzado',
        aiOverviewTitle: 'Puntos clave',
        readLabel: '🗣️ Leer',
        listenLabel: '🔊 Escuchar',
        tabAll: 'Todos',
        tabImages: 'Imágenes',
        tabVideo: 'Vídeos',
        allowedBadge: 'Permitido',
        blockedBadge: 'NO permitido',
        blockedSuffix: '🔒',
        openLabel: 'Abrir',
        emptyState: 'No encontré resultados para esta búsqueda.',
        errorState: 'No pude completar la búsqueda. Inténtalo de nuevo.',
        loadingLabel: 'Buscando…',
        loadingSpinnerLabel: 'Cargando resultados…',
        // Chrome-like UX (auditoría F5): inicio con sugerencias, metadatos
        // de resultados, reintento y pista de pestañas deshabilitadas.
        startTitle: '¿Qué querés buscar hoy?',
        startHint: 'Escribí tu consulta o elegí una sugerencia.',
        suggestions: [
          '¿Qué es la fotosíntesis?',
          'Historia de la Luna',
          'Animales en peligro de extinción',
          'Cuentos para leer',
        ],
        resultsMetaOne: '{count} resultado para "{query}"',
        resultsMetaMany: '{count} resultados para "{query}"',
        retryLabel: 'Reintentar',
        errorHint: 'Comprobá tu conexión o intentá con otra consulta.',
        emptyResultsTitle: 'Sin resultados',
        emptyResultsHint: 'Probá con otras palabras o elegí una sugerencia.',
        disabledTabHint: 'Sin proveedores configurados. Activá uno en el Centro de Control.',
        sourceWikipedia: 'Wikipedia',
        sourceDuckDuckGo: 'DuckDuckGo',
        resultTitle: 'Resultados',
        respuesta_ia_sin_resultados: 'No encontré resultados para esa búsqueda.',
        voiceNoQuery: '¿Qué querés que busque?',
        voiceResultCount: 'Encontré {count} resultados.',
        // F4 — Etiquetas de las cuadrículas de imágenes y vídeo.
        sourceCommons: 'Wikimedia Commons',
        sourceYouTube: 'YouTube',
        sourceInvidious: 'Invidious',
        openImageLabel: 'Abrir imagen',
        openVideoLabel: 'Abrir vídeo',
        playLabel: 'Reproducir',
        emptyImages: 'No encontré imágenes para esta búsqueda.',
        emptyVideo: 'No encontré vídeos para esta búsqueda.',
        imagesTitle: 'Imágenes',
        videoTitle: 'Vídeos',
        // F5 — Centro de Control del Buscador (panel "Buscador y catálogo").
        searchControlTitle: 'Buscador y catálogo',
        searchControlIntro: 'Configurá proveedores, catálogo, seguridad y vista previa del buscador.',
        providersSection: 'Proveedores',
        catalogSection: 'Catálogo de sitios',
        categoriesSection: 'Categorías',
        securitySection: 'Seguridad',
        previewSection: 'Vista previa (dev)',
        providerGroupWeb: 'Web',
        providerGroupImages: 'Imágenes',
        providerGroupVideo: 'Vídeo',
        providerEnabled: 'Habilitado',
        providerKey: 'Clave (API)',
        providerKeyPlaceholder: 'Dejalo vacío para usar la config',
        providerMaxResults: 'Máx. resultados',
        providerTimeout: 'Timeout (ms)',
        providerModel: 'Modelo',
        safeSearchLabel: 'Búsqueda segura (solo dominios permitidos)',
        safeSearchHint: 'Filtra los resultados para conservar únicamente los sitios curados.',
        supervisedLabel: 'Modo supervisado',
        supervisedHint: 'Fuerza la búsqueda segura en todos los tipos de resultado.',
        dailyLimitLabel: 'Límite diario de búsquedas',
        dailyLimitHint: '0 = sin límite',
        dailyLimitMessage: 'Alcanzaste el límite diario de búsquedas. Volvé mañana.',
        previewQueryLabel: 'Consulta de prueba',
        previewQueryPlaceholder: 'Escribí una consulta de prueba…',
        runPreview: 'Probar consulta',
        previewResults: 'Resultados',
        previewAi: 'Resumen de IA',
        previewEmpty: 'Ejecutá una consulta para ver la vista previa.',
        previewLoading: 'Consultando…',
        previewError: 'No se pudo completar la consulta de prueba.',
        saveConfig: 'Guardar configuración',
        saveConfigHint: 'Guardá los cambios para aplicarlos al buscador (se persisten como overrides sobre la configuración).',
        resetConfig: 'Restablecer',
        configSaved: 'Configuración guardada.',
        configReset: 'Configuración restablecida.',
        // F5 — Secciones de idiomas/nivel y categorías (vista config-driven).
        languageLevelSection: 'Idiomas y nivel',
        languageLevelHint: 'Idioma y nivel de lectura por rol; los sitios del catálogo los usan por defecto al resolver la búsqueda.',
        roleColumnLabel: 'Rol',
        categoriesHint: 'Las categorías del catálogo y cuántos sitios tiene cada una. Los tiles del inicio se derivan automáticamente.',
        siteCountWord: 'sitios',
      },
    },
  },
  /**
   * Materia gris — Fase 3 (F5): gamificación de participaciones.
   * Regla #1: sin hardcode — la tabla de acciones vive aquí (config-driven).
   */
  materiaGris: {
    enabled: true,
    actions: {
      participacion_conversacion: 3,
      recordatorio_completado: 5,
      tarea_hogar: 5,
      juego_completado: 8,
      cuento: 10,
    },
    maxEntriesPerParticipant: 200,
    ui: {
      panelTitle: 'Materia gris',
      awardLabel: 'Otorgar puntos',
      participantLabel: 'Participante',
      participantEmpty: '— Elegir participante —',
      actionLabel: 'Acción',
      actionEmpty: '— Elegir acción —',
      leaderboardLabel: 'Leaderboard',
      emptyState: 'Aún no hay puntos otorgados.',
      historyLabel: 'Historial',
      action_participacion_conversacion: 'Participar en la conversación',
      action_recordatorio_completado: 'Completar un recordatorio',
      action_tarea_hogar: 'Tarea del hogar',
      action_juego_completado: 'Completar un juego',
      action_cuento: 'Participar en un cuento',
    },
    voice: {
      awarded: 'Listo, puntos otorgados.',
    },
  },
  /**
   * Hábitos y metas — Fase 4 (Módulo G): metas/hábitos por participante
   * con check-in diario, rachas y progreso.
   * Regla #1: sin hardcode — categorías y límites viven aquí (config-driven).
   */
  habits: {
    enabled: true,
    categories: ['habito', 'meta', 'estudio', 'personal'],
    defaultTargetDays: 21,
    maxGoalsPerParticipant: 50,
    ui: {
      panelTitle: 'Hábitos y metas',
      addLabel: 'Agregar meta',
      participantLabel: 'Participante',
      participantEmpty: '— Elegir participante —',
      titleLabel: 'Meta o hábito',
      titlePlaceholder: 'Ej. Leer 15 minutos',
      categoryLabel: 'Categoría',
      category_habito: 'Hábito',
      category_meta: 'Meta',
      category_estudio: 'Estudio',
      category_personal: 'Personal',
      targetLabel: 'Días objetivo (opcional)',
      targetPlaceholder: '21',
      listLabel: 'Mis metas',
      emptyState: 'Aún no hay metas registradas.',
      todayLabel: 'Hoy',
      statusLabel: 'Estado',
      status_active: 'Activa',
      status_done: 'Hecha',
      status_paused: 'Pausada',
      status_archived: 'Archivada',
      streakUnit: 'día(s)',
      removeLabel: 'Eliminar',
    },
    voice: {
      goalAdded: 'Listo, he registrado la meta.',
      checkInDone: 'Hecho, meta completada hoy.',
      checkInUndone: 'Entendido, lo dejo como pendiente.',
      statusChanged: 'Listo, estado actualizado.',
      goalRemoved: 'He eliminado la meta.',
      streakLabel: 'Racha de',
      daysUnit: 'días',
    },
  },
  /**
   * Bienestar/Ánimo — Fase 5 (Módulo H): registro diario de ánimo por
   * participante (escala scaleMin..scaleMax), nota opcional, historial
   * y resumen.
   * Regla #1: sin hardcode — escala, límites y etiquetas viven aquí
   * (config-driven).
   */
  mood: {
    enabled: true,
    scaleMin: 1,
    scaleMax: 5,
    maxLogsPerParticipant: 365,
    ui: {
      panelTitle: 'Bienestar y ánimo',
      addLabel: 'Registrar ánimo',
      participantLabel: 'Participante',
      participantEmpty: '— Elegir participante —',
      moodLabel: 'Ánimo de hoy',
      moodEmpty: '— Elegir ánimo —',
      noteLabel: 'Nota (opcional)',
      notePlaceholder: '¿Cómo te sientes hoy?',
      summaryLabel: 'Resumen',
      totalLabel: 'Registros',
      averageLabel: 'Promedio',
      bestLabel: 'Mejor',
      worstLabel: 'Peor',
      currentLabel: 'Hoy',
      emptySummary: 'Aún no hay registros.',
      listLabel: 'Historial de ánimo',
      emptyState: 'Aún no hay registros de ánimo.',
      removeLabel: 'Eliminar',
      mood_1: '😞 Muy mal',
      mood_2: '😕 Mal',
      mood_3: '😐 Regular',
      mood_4: '🙂 Bien',
      mood_5: '😄 Muy bien',
    },
    voice: {
      moodLogged: 'Listo, he registrado tu ánimo de hoy.',
      moodUpdated: 'Entendido, he actualizado tu ánimo de hoy.',
      moodRemoved: 'He eliminado ese registro de ánimo.',
      summaryLabel: 'Resumen de ánimo',
    },
  },
  /**
   * Contactos — Fase 6 (Módulo I): agenda de contactos con cumpleaños
   * (clave 'YYYY-MM-DD'), vínculo opcional con participantes y ventana de
   * "cumpleaños próximos" (B9). Regla #1: sin hardcode — tope, ventana y
   * etiquetas viven aquí (config-driven).
   */
  contacts: {
    enabled: true,
    maxContacts: 500,
    birthdayWindowDays: 7,
    ui: {
      panelTitle: 'Agenda de contactos',
      addLabel: 'Agregar contacto',
      nameLabel: 'Nombre',
      namePlaceholder: 'Nombre del contacto',
      phoneLabel: 'Teléfono',
      phonePlaceholder: 'Teléfono (opcional)',
      emailLabel: 'Correo',
      emailPlaceholder: 'Correo (opcional)',
      relationshipLabel: 'Relación',
      relationshipPlaceholder: 'Familiar, amigo… (opcional)',
      birthdayLabel: 'Cumpleaños',
      participantLabel: 'Participante',
      participantEmpty: '— Ninguno —',
      notesLabel: 'Notas',
      notesPlaceholder: 'Notas (opcional)',
      birthdayNearLabel: 'Cumpleaños próximos',
      emptyBirthdayNear: 'No hay cumpleaños en la ventana.',
      todayLabel: '¡Hoy!',
      tomorrowLabel: 'Mañana',
      inDaysLabel: 'En',
      dayLabel: 'día',
      daysLabel: 'días',
      favoriteMark: '★',
      listLabel: 'Contactos',
      emptyState: 'Aún no hay contactos.',
      removeLabel: 'Eliminar',
    },
    voice: {
      contactAdded: 'Listo, he agregado el contacto.',
      contactUpdated: 'He actualizado el contacto.',
      contactRemoved: 'He eliminado el contacto.',
    },
  },
  /**
   * Acciones de dispositivo — Fase 7 (Módulo I+): llamar, WhatsApp,
   * SMS y correo. Regla #1: sin hardcode — prefijo de país, canal de
   * apertura y textos viven aquí (config-driven). Honestidad de PWA:
   * solo abre esquemas de URL estándar (tel:, wa.me, sms:, mailto:).
   */
  deviceActions: {
    enabled: true,
    countryDial: '52',
    launchTarget: '_blank',
    ui: {
      panelTitle: 'Acciones de dispositivo',
      callLabel: 'Llamar',
      whatsappLabel: 'WhatsApp',
      smsLabel: 'SMS',
      emailLabel: 'Correo',
    },
    voice: {
      es: {
        callLaunched: 'Abriendo el marcador para {name}...',
        whatsappLaunched: 'Abriendo WhatsApp para {name}...',
        smsLaunched: 'Abriendo mensajes para {name}...',
        emailLaunched: 'Abriendo el correo para {name}...',
        contactNotFound: 'No tengo a {name} en tus contactos.',
        missingPhone: 'No tengo teléfono de {name}.',
        missingEmail: 'No tengo correo de {name}.',
      },
      en: {
        callLaunched: 'Opening the dialer for {name}...',
        whatsappLaunched: 'Opening WhatsApp for {name}...',
        smsLaunched: 'Opening messages for {name}...',
        emailLaunched: 'Opening email for {name}...',
        contactNotFound: "I don't have {name} in your contacts.",
        missingPhone: "I don't have a phone number for {name}.",
        missingEmail: "I don't have an email for {name}.",
      },
    },
  },
  /**
   * Diario personal — Fase 6 (Módulo J): entradas de diario con fecha
   * ('YYYY-MM-DD'), título opcional, contenido, ánimo opcional (1..moodMax)
   * y vínculo opcional con participantes. Regla #1: sin hardcode — tope
   * diario, escala y etiquetas viven aquí (config-driven).
   */
  // Medios (video/documento): ventana de idempotencia por comando. Evita
  // regenerar (y re-cobrar) cuando el ASR re-captura el mismo pedido.
  media: { dedupWindowMs: 120000 },
  // Personalidad proactiva: se inyecta junto al `startupPrompt` del perfil para
  // que FLU ACTÚE su personaje (proponga juegos, cuente un chiste, sugiera un
  // baile) y no solo lo describa.
  personality: {
    proactiveDirective:
      'Sé proactivo: haz viva la personalidad del perfil proponiendo un juego, contando un chiste breve o sugiriendo un baile/actividad cuando encaje, sin que te lo pidan. Ofrece ideas concretas y breves.',
    proactiveDirectiveEn:
      'Be proactive: bring the profile personality to life by proposing a game, telling a short joke or suggesting a dance/activity when it fits, without being asked. Offer concrete, brief ideas.',
  },
  diary: {
    // Activo: reconocido por voz (parseDiaryIntent) y visible en el panel Hoy.
    enabled: true,
    maxEntriesPerDay: 50,
    moodMax: 5,
    ui: {
      panelTitle: 'Diario personal',
      addLabel: 'Guardar entrada',
      dateLabel: 'Fecha',
      titleLabel: 'Título',
      titlePlaceholder: 'Título (opcional)',
      contentLabel: 'Contenido',
      contentPlaceholder: '¿Qué quieres recordar hoy?',
      moodLabel: 'Ánimo (opcional)',
      moodEmpty: '— Sin ánimo —',
      participantLabel: 'Participante',
      participantEmpty: '— Ninguno —',
      untitledLabel: 'Sin título',
      listLabel: 'Historial del diario',
      emptyState: 'Aún no hay entradas en el diario.',
      removeLabel: 'Eliminar',
      mood_1: '😞 Muy mal',
      mood_2: '😕 Mal',
      mood_3: '😐 Regular',
      mood_4: '🙂 Bien',
      mood_5: '😄 Muy bien',
    },
    voice: {
      entryAdded: 'Listo, he guardado tu entrada del diario.',
      entryUpdated: 'He actualizado esa entrada.',
      entryRemoved: 'He eliminado esa entrada del diario.',
    },
  },
  /**
   * Onboarding — primera configuración asistida por voz (Fase 1, D1).
   * Pasos deterministas: ack (afirmación) | capture (captura de valor) | decision (sí/no).
   * - capture: {key} guarda la respuesta (ej. userName) en el estado capturado.
   * - decision: {accept}/{reject} resuelven una acción (ej. habilitar notificaciones).
   * Templates con placeholder {name} ← valor capturado en la clave nameKey.
   */
  onboarding: {
    enabled: true,
    nameKey: 'flu-user-name',
    overlay: {
      skipLabel: 'Omitir',
      progressLabel: 'Paso {current} de {total}',
      // Hint HONESTO de escritura: el input siempre pide escribir. El
      // label "Escucho…" (listeningHint) solo se muestra como badge vivo
      // cuando el navegador confirma onstart de verdad.
      typingHint: 'Escribe tu respuesta…',
      listeningHint: 'Escucho…',
      submitLabel: 'Enviar',
      continueLabel: 'Continuar',
      acceptLabel: 'Sí',
      rejectLabel: 'No',
      // Tap-to-talk: el micrófono solo se abre al tocar el botón 🎤
      // (nunca en paralelo con la voz de FLU → auto-eco imposible).
      micLabel: 'Hablar',
      stopLabel: 'Detener',
    },
    // Selector "¿Quién eres?" (multiusuario — Fase 3): puerta de identidad
    // al abrir la app en un dispositivo compartido por la familia.
    userPicker: {
      title: '',
      subtitle: 'Toca tu perfil para personalizar tu experiencia.',
      createLabel: 'Crear perfil personal',
      // Dropdown del header: opción "+ Nuevo", placeholder y botón borrar.
      createShortLabel: '+ Nuevo',
      selectPlaceholder: 'Elegir usuario',
      removeLabel: 'Borrar usuario',
      emptyHint: 'Todavía no hay perfiles. Crea el primero para comenzar.',
      // Al cargar, si ya hay perfiles (o quedó onboarding completado sin
      // perfil → "fantasma") se abre el selector para que cada persona
      // elija o cree el suyo. No se abre en el primer arranque (0 perfiles
      // y onboarding sin completar → corren las preguntas de bienvenida).
      autoOpenOnLoad: true,
    },
    steps: [
      {
        id: 'name',
        type: 'capture',
        key: 'name',
        es: '¿Cómo te llamas?',
        en: 'What is your name?',
        // Captura dual: el niño puede RESPONDER HABLANDO (además de texto).
        acceptVoice: true,
        ack: {
          es: '¡{name}, qué bonito nombre!',
          en: 'Nice to meet you, {name}!',
        },
      },
      {
        id: 'kind',
        type: 'capture',
        key: 'kind',
        es: '¿Eres niño o adulto?',
        en: 'Are you a child or an adult?',
        // Select de 2 opciones: niño→Estudiante, adulto→Familiar (defaultsByRole).
        options: [
          { value: 'niño', es: 'Niño / Niña', en: 'Child' },
          { value: 'adulto', es: 'Adulto / Adulta', en: 'Adult' },
        ],
        acceptVoice: true,
        ack: {
          es: '¡Genial, {name}!',
          en: 'Great, {name}!',
        },
      },
      {
        id: 'complete',
        type: 'ack',
        es: '¡Listo, {name}! Ya estás configurado. Háblame cuando quieras.',
        en: 'Done, {name}! You are all set. Talk to me whenever you want.',
      },
    ],
  },
  /**
   * No molestar (DND) — Fase 1 (D2). Silencia notificaciones y toasts según horario.
   */
  dnd: {
    enabled: false,
    schedule: { start: '22:00', end: '07:00' },
    allowUrgent: true,
    tickMs: 60000,
  },
  /**
   * Noticias — Fase 5 (placeholder config-driven; se habilita con el proxy RSS /api/rss).
   */
  news: {
    enabled: false,
    maxItems: 5,
    refreshIntervalMinutes: 60,
    sources: [],
  },
  /**
   * Salud y cuidador — Fase 4 (placeholder config-driven; se habilita con C1-C8).
   */
  health: {
    enabled: false,
    hydrationIntervalMinutes: 90,
    postureIntervalMinutes: 60,
    focusIntervalMinutes: 45,
  },
  /**
   * Flu como participante: escucha activa, mano alzada, intervención con «ok flu adelante».
   * Umbrales únicos — ver scripts/validate-flu-participant-config.mjs
   */
  fluParticipant: {
    enabled: true,
    /** true = solo con sesión «Iniciar conversación» activa; false = también en escucha pasiva (OS3 parity). */
    conversationOnly: false,
    evaluateOnTurnCommit: true,
    /** Al pulsar «Flu participa» sin mano alzada: evaluar ahora con Gemini antes de ceder la palabra. */
    evaluateOnManualGrant: true,
    /** Evaluar aporte válido cada N turnos cerrados en el log. */
    evaluateEveryNTurns: 3,
    /** Tras intervenir: pausa antes de volver a evaluar (ms). Default 3 min. */
    cooldownAfterInterventionMs: 180000,
    /** Si nadie dice «adelante», bajar la mano (ms). 0 = sin auto-bajar. */
    handRaisedTimeoutMs: 180000,
    maxInterventionsPerSession: 12,
    maxInterventionsPerHour: 5,
    /** Cuántas filas recientes manda a Gemini. */
    evaluationWindowTurns: 8,
    /** Confianza mínima (0–1) para alzar la mano. */
    minConfidence: 0.65,
    maxDraftChars: 420,
    minDraftChars: 24,
    minReasonChars: 8,
    /** Ignorar «ok flu adelante» repetido tras conceder la palabra (ms). */
    floorGrantDedupMs: 12000,
    ui: {
      handRaisedLabel: { es: 'Flu pide la palabra', en: 'Flu requests the floor' },
      evaluatingLabel: { es: 'Flu aprendiendo…', en: 'Flu learning…' },
      idleLabel: { es: 'Flu participante', en: 'Flu participant' },
      idleHint: {
        es: 'Flu observa la conversación. Cuando alce la mano, di «ok flu adelante».',
        en: 'Flu is observing. When its hand is raised, say «ok flu go ahead».',
      },
      panelTitle: { es: 'Configurador de voz', en: 'Voice configurator' },
      panelIntro: {
        es: 'Flu escucha la conversación, evalúa si hay aporte válido y alza la mano. Di «ok flu adelante» para cederle la palabra.',
        en: 'Flu listens, evaluates valid contributions and raises its hand. Say «ok flu go ahead» to let it speak.',
      },
      saveButton: { es: 'Guardar configuración', en: 'Save settings' },
      resetButton: { es: 'Restaurar valores por defecto', en: 'Restore defaults' },
      savedHint: { es: 'Guardado', en: 'Saved' },
      fields: {
        enabled: { es: 'Activar participación', en: 'Enable participation' },
        evaluateEveryNTurns: { es: 'Evaluar cada N turnos', en: 'Evaluate every N turns' },
        minConfidence: { es: 'Confianza mínima', en: 'Minimum confidence' },
        maxInterventionsPerSession: { es: 'Máx. intervenciones por sesión', en: 'Max interventions per session' },
        maxInterventionsPerHour: { es: 'Máx. intervenciones por hora', en: 'Max interventions per hour' },
        cooldownAfterInterventionMs: { es: 'Tiempo de espera tras hablar (min)', en: 'Wait after Flu speaks (min)' },
        handRaisedTimeoutMs: { es: 'Auto-bajar mano (min, 0=off)', en: 'Auto-lower hand (min, 0=off)' },
        evaluationWindowTurns: { es: 'Turnos en ventana de evaluación', en: 'Turns in evaluation window' },
        minDraftChars: { es: 'Mín. caracteres del borrador', en: 'Min draft characters' },
      },
      fieldHints: {
        evaluateEveryNTurns: {
          es: 'Cada cuántos turnos cerrados Gemini revisa si hay aporte válido.',
          en: 'How many closed turns before Gemini checks for a valid contribution.',
        },
      },
    },
  },
  ui: {
    shellCopy: '',
    listeningStatus: {
      idle: 'Detenido',
      active: 'Activa',
      listening: 'Escuchando',
      processing: 'Procesando',
    },
    listeningMeta: {
      configuration: 'Configuración',
      session: '',
      notSupported: 'Navegador no soportado',
    },
    buttons: {
      startConversation: 'Iniciar conversación',
      generateMinute: 'Generar minuta',
      openListening: 'Abrir escucha',
      closeListening: 'Cerrar escucha',
      fluParticipa: 'Flu participa',
      save: 'Guardar',
      saveMinute: 'Guardar minuta',
    },
    commandSpeech: {
      GENERAR_RESUMEN: { es: 'Generando minuta.', en: 'Generating summary.' },
      INICIAR_CONVERSACION: { es: 'Iniciando conversacion.', en: 'Starting conversation.' },
      ABRIR_ESCUCHA: { es: 'Abriendo escucha.', en: 'Opening listening.' },
      CERRAR_ESCUCHA: { es: 'Cerrando escucha.', en: 'Closing listening.' },
      FLU_WAKE: { es: 'Te escucho.', en: "I'm listening." },
      REGISTRAR_PARTICIPANTE: {
        es: 'Registrado {name}.',
        en: 'Registered {name}.',
      },
      FLU_ADELANTE: { es: 'De acuerdo.', en: 'Go ahead.' },
      FLU_ADELANTE_EMPTY: {
        es: 'No tengo nada pendiente por ahora.',
        en: 'I have nothing pending right now.',
      },
      FLU_ESPERA: { es: 'Entendido, espero.', en: 'Understood, I will wait.' },
      GUARDAR_MINUTA: { es: 'Minuta guardada.', en: 'Minute saved.' },
      ANALIZAR_DOCUMENTO: { es: 'Analizando el documento.', en: 'Analyzing the document.' },
      ANALIZAR_APP: { es: 'Analizando la app.', en: 'Analyzing the app.' },
      GENERAR_DOCUMENTO: { es: 'Generando el documento.', en: 'Generating the document.' },
      GENERAR_VIDEO: { es: 'Preparando el video.', en: 'Preparing the video.' },
      NAVEGAR: { es: '', en: '' },
      BUSCAR: { es: '', en: '' },
    },
    panel: {
      maximize: 'Maximizar',
      restore: 'Restaurar',
    },
    settings: {
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: 'Pega tu key aquí',
      apiKeySaved: 'Guardada localmente',
      apiKeyPending: 'Aún no guardada',
      language: 'Idioma',
      languageEs: 'Español',
      languageEn: 'English',
      languageBoth: 'Español + English',
      sessionRole: 'Perfil de sesión',
    },
    ambientes: {
      panelTitle: 'Ambientes (rebranding por oficio)',
      panelHint:
        'FLU se rebrandea según el oficio: identidad, tema visual, avatar, voz y pestañas.',
      activate: 'Activar',
      active: 'Activo',
      preview: 'Vista previa',
      // ---- 1A: gestión de ambientes dinámicos (crear/clonar/editar/eliminar) ----
      createLabel: 'Nuevo ambiente',
      cloneLabel: 'Clonar',
      cloneNameSuffix: ' (copia)',
      editLabel: 'Editar',
      removeLabel: 'Eliminar',
      saveLabel: 'Guardar ambiente',
      cancelLabel: 'Cancelar',
      nombreLabel: 'Nombre',
      nombrePlaceholder: 'Ej: Modo Selva',
      idLabel: 'Identificador',
      taglineLabel: 'Frase descriptiva',
      taglinePlaceholder: 'Ej: Convierto tu espacio en una selva de aprendizaje',
      iconoLabel: 'Ícono',
      frasesEsLabel: 'Frases de activación (ES)',
      frasesEnLabel: 'Frases de activación (EN)',
      frasesPlaceholder: 'Una frase por línea',
      frasesHint: 'Con estas frases FLU detecta el modo y se activa al escucharlas.',
      varsLabel: 'Variables del tema',
      varsPlaceholder: 'Vacío = no inyectar',
      decoracionLabel: 'Decoración',
      decoracionNone: '— Sin decoración —',
      tabsLabel: 'Pestañas visibles',
      requiredError: 'El nombre es obligatorio para generar el identificador.',
      duplicateError: 'Ya existe un ambiente con ese identificador.',
      reservedError: 'Ese identificador está reservado por el sistema.',
      notFoundError: 'El ambiente ya no existe.',
      invalidError: 'El formulario contiene datos inválidos.',
    },
    tabs: {
      ariaLabel: 'Secciones de Flu Voz',
      storageKey: 'flu-active-tab',
      defaultId: 'workspace',
      items: [
        { id: 'workspace', label: 'Pizarron' },
        { id: 'conversation', label: 'Conversación' },
        { id: 'minutes', label: 'Minutas' },
        { id: 'settings', label: 'Configuración' },
        { id: 'system', label: 'Sistema' },
      ],
    },
    recognitionErrors: {
      'audio-capture': 'El microfono no esta disponible. Cierra otras pestanas o apps que lo usen e intenta de nuevo.',
      'not-allowed': 'Permiso de microfono denegado.',
      'service-not-allowed': 'El reconocimiento de voz no esta permitido en este navegador.',
      network: 'El reconocimiento de voz de Chrome necesita conexion a internet y no pudo alcanzar el servicio. Revisa tu red/VPN y reintenta.',
      'engine-error': 'El motor de voz local fallo al transcribir. Reintentando…',
    },
    transcriptPlaceholder: '',
    transcriptLabel: '',
    /** Nombre visible mientras speakerId === calculando. */
    identifyingSpeakerName: 'Identificando...',
    mainCopy: '',
    workspace: {
      title: 'Pizarrón',
      emptyContent: '',
      fallbackTitle: 'Salida activa de IA',
      keyPointsTitle: { es: 'Puntos clave', en: 'Key points' },
      contenidoTitle: { es: 'Contenido', en: 'Content' },
      keyPointsEmpty: '',
      conversationEmpty: 'Todavia no hay transcripciones guardadas.',
      minuteHistoryEmpty: 'Aun no hay minutas guardadas. Genera una minuta y pulsa Guardar.',
      participantsEmpty: 'Los participantes aparecerán al identificar voces en la sesión.',
      participantsTitle: 'Participantes',
      imageAlt: 'Visual generado por Flu',
      imageLoading: 'Cargando imagen generada por IA…',
      imageError: 'No se pudo generar la imagen. Revisa la conexión o vuelve a pedir el visual.',
      typeLabels: {
        image_prompt: 'Prompt visual',
        diagram: 'Diagrama',
        '3d': 'Escena 3D',
        text: 'Texto de trabajo',
        horario: 'Horario de clases',
      },
      conversationSubtitle: 'Transcripción en vivo de la conversación',
      visibleLabels: {
        response: 'Respuesta:',
        theme: 'Tema',
        role: 'Perfil',
        log: '',
        summary: '',
        history: 'Historial de minutas',
      },
      conversationLogVisible: true,
      minuteDraftEmpty: 'Genera o selecciona una minuta para editarla aquí.',
      summaryUnavailableTitle: 'Minuta no disponible',
      summaryUnavailableMessage: 'No se pudo generar el resumen.',
      // ---- Pizarrón: tarjetas plegables (diseño UX aprobado) ----
      responseTitle: { es: 'Respuesta de Flu', en: 'Flu response' },
      responseEmpty: {
        es: 'Flu responderá aquí a tus preguntas.',
        en: 'Flu will respond here to your questions.',
      },
      origenWebLabel: { es: 'Web', en: 'Web' },
      origenIaLabel: { es: 'IA', en: 'AI' },
      imageTitle: { es: 'Imagen generada', en: 'Generated image' },
      imageExpandLabel: { es: '🔍 Ampliar', en: '🔍 Expand' },
      imageErrorTitle: { es: 'No se pudo cargar la imagen', en: 'The image could not be loaded' },
      imageRetryLabel: { es: 'Reintentar', en: 'Retry' },
      agendaTitle: { es: 'Agenda', en: 'Agenda' },
      agendaScheduleTitle: { es: 'Calendario de clases', en: 'Class schedule' },
      horarioTitle: { es: 'Horario de clases', en: 'Class schedule' },
      horarioEmpty: {
        es: 'Pide a Flu que lea una foto de tu horario o dicta una clase.',
        en: 'Ask Flu to read a photo of your schedule or dictate a class.',
      },
      documentTitle: { es: 'Análisis de documento', en: 'Document analysis' },
      documentEmpty: {
        es: 'Sube un documento (PDF, Excel, Word) para analizarlo aquí.',
        en: 'Upload a document (PDF, Excel, Word) to analyze it here.',
      },
      appTitle: { es: 'Análisis de app', en: 'App analysis' },
      appEmpty: {
        es: 'Sube una carpeta de proyecto para analizarla aquí.',
        en: 'Upload a project folder to analyze it here.',
      },
      generationTitle: { es: 'Generación de documento / video', en: 'Document / video generation' },
      generationEmpty: {
        es: 'Genera documentos o videos desde aquí.',
        en: 'Generate documents or videos from here.',
      },
      // Filtros del feed del Pizarrón (Todo · Imágenes · Video/Docs · Historial).
      feedFilterAll: { es: 'Todo', en: 'All' },
      feedFilterImages: { es: 'Imágenes', en: 'Images' },
      feedFilterMedia: { es: 'Video/Docs', en: 'Media/Docs' },
      feedFilterHistory: { es: 'Historial', en: 'History' },
      uploadTitle: { es: 'Subir archivo', en: 'Upload file' },
      uploadDropHint: { es: 'Arrastra tu documento aquí', en: 'Drag your document here' },
      uploadDropOr: { es: '— o —', en: '— or —' },
      uploadSelectLabel: { es: '📁 Subir imagen', en: '📁 Upload image' },
      uploadCameraLabel: { es: '📷 Tomar foto', en: '📷 Take photo' },
      uploadDocumentLabel: { es: '📄 Analizar documento', en: '📄 Analyze document' },
      uploadAppLabel: { es: '🧭 Analizar app', en: '🧭 Analyze app' },
      uploadRemoveLabel: { es: '✕ Quitar', en: '✕ Remove' },
      uploadAnalyzingLabel: { es: '🔍 Analizando con IA...', en: '🔍 Analyzing with AI...' },
      uploadErrorImage: {
        es: '⚠️ No se pudo leer la imagen. Verifica que sea un archivo JPG o PNG e inténtalo de nuevo.',
        en: '⚠️ The image could not be read. Make sure it is a JPG or PNG file and try again.',
      },
    },
    minuteFields: {
      title: 'Titulo',
      summary: 'Resumen',
      participants: 'Participantes',
      agreements: 'Acuerdos',
      pending: 'Pendientes',
      nextSteps: 'Siguientes pasos',
    },
  },
  frames: {
    workspace: 'workspace',
    conversation: 'conversation',
    minute: 'minute',
    history: 'history',
    voiceProfiles: 'voice-profiles',
  },
  /**
   * Traza estructurada (ring) para diagnóstico en dev.
   * Volcar en consola: __fluDev.trace.dump() · archivo: __fluDev.trace.download()
   */
  trace: {
    enabled: IS_DEV,
    ringSize: 800,
    /** Eventos speaker/diarize-* en ring y __fluDev.speakerMonitor */
    speakerDiarize: true,
    mirrorConsole: false,
    /** POST periódico a Vite → flu-voz/logs/agent-trace.json (lectura agente). */
    agentSink: IS_DEV,
    agentSinkMs: 1200,
  },
  /**
   * Juegos de entretenimiento (catálogo en src/core/games/gameCatalog).
   * La fuente de verdad de cada motor es 100% local y determinista;
   * estos valores solo parametrizan la configuración por defecto.
   */
  games: {
    enabled: true,
    defaultRounds: 3,
    simonDice: {
      verbos: ['Dance', 'Run', 'Walk', 'Jump_in_place'],
      longMax: 5,
    },
    adivinaNumero: {
      min: 1,
      max: 20,
      pistasMax: 5,
    },
    calculoMental: {
      maxSuma: 10,
      operaciones: ['+', '-'],
    },
    ahorcado: {
      intentos: 6,
    },
    memoriaSecuencias: {
      longMax: 4,
    },
    cuentoColaborativo: {
      turnos: 4,
    },
    cuentaConmigo: {
      hasta: 10,
    },
    respiracion: {
      rondas: 4,
    },
    loteria: {
      tablaSize: 3,
    },
    cuentacuentos: {
      escenasMax: 4,
    },
  },
  /**
   * Modo debug: checklist, invariantes y panel dev.
   * Apagar (enabled: false) cuando la app esté lista para producción.
   */
  debug: {
    enabled: IS_DEV,
    /** `[Flu][chrome-raw]` — evento SpeechRecognition sin procesar (solo dev). */
    chromeRawConsole: true,
    /** Panel flotante: log ingress (texto publicado completo). */
    micConsolePanel: false,
    /** Log autoritativo desde transcriptIngress (misma fuente que ÚLTIMA FRASE). */
    micIngressLog: true,
    /** Líneas máximas en panel mic (reciente arriba). */
    micConsoleMaxLines: 500,
    /** Consola [Flu][mic-ingress] además del panel. */
    micIngressConsole: true,
    /** @deprecated Usar chromeRawConsole */
    /** @deprecated Usar chromeRawConsole */
    micRawConsole: true,
    consoleLog: false,
    refreshMs: 1500,
    /** Relaya fragmentos crudos de Chrome (interim/final) al servidor para diagnóstico. */
    listenTrace: false,
    /** Vectores de embedding en filas del log de conversación (solo diagnóstico). */
    showEmbeddingPreview: false,
    /** Reenviar logs del frontend al servidor (terminal) para que Roo pueda verlos. */
    relayToServer: IS_DEV,
  },
  /**
   * Árbitro determinista (§1A/§2A/§2B del plan de afinado estructural).
   * Controla la semántica de "si hay match determinista → manda y NO llamar a
   * Gemini" (§2B). Por defecto está APAGADO (skipGeminiOnMatch: false): el flujo
   * conserva la semántica actual (fast-path en paralelo + contrato tardío de
   * Gemini con idempotencia). Al activarlo, cuando el árbitro matchea un dominio
   * con efecto de estado (config/juego/ambiente), se salta la llamada a Gemini y
   * se responde con una frase de cortesía determinista. Cambio de ALTO riesgo:
   * activar solo tras validar con el test §3B y prueba manual.
   */
  arbiter: {
    /** §2B: si hay match determinista de estado → NO llamar a Gemini (ALTO riesgo). */
    skipGeminiOnMatch: false,
  },
  /**
   * Perfil gratuito (recomendado): source browser + Chrome SR on-device + mic pasivo para hablantes.
   * No usar hybrid/stream salvo API de pago (p. ej. Deepgram). Ver docs/transcripcion-conversaciones.md § Stack gratuito.
   */
  transcript: {
    /**
     * Config del transcriptor Whisper — SOLO para el laboratorio dev
     * (`src/dev/asrLab/`). PRODUCCIÓN usa Chrome SpeechRecognition (Google,
     * online); el resto del pipeline es agnóstico al motor.
     */
    asr: {
      provider: 'whisper-wasm',
      /** §9 UN solo modelo (`tiny`) para final e interim: sin contención de CPU
       *  (antes corrían `base`+`tiny` a la vez) ni doble memoria. */
      modelId: 'Xenova/whisper-tiny',
      language: 'es',
      /**
       * dtype fp32. El q8 COMPLETO NO es viable: el decoder cuantizado falla en
       * ORT Web (WASM). Medido en escritorio: `tiny` fp32 ≈1.3 s por 4 s de audio.
       */
      dtype: 'fp32',
      /** Tasa objetivo del modelo (Hz). */
      targetSampleRate: 16000,
      /**
       * Texto de sesgo (initial_prompt) para el decoder: mezcla de idioma +
       * wake word + muletillas típicas. Hace que Whisper escriba "ok flu"
       * correctamente en vez de alucinar en audios cortos.
       */
      initialPrompt:
        'Conversación en español con el asistente. Palabras clave: ' +
        `${FLU_WAKE_WORDS.filter((word) => word.endsWith(' flu')).join(', ')}, ` +
        'estás ahí, cuéntame, busca en la web, recuérdame, anota.',
      /** Parciales en vivo (interim): la "última frase" se escribe mientras se
       *  escucha. El COMMIT de la conversación sigue siendo solo con el final. */
      partialsEnabled: true,
      partialIntervalMs: 1000,
      /** Ventana de audio del interim. Se usa el TURNO COMPLETO (tope 10 s ≥
       *  maxSegmentMs): una ventana deslizante corta perdía el inicio de la
       *  frase ("se comía el primero") y mostraba solo la cola. */
      partialWindowMs: 10000,
      /** Audio mínimo para el PRIMER parcial (ms). Con <1 s Whisper no tiene
       *  contexto y entra en bucle de repetición ("2,2,2,3,4"). */
      partialMinMs: 1200,
      /** Segmentador / VAD: corta turnos y emite parciales. */
      vad: {
        /** Ventana de análisis (ms). */
        frameMs: 30,
        /** Umbral de energía RMS para considerar voz. Único knob de voz del VAD;
         *  valor inicial — se mide/ajusta en validación, no es un valor secreto.
         *  Subido a 0.02: con 0.015 el ruido de ambiente abría turno y Whisper
         *  alucinaba ("¡Vamos!", "¡Ahh!"). */
        energyThreshold: 0.02,
        /** Voz mínima para abrir turno (ms). Subido a 450: exige voz sostenida
         *  (un chasquido/ruido corto ya no abre turno). */
        minSpeechMs: 450,
        /** Silencio para cerrar turno (ms). 900 junta "ok flu" con el comando
         *  (evita fragmentos); la ventana de wake del hook es la red de apoyo. */
        minSilenceMs: 900,
        /** Turno máximo antes de forzar corte (ms). Corto = menos bucles. */
        maxSegmentMs: 8000,
        /** Audio previo al inicio de voz que se incluye en el turno (ms). */
        preRollMs: 180,
      },
    },
    /** all | last-only | off — con 3+ filas en log escala a all (Chrome acumulativo). */
    stripPriorTurnsOnInterim: true,
    stripPriorTurnsMode: 'last-only',
    /** 0 = nunca escalar a strip-all (evita vaciar interinos en sesiones largas / TV). */
    stripPriorTurnsEscalateAfterRows: 0,
    /** En last-only: recortar como máximo los últimos N turnos del interino acumulativo. */
    stripPriorTurnsRecentMax: 6,
    /**
     * Un final ASR con varios timbres → varias filas (snapshots de identidad + reparto de texto).
     * Captura y transcribe todo; mejora etiquetas en salón / aula.
     */
    asrSegmentation: {
      enabled: true,
      /** Solo partir cuando un turno previo ya commitido aparece embebido + voz nueva. */
      proportionalSplit: false,
      minSpeakerRuns: 2,
      minSnapshotsPerRun: 2,
      minWordsPerSegment: 6,
      minCaptureWordsToSplit: 15,
      maxSegmentsPerFinal: 2,
      embeddedPriorMinChars: 12,
      minCoverageRatio: 0.85,
    },
    /** Umbrales pausa/cola ASR — único bloque numérico (docs/reglas-duras.md). 0 en *MaxWords = solo heurística. */
    pauseAndWeakAsr: {
      interimOpenLineFlushMs: 0,
      /** Tras N ms sin onresult de Chrome: commit openLine no guardado (TV / SR mudo). */
      srGapCommitMs: 10000,
      srGapCommitMinWords: 3,
      /** Extensión mínima (chars/palabras) para commit por gap SR vs fila anterior. */
      srGapCommitExtensionMinChars: 16,
      srGapCommitNoNewContentMinChars: 12,
      postCommitCooldownMs: 0,
      staleFlushMinWords: 4,
      staleFlushMinWordsDuringCooldown: 5,
      pauseContinuationMs: 12000,
      pauseContinuationMinMs: 400,
      pauseBridgeMinSharedWords: 3,
      tailMinLengthRatio: 0.35,
      /** Margen de caracteres live vs capture en cola ASR (isTailOnlyInterimCapture). */
      tailLiveLengthMarginChars: 12,
      /** Ratio palabras únicas vs total para detectar repetición ASR débil. */
      weakAsrRepetitionUniqueRatio: 0.55,
      tailOnlyMaxWords: 0,
      tailOnlyMaxChars: 0,
      weakAsrStaleMaxWords: 0,
      weakAsrStaleMaxChars: 0,
      weakAsrFinalMaxWords: 0,
      weakAsrFinalMaxChars: 0,
      shortCommitMaxWords: 0,
      shortCommitMaxChars: 0,
      skipDiarizeOnStaleFlush: true,
      treatEmptyPhraseAsWeak: true,
    },
    /** Guardas de filas nuevas en ingress (docs/reglas-duras.md). */
    ingressGuards: {
      forceNewRowShortFinalMaxWords: 6,
      novelWordMinCount: 2,
      novelWordMinTextLength: 10,
      alternateNewRowMinLength: 8,
    },
    /** Fusión ASR / filas cortas (speechMerge.js). */
    speechMerge: {
      shortFinalKeywords: [
        'hola',
        'hey',
        'oye',
        'flu',
        'si',
        'sí',
        'no',
        'ok',
        'vale',
        'estas',
        'estás',
        'ahi',
        'ahí',
        'perro',
        'gato',
        // Palabras clave de juegos (lotería, pista, simon, trivia…). Hoy son
        // un no-op: shortFinalHasKeyword ya acepta cualquier palabra de
        // ≥ shortFinalKeywordMinChars (4). Se listan para documentar la
        // intención y blindar el reconocimiento si ese umbral cambia.
        'loteria',
        'lotería',
        'tengo',
        'pista',
        'paso',
        'sigue',
        'simon',
        'trivia',
      ],
      minKeywordConfidence: 0.55,
      shortFinalMaxWords: 4,
      shortFinalKeywordMinChars: 4,
    },
    /** Consultas Flu → Gemini: solo final salvo consulta de minuta en interino. */
    fluQuery: {
      dispatchOnInterim: false,
      /** No re-despachar si la frase crece («platícame de los aero» → «…aeropuertos»). */
      prefixExtensionDedupMs: 12000,
    },
    interimOpenLineFlushCheckMs: 0,
    /** Tras este intervalo sin commit: no shrink/redundant agresivo en ingress. */
    relaxGuardsAfterCommitMs: 1500,
    /** Pausa entre frases: fuerza nueva fila (evita machacar voz por TV continua). */
    logRowPauseForceNewMs: 1000,
    /** Solapamiento acústico (ms) al pasar al siguiente turno tras commit confirmado. */
    turnAudioOverlapMs: 800,
  },
  voiceCommands: {
 /** Wake words + alias ASR (Chrome confunde flu → flow/blue/flo).
  *  Fuente única: FLU_WAKE_WORDS (§9.4). Configurable en Ajustes. */
 wakeWords: [...FLU_WAKE_WORDS],
 resetAvatarColors: [
   'restablecer colores del avatar',
   'reset avatar colors',
   'restablecer colores de flu',
   'reset flu colors',
   'colores por defecto',
   'default colors'
 ],
    openListening: [
      'abrir escucha',
      'abre escucha',
      'iniciar escucha',
      'activar escucha',
      'seguir escuchando',
      'continuar escuchando',
      'open listening',
      'start listening',
      'resume listening',
      'continue listening',
    ],
    nextSpeaker: [
      'otro hablante',
      'siguiente hablante',
      'cambio de hablante',
      'nuevo hablante',
      'habla otra persona',
      'next speaker',
      'another speaker',
      'other speaker',
    ],
    closeListening: [
      'cerrar escucha',
      'cierra escucha',
      'detener escucha',
      'deten la escucha',
      'apagar escucha',
      'dejar de escuchar',
      'parar escucha',
      'close listening',
      'stop listening',
      'end listening',
      'turn off listening',
    ],
    startConversation: [
      'iniciar conversacion',
      'inicia conversacion',
      'iniciar conversación',
      'inicia conversación',
      'empezar conversacion',
      'empezar conversación',
      'comenzar conversacion',
      'comenzar conversación',
      'arrancar conversacion',
      'reiniciar conversacion',
      'nueva conversacion',
      'nueva sesion',
      'start conversation',
      'begin conversation',
      'new conversation',
      'start session',
      'new session',
    ],
    generateMinute: [
      'generar minuta',
      'genera minuta',
      'generame minuta',
      'generame una minuta',
      'generame la minuta',
      'crear minuta',
      'crea una minuta',
      'preparar minuta',
      'hacer minuta',
      'generate minute',
      'generate summary',
      'create minute',
      'create a minute',
      'make a minute',
    ],
    generateSummary: [
      'generar resumen',
      'generar resuemn',
      'crear resumen',
      'crea un resumen',
      'resume la conversacion',
      'resumir la conversacion',
      'hacer resumen',
      'preparar resumen',
      'generate summary',
      'create summary',
      'summarize conversation',
      'summarise conversation',
      'make a summary',
    ],
    /** F1 — análisis de documentos (archivo anexado en la zona de carga). */
    analyzeDocument: [
      'analizar documento',
      'analiza documento',
      'analiza el documento',
      'analizar el documento',
      'analiza este documento',
      'analizar este documento',
      'leer documento',
      'lee el documento',
      'leer el archivo',
      'lee el archivo',
      'analiza el archivo',
      'analizar archivo',
      'analiza el archivo que te anexe',
      'resume el documento',
      'resumir el documento',
      'resume el archivo',
      'analyze document',
      'analyze the document',
      'analyze file',
      'analyze the file',
      'read the document',
      'read the file',
    ],
    /** F2 — análisis de funcionalidad de una app. */
    analyzeApp: [
      'analizar app',
      'analiza app',
      'analiza la app',
      'analizar la app',
      'analiza la aplicacion',
      'analizar la aplicacion',
      'analiza esta app',
      'analizar esta app',
      'analizar funcionalidad',
      'analiza la funcionalidad',
      'analyze app',
      'analyze the app',
      'analyze application',
      'analyze functionality',
    ],
    /** F3 — generación de documentos (pdf/docx/xlsx/pptx/md/csv/ics...). */
    generateDocument: [
      'generar documento',
      'genera documento',
      'generame documento',
      'genera un documento',
      'generar un documento',
      'generame un documento',
      'crear documento',
      'crea un documento',
      'generar pdf',
      'genera un pdf',
      'generar excel',
      'genera un excel',
      'generar presentacion',
      'genera una presentacion',
      // Cartas y otros documentos concretos (F4 — generación de documento).
      'generar carta',
      'genera carta',
      'genera una carta',
      'generame una carta',
      'crear carta',
      'crea carta',
      'crear una carta',
      'crea una carta',
      'creame una carta',
      'haz una carta',
      'hazme una carta',
      'hacer una carta',
      'escribir carta',
      'escribe una carta',
      'redactar carta',
      'redacta una carta',
      'generar ensayo',
      'genera un ensayo',
      'generar resumen',
      'genera un resumen',
      'generate document',
      'create document',
      'create a document',
      'generate a document',
    ],
    /** F4 — generación de video explicativo. */
    generateVideo: [
      'generar video',
      'genera video',
      'generame video',
      'genera un video',
      'generar un video',
      'generame un video',
      'crear video',
      'crea un video',
      'generate video',
      'create video',
      'create a video',
      'generate a video',
    ],
    saveMinute: [
      'guardar minuta',
      'guarda minuta',
      'guardame minuta',
      'guardame la minuta',
      'guardar la minuta',
      'save minute',
      'save the minute',
    ],
    /** Navegación curada por voz → resultado en el Pizarrón (frases directas). */
    navigate: [
      'navegar a wikipedia',
      'navega a wikipedia',
      'navegar en wikipedia',
      'navega en wikipedia',
      'navegar a educar',
      'navega a educar',
      'navegar en educar',
      'navega en educar',
      'navegar a youtube',
      'navega a youtube',
      'abrir wikipedia',
      'abre wikipedia',
      'abrir educar',
      'abre educar',
      'abrir youtube',
      'abre youtube',
      'buscar en wikipedia',
      'busca en wikipedia',
      'buscar en educar',
      'busca en educar',
      'buscar en youtube',
      'busca en youtube',
      'búscame en wikipedia',
      'búscame en educar',
      'explora wikipedia',
      'explora educar',
      'navigate to wikipedia',
      'open wikipedia',
      'search wikipedia',
      'search on wikipedia',
      'browse wikipedia',
      'go to wikipedia',
    ],
    // F3 — Búsqueda web general (BUSCAR): frases que disparan una búsqueda
    // en los proveedores configurados (Wikipedia + DuckDuckGo). Se detectan
    // con matchesCommandPhrase(..., { tolerant: true }) como NAVEGAR, pero
    // se evalúan DESPUÉS de NAVEGAR para que "busca en wikipedia" siga
    // navegando al sitio curado en vez de hacer una búsqueda general.
    buscar: [
      'busca en la web',
      'buscá en la web',
      'buscar en la web',
      'busca en internet',
      'buscá en internet',
      'buscar en internet',
      'busca información sobre',
      'buscá información sobre',
      'buscar información sobre',
      'busca sobre',
      'buscá sobre',
      'búscame',
      'buscame',
      'busca en google',
      'buscá en google',
      'buscar en google',
      'búsqueda general',
      'search the web',
      'search on the web',
      'search the internet',
      'search for information about',
      'search about',
      'search on google',
      'google search',
      'search for',
      'look up',
    ],
    // A2 — "cabezas" genéricas que NO son el tema de búsqueda. Si el resto de la
    // frase tras el gatillo es SOLO una de estas, el turno queda incompleto y
    // espera el tema en el siguiente fragmento ("... en la web información" +
    // "lenguaje de programación clipper"). Fuente única; sin hardcode disperso.
    searchPlaceholderHeads: [
      'informacion',
      'información',
      'info',
      'datos',
      'algo',
      'eso',
      'esto',
      'una informacion',
      'una información',
      'algo de informacion',
      'algo de información',
    ],
    // P1-C (§1.3.2) — autoconocimiento (CONOCER_FLU): frases que disparan la
    // respuesta local de FLU sobre sus capacidades (fast-path sin IA, §1.3.3-1.3.4).
    conocerFlu: [
      'que sabes hacer',
      'que puedes hacer',
      'que sabe hacer flu',
      'que puedes hacer flu',
      'que haces',
      'que funciones tienes',
      'cuentame tus habilidades',
      'para que sirves',
      'what can you do',
      'what do you do',
      'what are your skills',
      'what can flu do',
    ],
    listeningAckPhrases: [
      ...LISTENING_ACK_PHRASES,
    ],
    /** Tras wake: ceder la palabra a Flu (mano alzada). */
    grantFloor: [
      'adelante',
      'participa',
      'dale',
      'dale flu',
      'continua',
      'continúa',
      'sigue',
      'procede',
      'go ahead',
      'proceed',
      'continue',
    ],
    /** Tras wake: rechazar intervención pendiente. */
    dismissFloor: [
      'no ahora',
      'ahora no',
      'espera',
      'espera flu',
      'flu espera',
      'not now',
      'wait',
      'later',
    ],
    /** Log y Frase: captura completa del turno (wake word + comando), no solo el texto tras el wake. */
    commandLogPreserveWake: true,
  },
  /** Escenarios E2E de regresión (capturas reales reportadas en producción). */
  validation: {
    e2eScenarios: {
      wakeTv: {
        inmobiliarias: {
          capture:
            'muy intensos con una presion muy alta un partido muy cerrado equipo ecuatoriano le gano a alemania okay flu platicame de las inmobiliarias sin imagenes',
          passiveMustInclude: ['ecuatoriano', 'alemania'],
          passiveMustExclude: ['inmobiliarias', firstWakeWith('okay '), 'platicame'],
          questionMustInclude: ['inmobiliarias'],
        },
        autos: {
          capture:
            'primeros partidos pero es quien reemplazo okay flu primeros partidos platicame de los autos los con los con imagenes',
          passiveMustInclude: ['primeros partidos'],
          passiveMustExclude: ['platicame', 'autos'],
          questionMustInclude: ['autos'],
        },
        aviones: {
          capture:
            'manejar un bloque mas compacto permitir pocas oportunidades involucrar a su arquero okay flow platicame de los aviones sin imagenes',
          passiveMustInclude: ['bloque mas compacto'],
          passiveMustExclude: ['aviones', 'platicame'],
          questionMustInclude: ['aviones'],
        },
      },
      commands: {
        iniciarConversacion: ['iniciar conversacion', 'iniciar conversación'],
        fluParticipa: ['ok flu adelante', 'okay flu participa'],
      },
      /** Consultas wake + complemento (minutas, imágenes) — capturas reales de sesión. */
      fluQueries: {
        minuteConsult: [
          {
            phrase: 'ok flu platicame de la minuta 1',
            question: 'platicame de la minuta 1',
          },
          {
            phrase: 'ok flu platicame de la minuta 2',
            question: 'platicame de la minuta 2',
          },
          {
            phrase: 'okay flu dame un resumen de la minuta 2',
            question: 'dame un resumen de la minuta 2',
          },
          {
            phrase: 'ok flu genera un resumen de la minuta 4',
            question: 'genera un resumen de la minuta 4',
          },
        ],
        image: [
          {
            phrase: 'ok flu generame una imagen',
            question: 'generame una imagen',
          },
          {
            phrase: 'okay flow generame una imagen',
            question: 'generame una imagen',
          },
          {
            phrase: 'ok flu genera la imagen de un perro',
            question: 'genera la imagen de un perro',
          },
        ],
        peelMinuteEcho: {
          phrase: 'ok flu platicame de la minuta 2',
          lastCommitted: 'platicame de la minuta 2',
          expectQuestion: 'platicame de la minuta 2',
        },
        /** Tras respuesta Flu que menciona «imagen», el comando del usuario no debe bloquearse. */
        postAssistantImageReply: {
          userPhrase: 'ok flu generame una imagen',
          expectQuestion: 'generame una imagen',
        },
        bareImageUsesThread: {
          phrase: 'ok flu generame una imagen',
          historyUser: 'Platicame de estadios de futbol en Mexico.',
          anchorMustInclude: 'hilo reciente',
          anchorMustExclude: '("generame una imagen")',
        },
      },
    },
  },
}

export function isSessionResetCommand(comando = '') {
  return String(comando || '').trim() === FLU_CONFIG.navigation.sessionResetCommand
}

export function getActiveListenConfig() {
  return FLU_CONFIG.activeListen
}

/** Umbrales de reinicio SR en sesión de conversación (más agresivos que escucha pasiva). */
export function getConversationRestartConfig(conversationActive = false) {
  const restart = FLU_CONFIG.activeListen?.restart || {}
  if (!conversationActive) return restart
  return {
    ...restart,
    silentMicStallMs: restart.conversationStallMs ?? restart.silentMicStallMs,
    stallMs: restart.conversationStallMs ?? restart.stallMs,
    stallRebuildMinMs: restart.conversationStallRebuildMinMs ?? restart.stallRebuildMinMs,
    deadRecognitionMs: restart.conversationDeadRecognitionMs ?? restart.deadRecognitionMs,
  }
}

export function getConversationConfig() {
  return FLU_CONFIG.activeListen
}

/**
 * Wake word canonica para copy y prompts: la configurada en Ajustes, o la primera
 * del catalogo si el usuario vacio la lista. Fuente unica (┬º9.4): en runtime nunca
 * se escribe un literal de wake.
 */
export function getCanonicalWakeWord() {
  const configured = FLU_CONFIG?.voiceCommands?.wakeWords?.[0]
  return configured || FLU_WAKE_WORDS[0]
}
