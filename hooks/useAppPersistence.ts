

import { useState, useEffect, useCallback, useRef } from 'react';
import { ExportConfiguration, ChatSession } from '../types.ts'; // Added ChatSession
import * as dbService from '../services/dbService.ts';
import { METADATA_KEYS } from '../services/dbService.ts';
import { DEFAULT_EXPORT_CONFIGURATION, INITIAL_MESSAGES_COUNT, DEFAULT_SETTINGS } from '../constants.ts';

export function useAppPersistence(
    chatHistory: ChatSession[],
    currentChatId: string | null,
    // These are passed in to be saved, but their state management might live elsewhere (e.g., useGemini)
    // The hook itself will load them initially and provide a way to update them in DB.
    loadedMessageGenerationTimes: Record<string, number>, 
    setLoadedMessageGenerationTimes: (times: Record<string, number>) => void,
    loadedMessagesToDisplayConfig: Record<string, number>,
    setLoadedMessagesToDisplayConfig: (config: Record<string, number>) => void,
    showToast: (message: string, type?: 'success' | 'error') => void
) {
  const [messagesToDisplayConfig, setMessagesToDisplayConfigInternal] = useState<Record<string, number>>(loadedMessagesToDisplayConfig);
  const [currentExportConfig, setCurrentExportConfigInternal] = useState<ExportConfiguration>(DEFAULT_EXPORT_CONFIGURATION);
  const [messageGenerationTimes, setMessageGenerationTimesInternal] = useState<Record<string, number>>(loadedMessageGenerationTimes);
  
  const prevChatIdForAutoSaveRef = useRef<string | null>(null);

  // Load initial data from DB
  useEffect(() => {
    const loadInitialPersistenceData = async () => {
        try {
            const storedConfig = await dbService.getAppMetadata<Record<string, number>>(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG);
            if (storedConfig) {
                setMessagesToDisplayConfigInternal(storedConfig);
                setLoadedMessagesToDisplayConfig(storedConfig); // Update parent state
            } else if (chatHistory.length > 0) { // Initialize if not in DB and chatHistory is available
                const initialConfig: Record<string, number> = {};
                chatHistory.forEach(session => {
                    const maxInitial = session.settings?.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
                    initialConfig[session.id] = Math.min(session.messages.length, maxInitial);
                });
                setMessagesToDisplayConfigInternal(initialConfig);
                setLoadedMessagesToDisplayConfig(initialConfig);
                if (Object.keys(initialConfig).length > 0) {
                    await dbService.setAppMetadata(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG, initialConfig);
                }
            }

            const storedExportConfig = await dbService.getAppMetadata<ExportConfiguration>(METADATA_KEYS.EXPORT_CONFIGURATION);
            setCurrentExportConfigInternal(storedExportConfig || DEFAULT_EXPORT_CONFIGURATION);
            
            const storedGenTimes = await dbService.getAppMetadata<Record<string, number>>(METADATA_KEYS.MESSAGE_GENERATION_TIMES);
            if (storedGenTimes) {
                setMessageGenerationTimesInternal(storedGenTimes);
                setLoadedMessageGenerationTimes(storedGenTimes); // Update parent state
            }

        } catch (error) {
            console.error("Failed to load persisted app data:", error);
        }
    };
    loadInitialPersistenceData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount. ChatHistory as dep here could cause issues if it loads after.

  const setMessagesToDisplayConfig = useCallback(async (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    let newConfig: Record<string, number>;
    if (typeof updater === 'function') {
      setMessagesToDisplayConfigInternal(prev => {
        newConfig = updater(prev);
        dbService.setAppMetadata(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG, newConfig).catch(console.error);
        setLoadedMessagesToDisplayConfig(newConfig); // Update parent state
        return newConfig;
      });
    } else {
      newConfig = updater;
      setMessagesToDisplayConfigInternal(newConfig);
      await dbService.setAppMetadata(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG, newConfig);
      setLoadedMessagesToDisplayConfig(newConfig); // Update parent state
    }
  }, [setLoadedMessagesToDisplayConfig]);

  const setCurrentExportConfig = useCallback(async (newConfig: ExportConfiguration) => {
    setCurrentExportConfigInternal(newConfig);
    await dbService.setAppMetadata(METADATA_KEYS.EXPORT_CONFIGURATION, newConfig);
  }, []);

  const setMessageGenerationTimes = useCallback(async (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    let newTimes: Record<string, number>;
    if (typeof updater === 'function') {
        setMessageGenerationTimesInternal(prev => {
            newTimes = updater(prev);
            dbService.setAppMetadata(METADATA_KEYS.MESSAGE_GENERATION_TIMES, newTimes).catch(console.error);
            setLoadedMessageGenerationTimes(newTimes);
            return newTimes;
        });
    } else {
        newTimes = updater;
        setMessageGenerationTimesInternal(newTimes);
        await dbService.setAppMetadata(METADATA_KEYS.MESSAGE_GENERATION_TIMES, newTimes);
        setLoadedMessageGenerationTimes(newTimes);
    }
  }, [setLoadedMessageGenerationTimes]);

  const handleManualSave = useCallback(async () => {
    try {
      for (const session of chatHistory) {
        await dbService.addOrUpdateChatSession(session);
      }
      if (currentChatId) {
        await dbService.setAppMetadata(METADATA_KEYS.ACTIVE_CHAT_ID, currentChatId);
      }
      // messageGenerationTimes is now managed internally by this hook for DB persistence
      await dbService.setAppMetadata(METADATA_KEYS.MESSAGE_GENERATION_TIMES, messageGenerationTimes);
      // messagesToDisplayConfig is also managed internally by this hook for DB persistence
      await dbService.setAppMetadata(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG, messagesToDisplayConfig);
      await dbService.setAppMetadata(METADATA_KEYS.EXPORT_CONFIGURATION, currentExportConfig);
      
      // showToast("App state saved!", "success"); // Toast is often handled by UI for manual save button
    } catch (error) {
      console.error("Save operation failed:", error);
      showToast("Failed to save app state.", "error");
    }
  }, [chatHistory, currentChatId, messageGenerationTimes, messagesToDisplayConfig, currentExportConfig, showToast]);

  // Auto-save logic
  useEffect(() => {
    if (currentChatId && chatHistory.find(s => s.id === currentChatId)) { // Ensure currentChatSession exists in history
      if (prevChatIdForAutoSaveRef.current === currentChatId) {
        handleManualSave().catch(error => {
          console.error('Auto-save failed:', error);
        });
      }
    }
    prevChatIdForAutoSaveRef.current = currentChatId;
  }, [currentChatId, handleManualSave, chatHistory]);

  return {
    messagesToDisplayConfig,
    setMessagesToDisplayConfig,
    currentExportConfig,
    setCurrentExportConfig,
    messageGenerationTimes, // Expose for other hooks to use if needed (e.g., useGemini)
    setMessageGenerationTimes, // Expose setter for useGemini
    handleManualSave,
  };
}