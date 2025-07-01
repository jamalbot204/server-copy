
import { useCallback } from 'react';
import { ChatSession, ChatMessageRole, Attachment, LogApiRequestCallback } from '../types.ts'; // Adjusted paths
import { EditMessagePanelAction, EditMessagePanelDetails } from '../components/EditMessagePanel.tsx'; // Adjusted paths
import { INITIAL_MESSAGES_COUNT, DEFAULT_SETTINGS } from '../constants.ts'; // Adjusted paths
import { uploadFileViaApi, deleteFileViaApi } from '../services/geminiService.ts'; // Added deleteFileViaApi
 // Added for logApiRequest

interface UseChatInteractionsProps {
  apiKey: string;
  currentChatSession: ChatSession | null;
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
  openEditPanel: (details: EditMessagePanelDetails) => void; // From useAppModals
  closeEditPanel: () => void; // From useAppModals
  geminiHandleEditPanelSubmit: (action: EditMessagePanelAction, newContent: string, editingMessageDetail: EditMessagePanelDetails) => Promise<void>; // From useGemini
  geminiHandleCancelGeneration: () => Promise<void>; // From useGemini
  isLoadingFromGemini: boolean; // From useGemini
  setMessageGenerationTimes: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>; // From useAppPersistence
  setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>; // From useAppPersistence
  stopAndCancelAudio: () => void; // From useAudioControls
  activeAutoFetches: Map<string, AbortController>; // Simplified: This prop is no longer for the old auto-fetch state
  setActiveAutoFetches: React.Dispatch<React.SetStateAction<Map<string, AbortController>>>; // Simplified
  requestDeleteConfirmationModal: (sessionId: string, messageId: string) => void; // From useAppModals
  requestResetAudioCacheConfirmationModal: (sessionId: string, messageId: string) => void; // From useAppModals
  isSettingsPanelOpen: boolean; 
  closeSettingsPanel: () => void; 
  closeSidebar: () => void; 
  logApiRequest: LogApiRequestCallback; // Add logApiRequest
}

// Helper function to convert base64 string to a File object
function base64StringToFile(base64String: string, filename: string, mimeType: string): File {
  try {
    const byteCharacters = atob(base64String);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return new File([blob], filename, { type: mimeType });
  } catch (error) {
    console.error("Error in base64StringToFile:", error);
    // Return a dummy/empty file or throw, depending on desired error handling
    // For now, let's throw to make the error apparent.
    throw new Error("Failed to convert base64 string to File object.");
  }
}


export function useChatInteractions({
  apiKey,
  currentChatSession,
  updateChatSession,
  showToast,
  openEditPanel,
  closeEditPanel,
  geminiHandleEditPanelSubmit,
  geminiHandleCancelGeneration,
  isLoadingFromGemini,
  setMessageGenerationTimes,
  setMessagesToDisplayConfig,
  stopAndCancelAudio,
  requestDeleteConfirmationModal, 
  requestResetAudioCacheConfirmationModal,
  isSettingsPanelOpen,
  closeSettingsPanel,
  closeSidebar,
  logApiRequest,
}: UseChatInteractionsProps) {

  const handleActualCopyMessage = useCallback(async (content: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(content);
      showToast("Copied!", "success");
      return true;
    } catch (err) {
      console.error("Failed to copy message: ", err);
      showToast("Failed to copy message.", "error");
      return false;
    }
  }, [showToast]);

  const handleDeleteMessageAndSubsequent = useCallback(async (sessionId: string, messageId: string) => {
    if (currentChatSession?.messages.find(m => m.id === messageId)?.cachedAudioBuffers) {
        stopAndCancelAudio();
    }
    // The old activeAutoFetches map for proactive background fetch is no longer managed here.
    // Cancellation of individual segment fetches is handled by useAudioPlayer/useAudioControls.

    await updateChatSession(sessionId, (session) => {
      if (!session) return null;
      const messageIndex = session.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return session;
      const newMessages = session.messages.slice(0, messageIndex);
      
      setMessageGenerationTimes(prevTimes => {
        const newTimesState = { ...prevTimes };
        session.messages.slice(messageIndex).forEach(msg => delete newTimesState[msg.id]);
        return newTimesState;
      }).catch(console.error);

      const maxInitial = session.settings.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
      setMessagesToDisplayConfig(prev => ({
        ...prev,
        [sessionId]: Math.min(newMessages.length, maxInitial)
      })).catch(console.error);
      return { ...session, messages: newMessages };
    });
    // showToast is handled by App.tsx after confirmation
  }, [currentChatSession, updateChatSession, setMessageGenerationTimes, setMessagesToDisplayConfig, stopAndCancelAudio]);

  const handleDeleteSingleMessageOnly = useCallback(async (sessionId: string, messageId: string) => {
    if (currentChatSession?.messages.find(m => m.id === messageId)?.cachedAudioBuffers) {
        stopAndCancelAudio();
    }
    // The old activeAutoFetches map for proactive background fetch is no longer managed here.

    await updateChatSession(sessionId, (session) => {
      if (!session) return null;
      const newMessages = session.messages.filter(m => m.id !== messageId);
      
      setMessageGenerationTimes(prevTimes => {
        const newTimesState = { ...prevTimes };
        delete newTimesState[messageId];
        return newTimesState;
      }).catch(console.error);

      const maxInitial = session.settings.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
      setMessagesToDisplayConfig(prev => ({
        ...prev,
        [sessionId]: Math.min(newMessages.length, maxInitial)
      })).catch(console.error);
      return { ...session, messages: newMessages };
    });
    showToast("Message deleted.", "success");
  }, [currentChatSession, updateChatSession, setMessageGenerationTimes, setMessagesToDisplayConfig, stopAndCancelAudio, showToast]);

  const handleOpenEditMessagePanel = useCallback((sessionId: string, messageId: string, currentContent: string, role: ChatMessageRole, attachments?: Attachment[]) => {
    const chat = currentChatSession; 
    if (!chat || chat.id !== sessionId) return;
    openEditPanel({
      sessionId, messageId, originalContent: currentContent, role, attachments,
      // model and settings are not part of EditMessagePanelDetails
    });
    if (isSettingsPanelOpen) closeSettingsPanel();
    closeSidebar();
  }, [currentChatSession, openEditPanel, isSettingsPanelOpen, closeSettingsPanel, closeSidebar]);

  const handleEditPanelSubmitWrapper = useCallback(async (
    action: EditMessagePanelAction,
    newContent: string,
    editingMessageDetail: EditMessagePanelDetails
  ) => {
    if (!currentChatSession) return;

    const { sessionId, messageId, role, originalContent } = editingMessageDetail;

    const messageToEdit = currentChatSession.messages.find(m => m.id === messageId);
    const contentChanged = newContent.trim() !== originalContent.trim();

    if (action === EditMessagePanelAction.SAVE_LOCALLY) {
        if (!contentChanged) {
            closeEditPanel();
            return;
        }
        if (contentChanged && messageToEdit?.cachedAudioBuffers?.some(b => b !== null)) {
            requestResetAudioCacheConfirmationModal(sessionId, messageId);
        }
        await updateChatSession(sessionId, session => session ? ({
            ...session,
            messages: session.messages.map(msg =>
                (msg.id === messageId)
                ? { ...msg, content: newContent, timestamp: new Date(), cachedAudioBuffers: null }
                : msg
            )
        }) : null);

        if (role === ChatMessageRole.MODEL || role === ChatMessageRole.ERROR) {
            await setMessageGenerationTimes(prev => { const n = {...prev}; delete n[messageId]; return n; });
        }
        closeEditPanel();
        showToast("Saved locally!", "success");
        return;
    }
    
    if (action === EditMessagePanelAction.CANCEL) {
        if (isLoadingFromGemini && editingMessageDetail.role === ChatMessageRole.MODEL) {
            await geminiHandleCancelGeneration();
        }
        closeEditPanel();
        return;
    }

    // For AI-interacting actions (SAVE_AND_SUBMIT, CONTINUE_PREFIX)
    if (action === EditMessagePanelAction.SAVE_AND_SUBMIT || action === EditMessagePanelAction.CONTINUE_PREFIX) {
        if (contentChanged && messageToEdit?.cachedAudioBuffers?.some(b => b !== null)) {
            requestResetAudioCacheConfirmationModal(sessionId, messageId);
        }
        // Ensure audio cache is cleared for the message being edited/continued before Gemini call
        await updateChatSession(sessionId, session => session ? ({
            ...session, messages: session.messages.map(msg => msg.id === messageId ? { ...msg, cachedAudioBuffers: null } : msg)
        }) : null);

        closeEditPanel(); // Close panel immediately
        showToast(
            action === EditMessagePanelAction.SAVE_AND_SUBMIT ? "Submitting to AI..." : "Continuing with AI...",
            "success"
        );
        try {
            await geminiHandleEditPanelSubmit(action, newContent, editingMessageDetail);
        } catch (e: any) {
            console.error(`Error during ${action}:`, e);
            showToast(`Failed to ${action.replace('_', ' ').toLowerCase()}. Error: ${e.message || 'Unknown error'}`, "error");
        }
        return;
    }
    
    // Fallback if an unknown action is passed, though this shouldn't happen with current enum
    console.warn("Unhandled EditMessagePanelAction:", action);
    closeEditPanel();

  }, [
    currentChatSession,
    updateChatSession,
    closeEditPanel,
    showToast,
    requestResetAudioCacheConfirmationModal,
    setMessageGenerationTimes,
    geminiHandleEditPanelSubmit,
    isLoadingFromGemini,
    geminiHandleCancelGeneration
  ]);


  const handleLoadMoreDisplayMessages = useCallback(async (chatId: string, count: number) => {
    if (!currentChatSession || currentChatSession.id !== chatId) return;
    await setMessagesToDisplayConfig(prev => ({
      ...prev,
      [chatId]: Math.min((prev[chatId] || 0) + count, currentChatSession.messages.length)
    }));
  }, [currentChatSession, setMessagesToDisplayConfig]);

  const handleLoadAllDisplayMessages = useCallback(async (chatId: string) => {
    if (!currentChatSession || currentChatSession.id !== chatId) return;
    await setMessagesToDisplayConfig(prev => ({
      ...prev,
      [chatId]: currentChatSession.messages.length
    }));
  }, [currentChatSession, setMessagesToDisplayConfig]);
  
  const handleClearApiLogs = useCallback(async (sessionId: string) => {
    if (!currentChatSession || currentChatSession.id !== sessionId) return;
    await updateChatSession(sessionId, session => session ? ({ ...session, apiRequestLogs: [] }) : null);
    showToast("API logs cleared for this session.", "success");
  }, [currentChatSession, updateChatSession, showToast]);

  const handleClearChatCacheForCurrentSession = useCallback(() => {
    if (!currentChatSession) {
      showToast("No active chat session to clear cache for.", "error");
      return;
    }
    showToast("Model cache will be cleared on next interaction if settings changed.", "success");
    if (isSettingsPanelOpen) closeSettingsPanel();
  }, [currentChatSession, showToast, isSettingsPanelOpen, closeSettingsPanel]);

  const handleReUploadAttachment = useCallback(async (sessionId: string, messageId: string, attachmentId: string) => {
    if (!currentChatSession || currentChatSession.id !== sessionId) return;

    let originalAttachment: Attachment | undefined;

    await updateChatSession(sessionId, session => {
      if (!session) return null;
      const messageIndex = session.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return session;

      const attachmentIndex = session.messages[messageIndex].attachments?.findIndex(a => a.id === attachmentId);
      if (attachmentIndex === undefined || attachmentIndex === -1 || !session.messages[messageIndex].attachments) return session;
      
      originalAttachment = session.messages[messageIndex].attachments![attachmentIndex];

      const updatedAttachments = [...session.messages[messageIndex].attachments!];
      updatedAttachments[attachmentIndex] = {
        ...updatedAttachments[attachmentIndex],
        isReUploading: true,
        reUploadError: undefined,
        statusMessage: "Re-uploading...",
      };
      const updatedMessages = [...session.messages];
      updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], attachments: updatedAttachments };
      return { ...session, messages: updatedMessages };
    });

    if (!originalAttachment || !originalAttachment.base64Data || !originalAttachment.mimeType) {
      showToast("Cannot re-upload: Missing original file data.", "error");
      await updateChatSession(sessionId, session => { /* revert isReUploading state */
         if (!session) return null;
          const messageIndex = session.messages.findIndex(m => m.id === messageId);
          if (messageIndex === -1) return session;
           const attachmentIndex = session.messages[messageIndex].attachments?.findIndex(a => a.id === attachmentId);
          if (attachmentIndex === undefined || attachmentIndex === -1 || !session.messages[messageIndex].attachments) return session;
          const updatedAttachments = [...session.messages[messageIndex].attachments!];
            updatedAttachments[attachmentIndex] = {
                ...updatedAttachments[attachmentIndex],
                isReUploading: false,
                reUploadError: "Missing original file data.",
                statusMessage: "Re-upload failed: data missing.",
            };
            const updatedMessages = [...session.messages];
            updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], attachments: updatedAttachments };
            return { ...session, messages: updatedMessages };
      });
      return;
    }

    try {
      const fileToReUpload = base64StringToFile(originalAttachment.base64Data, originalAttachment.name, originalAttachment.mimeType);
      
      const uploadResult = await uploadFileViaApi(apiKey, fileToReUpload, logApiRequest);

      if (uploadResult.error || !uploadResult.fileUri || !uploadResult.fileApiName) {
        throw new Error(uploadResult.error || "Failed to get new file URI from API.");
      }

      // Attempt to delete the old file if it existed
      if (originalAttachment.fileApiName) {
        try {
          await deleteFileViaApi(apiKey, originalAttachment.fileApiName, logApiRequest);
        } catch (deleteError: any) {
          console.warn("Failed to delete old file during re-upload:", deleteError);
          showToast(`Old file deletion failed: ${deleteError.message}`, "error"); // Non-critical error
        }
      }

      // Update the attachment with new URI and name
      await updateChatSession(sessionId, session => {
        if (!session) return null;
        const messageIndex = session.messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return session;
        const attachmentIndex = session.messages[messageIndex].attachments?.findIndex(a => a.id === attachmentId);
        if (attachmentIndex === undefined || attachmentIndex === -1 || !session.messages[messageIndex].attachments) return session;

        const updatedAttachments = [...session.messages[messageIndex].attachments!];
        updatedAttachments[attachmentIndex] = {
          ...updatedAttachments[attachmentIndex],
          fileUri: uploadResult.fileUri,
          fileApiName: uploadResult.fileApiName,
          uploadState: 'completed_cloud_upload',
          statusMessage: 'Cloud URL refreshed.',
          isReUploading: false,
          reUploadError: undefined,
          error: undefined, // Clear previous errors
        };
        const updatedMessages = [...session.messages];
        updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], attachments: updatedAttachments };
        return { ...session, messages: updatedMessages };
      });
      showToast("File URL refreshed successfully!", "success");

    } catch (error: any) {
      console.error("Error re-uploading attachment:", error);
      showToast(`Re-upload failed: ${error.message || "Unknown error"}`, "error");
      await updateChatSession(sessionId, session => {
        if (!session) return null;
        const messageIndex = session.messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return session;
        const attachmentIndex = session.messages[messageIndex].attachments?.findIndex(a => a.id === attachmentId);
        if (attachmentIndex === undefined || attachmentIndex === -1 || !session.messages[messageIndex].attachments) return session;
        
        const updatedAttachments = [...session.messages[messageIndex].attachments!];
        updatedAttachments[attachmentIndex] = {
          ...updatedAttachments[attachmentIndex],
          isReUploading: false,
          reUploadError: error.message || "Unknown re-upload error.",
          statusMessage: "Re-upload failed.",
        };
        const updatedMessages = [...session.messages];
        updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], attachments: updatedAttachments };
        return { ...session, messages: updatedMessages };
      });
    }
  }, [apiKey, currentChatSession, updateChatSession, showToast, logApiRequest]);


  return {
    handleActualCopyMessage,
    handleDeleteMessageAndSubsequent, 
    handleDeleteSingleMessageOnly,
    handleOpenEditMessagePanel,
    handleEditPanelSubmitWrapper, 
    handleLoadMoreDisplayMessages,
    handleLoadAllDisplayMessages,
    handleClearApiLogs,
    handleClearChatCacheForCurrentSession,
    requestDeleteConfirmationModal, 
    handleReUploadAttachment, // Expose new handler
  };
}