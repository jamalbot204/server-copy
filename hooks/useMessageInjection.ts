
import { useCallback } from 'react';
import { ChatSession, ChatMessage, ChatMessageRole } from '../types.ts';
import { DEFAULT_SETTINGS, INITIAL_MESSAGES_COUNT } from '../constants.ts';

interface UseMessageInjectionProps {
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>;
  messagesToDisplayConfig: Record<string, number>; 
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function useMessageInjection({
  updateChatSession,
  setMessagesToDisplayConfig,
  messagesToDisplayConfig, 
  showToast,
}: UseMessageInjectionProps) {

  const handleInsertEmptyMessageAfter = useCallback(async (
    sessionId: string,
    afterMessageId: string,
    roleToInsert: ChatMessageRole.USER | ChatMessageRole.MODEL // Only allow User or Model for empty injection
  ) => {
    let success = false;

    await updateChatSession(sessionId, session => {
      if (!session) {
        return null;
      }

      const afterMessageIndex = session.messages.findIndex(m => m.id === afterMessageId);
      if (afterMessageIndex === -1) {
        console.error("[MessageInjection] Message to insert after not found:", afterMessageId, "in messages:", session.messages.map(m=>m.id));
        showToast("Error: Original message not found for injection.", "error");
        return session; 
      }

      const newEmptyMessage: ChatMessage = {
        id: `msg-${Date.now()}-empty-${Math.random().toString(36).substring(2, 9)}`,
        role: roleToInsert,
        content: "", 
        timestamp: new Date(),
        attachments: [], 
        isStreaming: false,
        cachedAudioBuffers: null,
        characterName: roleToInsert === ChatMessageRole.MODEL && session.isCharacterModeActive && session.aiCharacters && session.aiCharacters.length > 0
                       ? session.aiCharacters[0].name 
                       : undefined,
      };

      const newMessages = [
        ...session.messages.slice(0, afterMessageIndex + 1),
        newEmptyMessage,
        ...session.messages.slice(afterMessageIndex + 1),
      ];
      
      const maxInitial = session.settings?.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
      
      const currentDisplayCount = session.messages.length === newMessages.length -1 ?
                                  (messagesToDisplayConfig[sessionId] || Math.min(session.messages.length, maxInitial))
                                  : Math.min(session.messages.length, maxInitial);

      const newDisplayCount = Math.min(newMessages.length, currentDisplayCount + 1);

      setMessagesToDisplayConfig(prev => {
        return { ...prev, [sessionId]: newDisplayCount };
      }).catch(e => console.error("[MessageInjection] Error setting display config:", e));
      
      success = true; 
      return { ...session, messages: newMessages, lastUpdatedAt: new Date() };
    });

    if (success) {
      showToast("Empty message inserted.", "success");
    }

  }, [updateChatSession, setMessagesToDisplayConfig, messagesToDisplayConfig, showToast]);

  return {
    handleInsertEmptyMessageAfter,
  };
}