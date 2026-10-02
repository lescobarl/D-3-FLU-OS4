// @vitest-environment jsdom
// ============================================================
// App.shell.test.tsx - Conducta observable del monolito src/App.tsx
// ------------------------------------------------------------
// App.tsx solo exporta el componente `App` (y helpers internos no
// exportados). Para observar su CONDUCTA se monta el componente real
// en jsdom sustituyendo SOLO la frontera:
//   - hooks colaboradores (persistencia, stores, voz, agenda...):
//     dobles deterministas que devuelven datos controlados.
//   - servicios externos (gemini, ocr, musica, fluSpeech, audio).
//   - hijos pesados (vistas lazy, puente de avatar, barras): dobles
//     que capturan props para verificar el reparto.
// La logica de App (wiring, derivaciones inline, handlers de window,
// JSX del shell) NO se sustituye: se ejercita y se afirma.
//
//   Bloque A - shell: branding, chips de estado, selector de idioma.
//   Bloque B - selector de usuario: opciones, activar, borrar, crear.
//   Bloque C - reparto de props a hijos (barra, campana, tabs, hub).
//   Bloque D - handlers de window (shopping, notas, diario, agenda...).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const H = vi.hoisted(() => {
    const captured: Record<string, Record<string, unknown>> = {};
    const capture =
        (key: string) =>
        (props: Record<string, unknown>): null => {
            captured[key] = props;
            return null;
        };

    const state = {
        voiceStatus: 'idle' as string,
        voiceError: null as string | null,
        activeKnowledgeBase: 'general' as string,
        language: 'es' as 'es' | 'en' | 'both',
        sessionRole: 'Usuario',
        profile: 'tutor',
        activeAmbienteId: 'default',
        integrationHistory: [] as Array<Record<string, unknown>>,
        lastResponse: '',
        currentTranscript: '',
        workspaceArtifact: null as Record<string, unknown> | null,
        documentArtifact: null as Record<string, unknown> | null,
        appAnalysisArtifact: null as Record<string, unknown> | null,
        generationJob: null as Record<string, unknown> | null,
        minuteHistory: [] as unknown[],
        shoppingItems: [] as Array<{ id: string; label: string; checked: boolean }>,
        notesList: [] as Array<{ id: string; label: string; body: string; done: boolean }>,
        diaryEntries: [] as unknown[],
        participants: [] as Array<{ id: string; name: string; role?: string }>,
        participantsLoading: false,
        workspaceImageUrl: '',
        toasts: [] as Array<{ id: string }>,
        notificationHistory: [] as unknown[],
        unread: 0,
    };

    const fn = () => vi.fn();

    const spy = {
        audit: { logEvent: fn(), logChange: fn(), clearAll: fn() },
        config: {
            setLanguage: fn(),
            setSessionRole: fn(),
            handleTextApiKeyCommit: fn(),
            handleTextModelCommit: fn(),
            handleTextApiUrlCommit: fn(),
            handleGeminiApiKeyCommit: fn(),
            handleImageApiKeyCommit: fn(),
            handleImageModelCommit: fn(),
            handleImageApiUrlCommit: fn(),
            handleFalApiKeyCommit: fn(),
            handleFalVideoModelCommit: fn(),
            handleOcrApiKeyCommit: fn(),
            handleOcrModelCommit: fn(),
            handleOcrApiUrlCommit: fn(),
            handleClearCache: fn(),
            setWakeWords: fn(),
            setDebugLogsEnabled: fn(),
        },
        shopping: { addMany: fn(), toggle: fn(), remove: fn(), clearChecked: fn() },
        agenda: {
            list: fn(),
            create: fn(),
            update: fn(),
            cancel: fn(),
            cancelByTarget: fn(),
            updateByTarget: fn(),
            clearAll: fn(),
            stopRinging: fn(),
        },
        participants: {
            remove: fn(),
            register: fn(),
            findAnonymous: fn(),
            list: fn(),
            resolveParticipantBySpeakerLabel: fn(),
            participantsWithBirthdayNear: fn(),
        },
        notes: { add: fn(), refresh: fn(), rename: fn(), setBody: fn(), remove: fn() },
        diary: { addEntry: fn() },
        voiceProfiles: { removeProfile: fn(), findProfileByLabel: fn(), renameProfile: fn() },
        documents: { add: fn(), remove: fn() },
        minuteKnowledge: { publishAllToStore: fn() },
        minuteHandlers: {
            handleGenerateSummary: fn(),
            handleSaveMinute: fn(),
            handleSaveConversationSummary: fn(),
            handleSelectMinuteHistory: fn(),
        },
        navigation: { speakFlu: fn(), scheduleResumeListening: fn(), handleNavigationCommand: fn() },
        voice: {
            startListening: fn(),
            stopListening: fn(),
            showListeningAck: fn(),
            removeSessionSpeaker: fn(),
            renameSessionSpeaker: fn(),
            resetVoiceDisplay: fn(),
            suspendRecognitionForAssistantSpeech: fn(),
            setRecentMemory: fn(),
        },
        device: { execute: fn() },
        onboarding: {
            reset: fn(),
            skip: fn(),
            answer: fn(),
            completeWithName: fn(),
            persistForParticipant: fn(),
        },
        onboardingVoice: { start: fn(), stop: fn(), suspend: fn(), resume: fn() },
        notifications: { markAllRead: fn(), clear: fn(), dismiss: fn(), setChannel: fn() },
        dnd: { setEnabled: fn(), setSchedule: fn(), setAllowUrgent: fn() },
        branding: {
            setMode: fn(),
            setActiveSeason: fn(),
            setBirthday: fn(),
            setCelebrateAchievements: fn(),
        },
        catalogs: {
            handleActivateAmbiente: fn(),
            handleRegisterAmbiente: fn(),
            handleUpdateAmbiente: fn(),
            handleRemoveAmbiente: fn(),
            handleActivatePaleta: fn(),
            handleRegisterPaleta: fn(),
            handleUpdatePaleta: fn(),
            handleRemovePaleta: fn(),
        },
        analysis: {
            docClear: fn(),
            analyzeFile: fn(),
            appClear: fn(),
            analyzeProject: fn(),
            genClear: fn(),
            generate: fn(),
            generateFromContract: fn(),
        },
        integration: {
            addConversationEntry: fn(),
            setWorkspaceArtifact: fn(),
            setLastResponse: fn(),
            setLastGeminiEmotion: fn(),
            setPendingEmotionAnims: fn(),
            setConversationState: fn(),
            setFluSpeaking: fn(),
            incrementInteractionCount: fn(),
            pushBridgeEvent: fn(),
            detectAndSetEmotion: fn(),
            resetConversationHistory: fn(),
            removeConversationEntriesBySpeaker: fn(),
            setActivePersonId: fn(),
            setVoiceConfig: fn(),
            setPersonality: fn(),
            setAdvancedConfig: fn(),
            setImageConfig: fn(),
            applyProfile: fn(),
        },
    };

    const integration = {
        get conversationHistory() {
            return state.integrationHistory;
        },
        get lastResponse() {
            return state.lastResponse;
        },
        get currentTranscript() {
            return state.currentTranscript;
        },
        get workspaceArtifact() {
            return state.workspaceArtifact;
        },
        get documentArtifact() {
            return state.documentArtifact;
        },
        get appAnalysisArtifact() {
            return state.appAnalysisArtifact;
        },
        get generationJob() {
            return state.generationJob;
        },
        get minuteHistory() {
            return state.minuteHistory;
        },
        get profile() {
            return state.profile;
        },
        config: { debug: false },
        ...spy.integration,
    };

    const bunny = {
        currentExpression: null as string | null,
        currentAnimation: null as string | null,
        blendQueue: [] as string[],
        setComponentColor: fn(),
        resetComponentColors: fn(),
    };

    const useIntegrationStore = Object.assign(() => integration, { getState: () => integration });

    // Objetos de retorno ESTABLES (identidad fija) para que los useEffect de App
    // no re-disparen por recibir un objeto nuevo en cada render. Los campos
    // dinamicos se exponen con getters que leen `state`.
    const languageRef = {
        get current() {
            return state.language;
        },
    };
    const sessionRoleRef = {
        get current() {
            return state.sessionRole;
        },
    };

    const returns = {
        config: {
            apiKey: '',
            textModel: 'model-x',
            textApiUrl: '',
            geminiApiKey: '',
            imageApiKey: '',
            imageModel: 'img',
            imageApiUrl: '',
            falApiKey: '',
            falVideoModel: '',
            ocrApiKey: '',
            ocrModel: '',
            ocrApiUrl: '',
            get language() {
                return state.language;
            },
            get sessionRole() {
                return state.sessionRole;
            },
            voices: [] as unknown[],
            languageRef,
            sessionRoleRef,
            wakeWords: [] as string[],
            wakeWordsRef: { current: [] as string[] },
            debugLogsEnabled: false,
            ...spy.config,
        },
        audit: spy.audit,
        minuteKnowledge: { minutes: [] as unknown[], ...spy.minuteKnowledge },
        voiceProfiles: { profiles: [] as Array<{ id: string; label: string }>, ...spy.voiceProfiles },
        documents: { documents: [] as unknown[], loading: false, ...spy.documents },
        shopping: {
            get items() {
                return state.shoppingItems;
            },
            loading: false,
            get remainingCount() {
                return state.shoppingItems.filter((i) => !i.checked).length;
            },
            ...spy.shopping,
        },
        agenda: {
            items: [] as unknown[],
            ringing: null,
            list: spy.agenda.list,
            create: spy.agenda.create,
            update: spy.agenda.update,
            cancel: spy.agenda.cancel,
            cancelByTarget: spy.agenda.cancelByTarget,
            updateByTarget: spy.agenda.updateByTarget,
            clearAll: spy.agenda.clearAll,
            stopRinging: spy.agenda.stopRinging,
        },
        participants: {
            get participants() {
                return state.participants;
            },
            get loading() {
                return state.participantsLoading;
            },
            participantsWithBirthdayNear: spy.participants.participantsWithBirthdayNear,
            remove: spy.participants.remove,
            register: spy.participants.register,
            findAnonymous: spy.participants.findAnonymous,
            service: {
                list: spy.participants.list,
                resolveParticipantBySpeakerLabel: spy.participants.resolveParticipantBySpeakerLabel,
            },
        },
        materiaGris: { leaderboard: [] as unknown[], history: [] as unknown[], loading: false, awardPoints: fn() },
        communicationProfiles: { profiles: [], setManual: fn(), resetPerson: fn() },
        browserProfiles: { profiles: [], reset: fn(), update: fn() },
        searchSites: { sites: [], dynamicDomains: [], loading: false, register: fn(), update: fn(), remove: fn() },
        contacts: { contacts: [], birthdayNear: [], loading: false, addContact: fn(), removeContact: fn(), service: {} },
        diary: {
            get entries() {
                return state.diaryEntries;
            },
            ...spy.diary,
        },
        notes: {
            get notes() {
                return state.notesList;
            },
            ...spy.notes,
        },
        deviceActions: { service: { execute: spy.device.execute } },
        fluParticipant: {
            presentation: { phase: 'idle', tone: 'neutral' },
            evaluateOnDemand: fn(),
            canAcceptFloorGrant: () => false,
            shouldIgnoreDuplicateFloorGrant: () => true,
            consumeRaisedDraft: () => null,
            beginFloorDelivery: fn(),
            endFloorDelivery: fn(),
            recordInterventionDelivered: fn(),
        },
        voiceAssistant: {
            get status() {
                return state.voiceStatus;
            },
            get error() {
                return state.voiceError;
            },
            liveTranscript: '',
            lastTranscript: '',
            isSupported: true,
            listeningAck: null,
            get activeKnowledgeBase() {
                return state.activeKnowledgeBase;
            },
            ...spy.voice,
        },
        dnd: [{ active: false, allowUrgent: true }, spy.dnd] as const,
        onboarding: {
            visible: false,
            ready: true,
            currentStep: null,
            progress: { current: 0, total: 0 },
            state: { captured: {} as Record<string, string> },
            config: { steps: [] as unknown[], nameKey: 'flu-onboarding-name' },
            ...spy.onboarding,
        },
        onboardingVoice: { listening: false, interim: '', supported: false, ...spy.onboardingVoice },
        notifications: {
            get history() {
                return state.notificationHistory;
            },
            get unread() {
                return state.unread;
            },
            get toasts() {
                return state.toasts;
            },
            channel: 'app',
            service: {},
            ...spy.notifications,
        },
        branding: {
            config: { mode: 'auto', activeSeason: 'spring', birthday: null, celebrateAchievements: true },
            isBirthday: false,
            celebrandoA: false,
            isEcologicalBranding: false,
            seasonalActions: spy.branding,
        },
        catalogs: { ambientes: [] as unknown[], dynamicAmbienteIds: [], paletas: [], dynamicPaletaIds: [], ...spy.catalogs },
        workspaceImage: {
            get imageUrl() {
                return state.workspaceImageUrl;
            },
            isExpanded: false,
            generateFromContract: spy.analysis.generateFromContract,
        },
        documentAnalysis: {
            isAnalyzing: false,
            error: null,
            warnings: [],
            clear: spy.analysis.docClear,
            analyzeFile: spy.analysis.analyzeFile,
        },
        appAnalysis: { isAnalyzing: false, error: null, clear: spy.analysis.appClear, analyzeProject: spy.analysis.analyzeProject },
        documentGeneration: {
            isGenerating: false,
            error: null,
            result: null,
            videoResult: null,
            clear: spy.analysis.genClear,
            generate: spy.analysis.generate,
        },
        docGenBridge: { docInputRef: { current: null }, projectInputRef: { current: null } },
        minuteHandlers: { isSummarizing: false, ...spy.minuteHandlers },
        navigation: spy.navigation,
        autonomy: [{ running: false }, { startAllSystems: fn(), updateSystemConfig: fn(), stopAllSystems: fn() }] as const,
    };

    const hooks = {
        useIntegrationStore,
        useEnvironmentStore: (sel: (s: { activeAmbienteId: string }) => unknown) =>
            sel({ activeAmbienteId: state.activeAmbienteId }),
        useConfigPersistence: () => returns.config,
        useAuditLog: () => returns.audit,
        useMinuteKnowledge: () => returns.minuteKnowledge,
        useVoiceProfiles: () => returns.voiceProfiles,
        useDocuments: () => returns.documents,
        useShoppingList: () => returns.shopping,
        useAgenda: () => returns.agenda,
        useParticipants: () => returns.participants,
        useMateriaGris: () => returns.materiaGris,
        useCommunicationProfiles: () => returns.communicationProfiles,
        useBrowserProfiles: () => returns.browserProfiles,
        useSearchSites: () => returns.searchSites,
        useContacts: () => returns.contacts,
        useDiary: () => returns.diary,
        useNotes: () => returns.notes,
        useDeviceActions: () => returns.deviceActions,
        useFluParticipant: () => returns.fluParticipant,
        useFluVoiceAssistant: () => returns.voiceAssistant,
        useDoNotDisturb: () => returns.dnd,
        useOnboarding: () => returns.onboarding,
        useOnboardingVoiceCapture: () => returns.onboardingVoice,
        useNotificationCenter: () => returns.notifications,
        useEnhancedBranding: () => returns.branding,
        useCatalogsSettings: () => returns.catalogs,
        useWorkspaceImage: () => returns.workspaceImage,
        useDocumentAnalysis: () => returns.documentAnalysis,
        useAppAnalysis: () => returns.appAnalysis,
        useDocumentGeneration: () => returns.documentGeneration,
        useDocumentGenerationBridge: () => returns.docGenBridge,
        useMinuteHandlers: () => returns.minuteHandlers,
        useNavigationCommands: () => returns.navigation,
        useSessionPersistence: () => undefined,
        useConversationPersistence: () => undefined,
        useFluBridgesLifecycle: () => undefined,
        useAutonomyIntegration: () => returns.autonomy,
        useBunnyStore: (sel?: (s: typeof bunny) => unknown) => (sel ? sel(bunny) : bunny),
    };

    return { captured, capture, state, spy, integration, bunny, hooks };
});

// ---- Frontera: hooks colaboradores ----
vi.mock('../src/avatar', () => ({
    useBunnyStore: H.hooks.useBunnyStore,
    ensureAvatarPantsVisible: () => undefined,
    EXPRESSION_MAP: {},
}));
vi.mock('../src/store/integrationStore', () => ({
    useIntegrationStore: H.hooks.useIntegrationStore,
    detectSentiment: () => 'neutral',
}));
vi.mock('../src/store/environmentStore', () => ({ useEnvironmentStore: H.hooks.useEnvironmentStore }));
vi.mock('../src/hooks/useConfigPersistence', () => ({ useConfigPersistence: H.hooks.useConfigPersistence }));
vi.mock('../src/hooks/useAuditLog', () => ({ useAuditLog: H.hooks.useAuditLog }));
vi.mock('../src/hooks/useMinuteKnowledge', () => ({ useMinuteKnowledge: H.hooks.useMinuteKnowledge }));
vi.mock('../src/hooks/useVoiceProfiles', () => ({ useVoiceProfiles: H.hooks.useVoiceProfiles }));
vi.mock('../src/hooks/useDocuments', () => ({ useDocuments: H.hooks.useDocuments }));
vi.mock('../src/hooks/useShoppingList', () => ({ useShoppingList: H.hooks.useShoppingList }));
vi.mock('../src/hooks/useAgenda', () => ({ useAgenda: H.hooks.useAgenda }));
vi.mock('../src/hooks/useParticipants', () => ({ useParticipants: H.hooks.useParticipants }));
vi.mock('../src/hooks/useMateriaGris', () => ({ useMateriaGris: H.hooks.useMateriaGris }));
vi.mock('../src/hooks/useCommunicationProfiles', () => ({ useCommunicationProfiles: H.hooks.useCommunicationProfiles }));
vi.mock('../src/hooks/useBrowserProfiles', () => ({ useBrowserProfiles: H.hooks.useBrowserProfiles }));
vi.mock('../src/hooks/useSearchSites', () => ({ useSearchSites: H.hooks.useSearchSites }));
vi.mock('../src/hooks/useContacts', () => ({ useContacts: H.hooks.useContacts }));
vi.mock('../src/hooks/useDiary', () => ({ useDiary: H.hooks.useDiary }));
vi.mock('../src/hooks/useNotes', () => ({ useNotes: H.hooks.useNotes }));
vi.mock('../src/hooks/useDeviceActions', () => ({ useDeviceActions: H.hooks.useDeviceActions }));
vi.mock('../src/hooks/useFluParticipant', () => ({ useFluParticipant: H.hooks.useFluParticipant }));
vi.mock('../src/hooks/useDoNotDisturb', () => ({ useDoNotDisturb: H.hooks.useDoNotDisturb }));
vi.mock('../src/hooks/useOnboarding', () => ({ useOnboarding: H.hooks.useOnboarding }));
vi.mock('../src/hooks/useOnboardingVoiceCapture', () => ({ useOnboardingVoiceCapture: H.hooks.useOnboardingVoiceCapture }));
vi.mock('../src/hooks/useNotificationCenter', () => ({ useNotificationCenter: H.hooks.useNotificationCenter }));
vi.mock('../src/hooks/useCatalogsSettings', () => ({ useCatalogsSettings: H.hooks.useCatalogsSettings }));
vi.mock('../src/hooks/useWorkspaceImage', () => ({ useWorkspaceImage: H.hooks.useWorkspaceImage }));
vi.mock('../src/hooks/useDocumentAnalysis', () => ({ useDocumentAnalysis: H.hooks.useDocumentAnalysis }));
vi.mock('../src/hooks/useAppAnalysis', () => ({ useAppAnalysis: H.hooks.useAppAnalysis }));
vi.mock('../src/hooks/useDocumentGeneration', () => ({ useDocumentGeneration: H.hooks.useDocumentGeneration }));
vi.mock('../src/hooks/useDocumentGenerationBridge', () => ({ useDocumentGenerationBridge: H.hooks.useDocumentGenerationBridge }));
vi.mock('../src/hooks/useMinuteHandlers', () => ({ useMinuteHandlers: H.hooks.useMinuteHandlers }));
vi.mock('../src/hooks/useNavigationCommands', () => ({ useNavigationCommands: H.hooks.useNavigationCommands }));
vi.mock('../src/hooks/useSessionPersistence', () => ({
    useSessionPersistence: H.hooks.useSessionPersistence,
    readSessionState: () => Promise.resolve(undefined),
    defaultSessionState: () => ({ expandedFrameId: '', selectedMinuteId: null }),
}));
vi.mock('../src/hooks/useConversationPersistence', () => ({
    useConversationPersistence: H.hooks.useConversationPersistence,
    softDeleteConversationRows: () => Promise.resolve(undefined),
}));
vi.mock('../src/app/fluBridges', () => ({ useFluBridgesLifecycle: H.hooks.useFluBridgesLifecycle }));
vi.mock('../src/core/autonomy', () => ({ useAutonomyIntegration: H.hooks.useAutonomyIntegration }));
vi.mock('../src/voice/hooks/useFluVoiceAssistant', () => ({ useFluVoiceAssistant: H.hooks.useFluVoiceAssistant }));

// ---- Frontera: stores/persistencia ligera/servicios ----
vi.mock('../src/core/branding/useEnhancedBranding', () => ({ useEnhancedBranding: H.hooks.useEnhancedBranding }));
vi.mock('../src/voice/lib/fluSpeech', () => ({
    speakResponse: () => Promise.resolve(),
    waitForSpeechIdle: () => Promise.resolve(),
    isSpeechBusy: () => false,
    cancelSpeech: () => undefined,
}));
vi.mock('../src/voice/lib/fluParticipantConfig', () => ({
    getFluParticipantConfig: () => ({}),
    setFluParticipantOverrides: () => ({}),
    isFluParticipantEnabled: () => false,
}));
vi.mock('../src/core/temporal/audioAlert', () => ({
    createWebAudioDriver: () => ({ play: () => Promise.resolve(), stop: () => undefined }),
}));
vi.mock('../src/services/gemini', () => ({ geminiService: { generateVisionAnalysis: () => Promise.resolve({}) } }));
vi.mock('../src/services/musicPlayer', () => ({
    playSong: () => Promise.resolve(),
    pauseMusic: () => undefined,
    stopMusic: () => undefined,
    isMusicPlaying: () => false,
}));
vi.mock('../src/services/aiServiceFactory', () => ({
    getPreferredAIProvider: () => 'gemini',
    setPreferredAIProvider: () => undefined,
}));
vi.mock('../src/services/ocrService', () => ({ extractTextFromImage: () => Promise.resolve({ text: '' }) }));
vi.mock('../src/core/db/fluDatabase', () => ({
    fluDb: {
        agenda: {},
        conversations: {
            where: () => ({ equals: () => ({ primaryKeys: () => Promise.resolve([]) }) }),
            filter: () => ({ primaryKeys: () => Promise.resolve([]) }),
        },
    },
    addAuditLog: () => Promise.resolve(undefined),
}));

// ---- Frontera: hijos pesados (capturan props, no renderizan) ----
vi.mock('../src/voice/components/FluShellTabs', () => ({ FluShellTabs: H.capture('shell') }));
vi.mock('../src/components/VoiceAssistantBarWrapper', () => ({ VoiceAssistantBarWrapper: H.capture('voiceBar') }));
vi.mock('../src/components/NotificationCenterBell', () => ({ NotificationCenterBell: H.capture('notif') }));
vi.mock('../src/components/ThinkingIndicator', () => ({ ThinkingIndicator: H.capture('thinking') }));
vi.mock('../src/components/FluAvatarVoiceBridge', () => ({ FluAvatarVoiceBridge: H.capture('bridge') }));
vi.mock('../src/components/OnboardingOverlay', () => ({ OnboardingOverlay: H.capture('onboarding') }));
vi.mock('../src/core/branding/SeasonalEffects', () => ({ SeasonalEffects: H.capture('seasonal') }));
vi.mock('../src/components/FluWorkspaceTabView', () => ({ default: H.capture('workspace') }));
vi.mock('../src/components/FluConversationTabView', () => ({ default: H.capture('conversation') }));
vi.mock('../src/components/FluMinutesTabView', () => ({ default: H.capture('minutes') }));
vi.mock('../src/components/FluSettingsTabView', () => ({ default: H.capture('settings') }));
vi.mock('../src/components/FluSystemTabView', () => ({ default: H.capture('system') }));

import App from '../src/App';
import { APP_BRANDING } from '../src/core/config/appConfig';
import { getVisibleTabIds } from '../src/core/environments/environmentRegistry';
import { FLU_CONFIG as FLU_CONF } from '../src/voice/lib/fluConfig';

function resetMocks(obj: Record<string, unknown>): void {
    for (const value of Object.values(obj)) {
        if (value && typeof (value as { mockReset?: unknown }).mockReset === 'function') {
            (value as { mockReset: () => void }).mockReset();
        } else if (value && typeof value === 'object') {
            resetMocks(value as Record<string, unknown>);
        }
    }
}

async function renderApp() {
    const utils = render(
        <MemoryRouter
            initialEntries={['/']}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
            <App />
        </MemoryRouter>,
    );
    // Resuelve las vistas lazy (Suspense) para que los hijos capturen props.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return utils;
}

type AsyncHandler = (input?: unknown, opts?: unknown) => Promise<string>;
const win = window as unknown as Record<string, AsyncHandler | undefined>;

beforeEach(() => {
    resetMocks(H.spy);
    for (const key of Object.keys(H.captured)) delete H.captured[key];
    H.state.voiceStatus = 'idle';
    H.state.voiceError = null;
    H.state.activeKnowledgeBase = 'general';
    H.state.language = 'es';
    H.state.sessionRole = 'Usuario';
    H.state.profile = 'tutor';
    H.state.activeAmbienteId = 'default';
    H.state.integrationHistory = [];
    H.state.lastResponse = '';
    H.state.currentTranscript = '';
    H.state.workspaceArtifact = null;
    H.state.documentArtifact = null;
    H.state.appAnalysisArtifact = null;
    H.state.generationJob = null;
    H.state.minuteHistory = [];
    H.state.shoppingItems = [];
    H.state.notesList = [];
    H.state.diaryEntries = [];
    H.state.participants = [];
    H.state.participantsLoading = false;
    H.state.workspaceImageUrl = '';
    H.state.toasts = [];
    H.state.notificationHistory = [];
    H.state.unread = 0;
    localStorage.clear();
    // Defaults async de la frontera.
    H.spy.audit.logEvent.mockResolvedValue(undefined);
    H.spy.audit.logChange.mockResolvedValue(undefined);
    H.spy.audit.clearAll.mockResolvedValue(undefined);
    H.spy.agenda.list.mockResolvedValue([]);
    H.spy.agenda.create.mockResolvedValue({ ok: true, item: { label: '', trigger: null } });
    H.spy.agenda.clearAll.mockResolvedValue(0);
    H.spy.agenda.cancelByTarget.mockResolvedValue(0);
    H.spy.agenda.updateByTarget.mockResolvedValue(0);
    H.spy.notes.add.mockResolvedValue({ ok: true });
    H.spy.diary.addEntry.mockResolvedValue({ ok: true });
    H.spy.participants.remove.mockResolvedValue(true);
    H.spy.participants.register.mockResolvedValue({ ok: false });
    H.spy.participants.findAnonymous.mockResolvedValue(null);
    H.spy.participants.list.mockResolvedValue([]);
    H.spy.participants.participantsWithBirthdayNear.mockResolvedValue([]);
    H.spy.device.execute.mockResolvedValue({ ok: true });
    H.spy.analysis.generate.mockResolvedValue({ content: '', text: '', url: '' });
    H.spy.minuteHandlers.handleGenerateSummary.mockResolvedValue(true);
    H.spy.minuteHandlers.handleSaveConversationSummary.mockResolvedValue(undefined);
});

describe('App shell - branding y estado de voz', () => {
    it('pinta el branding (icono, nombre y version) desde appConfig', async () => {
        await renderApp();
        expect(screen.getByText(APP_BRANDING.NAME)).toBeTruthy();
        expect(screen.getByText(APP_BRANDING.VERSION)).toBeTruthy();
        expect(screen.getByText(APP_BRANDING.ICON)).toBeTruthy();
    });

    it('con voz detenida el chip de estado dice "Detenido"', async () => {
        await renderApp();
        expect(screen.getByText('Detenido')).toBeTruthy();
    });

    it('con voz escuchando el chip de estado dice "Escuchando" y la barra lo refleja', async () => {
        H.state.voiceStatus = 'listening';
        await renderApp();
        expect(screen.getByText('Escuchando')).toBeTruthy();
        expect(H.captured.voiceBar.status).toBe('listening');
    });

    it('el cambio de idioma delega en setLanguage del hook de persistencia', async () => {
        await renderApp();
        fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'en' } });
        expect(H.spy.config.setLanguage).toHaveBeenCalledWith('en');
    });

    it('el cambio de perfil delega en integrationStore.applyProfile', async () => {
        H.state.profile = 'tutor';
        await renderApp();
        const select = screen.getByLabelText('Perfil') as HTMLSelectElement;
        const target = Array.from(select.options)
            .map((o) => o.value)
            .find((v) => v !== select.value)!;
        fireEvent.change(select, { target: { value: target } });
        expect(H.spy.integration.applyProfile).toHaveBeenCalledWith(target);
    });

    it('con KB de minutas activa el chip usa la etiqueta de la config', async () => {
        H.state.activeKnowledgeBase = 'minutes';
        await renderApp();
        expect(screen.getByText(FLU_CONF.knowledgeBase.minutes)).toBeTruthy();
    });
});

describe('App shell - selector de usuario', () => {
    it('lista los participantes registrados mas la opcion "+ Nuevo"', async () => {
        H.state.participants = [{ id: 'p1', name: 'Luis', role: 'profesor' }];
        await renderApp();
        const select = screen.getByTestId('user-picker-select') as HTMLSelectElement;
        const values = Array.from(select.options).map((o) => o.value);
        expect(values).toContain('p1');
        expect(values).toContain('__new__');
        expect(screen.getByText('Luis · profesor')).toBeTruthy();
    });

    it('elegir un participante lo activa y muestra el boton de borrar', async () => {
        H.state.participants = [{ id: 'p1', name: 'Luis' }];
        await renderApp();
        expect(screen.queryByTestId('user-picker-remove')).toBeNull();

        fireEvent.change(screen.getByTestId('user-picker-select'), { target: { value: 'p1' } });

        expect(screen.getByTestId('user-picker-remove')).toBeTruthy();
        expect(localStorage.getItem('flu-active-user')).toBe('p1');
    });

    it('el boton de borrar elimina al participante activo', async () => {
        H.state.participants = [{ id: 'p1', name: 'Luis' }];
        await renderApp();
        fireEvent.change(screen.getByTestId('user-picker-select'), { target: { value: 'p1' } });
        fireEvent.click(screen.getByTestId('user-picker-remove'));
        await act(async () => {
            await Promise.resolve();
        });
        expect(H.spy.participants.remove).toHaveBeenCalledWith('p1');
    });

    it('elegir "+ Nuevo" reinicia el onboarding cuando no hay perfil activo', async () => {
        H.state.participants = [{ id: 'p1', name: 'Luis' }];
        await renderApp();
        fireEvent.change(screen.getByTestId('user-picker-select'), { target: { value: '__new__' } });
        expect(H.spy.onboarding.reset).toHaveBeenCalled();
    });

    it('sin participantes el selector solo ofrece placeholder y "+ Nuevo"', async () => {
        await renderApp();
        const select = screen.getByTestId('user-picker-select') as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '__new__']);
    });
});

describe('App shell - reparto de props a hijos', () => {
    it('pasa status e isSupported a la barra de voz', async () => {
        await renderApp();
        expect(H.captured.voiceBar.status).toBe('idle');
        expect(H.captured.voiceBar.isSupported).toBe(true);
        expect(H.captured.voiceBar.participantEnabled).toBe(false);
    });

    it('pasa historial y no leidos a la campana de notificaciones', async () => {
        H.state.unread = 3;
        H.state.notificationHistory = [{ id: 'n1' }];
        await renderApp();
        expect(H.captured.notif.unread).toBe(3);
        expect(H.captured.notif.items).toEqual([{ id: 'n1' }]);
        expect(H.captured.notif.language).toBe('es');
    });

    it('las pestanas visibles derivan del ambiente activo', async () => {
        await renderApp();
        expect(H.captured.shell.visibleIds).toEqual(getVisibleTabIds('default'));
    });

    it('el Pizarron recibe latestResponse del integrationStore', async () => {
        H.state.lastResponse = 'Respuesta sustantiva';
        await renderApp();
        const hub = H.captured.workspace.hub as Record<string, unknown>;
        expect(hub.latestResponse).toBe('Respuesta sustantiva');
    });

    it('el onboarding se pasa como no visible cuando no hay paso', async () => {
        await renderApp();
        expect(H.captured.onboarding.visible).toBe(false);
        expect(H.captured.onboarding.prompt).toBe('');
    });

    it('las minutas reciben el historial vacio del hook de minutas', async () => {
        await renderApp();
        expect(H.captured.minutes.history).toEqual([]);
    });
});

describe('App - handler de lista de compras (window)', () => {
    it('agrega varios articulos separados por coma', async () => {
        await renderApp();
        const result = await win.__fluHandleShoppingText!({
            action: 'shopping.add',
            handled: true,
            data: { label: 'leche, pan' },
        });
        expect(H.spy.shopping.addMany).toHaveBeenCalledWith(['leche', 'pan']);
        expect(result).toContain('leche');
    });

    it('alterna un articulo existente por etiqueta', async () => {
        H.state.shoppingItems = [{ id: 'i1', label: 'leche', checked: false }];
        await renderApp();
        const result = await win.__fluHandleShoppingText!({
            action: 'shopping.toggle',
            handled: true,
            data: { label: 'leche' },
        });
        expect(H.spy.shopping.toggle).toHaveBeenCalledWith('i1');
        expect(result).toContain('leche');
    });

    it('no alterna si la etiqueta no esta en la lista', async () => {
        H.state.shoppingItems = [{ id: 'i1', label: 'leche', checked: false }];
        await renderApp();
        await win.__fluHandleShoppingText!({
            action: 'shopping.toggle',
            handled: true,
            data: { label: 'zzz' },
        });
        expect(H.spy.shopping.toggle).not.toHaveBeenCalled();
    });

    it('lista solo los pendientes (excluye comprados)', async () => {
        H.state.shoppingItems = [
            { id: 'i1', label: 'leche', checked: false },
            { id: 'i2', label: 'pan', checked: true },
        ];
        await renderApp();
        const result = await win.__fluHandleShoppingText!({ action: 'shopping.list', handled: true, data: {} });
        expect(result).toContain('leche');
        expect(result).not.toContain('pan');
    });

    it('con lista vacia devuelve un mensaje no vacio', async () => {
        await renderApp();
        const result = await win.__fluHandleShoppingText!({ action: 'shopping.list', handled: true, data: {} });
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('elimina un articulo por etiqueta', async () => {
        H.state.shoppingItems = [{ id: 'i2', label: 'pan', checked: false }];
        await renderApp();
        const result = await win.__fluHandleShoppingText!({
            action: 'shopping.remove',
            handled: true,
            data: { label: 'pan' },
        });
        expect(H.spy.shopping.remove).toHaveBeenCalledWith('i2');
        expect(result).toContain('pan');
    });
});

describe('App - handler de notas y diario (window)', () => {
    it('crea una nota con el intent estructurado', async () => {
        await renderApp();
        const result = await win.__fluHandleNoteText!({
            action: 'note.add',
            handled: true,
            data: { label: 'Recordar negocio' },
        });
        expect(H.spy.notes.add).toHaveBeenCalledWith(expect.objectContaining({ label: 'Recordar negocio' }));
        expect(result.length).toBeGreaterThan(0);
    });

    it('ignora texto que no es una intencion de nota', async () => {
        await renderApp();
        const result = await win.__fluHandleNoteText!('hola mundo, que tal');
        expect(result).toBe('');
        expect(H.spy.notes.add).not.toHaveBeenCalled();
    });

    it('guarda una entrada de diario con el contenido dado', async () => {
        await renderApp();
        const result = await win.__fluHandleDiaryText!({
            action: 'diary.add',
            handled: true,
            data: { content: 'Hoy fue un buen dia' },
        });
        expect(H.spy.diary.addEntry).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Hoy fue un buen dia', date: expect.any(String) }),
        );
        expect(result).toContain('diario');
    });

    it('no guarda en el diario si no hay contenido', async () => {
        await renderApp();
        const result = await win.__fluHandleDiaryText!('hola');
        expect(result).toBe('');
        expect(H.spy.diary.addEntry).not.toHaveBeenCalled();
    });
});

describe('App - handlers de autoconocimiento, dispositivo y agenda', () => {
    it('responde al autoconocimiento con el manifiesto y registra auditoria', async () => {
        await renderApp();
        expect(typeof win.__fluHandleConocerFluText).toBe('function');
        const result = await win.__fluHandleConocerFluText!('que puedes hacer');
        expect(result.length).toBeGreaterThan(0);
        expect(H.spy.audit.logEvent).toHaveBeenCalled();
    });

    it('devuelve cadena vacia para un texto que no es accion de dispositivo', async () => {
        await renderApp();
        const result = await win.__fluHandleDeviceActionText!('hola que tal');
        expect(result).toBe('');
        expect(H.spy.device.execute).not.toHaveBeenCalled();
    });

    it('vaciar la agenda delega en agenda.clearAll', async () => {
        H.spy.agenda.clearAll.mockResolvedValue(0);
        await renderApp();
        const result = await win.__fluHandleAgendaCommandText!({ action: 'agenda.clear', handled: true });
        expect(H.spy.agenda.clearAll).toHaveBeenCalledTimes(1);
        expect(result.length).toBeGreaterThan(0);
    });

    it('crear un recordatorio delega en agenda.create y confirma', async () => {
        H.spy.agenda.create.mockResolvedValue({
            ok: true,
            item: { label: 'comprar leche', trigger: { type: 'absolute', at: Date.now() + 3600000 } },
        });
        await renderApp();
        const result = await win.__fluHandleAgendaCommandText!({
            action: 'agenda.create',
            handled: true,
            kind: 'recordatorio',
            label: 'comprar leche',
            trigger: { type: 'absolute', at: Date.now() + 3600000 },
        });
        expect(H.spy.agenda.create).toHaveBeenCalledTimes(1);
        expect(result).toContain('comprar leche');
    });
});
