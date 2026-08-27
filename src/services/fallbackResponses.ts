// ============================================================
// fallbackResponses — Generador de respuestas contextuales
// (fallback cuando Gemini no está disponible)
// ============================================================

/**
 * Genera una respuesta contextual de respaldo cuando Gemini no está disponible.
 * Usa coincidencia de patrones para detectar intenciones del usuario.
 * Soporta español (es) e inglés (en).
 */
export function generateResponse(
    userText: string,
    botName: string,
    history: Array<{ role: string; text: string }>,
    language: string = 'es',
): string {
    const isEnglish = language === 'en';
    const lower = userText.toLowerCase();
    const lastTurns = history.slice(-6);

    const isGreeting = !!lower.match(/^(hola|buenas|hey|hello|hi|qué tal|buen[oa]s|alo|saludos)/);
    const isFarewell = !!lower.match(/^(adiós|chao|bye|nos vemos|hasta luego|see you|hasta pronto|me voy|goodbye)/);
    const isThanks = lower.includes('gracias') || lower.includes('thanks') || lower.includes('thank you') || lower.includes('agradezco');
    const isAboutBot = lower.includes('quién eres') || lower.includes('qué eres') || lower.includes('who are you') || lower.includes('cómo te llamas') || lower.includes('what is your name');
    const isAboutCapabilities = lower.includes('qué puedes hacer') || lower.includes('what can you do') || lower.includes('tus funciones') || lower.includes('para qué sirves') || lower.includes('your functions');
    const isUserHappy = lower.includes('feliz') || lower.includes('contento') || lower.includes('alegre') || lower.includes('genial') || lower.includes('excelente') || lower.includes('me alegra') || lower.includes('happy') || lower.includes('great');
    const isUserSad = lower.includes('triste') || lower.includes('mal') || lower.includes('deprimido') || lower.includes('cansado') || lower.includes('preocupado') || lower.includes('estresado') || lower.includes('sad') || lower.includes('bad') || lower.includes('depressed');
    const isHowAreYou = lower.includes('cómo estás') || lower.includes('how are you') || lower.includes('qué tal estás') || lower.includes('cómo te va') || lower.includes("how's it going");
    const isHelpRequest = lower.includes('ayuda') || lower.includes('help') || lower.includes('necesito') || lower.includes('puedes ayudarme') || lower.includes('can you help');
    const isQuestion = lower.includes('qué') || lower.includes('cómo') || lower.includes('cuándo') || lower.includes('dónde') || lower.includes('por qué') || lower.includes('quién') || lower.includes('cuál') || lower.includes('what') || lower.includes('how') || lower.includes('when') || lower.includes('where') || lower.includes('why') || lower.includes('who') || lower.includes('which') || lower.endsWith('?');

    if (isGreeting) {
        if (lastTurns.length > 2) {
            if (isEnglish) {
                const greetings = [
                    `Hello again! Glad we're still talking. How can I help you now?`,
                    `Hey! Good to see you back. How are you?`,
                    `Welcome back! I was thinking about our previous conversation. What else would you like to explore?`,
                ];
                return greetings[Math.floor(Math.random() * greetings.length)];
            }
            const greetings = [
                `¡Hola de nuevo! Me alegra que sigamos conversando. ¿En qué puedo ayudarte ahora?`,
                `¡Hey! Qué bueno que vuelves. ¿Cómo vas?`,
                `¡Bienvenido de vuelta! Estaba pensando en nuestra conversación anterior. ¿Qué más te gustaría explorar?`,
            ];
            return greetings[Math.floor(Math.random() * greetings.length)];
        }
        if (isEnglish) {
            const greetings = [
                `Hello! I'm ${botName}. How are you? I'm here to help you.`,
                `Hey! I'm ${botName}. Great to see you. How can I help you today?`,
                `Hi! I'm ${botName}. I'm glad you're here. What do you need?`,
                `Hello! I'm ${botName}, your assistant. How can I help you?`,
            ];
            return greetings[Math.floor(Math.random() * greetings.length)];
        }
        const greetings = [
            `¡Hola! Soy ${botName}. ¿Cómo estás? Estoy aquí para ayudarte.`,
            `¡Hey! Soy ${botName}. Qué gusto verte. ¿En qué puedo ayudarte hoy?`,
            `¡Buenas! Soy ${botName}. Me alegra que estés aquí. ¿Qué necesitas?`,
            `¡Hola! Soy ${botName}, tu asistente. ¿En qué puedo servirte?`,
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }

    if (isFarewell) {
        if (isEnglish) {
            const farewells = [
                `See you later! It's been a pleasure chatting with you. Come back anytime!`,
                `Goodbye! Take care. I'll be here when you need me.`,
                `Bye! Have a great day. It was great talking with you.`,
            ];
            return farewells[Math.floor(Math.random() * farewells.length)];
        }
        const farewells = [
            `¡Hasta luego! Ha sido un placer charlar contigo. ¡Vuelve cuando quieras!`,
            `¡Nos vemos! Cuídate mucho. Estaré aquí cuando me necesites.`,
            `¡Chao! Que tengas un excelente día. Fue genial conversar contigo.`,
        ];
        return farewells[Math.floor(Math.random() * farewells.length)];
    }

    if (isThanks) {
        if (isEnglish) {
            const thanks = [
                "You're welcome! That's what I'm here for. Anything else?",
                'With pleasure. Always happy to help.',
                "Don't mention it! Count on me whenever you want.",
                "I'm glad I could help. Is there anything else I can assist you with?",
            ];
            return thanks[Math.floor(Math.random() * thanks.length)];
        }
        const thanks = [
            '¡De nada! Para eso estoy. ¿Necesitas algo más?',
            'Con gusto. Siempre es un placer ayudarte.',
            '¡No hay de qué! Cuenta conmigo cuando quieras.',
            'Me alegra poder ayudar. ¿Hay algo más en lo que pueda asistirte?',
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
    }

    if (isAboutBot) {
        if (isEnglish) {
            return `I'm ${botName}, a conversational assistant with personality. I'm here to chat with you, help you with whatever you need, and learn from our conversations. I can express emotions through my 3D avatar and have natural conversations.`;
        }
        return `Soy ${botName}, un asistente conversacional con personalidad. Estoy aquí para charlar contigo, ayudarte con lo que necesites y aprender de nuestras conversaciones. Puedo expresar emociones a través de mi avatar 3D y mantener conversaciones naturales.`;
    }

    if (isAboutCapabilities) {
        if (isEnglish) {
            return 'I can have conversations, listen to you through the microphone, answer questions, and express emotions through my 3D avatar. I can also generate meeting minutes from our conversations and keep a detailed record. What would you like to try?';
        }
        return 'Puedo mantener conversaciones, escucharte mediante el micrófono, responder preguntas, y expresar emociones a través de mi avatar 3D. También puedo generar minutas de nuestras conversaciones y mantener un registro detallado. ¿Qué te gustaría probar?';
    }

    if (isHowAreYou) {
        if (lastTurns.length > 4) {
            if (isEnglish) {
                return "I'm doing great! This conversation has gotten really interesting. Thanks for asking. And how are you?";
            }
            return '¡Estoy muy bien! Esta conversación se ha puesto muy interesante. Gracias por preguntar. ¿Y tú cómo estás?';
        }
        if (isEnglish) {
            const moods = [
                "I'm great! Thanks for asking. How are you?",
                'Very well, enjoying our conversation. How about you?',
                "Wonderful. It's always a good day when I can chat with you.",
                "Full of energy! I love when people take the time to have a conversation.",
            ];
            return moods[Math.floor(Math.random() * moods.length)];
        }
        const moods = [
            '¡Estoy genial! Gracias por preguntar. ¿Y tú cómo estás?',
            'Muy bien, disfrutando de nuestra conversación. ¿Cómo vas tú?',
            'Estupendamente. Siempre es un buen día cuando puedo charlar contigo.',
            '¡Lleno de energía! Me encanta cuando la gente se toma el tiempo para conversar.',
        ];
        return moods[Math.floor(Math.random() * moods.length)];
    }

    if (isUserHappy) {
        if (isEnglish) {
            return "I'm really glad to hear that! Happiness is contagious. What's making you so happy? I'd love to hear more about it.";
        }
        return '¡Me alegra mucho saber eso! La felicidad es contagiosa. ¿Qué te tiene tan contento? Me encantaría escuchar más al respecto.';
    }

    if (isUserSad) {
        if (isEnglish) {
            return "I'm so sorry. Sometimes talking helps you feel better. Do you want to tell me what's going on? I'm here to listen and support you in whatever you need.";
        }
        return 'Lo siento mucho. A veces conversar ayuda a sentirse mejor. ¿Quieres contarme qué pasa? Estoy aquí para escucharte y apoyarte en lo que necesites.';
    }

    if (isHelpRequest) {
        if (isEnglish) {
            return "Of course I can help you! Tell me what you need and I'll do my best to assist you. What is it about?";
        }
        return '¡Claro que puedo ayudarte! Dime qué necesitas y haré todo lo posible por asistirte. ¿De qué se trata?';
    }

    if (lastTurns.length >= 4) {
        const lastUserMsg = [...lastTurns].reverse().find(m => m.role === 'user');
        if (lastUserMsg && lastUserMsg.text !== userText) {
            if (isEnglish) {
                const contextualResponses = [
                    `I see. Following up on the topic you mentioned earlier, would you like to go deeper into something specific?`,
                    `Interesting perspective. This reminds me of what we were talking about a moment ago. How do you think it relates?`,
                    `Wow, that adds a new layer to what we were discussing. Tell me more.`,
                    `How interesting how our conversation evolves. What else can you tell me about it?`,
                ];
                return contextualResponses[Math.floor(Math.random() * contextualResponses.length)];
            }
            const contextualResponses = [
                `Entiendo. Siguiendo con el tema que mencionabas antes, ¿quieres profundizar en algo en particular?`,
                `Interesante perspectiva. Esto me recuerda a lo que hablábamos hace un momento. ¿Cómo crees que se relaciona?`,
                `Vaya, eso añade una nueva capa a lo que discutíamos. Cuéntame más.`,
                `Qué interesante cómo evoluciona nuestra conversación. ¿Qué más puedes contarme al respecto?`,
            ];
            return contextualResponses[Math.floor(Math.random() * contextualResponses.length)];
        }
    }

    if (isQuestion) {
        if (isEnglish) {
            const questionResponses = [
                `Good question. Let me think... I think it's a fascinating topic. What do you think?`,
                `That's something that makes me reflect. From my perspective, it's a topic with many angles. How do you see it?`,
                `What an interesting question. I like that you explore deep topics. What led you to ask that?`,
                `Hmm, let me process that... That's a thought-provoking question. What do you think about it?`,
            ];
            return questionResponses[Math.floor(Math.random() * questionResponses.length)];
        }
        const questionResponses = [
            `Buena pregunta. Déjame pensar... Creo que es un tema fascinante. ¿Qué opinas tú?`,
            `Eso es algo que me hace reflexionar. Desde mi perspectiva, es un tema con muchas aristas. ¿Cómo lo ves tú?`,
            `Qué interesante pregunta. Me gusta que explores temas profundos. ¿Qué te llevó a preguntar eso?`,
            `Mmm, déjame procesar eso... Es una pregunta que invita a la reflexión. ¿Qué piensas tú al respecto?`,
        ];
        return questionResponses[Math.floor(Math.random() * questionResponses.length)];
    }

    if (isEnglish) {
        const fallbacks = [
            `Interesting what you're saying. Tell me more about that.`,
            `I see. What else can you tell me about it?`,
            `Wow, that gives me food for thought. How do you feel about it?`,
            `How curious. I never stop learning new things with you.`,
            `Hmm, let me process that... It's a fascinating topic.`,
            `Great! I love when the conversation gets interesting.`,
            `Go on, go on... I'm very interested in what you're saying.`,
            `I see. That's a very interesting perspective. What else?`,
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }

    const fallbacks = [
        `Interesante lo que dices. Cuéntame más sobre eso.`,
        `Entiendo. ¿Qué más puedes contarme al respecto?`,
        `Vaya, eso da para pensar. ¿Cómo te sientes al respecto?`,
        `Qué curioso. Nunca dejo de aprender cosas nuevas contigo.`,
        `Mmm, déjame procesar eso... Es un tema fascinante.`,
        `¡Qué bien! Me encanta cuando la conversación se pone interesante.`,
        `Sigue, sigue... Me interesa mucho lo que dices.`,
        `Ya veo. Esa es una perspectiva muy interesante. ¿Qué más?`,
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}
