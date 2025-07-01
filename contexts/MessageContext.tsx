
import React, { createContext, useContext, useCallback, ReactNode, useMemo, useRef } from 'react';
import { ChatMessage, Attachment, AICharacter, ExportConfiguration, LogApiRequestCallback, ChatMessageRole, ApiRequestLog } from '../types.ts';
import { useAiCharacters } from '../hooks/useAiCharacters.ts';
import { useGemini } from '../hooks/useGemini.ts';
import { useImportExport } from '../hooks/useImportExport.ts';
import { useChatInteractions } from '../hooks/useChatInteractions.ts';
import { useUIContext } from './UIContext.tsx';
import { EditMessagePanelAction, EditMessagePanelDetails } from '../components/EditMessagePanel.tsx';
import { useMessageInjection } from '../hooks/useMessageInjection.ts';
import { useApiKeyContext } from './ApiKeyContext.tsx';
import { useSessionState, useSessionActions } from './SessionContext.tsx';
import { InteractionStatusProvider } from './InteractionStatusContext.tsx';

// Combined type for the new context
interface MessageContextType {
  logApiRequest: LogApiRequestCallback;
  handleSendMessage: (promptContent: string, attachments?: Attachment[], historyContextOverride?: ChatMessage[], characterIdForAPICall?: string, isTemporaryContext?: boolean) => Promise<void>;
  handleContinueFlow: () => Promise<void>;
  handleCancelGeneration: () => Promise<void>;
  handleRegenerateAIMessage: (sessionId: string, aiMessageIdToRegenerate: string) => Promise<void>;
  handleRegenerateResponseForUserMessage: (sessionId: string, userMessageId: string) => Promise<void>;
  handleEditPanelSubmit: (action: EditMessagePanelAction, newContent: string, details: EditMessagePanelDetails) => Promise<void>;
  handleToggleCharacterMode: () => Promise<void>;
  handleAddCharacter: (name: string, systemInstruction: string) => Promise<void>;
  handleEditCharacter: (id: string, name: string, systemInstruction: string) => Promise<void>;
  handleDeleteCharacter: (id: string) => Promise<void>;
  handleReorderCharacters: (newCharacters: AICharacter[]) => Promise<void>;
  handleSaveCharacterContextualInfo: (characterId: string, newInfo: string) => Promise<void>;
  handleExportChats: (chatIdsToExport: string[], exportConfig: ExportConfiguration) => Promise<void>;
  handleImportAll: () => Promise<void>;
  handleActualCopyMessage: (content: string) => Promise<boolean>;
  handleDeleteMessageAndSubsequent: (sessionId: string, messageId: string) => Promise<void>;
  handleDeleteSingleMessageOnly: (sessionId: string, messageId: string) => void;
  handleClearApiLogs: (sessionId: string) => Promise<void>;
  handleClearChatCacheForCurrentSession: () => void;
  handleReUploadAttachment: (sessionId: string, messageId: string, attachmentId: string) => Promise<void>;
  triggerAutoPlayForNewMessage: (callback: (newAiMessage: ChatMessage) => Promise<void>) => void;
  performActualAudioCacheReset: (sessionId: string, messageId: string) => Promise<void>;
  handleInsertEmptyMessageAfter: (sessionId: string, afterMessageId: string, roleToInsert: ChatMessageRole.USER | ChatMessageRole.MODEL) => Promise<void>;
  handleDeleteMultipleMessages: (messageIds: string[]) => Promise<void>;
}

const MessageContext = createContext<MessageContextType | null>(null);

export const MessageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const ui = useUIContext();
  const { activeApiKey, rotateActiveKey } = useApiKeyContext();
  const {
    updateChatSession,
    setMessageGenerationTimes,
    setMessagesToDisplayConfig,
    setChatHistory,
    setCurrentChatId,
  } = useSessionActions();
  const sessionState = useSessionState();


  const triggerAutoPlayCallbackRef = useRef<(newAiMessage: ChatMessage) => Promise<void>>(() => Promise.resolve());

  const gemini = useGemini({
    apiKey: activeApiKey?.value || '',
    currentChatSession: sessionState.currentChatSession,
    updateChatSession,
    logApiRequestDirectly: (logDetails) => {
      if (sessionState.currentChatSession && sessionState.currentChatSession.settings.debugApiRequests) {
        const newLogEntry: ApiRequestLog = { ...logDetails, id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`, timestamp: new Date() };
        updateChatSession(sessionState.currentChatSession.id, session => session ? ({ ...session, apiRequestLogs: [...(session.apiRequestLogs || []), newLogEntry] }) : null);
      }
    },
    onNewAIMessageFinalized: async (newAiMessage) => {
      await triggerAutoPlayCallbackRef.current(newAiMessage);
    },
    setMessageGenerationTimes: setMessageGenerationTimes,
    rotateApiKey: rotateActiveKey,
  });

  const chatInteractions = useChatInteractions({
    apiKey: activeApiKey?.value || '',
    currentChatSession: sessionState.currentChatSession, updateChatSession, showToast: ui.showToast,
    openEditPanel: ui.openEditPanel, closeEditPanel: ui.closeEditPanel,
    geminiHandleEditPanelSubmit: gemini.handleEditPanelSubmit,
    geminiHandleCancelGeneration: gemini.handleCancelGeneration,
    isLoadingFromGemini: gemini.isLoading,
    setMessageGenerationTimes: setMessageGenerationTimes,
    setMessagesToDisplayConfig: setMessagesToDisplayConfig,
    stopAndCancelAudio: () => {},
    activeAutoFetches: new Map(), setActiveAutoFetches: () => {},
    requestDeleteConfirmationModal: ui.requestDeleteConfirmation,
    requestResetAudioCacheConfirmationModal: ui.requestResetAudioCacheConfirmation,
    isSettingsPanelOpen: ui.isSettingsPanelOpen,
    closeSettingsPanel: ui.closeSettingsPanel,
    closeSidebar: ui.closeSidebar,
    logApiRequest: gemini.logApiRequest,
  });

  const aiCharacters = useAiCharacters(sessionState.currentChatSession, updateChatSession);

  const importExport = useImportExport(
    setChatHistory, setCurrentChatId, setMessageGenerationTimes,
    setMessagesToDisplayConfig, ui.showToast, sessionState.chatHistory
  );

  const messageInjection = useMessageInjection({
    updateChatSession,
    setMessagesToDisplayConfig: setMessagesToDisplayConfig,
    messagesToDisplayConfig: sessionState.messagesToDisplayConfig,
    showToast: ui.showToast,
  });

  const handleAddCharacter = async (name: string, systemInstruction: string) => {
    await aiCharacters.handleAddCharacter(name, systemInstruction);
    ui.showToast("Character added!", "success");
  };

  const handleEditCharacter = async (id: string, name: string, systemInstruction: string) => {
    await aiCharacters.handleEditCharacter(id, name, systemInstruction);
    ui.showToast("Character updated!", "success");
  };

  const handleDeleteCharacter = async (id: string) => {
    await aiCharacters.handleDeleteCharacter(id);
    ui.showToast("Character deleted!", "success");
  };

  const performActualAudioCacheReset = useCallback(async (sessionId: string, messageId: string) => {
    await updateChatSession(sessionId, session => {
      if (!session) return null;
      const messageIndex = session.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return session;

      const updatedMessages = [...session.messages];
      updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], cachedAudioBuffers: null };
      return { ...session, messages: updatedMessages };
    });
    ui.showToast("Audio cache reset for message.", "success");
  }, [updateChatSession, ui.showToast]);

  const handleDeleteMultipleMessages = useCallback(async (messageIds: string[]) => {
    if (!sessionState.currentChatSession || messageIds.length === 0) return;
    await updateChatSession(sessionState.currentChatSession.id, session => {
      if (!session) return null;
      const idSet = new Set(messageIds);
      const newMessages = session.messages.filter(m => !idSet.has(m.id));
      setMessageGenerationTimes(prevTimes => {
        const newTimesState = { ...prevTimes };
        messageIds.forEach(id => delete newTimesState[id]);
        return newTimesState;
      }).catch(console.error);
      return { ...session, messages: newMessages };
    });
    ui.showToast(`${messageIds.length} message(s) deleted.`, "success");
    ui.toggleSelectionMode();
  }, [sessionState.currentChatSession, updateChatSession, setMessageGenerationTimes, ui]);

  const contextValue = useMemo<MessageContextType>(() => ({
    logApiRequest: gemini.logApiRequest,
    handleSendMessage: gemini.handleSendMessage,
    handleContinueFlow: gemini.handleContinueFlow,
    handleCancelGeneration: gemini.handleCancelGeneration,
    handleRegenerateAIMessage: gemini.handleRegenerateAIMessage,
    handleRegenerateResponseForUserMessage: gemini.handleRegenerateResponseForUserMessage,
    handleEditPanelSubmit: chatInteractions.handleEditPanelSubmitWrapper,
    handleToggleCharacterMode: aiCharacters.handleToggleCharacterMode,
    handleAddCharacter, handleEditCharacter, handleDeleteCharacter,
    handleReorderCharacters: aiCharacters.handleReorderCharacters,
    handleSaveCharacterContextualInfo: aiCharacters.handleSaveCharacterContextualInfo,
    handleExportChats: importExport.handleExportChats,
    handleImportAll: importExport.handleImportAll,
    handleActualCopyMessage: chatInteractions.handleActualCopyMessage,
    handleDeleteMessageAndSubsequent: chatInteractions.handleDeleteMessageAndSubsequent,
    handleDeleteSingleMessageOnly: chatInteractions.handleDeleteSingleMessageOnly,
    handleClearApiLogs: chatInteractions.handleClearApiLogs,
    handleClearChatCacheForCurrentSession: chatInteractions.handleClearChatCacheForCurrentSession,
    handleReUploadAttachment: chatInteractions.handleReUploadAttachment,
    triggerAutoPlayForNewMessage: (callback) => { triggerAutoPlayCallbackRef.current = callback; (callback as any)._placeholder = false; },
    performActualAudioCacheReset,
    handleInsertEmptyMessageAfter: messageInjection.handleInsertEmptyMessageAfter,
    handleDeleteMultipleMessages,
  }), [
    gemini.logApiRequest, gemini.handleSendMessage, gemini.handleContinueFlow, gemini.handleCancelGeneration,
    gemini.handleRegenerateAIMessage, gemini.handleRegenerateResponseForUserMessage,
    chatInteractions.handleEditPanelSubmitWrapper, aiCharacters.handleToggleCharacterMode,
    handleAddCharacter, handleEditCharacter, handleDeleteCharacter, aiCharacters.handleReorderCharacters,
    aiCharacters.handleSaveCharacterContextualInfo, importExport.handleExportChats,
    importExport.handleImportAll, chatInteractions.handleActualCopyMessage,
    chatInteractions.handleDeleteMessageAndSubsequent, chatInteractions.handleDeleteSingleMessageOnly,
    chatInteractions.handleClearApiLogs, chatInteractions.handleClearChatCacheForCurrentSession,
    chatInteractions.handleReUploadAttachment, performActualAudioCacheReset,
    messageInjection.handleInsertEmptyMessageAfter, handleDeleteMultipleMessages
  ]);

  (contextValue.triggerAutoPlayForNewMessage as any)._placeholder = true;

  return (
    <MessageContext.Provider value={contextValue}>
      <InteractionStatusProvider
        isLoading={gemini.isLoading}
        currentGenerationTimeDisplay={gemini.currentGenerationTimeDisplay}
        sendMessageToGemini={gemini.handleSendMessage}
        cancelGeminiGeneration={gemini.handleCancelGeneration}
        handleRegenerateResponseForUserMessage={gemini.handleRegenerateResponseForUserMessage}
      >
        {children}
      </InteractionStatusProvider>
    </MessageContext.Provider>
  );
};

export const useMessageContext = (): MessageContextType => {
  const context = useContext(MessageContext);
  if (!context) throw new Error('useMessageContext must be used within a MessageProvider');
  return context;
};