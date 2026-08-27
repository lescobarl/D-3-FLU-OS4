# Plan: Delete All Backups and Create New FULL Backup (2026-08-18, Sequence 1)

## Objective
Delete all existing backups and create a new FULL backup with today's date (2026-08-18) sequence 1, confirming system protection.

## Current State Analysis
- **Current backup**: `rollback/backup-2026-08-18-seq1/` (422 files, 4.88 MB)
- **Server status**: Running on port 5174 (detached process)
- **System fixes applied**: Anti-echo, translation fallback, over-interpretation fixes
- **Validation**: All tests passing (1222/1222 tests)

## Task Breakdown

### Phase 1: Delete All Existing Backups
1. **Identify all backup directories**
   - List all directories matching pattern `backup-*` in `rollback/`
   - Check for any other backup locations (e.g., `reports/backup-*`, `scripts/backup-*`)

2. **Delete backup directories**
   - Remove `rollback/backup-2026-08-18-seq1/` and all its contents
   - Delete any other backup directories found
   - Confirm deletion with file count verification

3. **Clean up backup-related files**
   - Remove any backup logs or temporary files
   - Clear backup metadata from system state

### Phase 2: Create New FULL Backup
1. **Determine backup scope**
   - Include all critical directories: `src/`, `tests/`, `plans/`, `scripts/`, `reports/`
   - Exclude: `node_modules/`, `public/assets/`, `.env`, build artifacts
   - Include validation documentation and test results

2. **Create backup directory structure**
   - Create `rollback/backup-2026-08-18-seq1/` (new sequence)
   - Organize with same structure as workspace
   - Include timestamp and metadata files

3. **Copy critical files**
   - Copy all source code files with recent fixes
   - Include test files and validation reports
   - Copy configuration files and documentation
   - Include server logs and diagnostic information

4. **Create validation documentation**
   - Generate `validation-summary.md` with backup details
   - Include file count, total size, and critical file hashes
   - Document system state and applied fixes

### Phase 3: Verification and Protection
1. **Verify backup integrity**
   - Count files and compare with expected totals
   - Verify critical file hashes match originals
   - Test restoration capability for key components

2. **Confirm system protection**
   - Verify server is still running and accessible
   - Test critical functionality (translation, conversation flow)
   - Ensure backup is usable for rollback scenarios

3. **Create protection documentation**
   - Update `ESTADO_SISTEMA.md` with backup confirmation
   - Create rollback instructions
   - Document backup verification steps

## Success Criteria
1. ✅ All previous backups deleted
2. ✅ New FULL backup created at `rollback/backup-2026-08-18-seq1/`
3. ✅ Backup includes all critical files (400+ files, ~5MB)
4. ✅ Validation documentation created and verified
5. ✅ System remains operational after backup
6. ✅ Protection confirmed with verification steps

## Risk Mitigation
- **Risk**: Accidental deletion of non-backup files
  - **Mitigation**: Use precise pattern matching, verify before deletion
- **Risk**: Backup corruption
  - **Mitigation**: Verify file hashes, create checksums
- **Risk**: Server interruption during backup
  - **Mitigation**: Use copy operations that don't interfere with running processes

## Timeline
1. **Phase 1 (Deletion)**: 5-10 minutes
2. **Phase 2 (Backup Creation)**: 10-15 minutes  
3. **Phase 3 (Verification)**: 5-10 minutes
4. **Total estimated time**: 20-35 minutes

## Required Tools
- File operations (copy, delete, verify)
- Hash verification (MD5/SHA checksums)
- System status checking (server accessibility)
- Documentation generation

## Dependencies
- Server must remain running during backup
- Sufficient disk space for backup creation
- No active file locks on critical files

## Notes
- Today's date: 2026-08-18 (based on user timezone America/Mexico_City)
- Sequence number: 1 (first backup of the day)
- This backup will include all recent fixes for anti-echo, translation fallback, and over-interpretation issues