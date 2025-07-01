import React, { createContext, useContext, ReactNode } from 'react';
import { UseAutoSendReturn, ChatMessage, Attachment } from '../types.ts';
import { useAutoSend } from '../hooks/useAutoSend.ts';
import { useSessionState } from './SessionContext.tsx';

// The state provided by the context
interface InteractionStatusContextType {
  isLoading: boolean;
  currentGenerationTimeDisplay: string;
  autoSendHook: UseAutoSendReturn;
}

const InteractionStatusContext = createContext<InteractionStatusContextType | null>(null);

// Props for the provider component
interface InteractionStatusProviderProps {
  children: ReactNode;
  isLoading: boolean; // From useGemini
  currentGenerationTimeDisplay: string; // From useGemini
  sendMessageToGemini: (
    promptContent: string,
    attachments?: Attachment[],
    historyContextOverride?: ChatMessage[],
    characterIdForAPICall?: string,
    isTemporaryContext?: boolean
  ) => Promise<void>; // From useGemini
  cancelGeminiGeneration: () => Promise<void>; // From useGemini
  handleRegenerateResponseForUserMessage: (sessionId: string, userMessageId: string) => Promise<void>; // From useGemini
}

export const InteractionStatusProvider: React.FC<InteractionStatusProviderProps> = ({
  children,
  isLoading,
  currentGenerationTimeDisplay,
  sendMessageToGemini,
  cancelGeminiGeneration,
  handleRegenerateResponseForUserMessage,
}) => {
  const { currentChatSession } = useSessionState();

  const autoSendHook = useAutoSend({
    currentChatSession,
    isLoadingFromGemini: isLoading,
    sendMessageToGemini,
    cancelGeminiGeneration,
    handleRegenerateResponseForUserMessage,
  });

  const value = {
    isLoading,
    currentGenerationTimeDisplay,
    autoSendHook,
  };

  return (
    <InteractionStatusContext.Provider value={value}>
      {children}
    </InteractionStatusContext.Provider>
  );
};

// Custom hook for consuming the context
export const useInteractionStatus = (): InteractionStatusContextType => {
  const context = useContext(InteractionStatusContext);
  if (!context) {
    throw new Error('useInteractionStatus must be used within an InteractionStatusProvider');
  }
  return context;
};
