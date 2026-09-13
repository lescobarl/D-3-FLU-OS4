// ============================================================
// Goal Tracking System — FLU Remembers What It's Trying to Do
// ============================================================
// Tracks the current conversation goal, progress toward it,
// decisions made, topics covered, and pending action items.
// This gives FLU a sense of purpose and direction.
//
// Cumple:
//   - Rule #1: NO HARDCODE — all thresholds configurable
//   - Pure functions — no React dependencies
// ============================================================

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

import { v4 as uuidv4 } from 'uuid';

export interface Goal {
    /** Unique goal ID */
    id: string;
    /** Goal description (e.g. "Decide on project timeline") */
    description: string;
    /** When the goal was created */
    createdAt: number;
    /** Current status */
    status: 'active' | 'completed' | 'abandoned';
    /** Priority 0-1 */
    priority: number;
    /** Category */
    category: GoalCategory;
}

export type GoalCategory =
    | 'decision'
    | 'information_gathering'
    | 'problem_solving'
    | 'planning'
    | 'review'
    | 'social'
    | 'other';

export interface Decision {
    /** What was decided */
    description: string;
    /** When it was made */
    timestamp: number;
    /** Who made the decision */
    decidedBy?: string;
    /** Confidence 0-1 */
    confidence: number;
}

export interface Topic {
    /** Topic name */
    name: string;
    /** When first discussed */
    startedAt: number;
    /** When last discussed */
    lastDiscussedAt: number;
    /** Status */
    status: 'active' | 'completed' | 'deferred';
    /** Key points discussed */
    keyPoints: string[];
}

export interface PendingAction {
    /** Action description */
    description: string;
    /** Who is responsible */
    assignee?: string;
    /** When it was created */
    createdAt: number;
    /** Due date (optional) */
    dueBy?: number;
    /** Status */
    status: 'pending' | 'in_progress' | 'completed';
}

export interface SessionProgress {
    /** Current goals */
    goals: Goal[];
    /** Decisions made this session */
    decisions: Decision[];
    /** Topics discussed */
    topics: Topic[];
    /** Pending actions */
    pendingActions: PendingAction[];
    /** Session start time */
    sessionStart: number;
    /** Overall progress estimate 0-1 */
    overallProgress: number;
}

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Create initial session progress state.
 */
export function createSessionProgress(sessionStart: number = Date.now()): SessionProgress {
    return {
        goals: [],
        decisions: [],
        topics: [],
        pendingActions: [],
        sessionStart,
        overallProgress: 0,
    };
}

/**
 * Add a goal to the session.
 */
export function addGoal(progress: SessionProgress, description: string, category: GoalCategory = 'other', priority: number = 0.5): SessionProgress {
    const goal: Goal = {
        id: `goal_${uuidv4()}`,
        description,
        createdAt: Date.now(),
        status: 'active',
        priority,
        category,
    };
    return { ...progress, goals: [...progress.goals, goal] };
}

/**
 * Record a decision.
 */
export function recordDecision(progress: SessionProgress, description: string, decidedBy?: string, confidence: number = 0.8): SessionProgress {
    const decision: Decision = {
        description,
        timestamp: Date.now(),
        decidedBy,
        confidence,
    };
    return { ...progress, decisions: [...progress.decisions, decision] };
}

/**
 * Track a topic.
 */
export function trackTopic(progress: SessionProgress, name: string, keyPoint?: string): SessionProgress {
    const existing = progress.topics.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        const updated = progress.topics.map((t) =>
            t.name.toLowerCase() === name.toLowerCase()
                ? {
                    ...t,
                    lastDiscussedAt: Date.now(),
                    keyPoints: keyPoint
                        ? [...t.keyPoints.filter((kp) => kp !== keyPoint), keyPoint]
                        : t.keyPoints,
                }
                : t,
        );
        return { ...progress, topics: updated };
    }

    const topic: Topic = {
        name,
        startedAt: Date.now(),
        lastDiscussedAt: Date.now(),
        status: 'active',
        keyPoints: keyPoint ? [keyPoint] : [],
    };
    return { ...progress, topics: [...progress.topics, topic] };
}

/**
 * Complete a topic.
 */
export function completeTopic(progress: SessionProgress, name: string): SessionProgress {
    return {
        ...progress,
        topics: progress.topics.map((t) =>
            t.name.toLowerCase() === name.toLowerCase() ? { ...t, status: 'completed' as const } : t,
        ),
    };
}

/**
 * Add a pending action.
 */
export function addPendingAction(progress: SessionProgress, description: string, assignee?: string): SessionProgress {
    const action: PendingAction = {
        description,
        assignee,
        createdAt: Date.now(),
        status: 'pending',
    };
    return { ...progress, pendingActions: [...progress.pendingActions, action] };
}

/**
 * Compute overall session progress based on goals completed, topics covered, etc.
 */
export function computeOverallProgress(progress: SessionProgress): number {
    const goalProgress = progress.goals.length > 0
        ? progress.goals.filter((g) => g.status === 'completed').length / progress.goals.length
        : 0;

    const topicProgress = progress.topics.length > 0
        ? progress.topics.filter((t) => t.status === 'completed').length / progress.topics.length
        : 0;

    const decisionWeight = Math.min(1, progress.decisions.length / 5); // 5 decisions = 100%

    return Math.min(1, (goalProgress * 0.4 + topicProgress * 0.3 + decisionWeight * 0.3));
}

/**
 * Format session progress for Gemini system prompt injection.
 */
export function formatSessionProgressForPrompt(progress: SessionProgress, language: 'es' | 'en' = 'es'): string {
    const isEn = language === 'en';
    const lines: string[] = [];

    if (isEn) {
        lines.push('=== Session Progress ===');
    } else {
        lines.push('=== Progreso de la Sesión ===');
    }

    // Goals
    const activeGoals = progress.goals.filter((g) => g.status === 'active');
    if (activeGoals.length > 0) {
        if (isEn) {
            lines.push('Active goals:');
        } else {
            lines.push('Objetivos activos:');
        }
        for (const goal of activeGoals) {
            lines.push(`  - ${goal.description} (${isEn ? 'priority' : 'prioridad'}: ${goal.priority.toFixed(1)})`);
        }
    }

    // Decisions
    if (progress.decisions.length > 0) {
        if (isEn) {
            lines.push('Decisions made:');
        } else {
            lines.push('Decisiones tomadas:');
        }
        for (const decision of progress.decisions.slice(-3)) {
            lines.push(`  - ${decision.description}`);
        }
    }

    // Topics
    const activeTopics = progress.topics.filter((t) => t.status === 'active');
    if (activeTopics.length > 0) {
        if (isEn) {
            lines.push('Current topics:');
        } else {
            lines.push('Temas actuales:');
        }
        for (const topic of activeTopics) {
            lines.push(`  - ${topic.name}`);
        }
    }

    // Pending actions
    const pending = progress.pendingActions.filter((a) => a.status !== 'completed');
    if (pending.length > 0) {
        if (isEn) {
            lines.push('Pending actions:');
        } else {
            lines.push('Acciones pendientes:');
        }
        for (const action of pending) {
            const assignee = action.assignee ? ` (${action.assignee})` : '';
            lines.push(`  - ${action.description}${assignee}`);
        }
    }

    // Overall progress
    const overall = computeOverallProgress(progress);
    if (isEn) {
        lines.push(`Overall progress: ${Math.round(overall * 100)}%`);
    } else {
        lines.push(`Progreso general: ${Math.round(overall * 100)}%`);
    }

    return lines.join('\n');
}
