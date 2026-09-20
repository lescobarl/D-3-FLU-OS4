// ============================================================
// Long-Term Memory Store
// ============================================================
// Persistent memory across sessions using IndexedDB.
// Stores conversation summaries, key facts, user preferences,
// and relationship data with decay-based retrieval.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - Pure functions — no React dependencies
// ============================================================

import { v4 as uuidv4 } from 'uuid';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

export interface MemoryItem {
    id: string;
    /** Category for grouping (e.g., 'fact', 'preference', 'summary', 'relationship') */
    category: string;
    /** The memory content */
    content: string;
    /** Importance score 0-1 for retrieval priority */
    importance: number;
    /** Tags for cross-referencing */
    tags: string[];
    /** Session ID where this was learned */
    sessionId: string;
    /** Timestamp of creation */
    createdAt: number;
    /** Timestamp of last access (for forgetting curve) */
    lastAccessedAt: number;
    /** Access count (for reinforcement) */
    accessCount: number;
    /** TTL in ms; null = permanent */
    ttl: number | null;
    /** Borrado lógico (§2.9): la fila permanece, las consultas la excluyen. */
    deleted?: boolean;
}

export interface MemoryQuery {
    categories?: string[];
    tags?: string[];
    minImportance?: number;
    maxAge?: number;
    limit?: number;
}

export interface MemoryStats {
    totalItems: number;
    byCategory: Record<string, number>;
    oldestItem: number;
    newestItem: number;
    averageImportance: number;
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

const DB_NAME = 'flu-long-term-memory';
const DB_VERSION = 1;
const STORE_NAME = 'memories';

const DEFAULT_MEMORY_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RETURNED_ITEMS = 50;

// -----------------------------------------------------------
// IndexedDB Helpers
// -----------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('category', 'category', { unique: false });
                store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                store.createIndex('importance', 'importance', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
                store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
            }
        };

        request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
        request.onerror = () => reject(new Error('Failed to open IndexedDB'));
    });
}

// -----------------------------------------------------------
// CRUD Operations
// -----------------------------------------------------------

/**
 * Save a memory item to long-term storage.
 * If an item with the same ID exists, it will be updated.
 */
export async function saveMemory(item: MemoryItem): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('Failed to save memory'));
    });
}

/**
 * Save multiple memory items in a single transaction.
 */
export async function saveMemories(items: MemoryItem[]): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const item of items) {
            store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('Failed to save memories'));
    });
}

/**
 * Retrieve a memory item by ID.
 */
export async function getMemory(id: string): Promise<MemoryItem | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            const item = request.result || null;
            resolve(item && item.deleted !== true ? item : null);
        };
        request.onerror = () => reject(new Error('Failed to get memory'));
    });
}

/**
 * Delete a memory item by ID.
 */
export async function deleteMemory(id: string): Promise<void> {
    const existing = await getMemory(id);
    if (!existing) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ ...existing, deleted: true });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('Failed to delete memory'));
    });
}

/**
 * Query memory items with filters.
 */
export async function queryMemories(query: MemoryQuery = {}): Promise<MemoryItem[]> {
    const db = await openDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            let results: MemoryItem[] = (request.result || []).filter(
                (item: MemoryItem) => item.deleted !== true,
            );

            // Filter by category
            if (query.categories && query.categories.length > 0) {
                results = results.filter((item) => query.categories!.includes(item.category));
            }

            // Filter by tags
            if (query.tags && query.tags.length > 0) {
                results = results.filter((item) =>
                    query.tags!.some((tag) => item.tags.includes(tag)),
                );
            }

            // Filter by minimum importance
            if (query.minImportance !== undefined) {
                results = results.filter((item) => item.importance >= query.minImportance!);
            }

            // Filter by max age (items not accessed within maxAge ms)
            if (query.maxAge !== undefined) {
                results = results.filter((item) => (now - item.lastAccessedAt) <= query.maxAge!);
            }

            // Remove expired items
            results = results.filter((item) => {
                if (item.ttl === null) return true;
                return (now - item.createdAt) < item.ttl;
            });

            // Sort by importance (descending), then by lastAccessedAt (descending)
            results.sort((a, b) => {
                if (b.importance !== a.importance) return b.importance - a.importance;
                return b.lastAccessedAt - a.lastAccessedAt;
            });

            // Apply limit
            const limit = query.limit || MAX_RETURNED_ITEMS;
            results = results.slice(0, limit);

            resolve(results);
        };

        request.onerror = () => reject(new Error('Failed to query memories'));
    });
}

/**
 * Touch a memory item (update lastAccessedAt and accessCount).
 */
export async function touchMemory(id: string): Promise<void> {
    const item = await getMemory(id);
    if (!item) return;

    item.lastAccessedAt = Date.now();
    item.accessCount += 1;
    await saveMemory(item);
}

/**
 * Get all expired memory items for cleanup.
 */
export async function getExpiredMemories(): Promise<MemoryItem[]> {
    const db = await openDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const results: MemoryItem[] = (request.result || []).filter((item) => {
                if (item.ttl === null) return false;
                return (now - item.createdAt) >= item.ttl;
            });
            resolve(results);
        };

        request.onerror = () => reject(new Error('Failed to get expired memories'));
    });
}

/**
 * Clean up expired memory items.
 * Returns the number of items deleted.
 */
export async function cleanupExpiredMemories(): Promise<number> {
    const expired = await getExpiredMemories();
    if (expired.length === 0) return 0;

    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const item of expired) {
            store.delete(item.id);
        }
        tx.oncomplete = () => resolve(expired.length);
        tx.onerror = () => reject(new Error('Failed to cleanup expired memories'));
    });
}

// -----------------------------------------------------------
// Memory Creation Helpers
// -----------------------------------------------------------

/**
 * Generate a unique memory ID.
 */
export function generateMemoryId(category: string): string {
    return `${category}_${uuidv4()}`;
}

/**
 * Create a new memory item with defaults.
 */
export function createMemory(
    category: string,
    content: string,
    importance: number,
    tags: string[] = [],
    sessionId: string = '',
    ttl: number | null = DEFAULT_MEMORY_TTL,
): MemoryItem {
    const now = Date.now();
    return {
        id: generateMemoryId(category),
        category,
        content,
        importance: Math.max(0, Math.min(1, importance)),
        tags,
        sessionId,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ttl,
    };
}

// -----------------------------------------------------------
// Stats
// -----------------------------------------------------------

/**
 * Get memory statistics.
 */
export async function getMemoryStats(): Promise<MemoryStats> {
    const db = await openDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const items: MemoryItem[] = request.result || [];
            const now = Date.now();
            const valid = items.filter((item) => {
                if (item.ttl === null) return true;
                return (now - item.createdAt) < item.ttl;
            });

            const byCategory: Record<string, number> = {};
            let totalImportance = 0;

            for (const item of valid) {
                byCategory[item.category] = (byCategory[item.category] || 0) + 1;
                totalImportance += item.importance;
            }

            resolve({
                totalItems: valid.length,
                byCategory,
                oldestItem: valid.length > 0 ? Math.min(...valid.map((i) => i.createdAt)) : 0,
                newestItem: valid.length > 0 ? Math.max(...valid.map((i) => i.createdAt)) : 0,
                averageImportance: valid.length > 0 ? totalImportance / valid.length : 0,
            });
        };

        request.onerror = () => reject(new Error('Failed to get memory stats'));
    });
}

/**
 * Format memories for Gemini system prompt injection.
 */
export async function formatMemoriesForPrompt(
    categories?: string[],
    maxItems: number = 10,
): Promise<string> {
    const items = await queryMemories({
        categories,
        minImportance: 0.3,
        limit: maxItems,
    });

    if (items.length === 0) return '';

    const parts = items.map((item, i) => {
        const age = Math.round((Date.now() - item.createdAt) / (1000 * 60 * 60));
        return `${i + 1}. [${item.category}] (${age}h ago, importance: ${item.importance.toFixed(2)}) ${item.content}`;
    });

    return `\nLong-term memories:\n${parts.join('\n')}`;
}
