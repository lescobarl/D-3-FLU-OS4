import { useRef } from 'react';

/**
 * Ref del vinculo etiqueta->persona del participante ACTIVO (panel de participantes, A3).
 *
 * POR QUE VIVE AQUI (y no en el god-file): el trinquete de tamano de
 * useFluVoiceAssistant.js no admite crecer, asi que este bloque se saca a un modulo de
 * src/app (regla 7.6: recorta esas N lineas donde toca).
 *
 * El valor se REFRESCA en cada render: asi un callback con `deps: []` lee SIEMPRE el
 * vinculo vigente al resolver el hablante de la fila (sin closure obsoleta).
 *
 * @param registeredLabel etiqueta de diarizacion del participante activo ('' si no hay)
 * @param registeredName  nombre de persona del participante activo ('' si no hay)
 * @returns ref mutable cuyo `.current` es el vinculo vigente
 */
export function useParticipantSpeakerRef(registeredLabel: string, registeredName: string) {
    const ref = useRef<{ registeredLabel: string; registeredName: string }>({
        registeredLabel: '',
        registeredName: '',
    });
    ref.current = { registeredLabel, registeredName };
    return ref;
}
