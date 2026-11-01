/**
 * ANALIZADOR DE GRABACION (herramienta, no guard).
 *
 * Entrada UNICA: el WAV. De ahi extrae:
 *  - segmentacion por silencio (VAD de energia),
 *  - transcripcion con el ASR local (Xenova/whisper-tiny),
 *  - embedding de voz de CADA segmento al vuelo (no lee `signature`),
 *  - clustering de voces al piso 0.72,
 *  - duplicados de texto, cambios de hablante y comando "ok Flu soy XXX",
 *  - comparacion opcional con `turns.ndjson` (si existe), sin usarlo como fuente.
 *
 * Uso:
 *   $env:FLU_RECORDING_DIR="$env:TEMP\flu-recordings"
 *   npx vitest run tests/analyzeRecording.tool.test.ts --reporter=verbose
 * o:
 *   $env:FLU_RECORDING_WAV="C:\ruta\audio.wav"
 *
 * Sin esas variables el test se SALTA (no afecta CI/lint).
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSpeakerEmbedding } from '../src/voice/lib/speakerEmbeddingCore';
import { downsample } from '../src/voice/lib/asr/resample';

interface Wav {
  pcm: Float32Array;
  sampleRate: number;
  channels: number;
  bits: number;
}

function readWav(path: string): Wav {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('no es un WAV RIFF');
  }
  const fmt = buf.indexOf('fmt ');
  const data = buf.indexOf('data');
  if (fmt < 0 || data < 0) throw new Error('WAV sin fmt/data');
  const channels = buf.readUInt16LE(fmt + 10);
  const sampleRate = buf.readUInt32LE(fmt + 12);
  const bits = buf.readUInt16LE(fmt + 22);
  const bytes = bits / 8;
  const dataStart = data + 8;
  const dataSize = buf.readUInt32LE(data + 4);
  const frames = Math.floor(dataSize / (bytes * channels));
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const off = dataStart + (i * channels + c) * bytes;
      sum += bits === 16 ? buf.readInt16LE(off) / 32768 : buf.readFloatLE(off);
    }
    pcm[i] = sum / channels;
  }
  return { pcm, sampleRate, channels, bits };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

interface Segment {
  start: number;
  end: number;
  samples: Float32Array;
  rms: number;
}

function segmentBySilence(wav: Wav, minSpeechMs = 500, silenceMs = 350, padMs = 150): Segment[] {
  const frameMs = 30;
  const frame = Math.max(1, Math.round((wav.sampleRate * frameMs) / 1000));
  const threshold = 0.005;
  const voiced: boolean[] = [];
  for (let i = 0; i + frame <= wav.pcm.length; i += frame) {
    voiced.push(rms(wav.pcm.subarray(i, i + frame)) >= threshold);
  }
  const segments: Segment[] = [];
  let startFrame = -1;
  let lastVoiced = -1;
  const silenceFrames = Math.ceil(silenceMs / frameMs);
  for (let i = 0; i < voiced.length; i += 1) {
    if (voiced[i]) {
      if (startFrame < 0) startFrame = i;
      lastVoiced = i;
    } else if (startFrame >= 0 && i - lastVoiced >= silenceFrames) {
      const start = Math.max(0, startFrame * frame - Math.round((padMs / 1000) * wav.sampleRate));
      const end = Math.min(
        wav.pcm.length,
        (lastVoiced + 1) * frame + Math.round((padMs / 1000) * wav.sampleRate),
      );
      if (((end - start) / wav.sampleRate) * 1000 >= minSpeechMs) {
        segments.push({ start, end, samples: wav.pcm.slice(start, end), rms: rms(wav.pcm.subarray(start, end)) });
      }
      startFrame = -1;
      lastVoiced = -1;
    }
  }
  if (startFrame >= 0) {
    const start = Math.max(0, startFrame * frame);
    const end = Math.min(wav.pcm.length, (lastVoiced + 1) * frame);
    if (((end - start) / wav.sampleRate) * 1000 >= minSpeechMs) {
      segments.push({ start, end, samples: wav.pcm.slice(start, end), rms: rms(wav.pcm.subarray(start, end)) });
    }
  }
  return segments;
}

function cosine(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : null;
}

function clusterVectors(vectors: Array<number[] | null>, threshold = 0.72): { clusters: number[][]; assignment: Array<number | null> } {
  const ids = vectors.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const parent = new Map<number, number>(ids.map((i) => [i, i]));
  const find = (i: number): number => {
    const p = parent.get(i) ?? i;
    if (p === i) return i;
    const root = find(p);
    parent.set(i, root);
    return root;
  };
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent.set(b, a);
  };
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const c = cosine(vectors[ids[a]!]!, vectors[ids[b]!]!);
      if (c !== null && c >= threshold) union(ids[a]!, ids[b]!);
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of ids) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  const clusters = [...groups.values()].sort((a, b) => a[0]! - b[0]!);
  const assignment: Array<number | null> = vectors.map(() => null);
  clusters.forEach((group, index) => {
    for (const i of group) assignment[i] = index;
  });
  return { clusters, assignment };
}

function normalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findRecording(): string | null {
  const direct = process.env.FLU_RECORDING_WAV;
  if (direct && existsSync(direct)) return direct;
  const root = process.env.FLU_RECORDING_DIR;
  if (!root) return null;
  const candidate = join(root, 'audio.wav');
  if (existsSync(candidate)) return candidate;
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'audio.wav')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0] ? join(dirs[0], 'audio.wav') : null;
}

const recordingPath = findRecording();
const hasRecording = Boolean(recordingPath);

describe.skipIf(!hasRecording)('analisis WAV-only de la grabacion', () => {
  it('extrae segmentos, texto, voces, comandos y comparacion', async () => {
    if (!recordingPath) throw new Error('sin grabacion');
    const wav = readWav(recordingPath);
    const segments = segmentBySilence(wav);
    expect(segments.length, 'el WAV no tiene segmentos de voz por encima del piso').toBeGreaterThan(0);

    const embeddings: Array<number[] | null> = [];
    for (const segment of segments) {
      const vector = await computeSpeakerEmbedding(Array.from(segment.samples), wav.sampleRate);
      embeddings.push(vector.length ? vector : null);
    }
    const { clusters, assignment } = clusterVectors(embeddings, 0.72);

    let asrError: string | null = null;
    const texts: string[] = [];
    try {
      const transformers = await import('@huggingface/transformers');
      const asr = await transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'fp32',
      });
      const transcribe = asr as unknown as (
        audio: Float32Array,
        options: Record<string, unknown>,
      ) => Promise<{ text?: string }>;
      for (const segment of segments) {
        const audio16k = downsample(segment.samples, wav.sampleRate, 16000);
        const result = await transcribe(audio16k, {
          language: 'es',
          task: 'transcribe',
          chunk_length_s: 30,
          stride_length_s: 5,
        });
        texts.push(String(result?.text || '').trim());
      }
    } catch (error) {
      asrError = error instanceof Error ? error.message : String(error);
      texts.push(...segments.map(() => ''));
    }

    const normalized = texts.map(normalizeText);
    const byText = new Map<string, number[]>();
    normalized.forEach((text, index) => {
      if (!text) return;
      if (!byText.has(text)) byText.set(text, []);
      byText.get(text)!.push(index);
    });
    const duplicates = [...byText.entries()]
      .filter(([, indexes]) => indexes.length > 1)
      .map(([text, indexes]) => ({ text, segments: indexes }));

    const commands: Array<{ segment: number; text: string; wake: boolean; name: string | null }> = [];
    texts.forEach((text, index) => {
      const wake = /\b(ok|okay)\s+flu\b/i.test(text);
      const name = text.match(/\bsoy\s+([a-záéíóúñ]+)/i)?.[1] ?? null;
      if (wake || name) commands.push({ segment: index, text, wake, name });
    });

    const speakerChanges = assignment.reduce<number>((count, current, index) => {
      if (index === 0 || current === null) return count;
      return current !== assignment[index - 1] ? count + 1 : count;
    }, 0);

    const recorderPath = join(dirname(recordingPath), 'turns.ndjson');
    let recorder: unknown = null;
    if (existsSync(recorderPath)) {
      const rows = readFileSync(recorderPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((row): row is Record<string, unknown> => row !== null && row.kind === 'commit');
      const latest = new Map<string, Record<string, unknown>>();
      for (const row of rows) {
        const id = String(row.locutionId || '');
        if (id) latest.set(id, row);
      }
      recorder = {
        rows: rows.length,
        locutions: latest.size,
        speakers: [...new Set([...latest.values()].map((row) => String(row.speaker || '')))],
        withSignature: [...latest.values()].filter((row) => Array.isArray(row.signature) && row.signature.length).length,
        withAudio: [...latest.values()].filter((row) => Number(row.audioEndSample) > Number(row.audioStartSample)).length,
      };
    }

    const report = {
      recording: {
        path: recordingPath,
        file: basename(recordingPath),
        sampleRate: wav.sampleRate,
        channels: wav.channels,
        bits: wav.bits,
        seconds: Number((wav.pcm.length / wav.sampleRate).toFixed(2)),
      },
      segments: segments.map((segment, index) => ({
        index,
        start: Number((segment.start / wav.sampleRate).toFixed(2)),
        end: Number((segment.end / wav.sampleRate).toFixed(2)),
        seconds: Number(((segment.end - segment.start) / wav.sampleRate).toFixed(2)),
        rms: Number(segment.rms.toFixed(4)),
        text: texts[index] || '',
        speakerCluster: assignment[index],
        speakerLabel: assignment[index] === null ? 'sin_voz' : `Hablante ${assignment[index]! + 1}`,
        embeddingDim: embeddings[index]?.length ?? 0,
      })),
      clusters: clusters.map((group, index) => ({
        index,
        label: `Hablante ${index + 1}`,
        segments: group,
        size: group.length,
      })),
      speakers: clusters.length,
      speakerChanges,
      duplicates,
      commands,
      asrError,
      recorder,
    };

    const outDir = dirname(recordingPath);
    writeFileSync(join(outDir, 'analysis.json'), `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      `# Analisis WAV-only`,
      '',
      `- Archivo: ${report.recording.file}`,
      `- Duracion: ${report.recording.seconds}s · ${report.recording.sampleRate}Hz · ${report.recording.channels} canal(es)`,
      `- Segmentos: ${segments.length}`,
      `- Voces (0.72): ${report.speakers}`,
      `- Cambios de hablante: ${speakerChanges}`,
      `- Duplicados de texto: ${duplicates.length}`,
      `- Comandos: ${commands.length}`,
      `- ASR: ${asrError ? `ERROR: ${asrError}` : 'ok'}`,
      recorder ? `- Grabador: ${JSON.stringify(recorder)}` : '- Grabador: sin turns.ndjson',
      '',
      '| # | Inicio | Fin | Voz | Texto |',
      '|---:|---:|---:|---|---|',
      ...report.segments.map(
        (segment) =>
          `| ${segment.index} | ${segment.start}s | ${segment.end}s | ${segment.speakerLabel} | ${segment.text.replace(/\|/g, ' ')} |`,
      ),
      '',
    ].join('\n');
    writeFileSync(join(outDir, 'analysis.md'), md);

    console.log(`Analisis escrito en ${outDir}\\analysis.json y analysis.md`);
    console.log(
      `segmentos=${segments.length} voces=${report.speakers} cambios=${speakerChanges} duplicados=${duplicates.length} comandos=${commands.length}`,
    );
    expect(report.segments.length).toBeGreaterThan(0);
  }, 1_800_000);
});
