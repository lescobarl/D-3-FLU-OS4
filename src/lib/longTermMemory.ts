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
import { fluDb } from '../core/db/fluDatabase';

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

const DEFAULT_MEMORY_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RETURNED_ITEMS = 50;

// -----------------------------------------------------------
// CRUD Operations (Dexie: flu-os3.memories — C30)
// -----------------------------------------------------------

/**
 * Save a memory item to long-term storage.
 * If an item with the same ID exists, it will be updated.
 */
export async function saveMemory(item: MemoryItem): Promise<void> {
    await fluDb.memories.put(item);
}

/**
 * Save multiple memory items in a single transaction.
 */
export async function saveMemories(items: MemoryItem[]): Promise<void> {
    await fluDb.memories.bulkPut(items);
}

/**
 * Retrieve a memory item by ID.
 */
export async function getMemory(id: string): Promise<MemoryItem | null> {
    const item = await fluDb.memories.get(id);
    return item && item.deleted !== true ? item : null;
}

/**
 * Delete a memory item by ID (§2.9: borrado lógico, la fila permanece).
 */
export async function deleteMemory(id: string): Promise<void> {
    const existing = await getMemory(id);
    if (!existing) return;
    await fluDb.memories.put({ ...existing, deleted: true });
}

/**
 * Query memory items with filters.
 */
export async function queryMemories(query: MemoryQuery = {}): Promise<MemoryItem[]> {
    const now = Date.now();
    let results: MemoryItem[] = (await fluDb.memories.toArray()).filter(
        (item) => item.deleted !== true,
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
    return results.slice(0, limit);
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
    const now = Date.now();
    return (await fluDb.memories.toArray()).filter((item) => {
        if (item.deleted === true) return false;
        if (item.ttl === null) return false;
        return (now - item.createdAt) >= item.ttl;
    });
}

/**
 * Clean up expired memory items.
 * Returns the number of items marked as deleted (§2.9: borrado lógico).
 */
export async function cleanupExpiredMemories(): Promise<number> {
    const expired = await getExpiredMemories();
    if (expired.length === 0) return 0;
    await fluDb.memories.bulkPut(expired.map((item) => ({ ...item, deleted: true })));
    return expired.length;
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
    const items = await fluDb.memories.toArray();
    const now = Date.now();
    const valid = items.filter((item) => {
        if (item.deleted === true) return false;
        if (item.ttl === null) return true;
        return (now - item.createdAt) < item.ttl;
    });

    const byCategory: Record<string, number> = {};
    let totalImportance = 0;

    for (const item of valid) {
        byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        totalImportance += item.importance;
    }

    return {
        totalItems: valid.length,
        byCategory,
        oldestItem: valid.length > 0 ? Math.min(...valid.map((i) => i.createdAt)) : 0,
        newestItem: valid.length > 0 ? Math.max(...valid.map((i) => i.createdAt)) : 0,
        averageImportance: valid.length > 0 ? totalImportance / valid.length : 0,
    };
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
