import { STREAM_STT_DEV_URL } from '../../core/config/appConfig'

const LISTENING_ACK_PHRASES = Object.freeze([
  'estas escuchando',
  'me escuchas',
  'estas ahi',
  'estas ahí',
  'estas por ahi',
  'estas por ahí',
  'oye flu estas escuchando',
  'are you listening',
  'can you hear me',
  'hey flu are you listening',
])

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
        /** Bajo de 0.88→0.82: misma persona con variación natural de tono no crea H2/H3. */
        cosineMatchThreshold: 0.82,
        /** Re-identificación room-rematch estricta (512-D L2 + coseno). */
        roomRematchThreshold: 0.80,
        roomRematchThresholdMax: 0.80,
        roomRematchShortThreshold: 0.80,
        cosineContinuityThreshold: 0.70,
        cosineNewVoiceThreshold: 0.64,
        /** Caída de similitud coseno que indica cambio abrupto de voz en ingress. */
        abruptSimilarityDrop: 0.08,
        cosineRegisteredMatchThreshold: 0.68,
        /** Distancia coseno máxima para pegar al hablante del turno anterior. */
        lastTurnSignatureContinuityDistance: 0.075,
        /** Reutilización de cluster en producción (512-D real). */
        productionClusterReuseThreshold: 0.70,
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
        shortUtteranceHistoricalMatch: 0.66,
        /** <4 palabras: mantener locutor anterior si coseno ≥ 0.68 (evita H5/H7). */
        shortUtteranceImmediateContinuity: 0.68,
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
        segmentChronoSplit: true,
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
        /** Sesión efectivamente solitaria (1 cluster auto): aprieta el umbral de apertura de voz
         * nueva (NEW_VOICE_OPEN = NEW_VOICE_EFF * soloNewVoiceFactor) para evitar «Hablante 2»
         * fantasma sin romper voces realmente distintas (sims < NEW_VOICE_OPEN siguen abriendo). */
        soloNewVoiceFactor: 0.82,
        /** Tras ≥N clusters auto: no forzar production-primary-rematch si otro cluster encaja mejor. */
        classroomPrimaryRematchMaxClusters: 1,
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
    /** @deprecated Interinos ya no escriben al log; solo aplica a rutas legacy. */
    streamLogThrottleMs: 0,
    wakeWordCommandDelayMs: 1500,
    interimCommandDelayMs: 500,
    conversationMinMsAfterLastResult: 30,
    interimFinalizeGraceMs: 25,
    conversationSettleStableMs: 80,
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
  },
  /** Escucha activa local (SpeechRecognition del navegador). */
  activeListen: {
    languages: {
      es: 'es-MX',
      en: 'en-US',
      // Lenguas indígenas mexicanas (OS3 parity)
      nah: 'es-MX',   // Náhuatl — fallback a es-MX (SR no tiene locale nativo)
      yua: 'es-MX',   // Maya (yucateco) — fallback a es-MX
      mix: 'es-MX',   // Mixteco — fallback a es-MX
      zap: 'es-MX',   // Zapoteco — fallback a es-MX
    },
    /** Escucha bilingüe: alterna locale SR según detectTranscriptLanguage. */
    bilingual: {
      defaultLocale: 'es-MX',
      locales: ['es-MX', 'en-US'],
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
    },
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
    },
    transcriptPlaceholder: '',
    transcriptLabel: '',
    /** Nombre visible mientras speakerId === calculando. */
    identifyingSpeakerName: 'Identificando...',
    mainCopy: '',
    workspace: {
      title: '',
      emptyContent:
        'Aquí aparecerá el material que Flu genera para apoyar la sesión: texto, imagen, diagrama o salida operativa.',
      fallbackTitle: 'Salida activa de IA',
      keyPointsTitle: 'Puntos clave',
      keyPointsEmpty: 'Sin puntos clave por ahora.',
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
    enabled: true,
    ringSize: 800,
    /** Eventos speaker/diarize-* en ring y __fluDev.speakerMonitor */
    speakerDiarize: true,
    mirrorConsole: false,
    /** POST periódico a Vite → flu-voz/logs/agent-trace.json (lectura agente). */
    agentSink: true,
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
    loteria: {
      cartasPorRonda: 3,
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
    enabled: true,
    /** `[Flu][chrome-raw]` — evento SpeechRecognition sin procesar (solo dev). */
    chromeRawConsole: true,
    /** `[Flu][stream-stt]` — texto del STT por mic nativo (solo dev). */
    streamSttConsole: true,
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
    /** Vectores de embedding en filas del log de conversación (solo diagnóstico). */
    showEmbeddingPreview: false,
    /** Reenviar logs del frontend al servidor (terminal) para que Roo pueda verlos. */
    relayToServer: true,
  },
  /**
   * Perfil gratuito (recomendado): source browser + Chrome SR on-device + mic pasivo para hablantes.
   * No usar hybrid/stream salvo API de pago (p. ej. Deepgram). Ver docs/transcripcion-conversaciones.md § Stack gratuito.
   */
  transcript: {
    source: 'browser',
    commandsFromBrowser: true,
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
  streamStt: {
    wsPath: '/stream-stt',
    wsUrl: '',
    devServerUrl: STREAM_STT_DEV_URL,
    targetSampleRate: 16000,
    chunkMs: 80,
    reconnectMs: 1500,
    maxReconnectAttempts: 0,
    utteranceSilenceMs: 900,
    minVoicedRms: 0.0025,
  },
  voiceCommands: {
 /** Wake words + alias ASR (Chrome confunde flu → flow/blue/flo). Un solo punto de verdad. */
 wakeWords: [
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
 ],
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
          passiveMustExclude: ['inmobiliarias', 'okay flu', 'platicame'],
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
