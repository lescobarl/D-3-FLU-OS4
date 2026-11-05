/**
 * backupSystem — orquestacion de backups (autonomia).
 *
 * POR QUE ESTE TEST: `src/core/autonomy/backupSystem.ts` estaba al 0% (751
 * sentencias). `BackupSystem` delega en `IBackupManager` (interfaz inyectable,
 * §2.4): se prueba su ORQUESTACION con un doble — que hace backup cuando toca,
 * con la estrategia/notas correctas, y que sin backups la restauracion falla
 * con un mensaje claro en vez de romper.
 */
import { describe, expect, it } from 'vitest';
import {
    BackupSystem,
    type BackupMetadata,
    type IBackupManager,
} from '../src/core/autonomy/backupSystem';

class FakeManager implements IBackupManager {
    calls: string[] = [];
    backups: BackupMetadata[] = [];
    private seq = 0;

    createBackup(strategy?: string, _components?: string[], notes?: string): BackupMetadata {
        this.calls.push(`create:${strategy}:${notes}`);
        this.seq += 1;
        return { id: `b${this.seq}`, timestamp: this.seq } as unknown as BackupMetadata;
    }
    getAvailableBackups(): BackupMetadata[] {
        this.calls.push('get');
        return this.backups;
    }
    restoreBackup(backupId: string) {
        this.calls.push(`restore:${backupId}`);
        return { success: true, restoredComponents: [], failedComponents: [], message: 'ok', backupTimestamp: 0, durationMs: 0 };
    }
    verifyBackupIntegrity(): boolean {
        return true;
    }
    cleanupOldBackups(): number {
        this.calls.push('cleanup');
        return 0;
    }
}

describe('backupSystem — BackupSystem (orquestacion sobre IBackupManager)', () => {
    it('deshabilitado no crea backup', () => {
        const mgr = new FakeManager();
        const bs = new BackupSystem({ enabled: false }, mgr);
        expect(bs.performAutoBackup()).toBeNull();
        expect(mgr.calls).toEqual([]);
    });

    it('habilitado limpia antiguos y crea backup con la estrategia/notas del config', () => {
        const mgr = new FakeManager();
        const bs = new BackupSystem({ enabled: true }, mgr);
        const b = bs.performAutoBackup();
        expect(b).not.toBeNull();
        expect(mgr.calls).toContain('cleanup');
        expect(mgr.calls.some((c) => c.startsWith('create:incremental:'))).toBe(true);
    });

    it('el backup manual va con estrategia full y sus notas', () => {
        const mgr = new FakeManager();
        const bs = new BackupSystem({ enabled: true }, mgr);
        bs.createManualBackup(['conversation_state'], 'mis notas');
        expect(mgr.calls).toContain('create:full:mis notas');
    });

    it('restaurar el ultimo sin backups devuelve fallo explicito (no rompe)', () => {
        const mgr = new FakeManager();
        const bs = new BackupSystem({ enabled: true }, mgr);
        const r = bs.restoreLatestBackup();
        expect(r.success).toBe(false);
        expect(r.message).toContain('No hay backups');
    });

    it('restaurar el ultimo usa el primero de la lista (mas reciente)', () => {
        const mgr = new FakeManager();
        mgr.backups = [{ id: 'nuevo' }, { id: 'viejo' }] as unknown as BackupMetadata[];
        const bs = new BackupSystem({ enabled: true }, mgr);
        bs.restoreLatestBackup();
        expect(mgr.calls).toContain('restore:nuevo');
    });

    it('restoreBackupById delega con el id dado', () => {
        const mgr = new FakeManager();
        const bs = new BackupSystem({ enabled: true }, mgr);
        bs.restoreBackupById('abc');
        expect(mgr.calls).toContain('restore:abc');
    });

    it('stop() sin arranque previo no rompe', () => {
        const bs = new BackupSystem({ enabled: true }, new FakeManager());
        expect(() => bs.stop()).not.toThrow();
    });
});
