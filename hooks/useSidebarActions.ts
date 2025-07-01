
import { useState, useCallback } from 'react';
import { ChatSession, Attachment, AICharacter } from '../types.ts'; // Adjusted paths
import * as dbService from '../services/dbService.ts';
import { DEFAULT_SETTINGS, INITIAL_MESSAGES_COUNT } from '../constants.ts';


interface UseSidebarActionsProps {
  chatHistory: ChatSession[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatSession[]>>; // From useChatSessions
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  setCurrentChatId: (id: string | null) => Promise<void>; // From useChatSessions
  setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function useSidebarActions({
  chatHistory,
  setChatHistory,
  updateChatSession,
  setCurrentChatId,
  setMessagesToDisplayConfig,
  showToast,
}: UseSidebarActionsProps) {
  const [editingTitleInfo, setEditingTitleInfo] = useState<{ id: string | null; value: string }>({ id: null, value: '' });

  const handleStartEditChatTitle = useCallback((sessionId: string, currentTitle: string) => {
    setEditingTitleInfo({ id: sessionId, value: currentTitle });
  }, []);

  const handleSaveChatTitle = useCallback(async () => {
    if (editingTitleInfo.id && editingTitleInfo.value.trim()) {
      await updateChatSession(editingTitleInfo.id, session => session ? ({
        ...session,
        title: editingTitleInfo.value.trim(),
      }) : null);
      showToast("Chat title updated!", "success");
    }
    setEditingTitleInfo({ id: null, value: '' });
  }, [editingTitleInfo, updateChatSession, showToast]);

  const handleCancelEditChatTitle = useCallback(() => {
    setEditingTitleInfo({ id: null, value: '' });
  }, []);

  const handleEditTitleInputChange = useCallback((newTitle: string) => {
    setEditingTitleInfo(prev => ({ ...prev, value: newTitle }));
  }, []);

  const handleDuplicateChat = useCallback(async (originalSessionId: string) => {
    const originalSession = chatHistory.find(s => s.id === originalSessionId);
    if (!originalSession) {
      console.error("Original session not found for duplication");
      showToast("Failed to duplicate: Original chat not found.", "error");
      return;
    }
  
    const newSessionId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newTitle = `${originalSession.title} (Copy)`;
  
    const newMessages = originalSession.messages.map(msg => {
      const newMessageId = `msg-${Date.now()}-${msg.role}-${Math.random().toString(36).substring(2, 7)}`;
      const newAttachments: Attachment[] | undefined = msg.attachments?.map(att => ({
        ...att,
        id: `file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        uploadState: (att.fileUri && att.uploadState === 'completed_cloud_upload') ? 'completed_cloud_upload' : (att.base64Data ? 'completed' : 'idle'),
        statusMessage: (att.fileUri && att.uploadState === 'completed_cloud_upload') ? 'Cloud file (copied)' : (att.base64Data ? 'Local data (copied)' : undefined),
        progress: undefined, error: undefined, isLoading: false,
      }));
      return {
        ...msg,
        id: newMessageId,
        attachments: newAttachments,
        cachedAudioBuffers: null,
        exportedMessageAudioBase64: undefined,
        timestamp: new Date(msg.timestamp),
      };
    });
  
    const newAiCharacters: AICharacter[] | undefined = originalSession.aiCharacters?.map(char => ({
      ...char,
      id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    }));
  
    const duplicatedSession: ChatSession = {
      ...originalSession,
      id: newSessionId,
      title: newTitle,
      messages: newMessages,
      aiCharacters: newAiCharacters,
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
      apiRequestLogs: [],
    };
  
    setChatHistory(prev => [duplicatedSession, ...prev].sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime()));
    await dbService.addOrUpdateChatSession(duplicatedSession);
    
    await setCurrentChatId(newSessionId);
    const maxInitialForNewChat = duplicatedSession.settings.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
    await setMessagesToDisplayConfig(prev => ({
      ...prev,
      [newSessionId]: Math.min(duplicatedSession.messages.length, maxInitialForNewChat)
    }));
  
    showToast("Chat duplicated successfully!", "success");
  }, [chatHistory, setChatHistory, setCurrentChatId, setMessagesToDisplayConfig, showToast]);

  return {
    editingTitleInfo,
    handleStartEditChatTitle,
    handleSaveChatTitle,
    handleCancelEditChatTitle,
    handleEditTitleInputChange,
    handleDuplicateChat,
  };
}