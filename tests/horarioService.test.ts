// ============================================================
// horarioService — clases del horario en el Pizarrón (FASE C)
// ------------------------------------------------------------
// Cubre el servicio de horario con una base en memoria (misma
// interfaz HorarioDb), reloj y newId inyectables.
// Regla #1: sin hardcode; límites y colores desde config.
// Obligación #5: auditoría en cada mutación.
// Obligación #7: tupla Sync [revision, updated_at, deleted].
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type HorarioRecord } from '../src/core/db/fluDatabase';
import {
  createHorarioService,
  clasificarDia,
  diaDeFecha,
  extractAula,
  extractHorarioHoras,
  minutosDeFecha,
  structureHorarioText,
  toHHMM,
  toMin,
  type HorarioDb,
} from '../src/core/horario/horarioService';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría
// (fluDatabase no abre la conexión hasta la primera operación real).
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local
// (ISO: dia=4, minuto=600).
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const HORARIO_CONFIG = {
  maxClasesPorDia: 3,
  diaMin: 1,
  diaMax: 7,
  defaultColor: 'm1',
  colores: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const,
};

let idCounter = 0;

function createMapDb(initial: HorarioRecord[] = []): HorarioDb {
  const map = new Map<string, HorarioRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: HorarioRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: HorarioRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<HorarioRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<HorarioRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

function createService(db: HorarioDb) {
  return createHorarioService({
    db,
    config: HORARIO_CONFIG,
    now,
    newId: () => `hor-${++idCounter}`,
  });
}

let db: HorarioDb;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
});

describe('horarioService — creación de clases', () => {
  it('add crea un registro completo (trim, color, sync), lo persiste y audita', async () => {
    const service = createService(db);
    const result = await service.add({
      materia: '  Matematicas  ',
      dia: 4,
      inicio: '08:00',
      fin: '09:30',
      aula: ' Aula 3 ',
      color: 'm3',
    });

    expect(result.ok).toBe(true);
    const record = result.record!;
    expect(record.id).toBe('hor-1');
    expect(record.materia).toBe('Matematicas'); // trim
    expect(record.dia).toBe(4);
    expect(record.inicio).toBe('08:00');
    expect(record.fin).toBe('09:30');
    expect(record.aula).toBe('Aula 3'); // trim
    expect(record.color).toBe('m3');
    expect(record.reminders).toEqual([]);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.sync).toEqual({ revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false });

    // persistido en la base
    const stored = await db.get('hor-1');
    expect(stored?.materia).toBe('Matematicas');

    // auditoría (Obligación #5) — payload sin aula/color
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'horario.create', 'horario', 'hor-1', null,
      { materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:30' },
      'horarioService',
    );
  });

  it('add aplica el color por defecto y omite aula vacía', async () => {
    const service = createService(db);
    const result = await service.add({
      materia: 'Fisica',
      dia: 2,
      inicio: '10:00',
      fin: '11:00',
      aula: '   ',
      color: 'color-inexistente',
    });
    expect(result.ok).toBe(true);
    expect(result.record?.aula).toBeUndefined();
    expect(result.record?.color).toBe('m1'); // defaultColor del config
  });

  it('rechaza entradas inválidas como invalid-input sin auditar ni generar id', async () => {
    const service = createService(db);

    // materia vacía
    const r1 = await service.add({ materia: '   ', dia: 4, inicio: '08:00', fin: '09:00' });
    expect(r1).toEqual({ ok: false, reason: 'invalid-input' });

    // día fuera de rango o no entero
    const r2 = await service.add({ materia: 'A', dia: 0, inicio: '08:00', fin: '09:00' });
    expect(r2.reason).toBe('invalid-input');
    const r3 = await service.add({ materia: 'A', dia: 8, inicio: '08:00', fin: '09:00' });
    expect(r3.reason).toBe('invalid-input');
    const r4 = await service.add({ materia: 'A', dia: 2.5, inicio: '08:00', fin: '09:00' });
    expect(r4.reason).toBe('invalid-input');

    // hora inválida o fin <= inicio
    const r5 = await service.add({ materia: 'A', dia: 4, inicio: '25:00', fin: '09:00' });
    expect(r5.reason).toBe('invalid-input');
    const r6 = await service.add({ materia: 'A', dia: 4, inicio: '09:00', fin: '09:00' });
    expect(r6.reason).toBe('invalid-input');

    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
    expect(idCounter).toBe(0); // no se generó id
  });

  it('no supera el tope diario (maxClasesPorDia)', async () => {
    const service = createService(db);
    for (let i = 0; i < HORARIO_CONFIG.maxClasesPorDia; i += 1) {
      const res = await service.add({ materia: `Clase ${i}`, dia: 4, inicio: `${8 + i}:00`, fin: `${9 + i}:00` });
      expect(res.ok).toBe(true);
    }

    const overflow = await service.add({ materia: 'Extra', dia: 4, inicio: '12:00', fin: '13:00' });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe('max-per-dia');

    // solo se auditaron las creaciones aceptadas
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(HORARIO_CONFIG.maxClasesPorDia);
  });
});

describe('horarioService — consultas', () => {
  it('get devuelve una copia y undefined para ids inexistentes o vacíos', async () => {
    const service = createService(db);
    await service.add({ materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' });

    const got = await service.get('hor-1');
    expect(got?.materia).toBe('Matematicas');
    got!.materia = 'MUTADO';
    expect((await service.get('hor-1'))?.materia).toBe('Matematicas'); // copia, no muta la base

    expect(await service.get('')).toBeUndefined();
    expect(await service.get('inexistente')).toBeUndefined();
  });

  it('list devuelve todas las clases', async () => {
    const service = createService(db);
    await service.add({ materia: 'A', dia: 1, inicio: '08:00', fin: '09:00' });
    await service.add({ materia: 'B', dia: 2, inicio: '08:00', fin: '09:00' });
    const all = await service.list();
    expect(all).toHaveLength(2);
  });

  it('listByDia filtra y ordena por hora de inicio', async () => {
    const service = createService(db);
    await service.add({ materia: 'Tarde', dia: 4, inicio: '12:00', fin: '13:00' });
    await service.add({ materia: 'Temprano', dia: 4, inicio: '07:00', fin: '08:00' });
    await service.add({ materia: 'Otro dia', dia: 2, inicio: '09:00', fin: '10:00' });

    const delDia = await service.listByDia(4);
    expect(delDia.map((c) => c.materia)).toEqual(['Temprano', 'Tarde']);
  });

  it('listByMateria filtra sin distinguir mayúsculas (sin acentos)', async () => {
    const service = createService(db);
    await service.add({ materia: 'Historia', dia: 1, inicio: '08:00', fin: '09:00' });
    await service.add({ materia: 'Matematicas', dia: 2, inicio: '08:00', fin: '09:00' });

    expect((await service.listByMateria('historia')).map((c) => c.materia)).toEqual(['Historia']);
    expect((await service.listByMateria('HISTORIA')).map((c) => c.materia)).toEqual(['Historia']);
    expect(await service.listByMateria('')).toEqual([]);
    expect(await service.listByMateria('fisica')).toEqual([]);
  });

  it('countPorDia cuenta por día', async () => {
    const service = createService(db);
    await service.add({ materia: 'A', dia: 4, inicio: '08:00', fin: '09:00' });
    await service.add({ materia: 'B', dia: 4, inicio: '10:00', fin: '11:00' });
    await service.add({ materia: 'C', dia: 2, inicio: '08:00', fin: '09:00' });

    expect(await service.countPorDia(4)).toBe(2);
    expect(await service.countPorDia(2)).toBe(1);
    expect(await service.countPorDia(7)).toBe(0);
  });
});

describe('horarioService — actualización y borrado', () => {
  it('update modifica, sube la revisión de sync y audita con el registro previo', async () => {
    const service = createService(db);
    await service.add({ materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' });
    const before = await db.get('hor-1');

    const updated = await service.update('hor-1', { inicio: '09:00', fin: '10:00', aula: 'Aula 5' });
    expect(updated?.inicio).toBe('09:00');
    expect(updated?.fin).toBe('10:00');
    expect(updated?.aula).toBe('Aula 5');
    expect(updated?.materia).toBe('Matematicas');
    expect(updated?.sync.revision).toBe(2);

    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'horario.update', 'horario', 'hor-1', before, updated, 'horarioService',
    );
  });

  it('update devuelve null (sin mutar ni auditar) para ids inexistentes o parches inválidos', async () => {
    const service = createService(db);
    await service.add({ materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' });

    expect(await service.update('inexistente', { materia: 'X' })).toBeNull();
    expect(await service.update('hor-1', { materia: '  ' })).toBeNull();
    expect(await service.update('hor-1', { dia: 9 })).toBeNull();
    expect(await service.update('hor-1', { inicio: '12:00', fin: '11:00' })).toBeNull();

    // sin mutación: el registro original se conserva
    const stored = await db.get('hor-1');
    expect(stored?.fin).toBe('09:00');
    expect(stored?.sync.revision).toBe(1);
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledTimes(1); // solo el create inicial
  });

  it('remove borra, devuelve true y audita con el registro previo', async () => {
    const service = createService(db);
    await service.add({ materia: 'Matematicas', dia: 4, inicio: '08:00', fin: '09:00' });
    const before = await db.get('hor-1');

    const removed = await service.remove('hor-1');
    expect(removed).toBe(true);
    expect(await service.get('hor-1')).toBeUndefined();
    expect(vi.mocked(addAuditLog)).toHaveBeenCalledWith(
      'horario.remove', 'horario', 'hor-1', before, null, 'horarioService',
    );
  });

  it('remove de un id inexistente devuelve false sin auditar', async () => {
    const service = createService(db);
    expect(await service.remove('inexistente')).toBe(false);
    expect(vi.mocked(addAuditLog)).not.toHaveBeenCalled();
  });
});

describe('horarioService — próxima clase y clases de hoy', () => {
  it('proximaClase devuelve la clase más próxima después de ahora', async () => {
    const service = createService(db);
    await service.add({ materia: 'Quimica', dia: 4, inicio: '12:00', fin: '13:00' }); // jueves 12:00
    await service.add({ materia: 'Lunes temprano', dia: 1, inicio: '08:00', fin: '09:00' });

    // jueves 10:00 → la clase del jueves 12:00
    const prox = await service.proximaClase(NOW);
    expect(prox?.materia).toBe('Quimica');
  });

  it('proximaClase da la vuelta a la semana cuando no queda ninguna', async () => {
    const service = createService(db);
    await service.add({ materia: 'Quimica', dia: 4, inicio: '12:00', fin: '13:00' });
    await service.add({ materia: 'Lunes temprano', dia: 1, inicio: '08:00', fin: '09:00' });

    // jueves 23:00 → envuelve a la clase más temprana del ciclo (lunes 08:00)
    const wrap = await service.proximaClase(NOW + 13 * 60 * 60 * 1000);
    expect(wrap?.materia).toBe('Lunes temprano');
  });

  it('proximaClase devuelve null con lista vacía o solo horas inválidas', async () => {
    const emptyService = createService(createMapDb());
    expect(await emptyService.proximaClase(NOW)).toBeNull();

    // horario inválido solo puede llegar por siembra directa (add valida horas)
    const invalidDb = createMapDb([
      {
        id: 'hor-x', materia: 'Invalida', dia: 4, inicio: '25:00', fin: '09:00',
        createdAt: NOW, updatedAt: NOW, sync: { revision: 1, updated_at: new Date(NOW).toISOString(), deleted: false },
      },
    ]);
    const invalidService = createService(invalidDb);
    expect(await invalidService.proximaClase(NOW)).toBeNull();
  });

  it('clasesDeHoy filtra el día ISO actual y ordena por hora', async () => {
    const service = createService(db);
    await service.add({ materia: 'Tarde', dia: 4, inicio: '12:00', fin: '13:00' });
    await service.add({ materia: 'Temprano', dia: 4, inicio: '07:00', fin: '08:00' });
    await service.add({ materia: 'Otro dia', dia: 2, inicio: '09:00', fin: '10:00' });

    const hoy = await service.clasesDeHoy(NOW); // jueves (dia 4)
    expect(hoy.map((c) => c.materia)).toEqual(['Temprano', 'Tarde']);
  });
});

describe('horarioService — helpers de tiempo y estructuración OCR', () => {
  it('toMin convierte HH:MM a minutos y devuelve -1 para valores inválidos', () => {
    expect(toMin('08:00')).toBe(480);
    expect(toMin(' 09:30 ')).toBe(570);
    expect(toMin('23:59')).toBe(1439);
    expect(toMin('25:00')).toBe(-1);
    expect(toMin('')).toBe(-1);
    expect(toMin(null as unknown as string)).toBe(-1);
    expect(toMin('8:0')).toBe(-1);
  });

  it('toHHMM convierte minutos a HH:MM recortando a 0..1439', () => {
    expect(toHHMM(480)).toBe('08:00');
    expect(toHHMM(1439)).toBe('23:59');
    expect(toHHMM(1440)).toBe('23:59'); // clamp
    expect(toHHMM(-5)).toBe('00:00'); // clamp inferior
    expect(toHHMM(Number.NaN)).toBe('');
  });

  it('diaDeFecha/minutosDeFecha usan hora local', () => {
    expect(diaDeFecha(NOW)).toBe(4); // jueves
    expect(minutosDeFecha(NOW)).toBe(600); // 10:00
  });

  it('clasificarDia reconoce días con/sin acentos y frases que lo contienen', () => {
    expect(clasificarDia('Lunes')).toBe(1);
    expect(clasificarDia('SÁBADO')).toBe(6);
    expect(clasificarDia('viernes por la tarde')).toBe(5);
    expect(clasificarDia('no es un dia')).toBeNull();
    expect(clasificarDia('')).toBeNull();
  });

  it('extractHorarioHoras extrae rangos válidos y rechaza horas fuera de rango', () => {
    expect(extractHorarioHoras('08:00 - 09:30')).toEqual({ inicio: '08:00', fin: '09:30' });
    expect(extractHorarioHoras('8.30 a 10:15')).toEqual({ inicio: '08:30', fin: '10:15' });
    expect(extractHorarioHoras('25:00 - 26:00')).toBeNull();
    expect(extractHorarioHoras('sin horas aqui')).toBeNull();
  });

  it('extractAula extrae el aula/salón del texto', () => {
    expect(extractAula('Aula 3')).toBe('3');
    expect(extractAula('Laboratorio Fisica')).toBe('Fisica');
    expect(extractAula('sin aula')).toBe('');
  });

  it('structureHorarioText propaga el día a las líneas siguientes', () => {
    const clases = structureHorarioText(
      'Lunes\nMatematicas 08:00 - 09:30 Aula 3\nMartes\nFisica 10:00 - 11:00\n',
    );
    expect(clases).toHaveLength(2);
    expect(clases[0]).toEqual({ materia: 'Matematicas', dia: 1, inicio: '08:00', fin: '09:30', aula: '3' });
    expect(clases[1]).toEqual({ materia: 'Fisica', dia: 2, inicio: '10:00', fin: '11:00' });
  });

  it('structureHorarioText conserva el día cuando comparte línea con las horas', () => {
    const clases = structureHorarioText('Martes Matematicas 08:00 - 09:00');
    expect(clases).toHaveLength(1);
    expect(clases[0]).toEqual({ materia: 'Martes Matematicas', dia: 2, inicio: '08:00', fin: '09:00' });
  });

  it('structureHorarioText devuelve [] para texto vacío o sin horas', () => {
    expect(structureHorarioText('')).toEqual([]);
    expect(structureHorarioText('Lunes\nsin horas aqui')).toEqual([]);
  });
});
