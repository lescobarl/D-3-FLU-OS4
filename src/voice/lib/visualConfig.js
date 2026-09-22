import { POLLINATIONS_DEFAULTS, REMOTE_RESOURCE_URLS } from '../../core/config/sharedConfig'

export const VISUAL_CONFIG = {
  image: {
    width: 1024,
    height: 576,
    /** Pipeline único: brief IA → generación. Stock desactivado por defecto. */
    pipeline: {
      primary: 'pollinations',
      visualTypes: ['image_prompt', 'diagram', '3d'],
      /** Tras fallo de generación/proxy: localSvg | none */
      errorFallback: 'localSvg',
      stockSearch: {
        enabled: false,
        queryMode: 'fullBrief',
        minAcceptScore: 10,
        pageSize: 8,
        requestTimeoutMs: 12000,
        titlePenalties: [
          'scrap',
          'boneyard',
          'abandoned',
          'rust',
          'desert',
          'museum',
          'cemetery',
          'wreck',
          'desguace',
        ],
      },
    },
    pollinations: {
      // Base única (sin la ruta /prompt) derivada de POLLINATIONS_DEFAULTS.
      baseUrl: String(POLLINATIONS_DEFAULTS.BASE_URL).replace(/\/prompt\/?$/, ''),
      model: 'flux',
      nologo: true,
      enhance: true,
    },
    openverse: {
      apiBase: REMOTE_RESOURCE_URLS.OPENVERSE_IMAGES_API,
    },
    prompt: {
      maxSubjectChars: 320,
      maxContextChars: 280,
      leadInStopwords: ['flu', 'ok', 'okay', 'flow', 'blue', 'flo'],
      subjectLeadPatterns: {
        es: [
          /^(fotografia|fotograf[aí]a|foto|imagen|retrato|escena)\s+(realista|real|natural|detallada|nítida|nitida)?\s*(de|del|sobre|con)?\s+/i,
          /^(un|una)\s+(fotografia|fotograf[aí]a|foto|imagen|retrato|escena)\s+(realista|real|natural|detallada|nítida|nitida)?\s*(de|del|sobre|con)?\s+/i,
        ],
        en: [
          /^(photo|photograph|image|portrait|scene)\s+(of|about|with)?\s+/i,
          /^(a|an)\s+(photo|photograph|image|portrait|scene)\s+(of|about|with)?\s+/i,
        ],
      },
      noiseWords: [
        'he generado',
        'claro',
        'a continuacion',
        'a continuación',
        'te muestro',
        'muestro',
        'presento',
      ],
      /**
       * Frases de arranque conversacional que se eliminan al extraer el tema del
       * hilo (p. ej. "Platícame de los conejos que hablan" → "los conejos que
       * hablan"). Se aplican en extractConversationTopic para que el sujeto del
       * fallback determinista sea el tema limpio, no la pregunta completa.
       */
      topicLeadPatterns: [
        /^(plat[ií]came|cu[eé]ntame|h[aá]blame|dime|expl[ií]came|mu[eé]strame|ens[eé][ñn]ame|cuenta|habla|plat[ií]ca)\s+(?:de|sobre|acerca de|acerca)\s+/i,
        /^(tell me|talk to me|about|explain to me|show me)\s+(?:about|of|on)?\s+/i,
        /^(quiero|necesito|me gustar[ií]a|quisiera|puedes)\s+(?:saber|ver|conocer|hablar|aprender)\s+(?:de|sobre|acerca de|acerca)?\s+/i,
        /^(i want|i need|i would like|can you)\s+(?:to know|to see|to learn|to talk)\s+(?:about|of)?\s+/i,
      ],
      /** Tras quitar muletillas: petición visual sin sujeto concreto → inferir del hilo. */
      bareVisualPatterns: [
        /^genera(me|r)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual|ilustracion|ilustración|diagrama|render)\s*$/i,
        /^crea(r|me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual|ilustracion|ilustración)\s*$/i,
        /^muestra(r|me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual)\s*$/i,
        /^haz(me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual)\s*$/i,
      ],
      /**
       * Calificador visual explícito: el usuario pide imágenes/fotos de forma
       * explícita aunque la frase sea de explicación (p. ej. «háblame de los
       * aviones con imágenes»). Cuando aparece, el modelo DEBE fijar
       * workspace.tipo = image_prompt y generar prompt_visual, no preguntar.
       */
      explicitVisualQualifierPatterns: [
        /\bcon\s+(?:im[aá]genes?|fotos?|imagen(?:es)?)\b/gi,
        /\bcon\s+(?:im[aá]genes?|fotos?)\s+(?:de|del|de la|sobre)?\b/gi,
        /\b(incluye|incluir|muestra|muestrame)\s+(?:im[aá]genes?|fotos?)\b/gi,
        /\bcon\s+im[aá]genes?\s+(?:de|del|de la|sobre)\b/gi,
        /\bwith\s+(?:images?|photos?|pictures?)\b/gi,
        /\b(include|show|with)\s+(?:images?|photos?|pictures?)\b/gi,
      ],
      /** Ancla que fuerza image_prompt cuando hay calificador visual explícito. */
      explicitVisualAnchor: {
        es: 'El usuario pidió imágenes de forma explícita ("con imágenes"/"con fotos"). DEBES fijar workspace.tipo = image_prompt y escribir prompt_visual como escena renderizable autocontenida del sujeto. NO preguntes qué explicar: genera la imagen y acompaña con una respuesta_voz breve.',
        en: 'The user explicitly asked for images ("with images"/"with photos"). You MUST set workspace.tipo = image_prompt and write prompt_visual as a self-contained renderable scene of the subject. Do NOT ask what to explain: generate the image and accompany it with a brief respuesta_voz.',
      },
      /**
       * Ancla para petición visual SIN sujeto concreto en la frase actual
       * (p. ej. «generame una imagen»). El usuario quiere una imagen del tema
       * que se está conversando: DEBE inferir prompt_visual del hilo reciente.
       * Solo si el hilo NO tiene ningún tema visual concreto puede preguntar
       * brevemente y usar workspace.tipo text. La redacción es deliberadamente
       * imperativa para evitar que el modelo "salga por la tangente" pidiendo
       * aclaración cuando el hilo sí tiene un tema.
       */
      bareVisualAnchor: {
        es: 'PETICIÓN VISUAL SIN SUJETO EN ESTA FRASE. El usuario acaba de pedir una imagen ("generame una imagen", "crea una imagen", etc.) sin nombrar el sujeto. REGLA OBLIGATORIA: el tema ya está en el hilo de conversación (turnos previos del usuario y tema de sesión). DEBES inferir prompt_visual de ese hilo y fijar workspace.tipo = image_prompt con una escena renderizable específica (sujeto, entorno, estilo) del tema conversado. Prohibido placeholder abstracto genérico. PROHIBIDO responder "¿qué imagen quieres?" o "¿sobre qué?" cuando el hilo tiene un tema: genera la imagen de inmediato y acompaña con una respuesta_voz breve. ÚNICA excepción: si el hilo NO tiene absolutamente ningún tema (conversación vacía o sin contexto), entonces sí pregunta brevemente y usa workspace.tipo text.',
        en: 'VISUAL REQUEST WITHOUT A SUBJECT IN THIS UTTERANCE. The user just asked for an image ("generate me an image", "create an image", etc.) without naming the subject. MANDATORY RULE: the topic is already in the conversation thread (previous user turns and session topic). You MUST infer prompt_visual from that thread and set workspace.tipo = image_prompt with a specific renderable scene (subject, setting, style) of the discussed topic. Never generic abstract placeholders. FORBIDDEN to reply "what image do you want?" or "about what?" when the thread has a topic: generate the image right away and accompany it with a brief respuesta_voz. ONLY exception: if the thread has absolutely NO topic (empty conversation or no context), then ask briefly and use workspace.tipo text.',
      },
      /**
       * Fallback determinista (Regla #1: texto desde config, sin hardcode).
       * Cuando el usuario hace una petición visual sin sujeto ("generame una
       * imagen") y el modelo NO devuelve workspace.tipo=image_prompt (responde
       * pidiendo aclaración), el servidor construye el workspace de forma
       * determinista a partir del tema del hilo de conversación. Así la imagen
       * SIEMPRE se genera cuando el hilo tiene un tema, sin depender de que el
       * modelo siga el ancla del prompt.
       */
      bareVisualFallback: {
        es: {
          titulo: 'Imagen del tema conversado',
          promptVisual: (subject) =>
            `Escena renderizable del tema conversado: ${subject}. Representa el sujeto de forma clara y específica en una sola escena fotorrealista autocontenida, sin texto, sin títulos y sin estilo de presentación.`,
          respuestaVoz: (subject) =>
            `¡Listo! Te genero una imagen sobre ${subject}.`,
        },
        en: {
          titulo: 'Image of the discussed topic',
          promptVisual: (subject) =>
            `Renderable scene of the discussed topic: ${subject}. Depict the subject clearly and specifically in a single self-contained photorealistic scene, no text, no titles, no presentation style.`,
          respuestaVoz: (subject) =>
            `Done! I am generating an image about ${subject}.`,
        },
      },
      /** prompt_visual genérico prohibido (placeholders de modelo). */
      genericPromptPatterns: [
        /composici[oó]n abstracta/i,
        /imagen conceptual generada/i,
        /estilo art[ií]stico moderno/i,
        /elementos abstractos y colores vibrantes/i,
        /solicitud del usuario/i,
      ],
      imagePromptLead: {
        es: 'Crea una sola imagen fotorrealista a pantalla completa, no una presentacion, diapositiva, poster, tarjeta, infografia, mockup, collage, inserto ni composicion por capas.',
        en: 'Create a single photorealistic full-frame image, not a presentation, slide deck, poster, card, infographic, mockup, collage, inset, or layered layout.',
      },
      imagePromptSubject: {
        es: 'Representa exactamente: {subject}.',
        en: 'Depict exactly: {subject}.',
      },
      imagePromptConstraints: {
        es: 'Usa una sola escena realista continua sin texto, sin titulos, sin subtitulos, sin etiquetas, sin bordes, sin superposiciones en primer plano y sin estilo de presentacion.',
        en: 'Use one uninterrupted realistic scene with no text, no titles, no subtitles, no labels, no borders, no foreground overlays, and no presentation-style layout.',
      },
      diagramLead: {
        es: 'Crea un solo diagrama tecnico limpio basado solo en: {core}. Sin estilo de diapositiva, sin tarjetas de titulo, sin bloques de texto fuera del diagrama y sin decoracion de presentacion.',
        en: 'Create a single clean technical diagram based only on: {core}. No slide layout, no title cards, no text blocks outside the diagram, and no decorative presentation styling.',
      },
      diagram3dLead: {
        es: 'Crea una sola escena 3D basada solo en: {core}. Sin estilo de diapositiva, sin tarjetas de titulo, sin bloques de texto, sin subtitulos y sin estilo de presentacion.',
        en: 'Create a single 3D scene based only on: {core}. No slide layout, no title cards, no text blocks, no captions, and no presentation styling.',
      },
      imagePromptLeadReal: {
        es: 'Crea una sola imagen fotorrealista a pantalla completa basada solo en: {core}. Haz que se vea como una sola escena u objeto natural sin interrupciones, no como diapositiva, tarjeta, poster, infografia o mockup. Sin texto, sin titulos, sin subtitulos, sin etiquetas, sin bordes y sin superposiciones en primer plano.',
        en: 'Create a single photorealistic full-frame real-world image based only on: {core}. Make it look like one uninterrupted natural scene or object, not a presentation slide, card, poster, infographic, or mockup. No text, no titles, no subtitles, no labels, no borders, and no foreground overlays.',
      },
    },
    cache: {
      ttlMs: 24 * 60 * 60 * 1000,
    },
    /** Timeout cliente → POST /api/workspace-image y /api/openrouter-image (evita «Cargando…» infinito). */
    clientFetchTimeoutMs: 100000,
  },
}
