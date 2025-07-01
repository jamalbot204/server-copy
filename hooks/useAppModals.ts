import { useState, useCallback } from 'react';
import { EditMessagePanelDetails } from '../components/EditMessagePanel.tsx'; // Adjusted path
import { AICharacter, ChatSession, AttachmentWithContext } from '../types.ts'; // Adjusted path

// Props for FilenameInputModal trigger
export interface FilenameInputModalTriggerProps {
  defaultFilename: string;
  promptMessage: string;
  onSubmit: (filename: string) => void;
}

export function useAppModals(
    closeSidebar: () => void, // Callback from useAppUI
    showToast: (message: string, type?: 'success' | 'error', duration?: number) => void // Callback from useAppUI
) {
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [isTtsSettingsModalOpen, setIsTtsSettingsModalOpen] = useState(false);
  const [isEditPanelOpen, setIsEditPanelOpen] = useState(false);
  const [editingMessageDetail, setEditingMessageDetail] = useState<EditMessagePanelDetails | null>(null);
  const [isCharacterManagementModalOpen, setIsCharacterManagementModalOpen] = useState(false);
  const [isContextualInfoModalOpen, setIsContextualInfoModalOpen] = useState(false);
  const [editingCharacterForContextualInfo, setEditingCharacterForContextualInfo] = useState<AICharacter | null>(null);
  const [isDebugTerminalOpen, setIsDebugTerminalOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  
  const [isExportConfigModalOpen, setIsExportConfigModalOpenInternal] = useState(false);
  
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; messageId: string } | null>(null);
  const [isResetAudioConfirmationOpen, setIsResetAudioConfirmationOpen] = useState(false);
  const [resetAudioTarget, setResetAudioTarget] = useState<{ sessionId: string; messageId: string } | null>(null);

  // New state for FilenameInputModal
  const [isFilenameInputModalOpen, setIsFilenameInputModalOpen] = useState(false);
  const [filenameInputModalProps, setFilenameInputModalProps] = useState<FilenameInputModalTriggerProps | null>(null);
  
  // New state for ChatAttachmentsModal
  const [isChatAttachmentsModalOpen, setIsChatAttachmentsModalOpen] = useState(false);
  const [attachmentsForModal, setAttachmentsForModal] = useState<AttachmentWithContext[]>([]);


  const openSettingsPanel = useCallback(() => { setIsSettingsPanelOpen(true); closeSidebar(); }, [closeSidebar]);
  const closeSettingsPanel = useCallback(() => setIsSettingsPanelOpen(false), []);
  
  const openTtsSettingsModal = useCallback(() => { setIsTtsSettingsModalOpen(true); closeSidebar(); }, [closeSidebar]);
  const closeTtsSettingsModal = useCallback(() => setIsTtsSettingsModalOpen(false), []);

  const openEditPanel = useCallback((details: EditMessagePanelDetails) => {
    setEditingMessageDetail(details);
    setIsEditPanelOpen(true);
    if (isSettingsPanelOpen) setIsSettingsPanelOpen(false);
    closeSidebar();
  }, [isSettingsPanelOpen, closeSidebar]);
  const closeEditPanel = useCallback(() => { setIsEditPanelOpen(false); setEditingMessageDetail(null); }, []);

  const openCharacterManagementModal = useCallback(() => { setIsCharacterManagementModalOpen(true); closeSidebar(); }, [closeSidebar]);
  const closeCharacterManagementModal = useCallback(() => setIsCharacterManagementModalOpen(false), []);

  const openCharacterContextualInfoModal = useCallback((character: AICharacter) => {
    setEditingCharacterForContextualInfo(character);
    setIsContextualInfoModalOpen(true);
    closeSidebar();
  }, [closeSidebar]);
  const closeCharacterContextualInfoModal = useCallback(() => {
    setIsContextualInfoModalOpen(false);
    setEditingCharacterForContextualInfo(null);
  }, []);

  const openDebugTerminal = useCallback(() => { setIsDebugTerminalOpen(true); closeSidebar(); }, [closeSidebar]);
  const closeDebugTerminal = useCallback(() => setIsDebugTerminalOpen(false), []);

  const openExportConfigurationModal = useCallback(() => { setIsExportConfigModalOpenInternal(true); closeSidebar(); }, [closeSidebar]);
  const closeExportConfigurationModal = useCallback(() => setIsExportConfigModalOpenInternal(false), []);

  const requestDeleteConfirmation = useCallback((sessionId: string, messageId: string) => {
    setDeleteTarget({ sessionId, messageId });
    setIsDeleteConfirmationOpen(true);
    closeSidebar();
  }, [closeSidebar]);
  const cancelDeleteConfirmation = useCallback(() => {
    setIsDeleteConfirmationOpen(false);
    setDeleteTarget(null);
  }, []);

  const requestResetAudioCacheConfirmation = useCallback((sessionId: string, messageId: string) => {
    setResetAudioTarget({ sessionId, messageId });
    setIsResetAudioConfirmationOpen(true);
    closeSidebar();
  }, [closeSidebar]);
  const cancelResetAudioCacheConfirmation = useCallback(() => {
    setIsResetAudioConfirmationOpen(false);
    setResetAudioTarget(null);
  }, []);

  // Handlers for FilenameInputModal
  const openFilenameInputModal = useCallback((props: FilenameInputModalTriggerProps) => {
    setFilenameInputModalProps(props);
    setIsFilenameInputModalOpen(true);
    closeSidebar();
  }, [closeSidebar]);

  const closeFilenameInputModal = useCallback(() => {
    setIsFilenameInputModalOpen(false);
    setFilenameInputModalProps(null);
  }, []);

  const submitFilenameInputModal = useCallback((filename: string) => {
    if (filenameInputModalProps) {
      filenameInputModalProps.onSubmit(filename);
    }
    closeFilenameInputModal();
  }, [filenameInputModalProps, closeFilenameInputModal]);

  // Handlers for ChatAttachmentsModal
  const openChatAttachmentsModal = useCallback((session: ChatSession | null) => {
    if (!session || !session.messages || session.messages.length === 0) {
      showToast("No chat session active or session has no messages.", "error");
      return;
    }

    const allAttachments = session.messages.flatMap(msg =>
      (msg.attachments || []).map(att => ({
        attachment: att,
        messageId: msg.id,
        messageTimestamp: msg.timestamp,
        messageRole: msg.role,
        messageContentSnippet: msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : ''),
      }))
    ).filter(item => item.attachment);

    if (allAttachments.length === 0) {
      showToast("No attachments found in this chat.", "success");
      return;
    }
    
    allAttachments.sort((a, b) => new Date(b.messageTimestamp).getTime() - new Date(a.messageTimestamp).getTime());
    setAttachmentsForModal(allAttachments);
    setIsChatAttachmentsModalOpen(true);
    closeSidebar();
    if (isSettingsPanelOpen) setIsSettingsPanelOpen(false); // Close settings panel if it was open
  }, [closeSidebar, showToast, isSettingsPanelOpen]);

  const closeChatAttachmentsModal = useCallback(() => {
    setIsChatAttachmentsModalOpen(false);
    setAttachmentsForModal([]);
  }, []);

  const openApiKeyModal = useCallback(() => {
    setIsApiKeyModalOpen(true);
  }, []);

  const closeApiKeyModal = useCallback(() => {
    setIsApiKeyModalOpen(false);
  }, []);


  return {
    isSettingsPanelOpen, openSettingsPanel, closeSettingsPanel,
    isTtsSettingsModalOpen, openTtsSettingsModal, closeTtsSettingsModal,
    isEditPanelOpen, editingMessageDetail, openEditPanel, closeEditPanel,
    isCharacterManagementModalOpen, openCharacterManagementModal, closeCharacterManagementModal,
    isContextualInfoModalOpen, editingCharacterForContextualInfo, openCharacterContextualInfoModal, closeCharacterContextualInfoModal,
    isDebugTerminalOpen, openDebugTerminal, closeDebugTerminal,
    isExportConfigModalOpen, openExportConfigurationModal, closeExportConfigurationModal,
    isDeleteConfirmationOpen, deleteTarget, requestDeleteConfirmation, cancelDeleteConfirmation, setIsDeleteConfirmationOpen,
    isResetAudioConfirmationOpen, resetAudioTarget, requestResetAudioCacheConfirmation, cancelResetAudioCacheConfirmation, setIsResetAudioConfirmationOpen,
    isApiKeyModalOpen, openApiKeyModal, closeApiKeyModal,
    
    // FilenameInputModal related
    isFilenameInputModalOpen,
    filenameInputModalProps,
    openFilenameInputModal,
    closeFilenameInputModal,
    submitFilenameInputModal,

    // ChatAttachmentsModal related
    isChatAttachmentsModalOpen,
    attachmentsForModal,
    openChatAttachmentsModal,
    closeChatAttachmentsModal,
  };
}
