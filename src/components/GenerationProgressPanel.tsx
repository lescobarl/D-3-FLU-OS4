// ============================================================
// GenerationProgressPanel — Panel de progreso de generación F3/F4
// ============================================================
// Muestra el generationJob (estado/progreso), el botón de descarga
// del documento generado y la vista previa del video (mp4 o
// guion/storyboard degradado).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GenerationJob } from '../types/documentContracts';
import type { GeneratedDocumentResult } from '../core/ai/IAIService';
import type { VideoAssemblyResult } from '../services/videoAssembler';
import {
    buildLocalNarrationSegments,
    isLocalTtsAvailable,
    speakLocal,
    stopLocalSpeech,
} from '../services/localTts';

export interface GenerationProgressPanelProps {
    job: GenerationJob | null;
    result: GeneratedDocumentResult | null;
    videoResult: VideoAssemblyResult | null;
    isGenerating: boolean;
    error: string | null;
    language?: string;
    hideHeader?: boolean;
    onDownload?: (result: GeneratedDocumentResult) => void;
    onClear?: () => void;
}

function triggerDownload(result: GeneratedDocumentResult): void {
    const content = result.content || '';
    if (result.url) {
        const a = document.createElement('a');
        a.href = result.url;
        a.download = result.nombre;
        a.click();
        return;
    }
    const blob = new Blob([content], { type: result.mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const ESTADO_LABEL: Record<string, string> = {
    pendiente: '⏳ En cola',
    analizando: '🔍 Analizando fuentes',
    escribiendo: '✍️ Escribiendo documento',
    ensamblando: '🎬 Ensamblando video',
    listo: '✅ Listo',
    error: '❌ Error',
};

export default function GenerationProgressPanel({
    job,
    result,
    videoResult,
    isGenerating,
    error,
    language = 'es',
    hideHeader = false,
    onDownload,
    onClear,
}: GenerationProgressPanelProps) {
    const isEn = language === 'en';
    const [ttsSpeaking, setTtsSpeaking] = useState(false);
    const ttsAvailable = useMemo(() => isLocalTtsAvailable(), []);

    useEffect(() => {
        return () => {
            stopLocalSpeech();
        };
    }, []);

    const ttsSource = useMemo(() => {
        if (result?.content) return result.content;
        if (videoResult?.script) return videoResult.script;
        return '';
    }, [result, videoResult]);

    const handleTtsToggle = useCallback(() => {
        if (ttsSpeaking) {
            stopLocalSpeech();
            setTtsSpeaking(false);
            return;
        }
        if (!ttsSource) return;
        const segments = buildLocalNarrationSegments(ttsSource, language);
        const text = segments.map((s) => s.text).join('.\n');
        const outcome = speakLocal(text, {
            lang: language,
            onEnd: () => setTtsSpeaking(false),
            onError: () => setTtsSpeaking(false),
        });
        if (outcome.started) setTtsSpeaking(true);
    }, [ttsSpeaking, ttsSource, language]);

    if (!job && !isGenerating && !error && !result && !videoResult) return null;

    const showProgress = job && job.estado !== 'listo' && job.estado !== 'error';

    return (
        <div className="frame-content__generation">
            {!hideHeader && (
                <h4 className="generation-panel__title">
                    {isEn ? '🛠️ Document / Video Generation' : '🛠️ Generación de Documento / Video'}
                </h4>
            )}

            {job && (
                <div className="generation-panel__status">
                    <span className={`generation-panel__state generation-panel__state--${job.estado}`}>
                        {ESTADO_LABEL[job.estado] || job.estado}
                        {job.formato ? ` · ${job.formato.toUpperCase()}` : ''}
                    </span>
                    {showProgress && (
                        <div className="generation-panel__bar">
                            <div
                                className="generation-panel__bar-fill"
                                style={{ width: `${Math.max(2, Math.min(100, job.progreso))}%` }}
                            />
                        </div>
                    )}
                    {job.estado === 'error' && job.error && (
                        <p className="generation-panel__error">{job.error}</p>
                    )}
                </div>
            )}

            {error && job?.estado !== 'error' && (
                <p className="generation-panel__error">{error}</p>
            )}

            {result && (
                <div className="generation-panel__result">
                    <p className="generation-panel__result-name">
                        📄 {result.nombre}
                        {result.bytes ? ` (${(result.bytes / 1024).toFixed(1)} KB)` : ''}
                    </p>
                    <div className="generation-panel__actions">
                        <button
                            type="button"
                            className="flu-btn flu-btn--small"
                            onClick={() => (onDownload ? onDownload(result) : triggerDownload(result))}
                        >
                            ⬇️ {isEn ? 'Download' : 'Descargar'}
                        </button>
                        {ttsAvailable && ttsSource && (
                            <button
                                type="button"
                                className="flu-btn flu-btn--small generation-panel__tts"
                                data-testid="generation-tts"
                                onClick={handleTtsToggle}
                            >
                                {ttsSpeaking
                                    ? (isEn ? '⏹ Stop narration' : '⏹ Detener narración')
                                    : (isEn ? '🔊 Play narration (local TTS)' : '🔊 Reproducir narración (TTS local)')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {videoResult && (
                <div className="generation-panel__video">
                    {videoResult.url ? (
                        <video className="generation-panel__video-player" controls src={videoResult.url} />
                    ) : (
                        <p className="generation-panel__video-degraded">
                            {isEn
                                ? '🎬 Storyboard generated (mp4 unavailable, ffmpeg.wasm not installed).'
                                : '🎬 Se generó el guion y storyboard (mp4 no disponible: ffmpeg.wasm no instalado).'}
                        </p>
                    )}
                    <p className="generation-panel__video-meta">
                        {isEn ? 'Estimated duration:' : 'Duración estimada:'}{' '}
                        {Math.round(videoResult.estimatedSeconds / 60)} min ·{' '}
                        {videoResult.storyboard.length} {isEn ? 'scenes' : 'escenas'}
                    </p>
                    {videoResult.warnings.map((w, i) => (
                        <p key={i} className="generation-panel__warning">⚠️ {w}</p>
                    ))}
                    {videoResult.script && (
                        <details className="generation-panel__script">
                            <summary>{isEn ? 'View script' : 'Ver guion'}</summary>
                            <pre className="generation-panel__script-pre">{videoResult.script}</pre>
                        </details>
                    )}
                </div>
            )}

            {onClear && (result || videoResult || error || (job && job.estado === 'error')) && (
                <button
                    type="button"
                    className="flu-btn flu-btn--small flu-btn--danger"
                    onClick={onClear}
                >
                    {isEn ? 'Clear' : '✕ Limpiar'}
                </button>
            )}
        </div>
    );
}
