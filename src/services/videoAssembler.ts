// ============================================================
// videoAssembler.ts — Ensamblado de video tipo "walkthrough" (F4)
// ============================================================
// El video NO es generativo: es un recorrido ensamblado a partir de:
//   guion (markdown) → storyboard (diapositivas) → TTS (opcional)
//   → ffmpeg.wasm (autohospedado en public/ffmpeg/) → mp4.
//
// Visual del sujeto (Bug #5 — "video de un conejo saltando" mostraba
// solo texto del guion): cada frame dibuja, además del título y la
// narración, una IMAGEN REAL del sujeto (params.tema) generada por
// Pollinations, para que el video se VEA del sujeto pedido y no sea
// una diapositiva de texto.
//
// ffmpeg.wasm v0.12 (100% local):
//   - Core single-threaded copiado por scripts/sync-ffmpeg-core.mjs
//     a public/ffmpeg/ y cargado vía import.meta.env.BASE_URL
//     (sin CDN ni servidor externo).
//   - API: class FFmpeg { load({coreURL, wasmURL}), exec, writeFile,
//     readFile, deleteFile } + toBlobURL de @ffmpeg/util.
//
// Degradación elegante (Rule #1: NO HARDCODE — límites aquí):
//   - Si ffmpeg.wasm no carga, se devuelve guion + storyboard +
//     duración estimada (degraded=true).
//   - Si la imagen del sujeto no puede generarse, el frame cae a
//     texto (sin romper el video).
// ============================================================

import type { FFmpeg } from '@ffmpeg/ffmpeg';

export interface VideoStoryboardItem {
    /** Título de la diapositiva/escena. */
    title: string;
    /** Narración (locución) de la escena. */
    narration: string;
    /** Captura/imagen asociada (opcional). */
    visual?: string;
    /** Duración estimada en segundos. */
    durationSec: number;
}

export interface VideoAssemblyResult {
    /** URL del mp4 ensamblado (solo si ffmpeg.wasm estuvo disponible). */
    url?: string;
    /** Guion markdown original. */
    script: string;
    /** Storyboard descompuesto del guion. */
    storyboard: VideoStoryboardItem[];
    /** Duración total estimada en segundos. */
    estimatedSeconds: number;
    /** true si no se pudo ensamblar mp4 (solo guion/storyboard). */
    degraded: boolean;
    warnings: string[];
}

export interface VideoAssemblyParams {
    calidad?: 'baja' | 'media' | 'alta';
    duracion_min?: number;
    orientacion?: 'vertical' | 'horizontal';
    tema?: string;
}

// Imagen del sujeto (Bug #5): base de Pollinations desde appConfig (sin hardcode).
import { POLLINATIONS_CONFIG } from '../core/config/appConfig';
import { logCaughtError } from '../lib/caughtError';

/** URL de imagen del sujeto pedido por el usuario (p. ej. "un conejo saltando").
 *  Sin hardcode: la base sale de appConfig (POLLINATIONS_CONFIG.BASE_URL). */
function buildSubjectImageUrl(prompt: string): string {
    const base = String(POLLINATIONS_CONFIG?.BASE_URL || '');
    if (!base) return '';
    return `${base}/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 999999)}`;
}

/** Precarga la imagen del sujeto con timeout; null si no se pudo generar. */
function loadSubjectImage(prompt: string, timeoutMs = 12000): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        if (typeof window === 'undefined' || typeof Image === 'undefined' || !prompt.trim()) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = window.setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            resolve(null);
        }, timeoutMs);
        img.onload = () => {
            window.clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            window.clearTimeout(timer);
            resolve(null);
        };
        img.src = buildSubjectImageUrl(prompt);
    });
}

/** Descripción pura de una diapositiva para el render del frame (testeable). */
export interface FrameDescription {
    title: string;
    narration: string;
    /** Narración dividida en líneas ajustadas al ancho del frame. */
    lines: string[];
    bg: string;
    bgEnd: string;
    fg: string;
    accent: string;
}

// Configuración de calidad → resolución/fps/bitrate (centralizado).
const QUALITY_PRESETS: Record<string, { width: number; height: number; fps: number; bitrate: string }> = {
    baja: { width: 640, height: 360, fps: 24, bitrate: '800k' },
    media: { width: 1280, height: 720, fps: 30, bitrate: '2500k' },
    alta: { width: 1920, height: 1080, fps: 30, bitrate: '5000k' },
};

// Paletas de tema para el fondo/acento de los frames (Rule #1: NO HARDCODE).
const THEME_PALETTES: Record<string, { bg: string; bgEnd: string; fg: string; accent: string }> = {
    default: { bg: '#1a1a2e', bgEnd: '#16213e', fg: '#e7e7f0', accent: '#0f3460' },
    oscuro: { bg: '#0f0f1a', bgEnd: '#1a1a2e', fg: '#f0f0ff', accent: '#16213e' },
    claro: { bg: '#f5f5fa', bgEnd: '#e2e2ee', fg: '#1a1a2e', accent: '#c7c7d8' },
    azul: { bg: '#0b2447', bgEnd: '#19376d', fg: '#eaf3ff', accent: '#a5d7e8' },
    verde: { bg: '#052e16', bgEnd: '#14532d', fg: '#ecfdf5', accent: '#86efac' },
    rojo: { bg: '#3b0a0a', bgEnd: '#7f1d1d', fg: '#fef2f2', accent: '#fca5a5' },
};

const WORDS_PER_MINUTE = 150;
const MAX_LINE_CHARS = 48;

function estimateSecondsForText(text: string): number {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(3, Math.ceil((words / WORDS_PER_MINUTE) * 60));
}

// ------------------------------------------------------------
// Texto — envoltura de líneas (puro, testeable)
// ------------------------------------------------------------
export function wrapText(text: string, maxChars: number): string[] {
    const lines: string[] = [];
    const paragraphs = (text || '').split(/\r?\n/);
    for (const paragraph of paragraphs) {
        let current = '';
        for (const word of paragraph.split(/\s+/)) {
            if (!word) continue;
            if (current && (current + ' ' + word).trim().length > maxChars) {
                lines.push(current.trim());
                current = word;
            } else {
                current = current ? `${current} ${word}` : word;
            }
        }
        if (current) lines.push(current.trim());
    }
    return lines;
}

// ------------------------------------------------------------
// Frame — descripción pura de una diapositiva (testeable)
// ------------------------------------------------------------
export function describeFrame(
    item: VideoStoryboardItem,
    params: VideoAssemblyParams = {},
): FrameDescription {
    const palette = THEME_PALETTES[params.tema || 'default'] || THEME_PALETTES.default;
    const title = (item.title || 'Introducción').trim();
    const narration = (item.narration || '').trim();
    return {
        title,
        narration,
        lines: wrapText(narration, MAX_LINE_CHARS),
        bg: palette.bg,
        bgEnd: palette.bgEnd,
        fg: palette.fg,
        accent: palette.accent,
    };
}

// ------------------------------------------------------------
// Storyboard — descompone un guion markdown en diapositivas
// ------------------------------------------------------------
export function buildStoryboardFromScript(script: string): VideoStoryboardItem[] {
    const lines = (script || '').split('\n');
    const storyboard: VideoStoryboardItem[] = [];
    let currentTitle = 'Introducción';
    const currentNarration: string[] = [];

    const flush = () => {
        if (currentNarration.length > 0 || currentTitle) {
            const narration = currentNarration.join('\n').trim();
            storyboard.push({
                title: currentTitle,
                narration,
                durationSec: estimateSecondsForText(narration),
            });
        }
        currentNarration.length = 0;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (/^#{1,3}\s+/.test(line)) {
            flush();
            currentTitle = line.replace(/^#{1,3}\s+/, '').trim() || currentTitle;
        } else if (line) {
            currentNarration.push(line);
        }
    }
    flush();

    if (storyboard.length === 0) {
        storyboard.push({
            title: 'Guion',
            narration: (script || '').trim(),
            durationSec: estimateSecondsForText(script || ''),
        });
    }
    return storyboard;
}

// ------------------------------------------------------------
// Duración estimada — parámetros o estimación por narración
// ------------------------------------------------------------
export function estimateVideoDuration(
    storyboard: VideoStoryboardItem[],
    params: VideoAssemblyParams = {},
): number {
    if (params.duracion_min && params.duracion_min > 0) {
        return params.duracion_min * 60;
    }
    const total = (storyboard || []).reduce((acc, item) => acc + (item.durationSec || 0), 0);
    return Math.max(5, total);
}

// ------------------------------------------------------------
// Ensamblado real — ffmpeg.wasm v0.12 (autohospedado, degradación)
// ------------------------------------------------------------
/**
 * Renderiza un frame (PNG) para una diapositiva usando un <canvas>.
 * Solo se ejecuta en el navegador (la ruta degradada nunca llega aquí).
 */
function renderFrameToPng(
    item: VideoStoryboardItem,
    params: VideoAssemblyParams,
    preset: { width: number; height: number; fps: number; bitrate: string },
    subject: HTMLImageElement | null = null,
): Uint8Array {
    const desc = describeFrame(item, params);
    const width = params.orientacion === 'vertical' ? preset.height : preset.width;
    const height = params.orientacion === 'vertical' ? preset.width : preset.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');

    // Fondo con degradado del tema.
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, desc.bg);
    gradient.addColorStop(1, desc.bgEnd);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Imagen REAL del sujeto (Bug #5): el video debe MOSTRAR lo pedido
    // ("un conejo saltando"), no solo texto del guion. Cover + overlay
    // oscuro inferior para que el texto siga siendo legible.
    if (subject && subject.naturalWidth > 0 && subject.naturalHeight > 0) {
        const scale = Math.max(width / subject.naturalWidth, height / subject.naturalHeight);
        const dw = subject.naturalWidth * scale;
        const dh = subject.naturalHeight * scale;
        ctx.drawImage(subject, (width - dw) / 2, (height - dh) / 2, dw, dh);
        const overlay = ctx.createLinearGradient(0, height * 0.35, 0, height);
        overlay.addColorStop(0, 'rgba(0,0,0,0)');
        overlay.addColorStop(1, 'rgba(0,0,0,0.78)');
        ctx.fillStyle = overlay;
        ctx.fillRect(0, height * 0.35, width, height * 0.65);
    }

    // Barra de acento superior.
    ctx.fillStyle = desc.accent;
    ctx.fillRect(0, 0, width, Math.max(6, Math.round(height * 0.02)));

    // Título (dividido si es largo).
    const titleSize = Math.round(height * 0.06);
    const titleLines = wrapText(desc.title, Math.round(width / 14) || 24);
    ctx.fillStyle = desc.fg;
    ctx.font = `bold ${titleSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titleY = Math.round(height * 0.22);
    titleLines.forEach((line, i) => {
        const y = titleY + (i - (titleLines.length - 1) / 2) * titleSize * 1.15;
        ctx.fillText(line, width / 2, y);
    });

    // Narración (líneas ajustadas).
    const bodySize = Math.round(height * 0.035);
    ctx.fillStyle = desc.fg;
    ctx.globalAlpha = 0.92;
    ctx.font = `${bodySize}px system-ui, sans-serif`;
    const startY = Math.round(height * 0.42);
    desc.lines.slice(0, 14).forEach((line, i) => {
        ctx.fillText(line, width / 2, startY + i * bodySize * 1.35);
    });
    ctx.globalAlpha = 1;

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return bytes;
}

/**
 * Intenta cargar ffmpeg.wasm (v0.12) autohospedado. Retorna null si no
 * está disponible. Los límites de carga viven aquí (Rule #1: NO HARDCODE).
 */
async function tryLoadFFmpeg(): Promise<FFmpeg | null> {
    try {
        const mod = await import('@ffmpeg/ffmpeg');
        const FFmpegClass = mod?.FFmpeg || Reflect.get(mod, 'default')?.FFmpeg;
        if (typeof FFmpegClass !== 'function') return null;

        const utilMod = await import('@ffmpeg/util');
        const toBlobURL = typeof utilMod?.toBlobURL === 'function'
            ? utilMod.toBlobURL
            : Reflect.get(utilMod, 'default')?.toBlobURL;
        if (typeof toBlobURL !== 'function') return null;

        const base = (import.meta.env?.BASE_URL as string) || '/';
        const coreBase = `${base}ffmpeg/`;

        const ffmpeg = new FFmpegClass();
        await ffmpeg.load({
            coreURL: await toBlobURL(`${coreBase}ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${coreBase}ffmpeg-core.wasm`, 'application/wasm'),
        });
        return ffmpeg;
    } catch (e) {
        logCaughtError('[videoAssembler] ffmpeg.wasm no disponible, video degradado a guion/storyboard', e);
        return null;
    }
}

/**
 * Ensambla un video tipo walkthrough a partir del guion.
 * Siempre devuelve script + storyboard; el mp4 solo si ffmpeg.wasm existe.
 */
export async function assembleVideo(
    script: string,
    params: VideoAssemblyParams = {},
    _language = 'es',
): Promise<VideoAssemblyResult> {
    const warnings: string[] = [];
    const storyboard = buildStoryboardFromScript(script);
    const estimatedSeconds = estimateVideoDuration(storyboard, params);

    const ffmpeg = await tryLoadFFmpeg();
    if (!ffmpeg) {
        warnings.push(
            'ffmpeg.wasm no está instalado o no pudo cargarse. Se generó el guion y storyboard (sin video mp4).',
        );
        return {
            script,
            storyboard,
            estimatedSeconds,
            degraded: true,
            warnings,
        };
    }

    // Ensamblado real (best-effort): renderiza un frame por diapositiva y
    // los concatena en un mp4 con la duración estimada.
    try {
        const preset = QUALITY_PRESETS[params.calidad || 'media'] || QUALITY_PRESETS.media;

        // Imagen del sujeto pedido por el usuario (Bug #5): se precarga UNA vez y
        // se dibuja en cada frame para que el video muestre lo solicitado.
        const subject = await loadSubjectImage(params.tema || '');
        if (params.tema && !subject) {
            warnings.push('No se pudo generar la imagen del sujeto; el video usará solo texto (sin romper el ensamblado).');
        }

        const args: string[] = [];
        for (let i = 0; i < storyboard.length; i++) {
            const png = renderFrameToPng(storyboard[i], params, preset, subject);
            await ffmpeg.writeFile(`frame_${i}.png`, png);
            const duration = Math.max(1, Math.round(storyboard[i].durationSec || 3));
            args.push('-loop', '1', '-t', String(duration), '-i', `frame_${i}.png`);
        }

        const inputLabels = storyboard.map((_, i) => `[${i}:v]`).join('');
        args.push(
            '-filter_complex',
            `${inputLabels}concat=n=${storyboard.length}:v=1:a=0[vout]`,
            '-map', '[vout]',
            '-r', String(preset.fps),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-b:v', preset.bitrate,
            '-pix_fmt', 'yuv420p',
            'output.mp4',
        );
        await ffmpeg.exec(args);

        const data = await ffmpeg.readFile('output.mp4');
        const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new Uint8Array(data);
        const blob = new Blob([bytes.buffer], { type: 'video/mp4' });
        return {
            url: URL.createObjectURL(blob),
            script,
            storyboard,
            estimatedSeconds,
            degraded: false,
            warnings,
        };
    } catch (e) {
        logCaughtError('[catch] src/services/videoAssembler.ts', e);
        warnings.push(`No se pudo ensamblar el mp4 (${e instanceof Error ? e.message : String(e)}). Se entrega guion/storyboard.`);
        return {
            script,
            storyboard,
            estimatedSeconds,
            degraded: true,
            warnings,
        };
    }
}
