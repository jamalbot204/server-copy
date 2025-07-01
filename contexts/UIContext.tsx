
import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useAppUI, ToastInfo } from '../hooks/useAppUI.ts';
import { useAppModals, FilenameInputModalTriggerProps } from '../hooks/useAppModals.ts';
import { EditMessagePanelDetails } from '../components/EditMessagePanel.tsx';
import { AICharacter, ChatSession, AttachmentWithContext } from '../types.ts';

// Define the shape of the context data
interface UIContextType {
  // From useAppUI
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean | ((prevState: boolean) => boolean)) => void;
  layoutDirection: 'ltr' | 'rtl';
  setLayoutDirection: (direction: 'ltr' | 'rtl') => void;
  toastInfo: ToastInfo | null;
  setToastInfo: React.Dispatch<React.SetStateAction<ToastInfo | null>>;
  showToast: (message: string, type?: 'success' | 'error', duration?: number) => void;
  closeSidebar: () => void;
  handleToggleSidebar: () => void;
  handleToggleLayoutDirection: () => void;
  
  // From useAppModals
  isSettingsPanelOpen: boolean;
  openSettingsPanel: () => void;
  closeSettingsPanel: () => void;
  isTtsSettingsModalOpen: boolean;
  openTtsSettingsModal: () => void;
  closeTtsSettingsModal: () => void;
  isEditPanelOpen: boolean;
  editingMessageDetail: EditMessagePanelDetails | null;
  openEditPanel: (details: EditMessagePanelDetails) => void;
  closeEditPanel: () => void;
  isCharacterManagementModalOpen: boolean;
  openCharacterManagementModal: () => void;
  closeCharacterManagementModal: () => void;
  isContextualInfoModalOpen: boolean;
  editingCharacterForContextualInfo: AICharacter | null;
  openCharacterContextualInfoModal: (character: AICharacter) => void;
  closeCharacterContextualInfoModal: () => void;
  isDebugTerminalOpen: boolean;
  openDebugTerminal: () => void;
  closeDebugTerminal: () => void;
  isExportConfigModalOpen: boolean;
  openExportConfigurationModal: () => void;
  closeExportConfigurationModal: () => void;
  isDeleteConfirmationOpen: boolean;
  deleteTarget: { sessionId: string; messageId: string } | null;
  requestDeleteConfirmation: (sessionId: string, messageId: string) => void;
  cancelDeleteConfirmation: () => void;
  setIsDeleteConfirmationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isResetAudioConfirmationOpen: boolean;
  resetAudioTarget: { sessionId: string; messageId: string } | null;
  requestResetAudioCacheConfirmation: (sessionId: string, messageId: string) => void;
  cancelResetAudioCacheConfirmation: () => void;
  setIsResetAudioConfirmationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isApiKeyModalOpen: boolean;
  openApiKeyModal: () => void;
  closeApiKeyModal: () => void;

  // For FilenameInputModal
  isFilenameInputModalOpen: boolean;
  filenameInputModalProps: FilenameInputModalTriggerProps | null;
  openFilenameInputModal: (props: FilenameInputModalTriggerProps) => void;
  closeFilenameInputModal: () => void;
  submitFilenameInputModal: (filename: string) => void;

  // For ChatAttachmentsModal
  isChatAttachmentsModalOpen: boolean;
  attachmentsForModal: AttachmentWithContext[];
  openChatAttachmentsModal: (session: ChatSession | null) => void;
  closeChatAttachmentsModal: () => void;

  // For multi-select
  isSelectionModeActive: boolean;
  selectedMessageIds: Set<string>;
  toggleSelectionMode: () => void;
  toggleMessageSelection: (messageId: string) => void;
  clearSelection: () => void;
  selectAllVisible: (visibleMessageIds: string[]) => void;
}

// Create the context with a default value of null
const UIContext = createContext<UIContextType | null>(null);

// Create the Provider component
export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const uiState = useAppUI();
  // Pass showToast from uiState to useAppModals
  const modalsState = useAppModals(uiState.closeSidebar, uiState.showToast);

  const value = useMemo(() => ({
    ...uiState,
    ...modalsState,
  }), [uiState, modalsState]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

// Create a custom hook for easy access to the context
export const useUIContext = (): UIContextType => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUIContext must be used within a UIProvider');
  }
  return context;
};
