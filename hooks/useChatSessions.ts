
import { useState, useEffect, useCallback } from 'react';
import { ChatSession, GeminiSettings, UserDefinedDefaults } from '../types.ts';
import * as dbService from '../services/dbService.ts';
import { METADATA_KEYS } from '../services/dbService.ts'; // Corrected import
import { DEFAULT_MODEL_ID, DEFAULT_SETTINGS, INITIAL_MESSAGES_COUNT, DEFAULT_SAFETY_SETTINGS, DEFAULT_TTS_SETTINGS } from '../constants.ts';

export function useChatSessions() {
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatIdInternal] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const currentChatSession = useCallback(() => {
    return chatHistory.find(session => session.id === currentChatId);
  }, [chatHistory, currentChatId]);

  const setCurrentChatId = async (id: string | null) => {
    setCurrentChatIdInternal(id);
    await dbService.setAppMetadata(METADATA_KEYS.ACTIVE_CHAT_ID, id);
  };

  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoadingData(true);
      try {
        const sessions = await dbService.getAllChatSessions();
        const activeChatId = await dbService.getAppMetadata<string | null>(METADATA_KEYS.ACTIVE_CHAT_ID);
        
        const loadedSessions = sessions || [];
        setChatHistory(loadedSessions.map(s => ({
            ...s, 
            apiRequestLogs: s.apiRequestLogs || [],
            settings: {
                ...DEFAULT_SETTINGS, // Ensure all default fields are present
                ...s.settings,      // Override with stored settings
                ttsSettings: s.settings?.ttsSettings || { ...DEFAULT_TTS_SETTINGS } // Ensure TTS settings
            }
        })));

        if (loadedSessions.length > 0) {
          const validActiveChatId = activeChatId && loadedSessions.find(s => s.id === activeChatId) ? activeChatId : loadedSessions[0].id;
          setCurrentChatIdInternal(validActiveChatId);
        } else {
          setCurrentChatIdInternal(null);
        }
      } catch (error) {
        console.error("Failed to load initial chat data from IndexedDB:", error);
        setChatHistory([]);
        setCurrentChatIdInternal(null);
      } finally {
        setIsLoadingData(false);
      }
    };
    loadInitialData();
  }, []);

  const updateChatSession = useCallback(async (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => {
    let updatedSessionGlobal: ChatSession | null = null;
    setChatHistory(prevHistory => {
        const newHistory = prevHistory.map(session => {
            if (session.id === sessionId) {
                const updatedSessionCandidate = updater(session);
                if (updatedSessionCandidate === null) return session; // No update if updater returns null
                // Ensure lastUpdatedAt is always refreshed on any meaningful update
                updatedSessionGlobal = { ...updatedSessionCandidate, lastUpdatedAt: new Date() };
                return updatedSessionGlobal;
            }
            return session;
        });
        if (updatedSessionGlobal) { // Only update if there was an actual change
             // Ensure correct sorting by lastUpdatedAt after an update
            return newHistory.sort((a,b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
        }
        return prevHistory; // Return original if no update
    });

    if (updatedSessionGlobal) {
        // console.log(`[useChatSessions] Saving updated session ${sessionId} to IndexedDB at ${updatedSessionGlobal.lastUpdatedAt.toISOString()}`);
        await dbService.addOrUpdateChatSession(updatedSessionGlobal);
    }
  }, []);

  const handleNewChat = useCallback(async (
    setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>
  ) => {
    const newSessionId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    let initialModel = DEFAULT_MODEL_ID;
    let initialSettings: GeminiSettings = {
        ...DEFAULT_SETTINGS,
        safetySettings: [...DEFAULT_SAFETY_SETTINGS],
        ttsSettings: { ...DEFAULT_TTS_SETTINGS }, // Ensure TTS settings are initialized
        maxInitialMessagesDisplayed: DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT,
    };

    try {
        const storedUserDefaults = await dbService.getAppMetadata<UserDefinedDefaults>(METADATA_KEYS.USER_DEFINED_GLOBAL_DEFAULTS);
        if (storedUserDefaults) {
            initialModel = storedUserDefaults.model || DEFAULT_MODEL_ID;
            initialSettings = {
                ...DEFAULT_SETTINGS, // Start with base defaults
                ...storedUserDefaults.settings, // Apply stored defaults
                safetySettings: storedUserDefaults.settings?.safetySettings && storedUserDefaults.settings.safetySettings.length > 0 
                                ? [...storedUserDefaults.settings.safetySettings] // Deep copy safety settings
                                : [...DEFAULT_SAFETY_SETTINGS], // Fallback to default safety settings
                ttsSettings: storedUserDefaults.settings?.ttsSettings || { ...DEFAULT_TTS_SETTINGS }, // Apply stored or default TTS
                maxInitialMessagesDisplayed: storedUserDefaults.settings?.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT,
            };
        }
    } catch (e) {
        console.error("Failed to parse user-defined global defaults from IndexedDB", e);
        // Defaults are already set, so just log and continue
    }

    const newSession: ChatSession = {
      id: newSessionId,
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      model: initialModel,
      settings: initialSettings,
      isCharacterModeActive: false, 
      aiCharacters: [],      
      apiRequestLogs: [],
    };

    setChatHistory(prev => [newSession, ...prev].sort((a,b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime()));
    // console.log(`[useChatSessions] Saving new session ${newSessionId} to IndexedDB.`);
    await dbService.addOrUpdateChatSession(newSession);
    await setCurrentChatId(newSession.id);
    
    const maxInitialForNewChat = newSession.settings.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
    await setMessagesToDisplayConfig(prev => ({
        ...prev, 
        [newSessionId]: Math.min(newSession.messages.length, maxInitialForNewChat) 
    }));
  }, [setCurrentChatId]); // Removed setChatHistory as it's directly used with functional update

  const handleSelectChat = useCallback(async (
    id: string,
    setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>
   ) => {
    await setCurrentChatId(id);
    // The chatHistory dependency here might cause re-runs if chatHistory updates frequently.
    // Consider if this logic can be moved or if the dependency is acceptable.
    const selectedChat = chatHistory.find(c => c.id === id); 
    if (selectedChat) {
        const maxInitial = selectedChat.settings.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
        await setMessagesToDisplayConfig(prev => ({
            ...prev,
            [id]: Math.min(selectedChat.messages.length, maxInitial)
        }));
    }
  }, [chatHistory, setCurrentChatId]);

  const handleDeleteChat = useCallback(async (
    id: string,
    setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>,
    setMessageGenerationTimes: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>
  ) => {
    const chatToDelete = chatHistory.find(s => s.id === id); 
    setChatHistory(prev => prev.filter(session => session.id !== id));
    // console.log(`[useChatSessions] Deleting session ${id} from IndexedDB.`);
    await dbService.deleteChatSession(id);

    await setMessagesToDisplayConfig(prev => {
        const newConfig = {...prev};
        delete newConfig[id];
        return newConfig;
    });
    if (chatToDelete) { 
        await setMessageGenerationTimes(prevTimes => {
            const newTimesState = {...prevTimes};
            chatToDelete.messages.forEach(msg => delete newTimesState[msg.id]);
            return newTimesState;
        });
    }

    if (currentChatId === id) {
      // Use functional update for setChatHistory to get the latest state
      setChatHistory(currentHistory => { 
        const sortedRemaining = [...currentHistory].sort((a,b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
        setCurrentChatId(currentHistory.length > 0 ? sortedRemaining[0].id : null);
        // Important: return the currentHistory itself, not sortedRemaining, if setCurrentChatId depends on it.
        // Or, ensure setCurrentChatId logic is independent of the exact instance of chatHistory if sorting happens before.
        return currentHistory; 
      })
    }
  }, [chatHistory, currentChatId, setCurrentChatId]); // Removed setChatHistory


  return {
    chatHistory,
    setChatHistory, // Expose for import/export
    currentChatId,
    setCurrentChatId, // Expose the internal setter directly
    currentChatSession: currentChatSession(),
    updateChatSession,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    isLoadingData,
  };
}