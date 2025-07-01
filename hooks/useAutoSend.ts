

import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatSession, ChatMessage, Attachment, ChatMessageRole, UseAutoSendReturn } from '../types.ts';

export interface UseAutoSendProps {
  currentChatSession: ChatSession | null;
  isLoadingFromGemini: boolean;
  sendMessageToGemini: (
    promptContent: string,
    attachments?: Attachment[],
    historyContextOverride?: ChatMessage[],
    characterIdForAPICall?: string,
    isTemporaryContext?: boolean
  ) => Promise<void>;
  cancelGeminiGeneration: () => Promise<void>;
  handleRegenerateResponseForUserMessage: (sessionId: string, userMessageId: string) => Promise<void>; // Added for error retry
}

export function useAutoSend({
  currentChatSession,
  isLoadingFromGemini,
  sendMessageToGemini,
  cancelGeminiGeneration,
  handleRegenerateResponseForUserMessage, // Destructure new prop
}: UseAutoSendProps): UseAutoSendReturn {
  const [isAutoSendingActive, setIsAutoSendingActive] = useState(false);
  const [autoSendTextInternal, setAutoSendTextInternal] = useState('');
  const [autoSendRepetitionsInput, setAutoSendRepetitionsInput] = useState('1');
  const [autoSendRemaining, setAutoSendRemaining] = useState(0);
  const [autoSendTargetCharacterId, setAutoSendTargetCharacterId] = useState<string | undefined>(undefined);
  const [userVisibleAutoSendText, setUserVisibleAutoSendText] = useState('');

  const [isWaitingForErrorRetry, setIsWaitingForErrorRetry] = useState(false);
  const [errorRetryCountdown, setErrorRetryCountdown] = useState(0);
  const [errorRetryMessageDetails, setErrorRetryMessageDetails] = useState<{ userMessageIdToRegenerateFor: string } | null>(null);
  
  const sendLoopActiveRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const delayTimeoutRef = useRef<number | null>(null);
  const errorRetryIntervalRef = useRef<number | null>(null);
  const [waitingForDelay, setWaitingForDelay] = useState(false);
  const initialRepetitionsRef = useRef(0);


  const canStartAutoSend = useCallback((text: string, repetitionsInput: string) => {
    return !!currentChatSession && text.trim() !== '' && parseInt(repetitionsInput, 10) > 0;
  }, [currentChatSession]);

  const isPreparingAutoSend = userVisibleAutoSendText.trim() !== '' && parseInt(autoSendRepetitionsInput, 10) > 0 && !isAutoSendingActive;

  const resetErrorRetryStates = () => {
    setIsWaitingForErrorRetry(false);
    setErrorRetryCountdown(0);
    setErrorRetryMessageDetails(null);
    if (errorRetryIntervalRef.current) {
      clearInterval(errorRetryIntervalRef.current);
      errorRetryIntervalRef.current = null;
    }
  };

  const startAutoSend = useCallback((text: string, repetitions: number, targetCharacterId?: string) => {
    if (!canStartAutoSend(text, repetitions.toString())) return;

    if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
    delayTimeoutRef.current = null;
    setWaitingForDelay(false);
    resetErrorRetryStates();
    
    setIsAutoSendingActive(true);
    setAutoSendTextInternal(text); 
    setAutoSendRemaining(repetitions);
    setAutoSendTargetCharacterId(targetCharacterId);
    initialRepetitionsRef.current = repetitions;
    wasLoadingRef.current = isLoadingFromGemini; 
    sendLoopActiveRef.current = true;
  }, [canStartAutoSend, isLoadingFromGemini]);

  const stopAutoSend = useCallback(async (calledByUser: boolean = true) => {
    sendLoopActiveRef.current = false; // Signal to stop any ongoing loops
    setIsAutoSendingActive(false);
    // Don't reset autoSendRemaining immediately if it's an internal stop due to error retry finishing.
    // Let the main loop logic decide based on sendLoopActiveRef.
    // However, if calledByUser, then clear remaining.
    if (calledByUser) {
        setAutoSendRemaining(0);
    }
    setAutoSendTargetCharacterId(undefined);
    
    setWaitingForDelay(false);
    if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
    delayTimeoutRef.current = null;

    resetErrorRetryStates();

    if (isLoadingFromGemini && calledByUser) { // Only cancel Gemini if explicitly stopped by user
      await cancelGeminiGeneration();
    }
  }, [isLoadingFromGemini, cancelGeminiGeneration]);

  // Effect for error retry countdown
  useEffect(() => {
    if (isWaitingForErrorRetry && errorRetryCountdown > 0) {
      errorRetryIntervalRef.current = window.setInterval(() => {
        setErrorRetryCountdown(prev => prev - 1);
      }, 1000);
    } else if (isWaitingForErrorRetry && errorRetryCountdown === 0) {
      if (errorRetryIntervalRef.current) clearInterval(errorRetryIntervalRef.current);
      errorRetryIntervalRef.current = null;

      if (errorRetryMessageDetails?.userMessageIdToRegenerateFor && currentChatSession) {
        // console.log(`[AutoSend] Countdown finished. Regenerating for ${errorRetryMessageDetails.userMessageIdToRegenerateFor}`);
        handleRegenerateResponseForUserMessage(currentChatSession.id, errorRetryMessageDetails.userMessageIdToRegenerateFor)
          .catch(async (regenError) => {
            console.error("[AutoSend] Error during regeneration attempt:", regenError);
            // If regeneration itself fails, an error message will be added by useGemini.
            // The main loop will pick this up.
          })
          .finally(() => {
             // This 'finally' ensures that even if regen fails to initiate, we reset.
             // The main loop is waiting for isLoadingFromGemini to change.
             // If handleRegenerateResponseForUserMessage throws immediately, isLoadingFromGemini might not change.
             // However, useGemini's handleRegenerate... should set isLoading.
          });
      }
      // Resetting states. The main loop will continue once isLoadingFromGemini changes.
      setIsWaitingForErrorRetry(false); 
      setErrorRetryMessageDetails(null);
    }
    return () => {
      if (errorRetryIntervalRef.current) clearInterval(errorRetryIntervalRef.current);
    };
  }, [isWaitingForErrorRetry, errorRetryCountdown, errorRetryMessageDetails, currentChatSession, handleRegenerateResponseForUserMessage]);


  // Main send loop effect
  useEffect(() => {
    if (!sendLoopActiveRef.current || !isAutoSendingActive) {
        if (isAutoSendingActive) stopAutoSend(false); // Internal stop if loop becomes inactive
        return;
    }

    if (isWaitingForErrorRetry || waitingForDelay) {
        wasLoadingRef.current = isLoadingFromGemini;
        return;
    }

    if (!isLoadingFromGemini && wasLoadingRef.current) { // Gemini (or regeneration) just finished
        wasLoadingRef.current = false; 
        
        if (!currentChatSession) {
            stopAutoSend(false);
            return;
        }

        const lastMessage = currentChatSession.messages[currentChatSession.messages.length - 1];

        if (lastMessage?.role === ChatMessageRole.ERROR && autoSendRemaining > 0) {
            const userMessageThatCausedErrorIndex = currentChatSession.messages.length - 2;
            if (userMessageThatCausedErrorIndex >= 0) {
                const userMessageToRegenFor = currentChatSession.messages[userMessageThatCausedErrorIndex];
                if (userMessageToRegenFor.role === ChatMessageRole.USER) {
                    // console.log(`[AutoSend] Error detected. User message to regen for: ${userMessageToRegenFor.id}`);
                    setErrorRetryMessageDetails({ userMessageIdToRegenerateFor: userMessageToRegenFor.id });
                    setIsWaitingForErrorRetry(true);
                    setErrorRetryCountdown(30); // Start 30-second countdown
                    // Do not decrement autoSendRemaining for the error.
                    return; 
                }
            }
            // If error source can't be determined for regen, stop.
            // console.log("[AutoSend] Error detected, but couldn't find user message to regenerate for. Stopping.");
            stopAutoSend(false);
            return;
        } else { // Successful response (or non-error from Gemini)
            if (autoSendRemaining > 0) {
                // This means a message was successfully sent (or regen was successful),
                // and it was part of the auto-send sequence that just completed its Gemini interaction.
                // So, we decrement the counter for *this successful interaction*.
                const newRemaining = autoSendRemaining -1;
                setAutoSendRemaining(newRemaining);

                if (newRemaining > 0) { // If more repetitions are left
                    setWaitingForDelay(true);
                    delayTimeoutRef.current = window.setTimeout(() => {
                        setWaitingForDelay(false);
                        delayTimeoutRef.current = null;
                    }, 1000); // 1-second delay for next successful send
                    return; 
                } else { // All repetitions are done
                    // console.log("[AutoSend] All repetitions completed successfully.");
                    stopAutoSend(false);
                    return;
                }
            } else { // autoSendRemaining was already 0, this was the last one
                 // console.log("[AutoSend] Final repetition processed successfully.");
                 stopAutoSend(false);
                 return;
            }
        }
    }

    // This block initiates a *new* send if conditions are met
    // (e.g., initial send, or after delay for next repetition, or after error retry sequence completed and isLoading is false again)
    if (!isLoadingFromGemini && !isWaitingForErrorRetry && !waitingForDelay && autoSendRemaining > 0) {
        // console.log(`[AutoSend] Sending message. Remaining: ${autoSendRemaining}`);
        sendMessageToGemini(autoSendTextInternal, undefined, undefined, autoSendTargetCharacterId)
            .catch(async (error) => {
                console.error("[AutoSend] Error calling sendMessageToGemini:", error);
                await stopAutoSend(true); // Hard stop if the send call itself fails
            });
        // After this, isLoadingFromGemini should become true.
        // The wasLoadingRef will be updated at the end of this effect.
    }
    
    wasLoadingRef.current = isLoadingFromGemini;

  }, [
    isAutoSendingActive,
    autoSendRemaining,
    isLoadingFromGemini,
    waitingForDelay,
    isWaitingForErrorRetry, // Added
    autoSendTextInternal,
    autoSendTargetCharacterId,
    sendMessageToGemini,
    stopAutoSend,
    currentChatSession, // Added for inspecting messages
    handleRegenerateResponseForUserMessage, // Added
  ]);

  // Cleanup timeouts and intervals on unmount or when auto-send stops.
  useEffect(() => {
    return () => {
      if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
      if (errorRetryIntervalRef.current) clearInterval(errorRetryIntervalRef.current);
    };
  }, []);


  return {
    isAutoSendingActive,
    autoSendText: userVisibleAutoSendText,
    setAutoSendText: setUserVisibleAutoSendText,
    autoSendRepetitionsInput,
    setAutoSendRepetitionsInput,
    autoSendRemaining,
    startAutoSend,
    stopAutoSend,
    canStartAutoSend,
    isPreparingAutoSend,
    isWaitingForErrorRetry,    // Expose for UI
    errorRetryCountdown,       // Expose for UI
  };
}