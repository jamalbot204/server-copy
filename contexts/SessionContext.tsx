

import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import { ChatSession, ExportConfiguration, ChatMessage } from '../types.ts';
import { useChatSessions } from '../hooks/useChatSessions.ts';
import { useAppPersistence } from '../hooks/useAppPersistence.ts';
import { useSidebarActions } from '../hooks/useSidebarActions.ts';
import { useUIContext } from './UIContext.tsx';
import { DEFAULT_SETTINGS, INITIAL_MESSAGES_COUNT } from '../constants.ts';


// STATE
interface SessionStateContextType {
  chatHistory: ChatSession[];
  currentChatId: string | null;
  currentChatSession: ChatSession | null;
  visibleMessagesForCurrentChat: ChatMessage[];
  isLoadingData: boolean;
  editingTitleInfo: { id: string | null; value: string };
  messagesToDisplayConfig: Record<string, number>;
  currentExportConfig: ExportConfiguration;
  messageGenerationTimes: Record<string, number>;
}

// ACTIONS
interface SessionActionsContextType {
  setChatHistory: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setCurrentChatId: (id: string | null) => Promise<void>;
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  handleNewChat: () => void;
  handleSelectChat: (id: string) => void;
  handleDeleteChat: (id: string) => void;
  setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>;
  setCurrentExportConfig: (newConfig: ExportConfiguration) => Promise<void>;
  setMessageGenerationTimes: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>;
  handleManualSave: () => Promise<void>;
  handleStartEditChatTitle: (sessionId: string, currentTitle: string) => void;
  handleSaveChatTitle: () => Promise<void>;
  handleCancelEditChatTitle: () => void;
  handleEditTitleInputChange: (newTitle: string) => void;
  handleDuplicateChat: (sessionId: string) => Promise<void>;
  handleLoadMoreDisplayMessages: (chatId: string, count: number) => Promise<void>;
  handleLoadAllDisplayMessages: (chatId: string) => Promise<void>;
}


const SessionStateContext = createContext<SessionStateContextType | null>(null);
const SessionActionsContext = createContext<SessionActionsContextType | null>(null);


export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { showToast } = useUIContext();

  const {
    chatHistory, setChatHistory, currentChatId, setCurrentChatId: setCurrentChatIdFromHook,
    currentChatSession: rawCurrentChatSession, updateChatSession, handleNewChat: useChatSessionsHandleNewChat,
    handleSelectChat: useChatSessionsHandleSelectChat,
    handleDeleteChat: useChatSessionsHandleDeleteChat, isLoadingData,
  } = useChatSessions();

  const [loadedMsgGenTimes, setLoadedMsgGenTimes] = useState<Record<string, number>>({});
  const [loadedDisplayConfig, setLoadedDisplayConfig] = useState<Record<string, number>>({});

  const persistence = useAppPersistence(
    chatHistory, currentChatId, loadedMsgGenTimes, setLoadedMsgGenTimes,
    loadedDisplayConfig, setLoadedDisplayConfig, showToast
  );

  const sidebarActions = useSidebarActions({
    chatHistory, setChatHistory, updateChatSession, setCurrentChatId: setCurrentChatIdFromHook,
    setMessagesToDisplayConfig: persistence.setMessagesToDisplayConfig, showToast: showToast,
  });

  const handleNewChat = useCallback(async () => {
    await useChatSessionsHandleNewChat(persistence.setMessagesToDisplayConfig);
    showToast("New chat created!", "success");
  }, [useChatSessionsHandleNewChat, persistence.setMessagesToDisplayConfig, showToast]);

  const handleSelectChat = useCallback(async (id: string) => {
    await useChatSessionsHandleSelectChat(id, persistence.setMessagesToDisplayConfig);
  }, [useChatSessionsHandleSelectChat, persistence.setMessagesToDisplayConfig]);

  const handleDeleteChat = useCallback(async (id: string) => {
    await useChatSessionsHandleDeleteChat(id, persistence.setMessagesToDisplayConfig, persistence.setMessageGenerationTimes);
    showToast("Chat deleted!", "success");
  }, [useChatSessionsHandleDeleteChat, persistence, showToast]);
  
  const visibleMessagesForCurrentChat = useMemo(() => {
    if (!rawCurrentChatSession || !rawCurrentChatSession.id) return [];
    const countFromConfig = persistence.messagesToDisplayConfig[rawCurrentChatSession.id];
    const countFromSessionSettings = rawCurrentChatSession.settings?.maxInitialMessagesDisplayed;
    const countFromGlobalDefaults = DEFAULT_SETTINGS.maxInitialMessagesDisplayed;
    let numToDisplay = countFromConfig ?? countFromSessionSettings ?? countFromGlobalDefaults ?? INITIAL_MESSAGES_COUNT;
    return rawCurrentChatSession.messages.slice(-numToDisplay);
  }, [rawCurrentChatSession, persistence.messagesToDisplayConfig]);

  const handleLoadMoreDisplayMessages = useCallback(async (chatId: string, count: number) => {
    if (!rawCurrentChatSession || rawCurrentChatSession.id !== chatId) return;
    await persistence.setMessagesToDisplayConfig(prev => ({
      ...prev,
      [chatId]: Math.min((prev[chatId] || 0) + count, rawCurrentChatSession.messages.length)
    }));
  }, [rawCurrentChatSession, persistence.setMessagesToDisplayConfig]);

  const handleLoadAllDisplayMessages = useCallback(async (chatId: string) => {
    if (!rawCurrentChatSession || rawCurrentChatSession.id !== chatId) return;
    await persistence.setMessagesToDisplayConfig(prev => ({
      ...prev,
      [chatId]: rawCurrentChatSession.messages.length
    }));
  }, [rawCurrentChatSession, persistence.setMessagesToDisplayConfig]);


  const stateValue: SessionStateContextType = useMemo(() => ({
    chatHistory,
    currentChatId,
    currentChatSession: rawCurrentChatSession ?? null,
    visibleMessagesForCurrentChat,
    isLoadingData,
    editingTitleInfo: sidebarActions.editingTitleInfo,
    messagesToDisplayConfig: persistence.messagesToDisplayConfig,
    currentExportConfig: persistence.currentExportConfig,
    messageGenerationTimes: persistence.messageGenerationTimes,
  }), [
    chatHistory, currentChatId, rawCurrentChatSession, visibleMessagesForCurrentChat,
    isLoadingData, sidebarActions.editingTitleInfo, persistence.messagesToDisplayConfig,
    persistence.currentExportConfig, persistence.messageGenerationTimes
  ]);

  const actionsValue: SessionActionsContextType = useMemo(() => ({
    setChatHistory,
    setCurrentChatId: setCurrentChatIdFromHook,
    updateChatSession,
    handleNewChat,
    handleSelectChat,
    handleDeleteChat,
    setMessagesToDisplayConfig: persistence.setMessagesToDisplayConfig,
    setCurrentExportConfig: persistence.setCurrentExportConfig,
    setMessageGenerationTimes: persistence.setMessageGenerationTimes,
    handleManualSave: persistence.handleManualSave,
    handleStartEditChatTitle: sidebarActions.handleStartEditChatTitle,
    handleSaveChatTitle: sidebarActions.handleSaveChatTitle,
    handleCancelEditChatTitle: sidebarActions.handleCancelEditChatTitle,
    handleEditTitleInputChange: sidebarActions.handleEditTitleInputChange,
    handleDuplicateChat: sidebarActions.handleDuplicateChat,
    handleLoadMoreDisplayMessages,
    handleLoadAllDisplayMessages,
  }), [
    setChatHistory, setCurrentChatIdFromHook, updateChatSession, handleNewChat, handleSelectChat, handleDeleteChat,
    persistence.setMessagesToDisplayConfig, persistence.setCurrentExportConfig, persistence.setMessageGenerationTimes,
    persistence.handleManualSave, sidebarActions.handleStartEditChatTitle, sidebarActions.handleSaveChatTitle,
    sidebarActions.handleCancelEditChatTitle, sidebarActions.handleEditTitleInputChange, sidebarActions.handleDuplicateChat,
    handleLoadMoreDisplayMessages, handleLoadAllDisplayMessages
  ]);


  return (
    <SessionStateContext.Provider value={stateValue}>
        <SessionActionsContext.Provider value={actionsValue}>
            {children}
        </SessionActionsContext.Provider>
    </SessionStateContext.Provider>
  )
};

export const useSessionState = (): SessionStateContextType => {
  const context = useContext(SessionStateContext);
  if (!context) throw new Error('useSessionState must be used within a SessionProvider');
  return context;
};

export const useSessionActions = (): SessionActionsContextType => {
  const context = useContext(SessionActionsContext);
  if (!context) throw new Error('useSessionActions must be used within a SessionProvider');
  return context;
};