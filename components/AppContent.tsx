

import React, { useRef, useCallback, useState, memo } from 'react';
import { useSessionState } from '../contexts/SessionContext.tsx';
import { useMessageContext } from '../contexts/MessageContext.tsx';
import { useUIContext } from '../contexts/UIContext.tsx';
import { useAudioContext } from '../contexts/AudioContext.tsx';
import { useApiKeyContext } from '../contexts/ApiKeyContext.tsx'; // Import ApiKey context

import Sidebar from './Sidebar.tsx';
import ChatView, { ChatViewHandles } from './ChatView.tsx';
import ReadModeView from './ReadModeView.tsx';
import SettingsPanel from './SettingsPanel.tsx';
import EditMessagePanel from './EditMessagePanel.tsx';
import CharacterManagementModal from './CharacterManagementModal.tsx';
import CharacterContextualInfoModal from './CharacterContextualInfoModal.tsx';
import DebugTerminalPanel from './DebugTerminalPanel.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import ToastNotification from './ToastNotification.tsx';
import TtsSettingsModal from './TtsSettingsModal.tsx';
import AdvancedAudioPlayer from './AdvancedAudioPlayer.tsx';
import ExportConfigurationModal from './ExportConfigurationModal.tsx';
import FilenameInputModal from './FilenameInputModal.tsx';
import ChatAttachmentsModal from './ChatAttachmentsModal.tsx';
import MultiSelectActionBar from './MultiSelectActionBar.tsx';
import ApiKeyManagerModal from './ApiKeyManagerModal.tsx';


const AppContent: React.FC = memo(() => {
  const { isLoadingData, currentChatSession } = useSessionState();
  const { handleDeleteMessageAndSubsequent, performActualAudioCacheReset } = useMessageContext();
  const ui = useUIContext();
  const audio = useAudioContext();
  const { deleteApiKey } = useApiKeyContext(); // Get deleteApiKey function
  const chatViewRef = useRef<ChatViewHandles>(null);

  const [isReadModeOpen, setIsReadModeOpen] = useState(false);
  const [readModeContent, setReadModeContent] = useState('');

  const handleEnterReadMode = useCallback((content: string) => {
    setReadModeContent(content);
    setIsReadModeOpen(true);
  }, []);

  const handleCloseReadMode = useCallback(() => {
    setIsReadModeOpen(false);
    setReadModeContent('');
  }, []);

  const handleGoToMessage = useCallback(() => {
    if (audio.audioPlayerState.currentMessageId && chatViewRef.current) {
      const baseMessageId = audio.audioPlayerState.currentMessageId.split('_part_')[0];
      chatViewRef.current.scrollToMessage(baseMessageId);
    }
  }, [audio.audioPlayerState.currentMessageId]);

  const getFullTextForAudioBar = useCallback(() => {
    if (!audio.audioPlayerState.currentMessageId || !currentChatSession) return audio.audioPlayerState.currentPlayingText || "Playing audio...";
    const baseId = audio.audioPlayerState.currentMessageId.split('_part_')[0];
    const message = currentChatSession.messages.find(m => m.id === baseId);
    return message ? message.content : (audio.audioPlayerState.currentPlayingText || "Playing audio...");
  }, [audio.audioPlayerState, currentChatSession]);

  const handleGoToAttachmentInChat = useCallback((messageId: string) => {
    ui.closeChatAttachmentsModal();
    if (chatViewRef.current) {
      chatViewRef.current.scrollToMessage(messageId);
    }
  }, [ui]);

  const handleConfirmDeletion = useCallback(() => {
    if (ui.deleteTarget) {
      // Check if the target is an API key
      if (ui.deleteTarget.messageId === 'api-key') {
        deleteApiKey(ui.deleteTarget.sessionId);
        ui.showToast("API Key deleted.", "success");
      } else { // It's a message
        handleDeleteMessageAndSubsequent(ui.deleteTarget.sessionId, ui.deleteTarget.messageId);
        ui.showToast("Message and history deleted.", "success");
      }
    }
    ui.cancelDeleteConfirmation();
  }, [ui, deleteApiKey, handleDeleteMessageAndSubsequent]);

  const isAudioBarVisible = !!(audio.audioPlayerState.currentMessageId || audio.audioPlayerState.isLoading || audio.audioPlayerState.isPlaying || audio.audioPlayerState.currentPlayingText);
  
  if (isLoadingData) {
    return <div className="flex justify-center items-center h-screen bg-transparent text-white text-lg">Loading Chat Sessions...</div>;
  }

  return (
    <div className="flex h-screen antialiased text-[var(--aurora-text-primary)] bg-transparent overflow-hidden">
      <div className={`fixed inset-y-0 left-0 z-[60] transform transition-transform duration-300 ease-in-out ${ui.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} w-80`}>
        <Sidebar />
      </div>

      {ui.isSidebarOpen && <div className="fixed inset-0 z-30 bg-black bg-opacity-50 sm:hidden" onClick={ui.closeSidebar} aria-hidden="true" />}
      
      <main className={`flex-1 flex flex-col overflow-y-auto transition-all duration-300 ease-in-out ${ui.isSidebarOpen ? 'sm:ml-80' : 'ml-0'} ${isAudioBarVisible ? 'pt-[76px]' : ''}`}>
        <ChatView ref={chatViewRef} onEnterReadMode={handleEnterReadMode} />
      </main>
      
      <div className='absolute'>
        {isAudioBarVisible && (
            <div className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-in-out ${ui.isSidebarOpen ? 'sm:left-80' : 'left-0'}`}>
              <AdvancedAudioPlayer
                audioPlayerState={audio.audioPlayerState}
                onCloseView={audio.handleClosePlayerViewOnly} 
                onSeekRelative={audio.seekRelative}
                onSeekToAbsolute={audio.seekToAbsolute}
                onTogglePlayPause={audio.togglePlayPause}
                currentMessageText={getFullTextForAudioBar()}
                onGoToMessage={handleGoToMessage}
                onIncreaseSpeed={audio.increaseSpeed} 
                onDecreaseSpeed={audio.decreaseSpeed} 
              />
            </div>
        )}

        <ReadModeView isOpen={isReadModeOpen} content={readModeContent} onClose={handleCloseReadMode} />
        
        <SettingsPanel />
        <ApiKeyManagerModal />
        <ExportConfigurationModal />
        <TtsSettingsModal />
        <EditMessagePanel />
        <CharacterManagementModal />
        <CharacterContextualInfoModal />
        <DebugTerminalPanel />
        {ui.isSelectionModeActive && <MultiSelectActionBar />}
        <ChatAttachmentsModal
            isOpen={ui.isChatAttachmentsModalOpen}
            attachments={ui.attachmentsForModal}
            chatTitle={currentChatSession?.title || "Current Chat"}
            onClose={ui.closeChatAttachmentsModal}
            onGoToMessage={handleGoToAttachmentInChat}
        />

        {ui.isFilenameInputModalOpen && ui.filenameInputModalProps && (
          <FilenameInputModal
            isOpen={ui.isFilenameInputModalOpen}
            defaultFilename={ui.filenameInputModalProps.defaultFilename}
            promptMessage={ui.filenameInputModalProps.promptMessage}
            onSubmit={ui.submitFilenameInputModal}
            onClose={ui.closeFilenameInputModal}
          />
        )}

        <ConfirmationModal
          isOpen={ui.isDeleteConfirmationOpen}
          title="Confirm Deletion"
          message={ui.deleteTarget?.messageId === 'api-key' ? 'Are you sure you want to permanently delete this API key?' : <>Are you sure you want to delete this message and all <strong className="text-red-400">subsequent messages</strong> in this chat? <br/>This action cannot be undone.</>}
          confirmText="Yes, Delete" cancelText="No, Cancel"
          onConfirm={handleConfirmDeletion}
          onCancel={ui.cancelDeleteConfirmation}
          isDestructive={true}
        />
        <ConfirmationModal
          isOpen={ui.isResetAudioConfirmationOpen}
          title="Confirm Audio Reset"
          message="Are you sure you want to reset the audio cache for this message? This action cannot be undone."
          confirmText="Yes, Reset Audio" cancelText="No, Cancel"
          onConfirm={() => { 
            if(ui.resetAudioTarget) {
              performActualAudioCacheReset(ui.resetAudioTarget.sessionId, ui.resetAudioTarget.messageId);
            }
            ui.cancelResetAudioCacheConfirmation(); 
          }} 
          onCancel={ui.cancelResetAudioCacheConfirmation}
          isDestructive={true}
        />
        {ui.toastInfo && <ToastNotification message={ui.toastInfo.message} type={ui.toastInfo.type} onClose={() => ui.setToastInfo(null)} duration={ui.toastInfo.duration} />}
      </div>
    </div>
  );
});

export default AppContent;