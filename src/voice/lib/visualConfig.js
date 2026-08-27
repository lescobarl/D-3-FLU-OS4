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
      /** Reservado: primary gemini + apiKey en servidor (no activo en runtime browser). */
      geminiImage: {
        models: [
          { model: 'gemini-2.5-flash-image', kind: 'generateContent' },
          { model: 'gemini-3.1-flash-image-preview', kind: 'generateContent' },
          { model: 'imagen-4.0-fast-generate-001', kind: 'predict' },
          { model: 'imagen-4.0-generate-001', kind: 'predict' },
        ],
      },
    },
    pollinations: {
      baseUrl: 'https://image.pollinations.ai',
      model: 'flux',
      nologo: true,
      enhance: true,
    },
    openverse: {
      apiBase: 'https://api.openverse.org/v1/images/',
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
      /** Tras quitar muletillas: petición visual sin sujeto concreto → inferir del hilo. */
      bareVisualPatterns: [
        /^genera(me|r)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual|ilustracion|ilustración|diagrama|render)\s*$/i,
        /^crea(r|me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual|ilustracion|ilustración)\s*$/i,
        /^muestra(r|me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual)\s*$/i,
        /^haz(me)?\s+(?:(?:una|la|el|un)\s+)?(imagen|foto|visual)\s*$/i,
      ],
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
    /** Timeout cliente → POST /api/workspace-image (evita «Cargando…» infinito). */
    clientFetchTimeoutMs: 60000,
  },
}
