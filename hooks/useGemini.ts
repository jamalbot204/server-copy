

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatSession, ChatMessage, ChatMessageRole, GeminiSettings, Attachment, AICharacter, HarmCategory, HarmBlockThreshold, FullResponseData, UserMessageInput, LogApiRequestCallback, UseGeminiReturn, GeminiHistoryEntry } from '../types.ts';
import { getFullChatResponse, generateMimicUserResponse, clearCachedChat as geminiServiceClearCachedChat, mapMessagesToGeminiHistoryInternal } from '../services/geminiService.ts'; // Updated import
import { DEFAULT_SETTINGS } from '../constants.ts';
import { EditMessagePanelAction, EditMessagePanelDetails } from '../components/EditMessagePanel.tsx';
import { findPrecedingUserMessageIndex, getHistoryUpToMessage } from '../services/utils.ts'; // Import helpers

// Define props for the hook
interface UseGeminiProps {
  apiKey: string;
  currentChatSession: ChatSession | null;
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  logApiRequestDirectly: LogApiRequestCallback;
  onNewAIMessageFinalized?: (newAiMessage: ChatMessage) => Promise<void>; // Changed to async to align with new trigger 
  setMessageGenerationTimes: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>;
  rotateApiKey: () => Promise<void>;
}

export function useGemini({
  apiKey,
  currentChatSession,
  updateChatSession,
  logApiRequestDirectly,
  onNewAIMessageFinalized, 
  setMessageGenerationTimes,
  rotateApiKey,
}: UseGeminiProps): UseGeminiReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [currentGenerationTimeDisplay, setCurrentGenerationTimeDisplay] = useState<string>("0.0s");
  const [lastMessageHadAttachments, setLastMessageHadAttachments] = useState(false);

  const generationStartTimeRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingMessageIdRef = useRef<string | null>(null);
  const originalMessageSnapshotRef = useRef<ChatMessage | null>(null);
  const requestCancelledByUserRef = useRef<boolean>(false);
  const onFullResponseCalledForPendingMessageRef = useRef<boolean>(false);

  const prevModelRef = useRef<string | undefined>(undefined);
  const prevSettingsRef = useRef<GeminiSettings | undefined>(undefined);


  useEffect(() => {
    let intervalId: number | undefined;
    if (isLoading && generationStartTimeRef.current) {
      setCurrentGenerationTimeDisplay("0.0s");
      intervalId = window.setInterval(() => {
        if (generationStartTimeRef.current !== null) { // Changed: Explicit null check
          const elapsedSeconds = (Date.now() - generationStartTimeRef.current) / 1000; // Changed: Removed !
          setCurrentGenerationTimeDisplay(`${elapsedSeconds.toFixed(1)}s`);
        }
      }, 100);
    } else {
      generationStartTimeRef.current = null;
      if (!isLoading) {
          setCurrentGenerationTimeDisplay("0.0s");
      }
    }
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoading]);

  useEffect(() => {
    if (currentChatSession) {
      prevModelRef.current = currentChatSession.model;
      prevSettingsRef.current = currentChatSession.settings;
    }
  }, [currentChatSession?.id]);


  useEffect(() => {
    if (!currentChatSession) return;

    const newModel = currentChatSession.model;
    const newSettings = currentChatSession.settings;

    let modelChanged = false;
    if (prevModelRef.current !== undefined && prevModelRef.current !== newModel) {
      modelChanged = true;
    }

    let settingsChanged = false;
    if (prevSettingsRef.current !== undefined && JSON.stringify(prevSettingsRef.current) !== JSON.stringify(newSettings)) {
      settingsChanged = true;
    }

    if (modelChanged || settingsChanged) {
      const nonCharSettingsForCacheKey = { ...newSettings };
      delete (nonCharSettingsForCacheKey as any)._characterIdForCacheKey;
      geminiServiceClearCachedChat(currentChatSession.id, newModel, nonCharSettingsForCacheKey);

      if (currentChatSession.isCharacterModeActive && currentChatSession.aiCharacters) {
        currentChatSession.aiCharacters.forEach(character => {
          const charSettingsForCacheKey: GeminiSettings & { _characterIdForCacheKey?: string } = {
            ...newSettings,
            systemInstruction: character.systemInstruction,
            _characterIdForCacheKey: character.id,
          };
          geminiServiceClearCachedChat(currentChatSession.id, newModel, charSettingsForCacheKey);
        });
      }
    }
    prevModelRef.current = newModel;
    prevSettingsRef.current = newSettings;
  }, [currentChatSession?.model, currentChatSession?.settings, currentChatSession?.id, currentChatSession?.isCharacterModeActive, currentChatSession?.aiCharacters]);


 const handleCancelGeneration = useCallback(async () => {
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      requestCancelledByUserRef.current = true;
      abortControllerRef.current.abort();

      setIsLoading(false);
      setCurrentGenerationTimeDisplay("0.0s");
      generationStartTimeRef.current = null;
      setLastMessageHadAttachments(false);
      onFullResponseCalledForPendingMessageRef.current = false;

      const activeChatIdForCancel = currentChatSession?.id;
      const currentPendingMessageId = pendingMessageIdRef.current;
      const currentOriginalSnapshot = originalMessageSnapshotRef.current;

      if (activeChatIdForCancel && currentPendingMessageId) {
        if (currentOriginalSnapshot && currentOriginalSnapshot.id === currentPendingMessageId) {
          await updateChatSession(activeChatIdForCancel, session => session ? ({
            ...session,
            messages: session.messages.map(msg => msg.id === currentOriginalSnapshot.id ? currentOriginalSnapshot : msg)
          }) : null);
        } else {
          await updateChatSession(activeChatIdForCancel, session => {
            if (!session) return null;
            const messageToRemove = session.messages.find(msg => msg.id === currentPendingMessageId && (msg.isStreaming || msg.content === ''));
            if (messageToRemove) {
                const newMessages = session.messages.filter(msg => msg.id !== currentPendingMessageId);
                return { ...session, messages: newMessages };
            }
            return session;
          });
        }
      }
      pendingMessageIdRef.current = null;
      originalMessageSnapshotRef.current = null;
    } else {
        if (isLoading) setIsLoading(false);
        if (lastMessageHadAttachments) setLastMessageHadAttachments(false);
    }
  }, [currentChatSession, updateChatSession, isLoading, lastMessageHadAttachments]);


  const handleSendMessage = useCallback(async (
    promptContent: string,
    attachments?: Attachment[],
    historyContextOverride?: ChatMessage[],
    characterIdForAPICall?: string,
    isTemporaryContext?: boolean
  ) => {
    if (!currentChatSession || isLoading) return;

    await rotateApiKey();

    requestCancelledByUserRef.current = false;
    onFullResponseCalledForPendingMessageRef.current = false;
    originalMessageSnapshotRef.current = null; // Reset snapshot
    setLastMessageHadAttachments(!!(attachments && attachments.length > 0 && !isTemporaryContext));

    let sessionToUpdate = { ...currentChatSession }; // Operate on a copy for preparing local state
    let baseSettingsForAPICall = { ...currentChatSession.settings };
    let settingsOverrideForAPICall: Partial<GeminiSettings & { _characterIdForAPICall?: string }> = {};
    let characterNameForResponse: string | undefined = undefined;
    let userMessageIdForPotentialTitleUpdate: string | null = null;


    if (currentChatSession.isCharacterModeActive && characterIdForAPICall) {
        const character = (currentChatSession.aiCharacters || []).find(c => c.id === characterIdForAPICall);
        if (character) {
            settingsOverrideForAPICall.systemInstruction = character.systemInstruction;
            settingsOverrideForAPICall.userPersonaInstruction = undefined; // Character mode overrides general user persona for this turn
            settingsOverrideForAPICall._characterIdForAPICall = character.id;
            characterNameForResponse = character.name;
        } else {
            console.error(`Character with ID ${characterIdForAPICall} not found.`);
            return;
        }
    }

    // 1. Determine finalUserMessageInputForAPI (content for the current turn sent to chat.sendMessage())
    let finalUserMessageInputForAPI: UserMessageInput;
    if (currentChatSession.isCharacterModeActive && characterIdForAPICall && !promptContent.trim() && (!attachments || attachments.length === 0) && !historyContextOverride) {
        // Character trigger with empty physical input - use contextual info if available
        const characterTriggered = (currentChatSession.aiCharacters || []).find(c => c.id === characterIdForAPICall);
        finalUserMessageInputForAPI = (characterTriggered?.contextualInfo?.trim())
            ? { text: characterTriggered.contextualInfo, attachments: [] }
            : { text: "", attachments: [] }; // Still send empty if no contextual info
    } else {
        // Standard message, edit, or temporary context
        finalUserMessageInputForAPI = { text: promptContent, attachments: attachments || [] };
    }

    // Guard against truly empty messages in non-character mode if not an edit
    if (!characterIdForAPICall && !historyContextOverride && !finalUserMessageInputForAPI.text.trim() && (!finalUserMessageInputForAPI.attachments || finalUserMessageInputForAPI.attachments.length === 0)) {
        return;
    }

    // 2. Determine historyForGeminiSDK (history *before* the current turn for ai.chats.create())
    let historyForGeminiSDK: ChatMessage[];
    if (historyContextOverride) {
        // This is typically from an edit action. `historyContextOverride` is the state *before* the edited message.
        historyForGeminiSDK = [...historyContextOverride];
    } else {
        // This is for a new message. `sessionToUpdate.messages` is the state *before* this new message.
        historyForGeminiSDK = [...sessionToUpdate.messages];
    }

    // 3. Prepare for UI update: Create a ChatMessage object for the current user's turn if applicable
    let currentTurnUserMessageForUI: ChatMessage | null = null;
    if (!isTemporaryContext) {
        // This applies to new messages and standard edits (where historyContextOverride is present)
        // The message created here represents the user's action that will be sent to the API.
        currentTurnUserMessageForUI = {
            id: `msg-${Date.now()}-user-turn-${Math.random().toString(36).substring(2,7)}`, // New ID for this UI representation
            role: ChatMessageRole.USER,
            content: finalUserMessageInputForAPI.text,
            attachments: finalUserMessageInputForAPI.attachments?.map(att => ({...att})), // Ensure a fresh copy of attachments
            timestamp: new Date(),
        };
        userMessageIdForPotentialTitleUpdate = currentTurnUserMessageForUI.id;
    }


    // 4. Update session for UI (locally) - This adds the user's turn and AI placeholder to the UI
    generationStartTimeRef.current = Date.now();
    setIsLoading(true);
    setCurrentGenerationTimeDisplay("0.0s");
    abortControllerRef.current = new AbortController();

    const modelMessageId = `msg-${Date.now()}-model-${Math.random().toString(36).substring(2,7)}`;
    pendingMessageIdRef.current = modelMessageId; // Track the AI message ID we're waiting for
    const placeholderAiMessage: ChatMessage = {
        id: modelMessageId, role: ChatMessageRole.MODEL, content: '',
        timestamp: new Date(), isStreaming: true, characterName: characterNameForResponse,
    };

    let messagesForUIUpdate: ChatMessage[] = [...historyForGeminiSDK]; // Start with history seen by SDK
    if (currentTurnUserMessageForUI) { // If there's a UI representation of the user's current turn
        messagesForUIUpdate.push(currentTurnUserMessageForUI);
    }
    messagesForUIUpdate.push(placeholderAiMessage); // Add AI placeholder

    let newTitleForSession = sessionToUpdate.title;
    if (userMessageIdForPotentialTitleUpdate && sessionToUpdate.title === "New Chat") {
        // Check if currentTurnUserMessageForUI is effectively the first user message in the displayed sequence
        const userMessagesInUiUpdate = messagesForUIUpdate.filter(m => m.role === ChatMessageRole.USER);
        if (userMessagesInUiUpdate.length > 0 && userMessagesInUiUpdate[userMessagesInUiUpdate.length-1].id === userMessageIdForPotentialTitleUpdate) {
            // Count user messages in the history *before* this new one
            const userMessagesInHistory = historyForGeminiSDK.filter(m => m.role === ChatMessageRole.USER).length;
            if (userMessagesInHistory === 0) { // This is indeed the first user message overall
                 newTitleForSession = (finalUserMessageInputForAPI.text || "Chat with attachments").substring(0, 35) +
                                 ((finalUserMessageInputForAPI.text.length > 35 || (!finalUserMessageInputForAPI.text && finalUserMessageInputForAPI.attachments && finalUserMessageInputForAPI.attachments.length > 0)) ? "..." : "");
            }
        }
    }

    await updateChatSession(sessionToUpdate.id, s => s ? ({
        ...s,
        messages: messagesForUIUpdate,
        lastUpdatedAt: new Date(),
        title: newTitleForSession // Apply title update
    }) : null);

    const activeChatIdForThisCall = currentChatSession.id;

    // 5. Call getFullChatResponse
    await getFullChatResponse(
        apiKey,
        activeChatIdForThisCall,
        finalUserMessageInputForAPI, // Current turn's content
        currentChatSession.model,
        baseSettingsForAPICall,
        historyForGeminiSDK, // History *before* current turn
        async (responseData: FullResponseData) => {
            if (requestCancelledByUserRef.current && pendingMessageIdRef.current === modelMessageId) return;
            onFullResponseCalledForPendingMessageRef.current = true;
            if (generationStartTimeRef.current) {
                const duration = (Date.now() - generationStartTimeRef.current) / 1000;
                await setMessageGenerationTimes(prev => ({...prev, [modelMessageId]: duration}));
            }
            const newAiMessage: ChatMessage = {
                ...placeholderAiMessage,
                content: responseData.text,
                groundingMetadata: responseData.groundingMetadata,
                isStreaming: false,
                timestamp: new Date(),
                characterName: characterNameForResponse
            };

            await updateChatSession(activeChatIdForThisCall, session => session ? ({
                ...session,
                messages: session.messages.map(msg =>
                    msg.id === modelMessageId ? newAiMessage : msg
                )
            }) : null);
            // Call onNewAIMessageFinalized *after* the session state is updated
            if (onNewAIMessageFinalized) {
                await onNewAIMessageFinalized(newAiMessage);
            }

        },
        async (errorMsg, isAbortError) => {
            const currentPendingMsgId = pendingMessageIdRef.current;
            if (requestCancelledByUserRef.current && currentPendingMsgId === modelMessageId) { if (isLoading) setIsLoading(false); if (lastMessageHadAttachments) setLastMessageHadAttachments(false); return; }

            onFullResponseCalledForPendingMessageRef.current = false;

            if (isAbortError && currentPendingMsgId === modelMessageId) {
                 if (originalMessageSnapshotRef.current && originalMessageSnapshotRef.current.id === currentPendingMsgId) {
                    await updateChatSession(activeChatIdForThisCall, s => s ? ({ ...s, messages: s.messages.map(m => m.id === originalMessageSnapshotRef.current!.id ? originalMessageSnapshotRef.current! : m) }) : null);
                } else {
                    await updateChatSession(activeChatIdForThisCall, s => {
                        if (!s) return null;
                        const msgExists = s.messages.some(m => m.id === currentPendingMsgId);
                        if (msgExists) {
                             return { ...s, messages: s.messages.map(msg =>
                                msg.id === currentPendingMsgId
                                ? { ...msg, isStreaming: false, role: ChatMessageRole.ERROR, content: `Response aborted: ${errorMsg}`, characterName: characterNameForResponse }
                                : msg
                            )};
                        }
                        return s;
                    });
                }
            } else if (currentPendingMsgId === modelMessageId) {
                await updateChatSession(activeChatIdForThisCall, session => session ? ({
                    ...session,
                    messages: session.messages.map(msg =>
                        msg.id === modelMessageId
                        ? { ...msg, isStreaming: false, role: ChatMessageRole.ERROR, content: `Response failed: ${errorMsg}`, characterName: characterNameForResponse }
                        : msg
                    )
                }) : null);
            }
            if (!requestCancelledByUserRef.current && currentPendingMsgId === modelMessageId) {
                setIsLoading(false);
                setLastMessageHadAttachments(false);
            }
        },
        async () => { // onComplete
            const userDidCancel = requestCancelledByUserRef.current;
            const currentPendingMsgIdForComplete = pendingMessageIdRef.current;

            if (userDidCancel && currentPendingMsgIdForComplete === modelMessageId) { /* Already handled by cancel logic */ }
            else if (currentPendingMsgIdForComplete === modelMessageId) { // AI interaction finished for this messageId
                setIsLoading(false);
                setLastMessageHadAttachments(false);

                if (!onFullResponseCalledForPendingMessageRef.current) { // If onFullResponse was NOT called (e.g. stream error)
                    await updateChatSession(activeChatIdForThisCall, session => {
                        if (!session) return null;
                        const messageInState = session.messages.find(m => m.id === modelMessageId);
                        // If the message is still streaming and not an error, mark it as an error.
                        if (messageInState && messageInState.isStreaming && messageInState.role !== ChatMessageRole.ERROR) {
                            return {
                                ...session,
                                messages: session.messages.map(msg =>
                                    msg.id === modelMessageId
                                    ? { ...msg, isStreaming: false, role: ChatMessageRole.ERROR, content: "Response processing failed or stream ended unexpectedly.", timestamp: new Date(), characterName: characterNameForResponse }
                                    : msg
                                ),
                                lastUpdatedAt: new Date()
                            };
                        }
                        return { ...session, lastUpdatedAt: new Date() }; // Ensure lastUpdatedAt is updated
                    });
                } else { // onFullResponse WAS called, just update timestamp
                     await updateChatSession(activeChatIdForThisCall, session => {
                        if (!session) return null;
                        return { ...session, lastUpdatedAt: new Date() };
                    });
                }
                pendingMessageIdRef.current = null;
                originalMessageSnapshotRef.current = null; // Clear snapshot after completion
            }
            // Cleanup refs for this specific messageId
            if (abortControllerRef.current && currentPendingMsgIdForComplete === modelMessageId) abortControllerRef.current = null;
            if (currentPendingMsgIdForComplete === modelMessageId) requestCancelledByUserRef.current = false;
            onFullResponseCalledForPendingMessageRef.current = false;
        },
        logApiRequestDirectly,
        abortControllerRef.current.signal,
        settingsOverrideForAPICall,
        currentChatSession.aiCharacters
    );
  }, [apiKey, currentChatSession, isLoading, updateChatSession, logApiRequestDirectly, setMessageGenerationTimes, lastMessageHadAttachments, onNewAIMessageFinalized, rotateApiKey]);


  const handleContinueFlow = useCallback(async () => {
    if (!currentChatSession || isLoading || currentChatSession.messages.length === 0 || currentChatSession.isCharacterModeActive) {
        return;
    }

    await rotateApiKey();

    requestCancelledByUserRef.current = false;
    onFullResponseCalledForPendingMessageRef.current = false;
    originalMessageSnapshotRef.current = null;
    let sessionToUpdate = { ...currentChatSession };
    const activeChatIdForThisCall = currentChatSession.id;

    setLastMessageHadAttachments(false);
    generationStartTimeRef.current = Date.now();
    setIsLoading(true);
    setCurrentGenerationTimeDisplay("0.0s");
    abortControllerRef.current = new AbortController();

    const lastMessage = sessionToUpdate.messages[sessionToUpdate.messages.length - 1];
    let operationPendingMessageId: string | null = null;

    const commonOnCompleteForFlow = async (messageId: string | null, specificCharacterName?: string) => {
        if (requestCancelledByUserRef.current && pendingMessageIdRef.current === messageId) { /* Handled */ }
        else if (pendingMessageIdRef.current === messageId) {
            setIsLoading(false); setLastMessageHadAttachments(false);
            if (!onFullResponseCalledForPendingMessageRef.current) {
                await updateChatSession(activeChatIdForThisCall, session => {
                    if (!session) return null;
                    const msgInState = session.messages.find(m => m.id === messageId);
                    if (msgInState && msgInState.isStreaming && msgInState.role !== ChatMessageRole.ERROR) {
                        return {
                            ...session,
                            messages: session.messages.map(m =>
                                m.id === messageId
                                ? { ...m, isStreaming: false, role: ChatMessageRole.ERROR, content: "Response processing failed or stream ended unexpectedly.", characterName: specificCharacterName }
                                : m
                            ),
                            lastUpdatedAt: new Date()
                        };
                    }
                    return { ...session, lastUpdatedAt: new Date() };
                });
            } else {
                 await updateChatSession(activeChatIdForThisCall, session => {
                    if (!session) return null;
                    return { ...session, lastUpdatedAt: new Date() };
                });
            }
            pendingMessageIdRef.current = null; originalMessageSnapshotRef.current = null;
        }
        if (abortControllerRef.current && pendingMessageIdRef.current === messageId) abortControllerRef.current = null;
        if (pendingMessageIdRef.current === messageId) requestCancelledByUserRef.current = false;
        onFullResponseCalledForPendingMessageRef.current = false;
    };

    if (lastMessage.role === ChatMessageRole.USER) {
        const userMessageInputForAPI: UserMessageInput = { text: lastMessage.content, attachments: lastMessage.attachments };
        const historyForAPICall = sessionToUpdate.messages.slice(0, -1); // History *before* the last user message
        if (lastMessage.attachments && lastMessage.attachments.length > 0) setLastMessageHadAttachments(true);

        const modelMessageId = `msg-${Date.now()}-model-flow-${Math.random().toString(36).substring(2,7)}`;
        operationPendingMessageId = modelMessageId;
        pendingMessageIdRef.current = modelMessageId;
        const placeholderAiMessage: ChatMessage = {
            id: modelMessageId, role: ChatMessageRole.MODEL, content: '',
            timestamp: new Date(), isStreaming: true,
        };
        // UI Update: Add AI placeholder AFTER the last user message that is triggering this flow.
        await updateChatSession(activeChatIdForThisCall, s => s ? ({ ...s, messages: [...s.messages, placeholderAiMessage], lastUpdatedAt: new Date() }) : null);


        await getFullChatResponse(
            apiKey,
            activeChatIdForThisCall,
            userMessageInputForAPI, // Content of the last user message
            currentChatSession.model,
            currentChatSession.settings,
            historyForAPICall, // History *before* the last user message
            async (responseData: FullResponseData) => {
                if (requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) return;
                onFullResponseCalledForPendingMessageRef.current = true;
                if (generationStartTimeRef.current) await setMessageGenerationTimes(prev => ({...prev, [operationPendingMessageId!]: (Date.now() - generationStartTimeRef.current!) / 1000}));
                const newAiMessage: ChatMessage = {
                    ...placeholderAiMessage,
                    content: responseData.text,
                    groundingMetadata: responseData.groundingMetadata,
                    isStreaming: false,
                    timestamp: new Date()
                };
                await updateChatSession(activeChatIdForThisCall, s => s ? ({ ...s, messages: s.messages.map(m => m.id === operationPendingMessageId ? newAiMessage : m)}) : null);
                if (onNewAIMessageFinalized) {
                    await onNewAIMessageFinalized(newAiMessage);
                }
            },
            async (errorMsg, isAbortError) => {
                if (requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) { if(isLoading) setIsLoading(false); setLastMessageHadAttachments(false); return; }
                onFullResponseCalledForPendingMessageRef.current = false;
                if (isAbortError && pendingMessageIdRef.current === operationPendingMessageId) { /* Handled by finally or specific logic */ }
                else if (pendingMessageIdRef.current === operationPendingMessageId) {
                    await updateChatSession(activeChatIdForThisCall, s => s ? ({ ...s, messages: s.messages.map(m => m.id === operationPendingMessageId ? {...m, role: ChatMessageRole.ERROR, content: `Flow response failed: ${errorMsg}`, isStreaming: false} : m)}) : null);
                }
                if (!requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) { setIsLoading(false); setLastMessageHadAttachments(false); }
            },
            () => commonOnCompleteForFlow(operationPendingMessageId),
            logApiRequestDirectly, abortControllerRef.current.signal
        );
    } else if (lastMessage.role === ChatMessageRole.MODEL || lastMessage.role === ChatMessageRole.ERROR) {
        const mimicUserMessageId = `msg-${Date.now()}-user-mimic-${Math.random().toString(36).substring(2,7)}`;
        operationPendingMessageId = mimicUserMessageId;
        pendingMessageIdRef.current = mimicUserMessageId;
        setLastMessageHadAttachments(false);

        const placeholderUserMimicMessage: ChatMessage = {
            id: mimicUserMessageId, role: ChatMessageRole.USER, content: '',
            timestamp: new Date(), isStreaming: true,
        };
        // UI Update: Add placeholder for the user-mimic message
        await updateChatSession(activeChatIdForThisCall, s => s ? ({...s, messages: [...s.messages, placeholderUserMimicMessage], lastUpdatedAt: new Date() }) : null);

        try {
            if (abortControllerRef.current?.signal.aborted && requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) throw new DOMException("Aborted by user", "AbortError");
            onFullResponseCalledForPendingMessageRef.current = false;
            const persona = currentChatSession.settings.userPersonaInstruction || DEFAULT_SETTINGS.userPersonaInstruction || "Please respond as the user.";
            const baseSettingsForMimic = { ...currentChatSession.settings };
            const overrideSettingsForMimic: Partial<GeminiSettings> = {
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
                useGoogleSearch: false,
                urlContext: [],
                _characterNameForLog: "[Continue Flow - User Mimic]"
            };

            // Use standard, unflipped history including the last MODEL/ERROR message
            const historyForStandardGeminiCall: GeminiHistoryEntry[] = mapMessagesToGeminiHistoryInternal(
                sessionToUpdate.messages.slice(0,-1), // Actual history including the last MODEL/ERROR message
                baseSettingsForMimic
            );

            const generatedText = await generateMimicUserResponse(
                apiKey,
                currentChatSession.model,
                historyForStandardGeminiCall, // Pass the standard history
                persona,
                baseSettingsForMimic,
                logApiRequestDirectly,
                abortControllerRef.current.signal,
                overrideSettingsForMimic
            );
            if (requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) return;
            onFullResponseCalledForPendingMessageRef.current = true;
            if (generationStartTimeRef.current) await setMessageGenerationTimes(prev => ({...prev, [operationPendingMessageId!]: (Date.now() - generationStartTimeRef.current!) / 1000}));
            const newUserMessage: ChatMessage = {
                id: operationPendingMessageId!, role: ChatMessageRole.USER, content: generatedText,
                timestamp: new Date(), isStreaming: false,
            };
            await updateChatSession(activeChatIdForThisCall, session => session ? ({
                ...session, messages: session.messages.map(m => m.id === operationPendingMessageId ? newUserMessage : m)
            }) : null);
        } catch (error: any) {
             onFullResponseCalledForPendingMessageRef.current = false;
            if (requestCancelledByUserRef.current && pendingMessageIdRef.current === operationPendingMessageId) return;
             if (error.name === 'AbortError' && pendingMessageIdRef.current === operationPendingMessageId) {
                // On abort during mimic, we just want to remove the placeholder.
                // The incorrect check for originalMessageSnapshotRef was causing a crash.
                await updateChatSession(activeChatIdForThisCall, s => s ? ({ ...s, messages: s.messages.filter(m => m.id !== pendingMessageIdRef.current) }) : null);
            } else if (pendingMessageIdRef.current === operationPendingMessageId) {
                const errorMessageContent: ChatMessage = {
                    id: operationPendingMessageId!, role: ChatMessageRole.ERROR,
                    content: error.message || "Failed to generate user-style response.",
                    timestamp: new Date(), isStreaming: false,
                };
                await updateChatSession(activeChatIdForThisCall, session => session ? ({
                     ...session, messages: session.messages.map(m => m.id === operationPendingMessageId ? errorMessageContent : m)
                }) : null);
            }
        } finally {
            await commonOnCompleteForFlow(operationPendingMessageId);
        }
    } else {
        setIsLoading(false); generationStartTimeRef.current = null; abortControllerRef.current = null;
        pendingMessageIdRef.current = null; originalMessageSnapshotRef.current = null;
        requestCancelledByUserRef.current = false;
        onFullResponseCalledForPendingMessageRef.current = false;
        setLastMessageHadAttachments(false);
    }
  }, [apiKey, currentChatSession, isLoading, updateChatSession, logApiRequestDirectly, setMessageGenerationTimes, onNewAIMessageFinalized, rotateApiKey]);

  const handleRegenerateAIMessage = useCallback(async (sessionId: string, aiMessageIdToRegenerate: string) => {
    if (!currentChatSession || isLoading || currentChatSession.id !== sessionId) return;

    await rotateApiKey();
    
    requestCancelledByUserRef.current = false;
    onFullResponseCalledForPendingMessageRef.current = false;

    const aiMessageIndex = currentChatSession.messages.findIndex(m => m.id === aiMessageIdToRegenerate && (m.role === ChatMessageRole.MODEL || m.role === ChatMessageRole.ERROR));
    if (aiMessageIndex <= 0) return;

    const userPromptIndex = findPrecedingUserMessageIndex(currentChatSession.messages, aiMessageIndex);
    if (userPromptIndex === -1) return;

    const userPromptMessage = currentChatSession.messages[userPromptIndex];
    const userMessageInputForAPI: UserMessageInput = { text: userPromptMessage.content, attachments: userPromptMessage.attachments };
    const historyForGeminiService = getHistoryUpToMessage(currentChatSession.messages, userPromptIndex + 1); // History includes the user prompt, which is correct for init. SDK handles not resending it.
    setLastMessageHadAttachments(!!(userMessageInputForAPI.attachments && userMessageInputForAPI.attachments.length > 0));

    const aiMessageToUpdate = currentChatSession.messages[aiMessageIndex];
    originalMessageSnapshotRef.current = { ...aiMessageToUpdate };
    pendingMessageIdRef.current = aiMessageIdToRegenerate;

    generationStartTimeRef.current = Date.now();
    setIsLoading(true);
    setCurrentGenerationTimeDisplay("0.0s");
    abortControllerRef.current = new AbortController();

    const updatedAiMessagePlaceholder: ChatMessage = {
      ...aiMessageToUpdate,
      content: '',
      groundingMetadata: undefined,
      isStreaming: true,
      timestamp: new Date(),
      cachedAudioBuffers: null,
    };

    await updateChatSession(sessionId, s => s ? ({
      ...s,
      messages: s.messages.map(msg => msg.id === aiMessageIdToRegenerate ? updatedAiMessagePlaceholder : msg)
    }) : null);
    await setMessageGenerationTimes(prevTimes => {
      const newTimes = { ...prevTimes };
      delete newTimes[aiMessageIdToRegenerate];
      return newTimes;
    });

    let settingsOverrideForRegen: Partial<GeminiSettings & { _characterIdForAPICall?: string }> = {};
    let characterForRegen: AICharacter | undefined;
    if (currentChatSession.isCharacterModeActive && aiMessageToUpdate.characterName) {
      characterForRegen = (currentChatSession.aiCharacters || []).find(c => c.name === aiMessageToUpdate.characterName);
      if (characterForRegen) {
        settingsOverrideForRegen.systemInstruction = characterForRegen.systemInstruction;
        settingsOverrideForRegen._characterIdForAPICall = characterForRegen.id;
      }
    }
    const settingsForCacheClear = { ...currentChatSession.settings, ...settingsOverrideForRegen };
     if (characterForRegen) (settingsForCacheClear as any)._characterIdForCacheKey = characterForRegen.id;
     else delete (settingsForCacheClear as any)._characterIdForCacheKey;
    geminiServiceClearCachedChat(sessionId, currentChatSession.model, settingsForCacheClear);


    const commonOnCompleteForRegen = async () => {
        if (requestCancelledByUserRef.current && pendingMessageIdRef.current === aiMessageIdToRegenerate) { /* Handled */ }
        else if (pendingMessageIdRef.current === aiMessageIdToRegenerate) {
            setIsLoading(false); setLastMessageHadAttachments(false);
             if (!onFullResponseCalledForPendingMessageRef.current) {
                await updateChatSession(sessionId, session => {
                    if (!session) return null;
                    const msgInState = session.messages.find(m => m.id === aiMessageIdToRegenerate);
                    if (msgInState && msgInState.isStreaming && msgInState.role !== ChatMessageRole.ERROR) {
                         return {
                            ...session,
                            messages: session.messages.map(msg =>
                                msg.id === aiMessageIdToRegenerate
                                ? { ...msg, isStreaming: false, role: ChatMessageRole.ERROR, content: "Response processing failed or stream ended unexpectedly.", characterName: aiMessageToUpdate.characterName, cachedAudioBuffers: null }
                                : msg
                            ),
                            lastUpdatedAt: new Date()
                        };
                    } else if (msgInState && !msgInState.isStreaming && originalMessageSnapshotRef.current) {
                        return {
                            ...session,
                            messages: session.messages.map(msg => msg.id === aiMessageIdToRegenerate ? originalMessageSnapshotRef.current! : msg),
                            lastUpdatedAt: new Date()
                        };
                    }
                    return { ...session, lastUpdatedAt: new Date() };
                });
            } else {
                 await updateChatSession(sessionId, session => {
                    if (!session) return null;
                    return { ...session, lastUpdatedAt: new Date() };
                });
            }
            pendingMessageIdRef.current = null; originalMessageSnapshotRef.current = null;
        }
        if (abortControllerRef.current && pendingMessageIdRef.current === aiMessageIdToRegenerate) abortControllerRef.current = null;
        if (pendingMessageIdRef.current === aiMessageIdToRegenerate) requestCancelledByUserRef.current = false;
        onFullResponseCalledForPendingMessageRef.current = false;
    };


    await getFullChatResponse(
      apiKey,
      sessionId,
      userMessageInputForAPI, // Current user's input that led to the AI message
      currentChatSession.model,
      currentChatSession.settings,
      historyForGeminiService, // History up to and including the user message
      async (responseData: FullResponseData) => {
        if (requestCancelledByUserRef.current && pendingMessageIdRef.current === aiMessageIdToRegenerate) return;
        onFullResponseCalledForPendingMessageRef.current = true;
        if (generationStartTimeRef.current) await setMessageGenerationTimes(prev => ({ ...prev, [aiMessageIdToRegenerate]: (Date.now() - generationStartTimeRef.current!) / 1000 }));

        const newAiMessageContent : ChatMessage = {
            ...updatedAiMessagePlaceholder,
            content: responseData.text,
            groundingMetadata: responseData.groundingMetadata,
            isStreaming: false,
            role: ChatMessageRole.MODEL,
            timestamp: new Date(),
            cachedAudioBuffers: null,
        };

        await updateChatSession(sessionId, session => session ? ({
          ...session, messages: session.messages.map(msg =>
            msg.id === aiMessageIdToRegenerate ? newAiMessageContent : msg
          )}) : null);
        if (onNewAIMessageFinalized) {
            await onNewAIMessageFinalized(newAiMessageContent);
        }
      },
      async (errorMsg, isAbortError) => {
        if (requestCancelledByUserRef.current && pendingMessageIdRef.current === aiMessageIdToRegenerate) {
            if(isLoading) setIsLoading(false);
            setLastMessageHadAttachments(false);
            return;
        }
        onFullResponseCalledForPendingMessageRef.current = false;

        if (isAbortError && pendingMessageIdRef.current === aiMessageIdToRegenerate) {
            if (originalMessageSnapshotRef.current && originalMessageSnapshotRef.current.id === aiMessageIdToRegenerate) {
                await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(m => m.id === originalMessageSnapshotRef.current!.id ? originalMessageSnapshotRef.current! : m) }) : null);
            } else {
                 await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(msg =>
                    msg.id === aiMessageIdToRegenerate ? { ...updatedAiMessagePlaceholder, isStreaming: false, role: ChatMessageRole.ERROR, content: 'Regeneration aborted.', cachedAudioBuffers: null } : msg
                )}) : null);
            }
        } else if (pendingMessageIdRef.current === aiMessageIdToRegenerate) {
            await updateChatSession(sessionId, session => session ? ({
                ...session,
                messages: session.messages.map(msg =>
                    msg.id === aiMessageIdToRegenerate
                    ? { ...updatedAiMessagePlaceholder, isStreaming: false, role: ChatMessageRole.ERROR, content: `Regeneration failed: ${errorMsg}`, cachedAudioBuffers: null }
                    : msg
                )
            }) : null);
        }

        if (!requestCancelledByUserRef.current && pendingMessageIdRef.current === aiMessageIdToRegenerate) {
            setIsLoading(false);
            setLastMessageHadAttachments(false);
        }
      },
      commonOnCompleteForRegen,
      logApiRequestDirectly,
      abortControllerRef.current.signal,
      settingsOverrideForRegen,
      currentChatSession.aiCharacters
    );
  }, [apiKey, currentChatSession, isLoading, updateChatSession, logApiRequestDirectly, setMessageGenerationTimes, onNewAIMessageFinalized, rotateApiKey]);


  const handleRegenerateResponseForUserMessage = useCallback(async (sessionId: string, userMessageId: string) => {
    if (!currentChatSession || isLoading || currentChatSession.id !== sessionId) return;

    const userMessageIndex = currentChatSession.messages.findIndex(m => m.id === userMessageId && m.role === ChatMessageRole.USER);
    if (userMessageIndex === -1) return;

    let targetAiMessageId: string | null = null;
    let targetAiMessageIndex = -1;
    if (userMessageIndex + 1 < currentChatSession.messages.length) {
        const nextMessage = currentChatSession.messages[userMessageIndex + 1];
        if (nextMessage.role === ChatMessageRole.MODEL || nextMessage.role === ChatMessageRole.ERROR) {
            targetAiMessageId = nextMessage.id;
            targetAiMessageIndex = userMessageIndex + 1;
        }
    }

    if (!targetAiMessageId || targetAiMessageIndex === -1) {
        console.warn("No AI message found immediately after the user message to regenerate.");
        return;
    }

    await handleRegenerateAIMessage(sessionId, targetAiMessageId);

  }, [currentChatSession, isLoading, handleRegenerateAIMessage]);


  const handleEditPanelSubmit = useCallback(async (
    action: EditMessagePanelAction,
    newContent: string,
    editingMessageDetail: EditMessagePanelDetails
  ) => {
    if (!currentChatSession || isLoading) return;

    const { sessionId, messageId, role, attachments } = editingMessageDetail;
    if (currentChatSession.id !== sessionId) return;

    requestCancelledByUserRef.current = false;
    onFullResponseCalledForPendingMessageRef.current = false;
    originalMessageSnapshotRef.current = null;

    if (action === EditMessagePanelAction.SAVE_AND_SUBMIT) {
        const messageBeingEditedIndex = currentChatSession.messages.findIndex(m => m.id === messageId);
        if (messageBeingEditedIndex === -1) {
            console.error("Message to edit not found in current session.");
            return;
        }

        const originalMessagesAfterEditPoint = currentChatSession.messages.slice(messageBeingEditedIndex);
        await setMessageGenerationTimes(prevTimes => {
            const newTimesState = {...prevTimes};
            originalMessagesAfterEditPoint.forEach(msg => delete newTimesState[msg.id]);
            return newTimesState;
        });

        let historyForAPI: ChatMessage[];

        if (role === ChatMessageRole.USER) {
            // History *before* the message being edited.
            historyForAPI = getHistoryUpToMessage(currentChatSession.messages, messageBeingEditedIndex);
        } else { // Role is MODEL or ERROR
            const precedingUserMessageIndex = findPrecedingUserMessageIndex(currentChatSession.messages, messageBeingEditedIndex);
            if (precedingUserMessageIndex === -1) {
                console.error("Cannot resubmit AI edit: No preceding user message found.");
                return;
            }
            // History *up to and including* the user message that led to the AI message.
            historyForAPI = getHistoryUpToMessage(currentChatSession.messages, precedingUserMessageIndex + 1);
        }
        // `newContent` (and `attachments` if user role) will be passed as the current turn's prompt.
        // `historyForAPI` will be used as `historyContextOverride`.
        await handleSendMessage(newContent, role === ChatMessageRole.USER ? attachments : currentChatSession.messages[findPrecedingUserMessageIndex(currentChatSession.messages, messageBeingEditedIndex)]?.attachments, historyForAPI);

    } else if (action === EditMessagePanelAction.CONTINUE_PREFIX) {
        if (role !== ChatMessageRole.MODEL) {
            console.warn("Continue Prefix action is only for AI messages.");
            return;
        }
        const modelMessageToContinue = currentChatSession.messages.find(m => m.id === messageId);
        if (!modelMessageToContinue) {
            console.error("Message to continue not found.");
            return;
        }

        originalMessageSnapshotRef.current = { ...modelMessageToContinue, cachedAudioBuffers: null };
        pendingMessageIdRef.current = messageId;

        generationStartTimeRef.current = Date.now();
        setIsLoading(true);
        setCurrentGenerationTimeDisplay("0.0s");
        abortControllerRef.current = new AbortController();

        const updatedAiMessagePlaceholder: ChatMessage = {
            ...modelMessageToContinue,
            content: newContent, // The new prefix
            isStreaming: true,
            timestamp: new Date(),
            cachedAudioBuffers: null,
        };
        await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(msg => msg.id === messageId ? updatedAiMessagePlaceholder : msg)}) : null);
        await setMessageGenerationTimes(prev => { const n = {...prev}; delete n[messageId]; return n; });

        let settingsOverrideForContinue: Partial<GeminiSettings & { _characterIdForAPICall?: string }> = {};
        if (currentChatSession.isCharacterModeActive && modelMessageToContinue.characterName) {
            const character = (currentChatSession.aiCharacters || []).find(c => c.name === modelMessageToContinue.characterName);
            if (character) {
                settingsOverrideForContinue.systemInstruction = character.systemInstruction;
                settingsOverrideForContinue._characterIdForAPICall = character.id;
            }
        }

        const messageBeingContinuedIndex = currentChatSession.messages.findIndex(m => m.id === messageId);
        const userPromptForContinuationIndex = findPrecedingUserMessageIndex(currentChatSession.messages, messageBeingContinuedIndex);
        if (userPromptForContinuationIndex === -1) {
             console.error("Could not find user prompt for AI message continuation.");
             setIsLoading(false);
             if (originalMessageSnapshotRef.current) {
                await updateChatSession(sessionId, s => s ? ({...s, messages: s.messages.map(m => m.id === messageId ? originalMessageSnapshotRef.current! : m)}) : null);
             }
             return;
        }

        // History should include the original user prompt that led to the AI message being continued.
        const historyContext = getHistoryUpToMessage(currentChatSession.messages, userPromptForContinuationIndex + 1);

        // The content for the API call is the new prefix (newContent)
        const userMessageInputForContinue: UserMessageInput = {
            text: newContent, // This is the prefix the AI will continue from.
            attachments: currentChatSession.messages[userPromptForContinuationIndex].attachments
        };

        const onCompleteForContinue = async () => {
             if (requestCancelledByUserRef.current && pendingMessageIdRef.current === messageId) { /* Handled */ }
            else if (pendingMessageIdRef.current === messageId) {
                setIsLoading(false);
                setLastMessageHadAttachments(false);
                if (!onFullResponseCalledForPendingMessageRef.current) {
                    await updateChatSession(sessionId, session => {
                         if (!session) return null;
                        const msgInState = session.messages.find(m => m.id === messageId);
                        if (msgInState && msgInState.isStreaming && msgInState.role !== ChatMessageRole.ERROR) {
                            return {
                                ...session,
                                messages: session.messages.map(msg =>
                                    msg.id === messageId
                                    ? { ...msg, isStreaming: false, role: ChatMessageRole.ERROR, content: "Continuation failed or stream ended unexpectedly.", timestamp: new Date(), characterName: modelMessageToContinue.characterName, cachedAudioBuffers: null }
                                    : msg
                                ), lastUpdatedAt: new Date() };
                        } else if (msgInState && originalMessageSnapshotRef.current && msgInState.id === originalMessageSnapshotRef.current.id ) {
                             return { ...session, messages: session.messages.map(msg => msg.id === messageId ? originalMessageSnapshotRef.current! : msg), lastUpdatedAt: new Date() };
                        }
                        return {...session, lastUpdatedAt: new Date() };
                    });
                } else {
                    await updateChatSession(sessionId, session => session ? ({...session, lastUpdatedAt: new Date() }) : null);
                }
                pendingMessageIdRef.current = null; originalMessageSnapshotRef.current = null;
            }
            if (abortControllerRef.current && pendingMessageIdRef.current === messageId) abortControllerRef.current = null;
            if (pendingMessageIdRef.current === messageId) requestCancelledByUserRef.current = false;
            onFullResponseCalledForPendingMessageRef.current = false;
        };

        const onErrorForContinue = async (errorMsg: string, isAbortError?: boolean) => {
            if (requestCancelledByUserRef.current && pendingMessageIdRef.current === messageId) {
                if(isLoading) setIsLoading(false); setLastMessageHadAttachments(false);
                if (originalMessageSnapshotRef.current && originalMessageSnapshotRef.current.id === messageId) {
                    await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(m => m.id === originalMessageSnapshotRef.current!.id ? originalMessageSnapshotRef.current! : m) }) : null);
                }
                return;
            }
            onFullResponseCalledForPendingMessageRef.current = false;
            if ((isAbortError || errorMsg.toLowerCase().includes('aborted')) && pendingMessageIdRef.current === messageId) {
                if (originalMessageSnapshotRef.current && originalMessageSnapshotRef.current.id === messageId) {
                    await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(m => m.id === originalMessageSnapshotRef.current!.id ? originalMessageSnapshotRef.current! : m) }) : null);
                } else {
                     await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(msg => msg.id === messageId ? { ...updatedAiMessagePlaceholder, isStreaming: false, role: ChatMessageRole.ERROR, content: `Continuation aborted: ${errorMsg}`, cachedAudioBuffers: null } : msg)}) : null);
                }
            } else if (pendingMessageIdRef.current === messageId) {
                await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(msg => msg.id === messageId ? { ...updatedAiMessagePlaceholder, isStreaming: false, role: ChatMessageRole.ERROR, content: `Continuation failed: ${errorMsg}`, cachedAudioBuffers: null } : msg)}) : null);
            }
            if (!requestCancelledByUserRef.current && pendingMessageIdRef.current === messageId) { setIsLoading(false); setLastMessageHadAttachments(false); }
        };

        await getFullChatResponse(
            apiKey,
            sessionId,
            userMessageInputForContinue, // New prefix to continue
            currentChatSession.model,
            currentChatSession.settings,
            historyContext, // History including the user prompt that led to the original AI message
            async (responseData) => {
                if (requestCancelledByUserRef.current && pendingMessageIdRef.current === messageId) return;
                onFullResponseCalledForPendingMessageRef.current = true;
                if (generationStartTimeRef.current) await setMessageGenerationTimes(prev => ({ ...prev, [messageId]: (Date.now() - generationStartTimeRef.current!) / 1000 }));

                const finalContent = newContent + responseData.text;
                const continuedAiMessage: ChatMessage = {
                    ...updatedAiMessagePlaceholder, content: finalContent, groundingMetadata: responseData.groundingMetadata,
                    isStreaming: false, role: ChatMessageRole.MODEL, timestamp: new Date(), cachedAudioBuffers: null,
                };

                await updateChatSession(sessionId, s => s ? ({ ...s, messages: s.messages.map(msg => msg.id === messageId ? continuedAiMessage : msg)}) : null);
                if (onNewAIMessageFinalized) {
                     await onNewAIMessageFinalized(continuedAiMessage);
                }
            },
            onErrorForContinue,
            onCompleteForContinue,
            logApiRequestDirectly,
            abortControllerRef.current.signal,
            settingsOverrideForContinue,
            currentChatSession.aiCharacters
        );
    }
    // SAVE_LOCALLY and CANCEL are handled by useChatInteractions hook's wrapper
  }, [
      apiKey, currentChatSession, isLoading, updateChatSession, handleSendMessage, logApiRequestDirectly,
      setMessageGenerationTimes, onNewAIMessageFinalized, setLastMessageHadAttachments, rotateApiKey
  ]);


  return {
    isLoading,
    currentGenerationTimeDisplay,
    lastMessageHadAttachments,
    logApiRequest: logApiRequestDirectly,
    handleSendMessage,
    handleContinueFlow,
    handleCancelGeneration,
    handleRegenerateAIMessage,
    handleRegenerateResponseForUserMessage,
    handleEditPanelSubmit,
  };
}