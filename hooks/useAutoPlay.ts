

import { useCallback, useEffect, useRef } from 'react';
import { ChatMessage, ChatMessageRole, ChatSession } from '../types.ts';

interface UseAutoPlayOptions {
  currentChatSession: ChatSession | null;
  playFunction: (fullText: string, baseMessageId: string, partIndex?: number) => Promise<void>;
}

export function useAutoPlay({ currentChatSession, playFunction }: UseAutoPlayOptions) {
  const processedNewMessagesRef = useRef<Set<string>>(new Set());
  const autoPlayTimeoutRef = useRef<number | null>(null);
  const playFunctionRef = useRef(playFunction);

  useEffect(() => {
    playFunctionRef.current = playFunction;
  }, [playFunction]);

  useEffect(() => {
    processedNewMessagesRef.current.clear();
    if (autoPlayTimeoutRef.current) {
      clearTimeout(autoPlayTimeoutRef.current);
      autoPlayTimeoutRef.current = null;
    }
    return () => {
      if (autoPlayTimeoutRef.current) {
        clearTimeout(autoPlayTimeoutRef.current);
      }
    };
  }, [currentChatSession?.id]);

  const triggerAutoPlayForNewMessage = useCallback(async (newAiMessage: ChatMessage) => {
    const autoPlayIsEnabled = currentChatSession?.settings?.ttsSettings?.autoPlayNewMessages ?? false;

    if (
      !currentChatSession ||
      !autoPlayIsEnabled ||
      newAiMessage.role !== ChatMessageRole.MODEL ||
      newAiMessage.isStreaming || 
      processedNewMessagesRef.current.has(newAiMessage.id)
    ) {
      return;
    }

    processedNewMessagesRef.current.add(newAiMessage.id);


    if (autoPlayTimeoutRef.current) {
      clearTimeout(autoPlayTimeoutRef.current);
    }

    autoPlayTimeoutRef.current = window.setTimeout(async () => {
      try {
        await playFunctionRef.current(newAiMessage.content, newAiMessage.id, undefined);
      } catch (error) {
        console.error(`[AutoPlay] Error trying to auto-play message ${newAiMessage.id}:`, error);
      } finally {
        autoPlayTimeoutRef.current = null;
      }
    }, 750); 
  }, [currentChatSession]);

  return {
    triggerAutoPlayForNewMessage,
  };
}