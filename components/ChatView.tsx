
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useImperativeHandle, forwardRef, memo, useMemo } from 'react';
import { VariableSizeList } from 'react-window';
import { useSessionState, useSessionActions } from '../contexts/SessionContext.tsx';
import { useMessageContext } from '../contexts/MessageContext.tsx';
import { useInteractionStatus } from '../contexts/InteractionStatusContext.tsx';
import { useUIContext } from '../contexts/UIContext.tsx';
import { ChatMessage, ChatMessageRole, AICharacter } from '../types.ts';
import MessageItem from './MessageItem.tsx';
import { LOAD_MORE_MESSAGES_COUNT } from '../constants.ts';
import { Bars3Icon, FlowRightIcon, StopIcon, PaperClipIcon, XCircleIcon, DocumentIcon, PlayCircleIcon, UsersIcon, PlusIcon, ArrowsUpDownIcon, CheckIcon, InfoIcon, CloudArrowUpIcon, ServerIcon, SendIcon, ClipboardDocumentCheckIcon } from './Icons.tsx';
import AutoSendControls from './AutoSendControls.tsx';
import ManualSaveButton from './ManualSaveButton.tsx';
import { useAttachmentHandler } from '../hooks/useAttachmentHandler.ts';
import useAutoResizeTextarea from '../hooks/useAutoResizeTextarea.ts';
import { getModelDisplayName } from '../services/utils.ts';
import { useApiKeyContext } from '../contexts/ApiKeyContext.tsx';

interface ChatViewProps {
    onEnterReadMode: (content: string) => void;
}

export interface ChatViewHandles {
    scrollToMessage: (messageId: string) => void;
}

const ChatView = memo(forwardRef<ChatViewHandles, ChatViewProps>(({
    onEnterReadMode,
}, ref) => {
    const { currentChatSession, visibleMessagesForCurrentChat, currentChatId } = useSessionState();
    const { handleLoadMoreDisplayMessages, handleLoadAllDisplayMessages, handleManualSave } = useSessionActions();
    const { isLoading, currentGenerationTimeDisplay, autoSendHook } = useInteractionStatus();
    const {
        logApiRequest,
        handleSendMessage, handleContinueFlow, handleCancelGeneration, handleReorderCharacters
    } = useMessageContext();

    const ui = useUIContext();
    const { activeApiKey } = useApiKeyContext();

    const [inputMessage, setInputMessage] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useAutoResizeTextarea<HTMLTextAreaElement>(inputMessage);
    const [showLoadButtonsUI, setShowLoadButtonsUI] = useState(false);

    // --- Virtualization State and Refs ---
    const listRef = useRef<VariableSizeList>(null);
    const itemHeights = useRef(new Map<string, number>());
    const messageListContainerRef = useRef<HTMLDivElement>(null);
    const [listDimensions, setListDimensions] = useState({ width: 0, height: 0 });
    const [scrollToMessageId, setScrollToMessageId] = useState<{ id: string, align: 'start' | 'center' | 'end' } | null>(null);
    const userHasScrolledRef = useRef(false);
    // --- End Virtualization State ---

    const prevChatIdRef = useRef<string | null | undefined>(null);
    const prevVisibleMessagesLengthRef = useRef(0);

    const isCharacterMode = currentChatSession?.isCharacterModeActive || false;
    const [characters, setCharactersState] = useState<AICharacter[]>(currentChatSession?.aiCharacters || []);
    const [isReorderingActive, setIsReorderingActive] = useState(false);
    const draggedCharRef = useRef<AICharacter | null>(null);
    const characterButtonContainerRef = useRef<HTMLDivElement | null>(null);
    const [isInfoInputModeActive, setIsInfoInputModeActive] = useState(false);

    const attachmentHandler = useAttachmentHandler({
        apiKey: activeApiKey?.value || '',
        logApiRequestCallback: logApiRequest,
        isInfoInputModeActive,
        showToastCallback: ui.showToast,
    });
    const {
        selectedFiles,
        handleFileSelection,
        handlePaste,
        removeSelectedFile,
        getValidAttachmentsToSend,
        isAnyFileStillProcessing,
        resetSelectedFiles,
        getFileProgressDisplay,
        getDisplayFileType,
    } = attachmentHandler;

    const visibleMessages = visibleMessagesForCurrentChat || [];
    const totalMessagesInSession = currentChatSession ? currentChatSession.messages.length : 0;
    
    const prevVisibleMessagesRef = useRef<ChatMessage[]>(visibleMessages);
    useLayoutEffect(() => {
        const prevMessages = prevVisibleMessagesRef.current;
        const currentMessages = visibleMessages;
        const prevMessageMap = new Map(prevMessages.map(m => [m.id, m]));
        let needsReset = false;

        // Check for updates that affect height (like streaming state change)
        currentMessages.forEach((currentMsg, index) => {
            const prevMsg = prevMessageMap.get(currentMsg.id);
            if (prevMsg && prevMsg.isStreaming && !currentMsg.isStreaming) {
                // A message has just finished streaming (completed or cancelled).
                // Its height has likely changed.
                itemHeights.current.delete(currentMsg.id);
                if (listRef.current) {
                    listRef.current.resetAfterIndex(index);
                    needsReset = true; // Mark that a reset happened
                }
            }
        });

        // Check for deletions if no update-related reset happened
        if (!needsReset && prevMessages.length > currentMessages.length) {
            const currentMessageIds = new Set(currentMessages.map(m => m.id));
            const deletedMessages = prevMessages.filter(prevMsg => !currentMessageIds.has(prevMsg.id));
            
            if (deletedMessages.length > 0) {
                const firstDeletedIndex = prevMessages.findIndex(m => m.id === deletedMessages[0].id);
                deletedMessages.forEach(msg => {
                    itemHeights.current.delete(msg.id);
                });
                if (firstDeletedIndex !== -1 && listRef.current) {
                    listRef.current.resetAfterIndex(firstDeletedIndex);
                }
            }
        }

        // Update the ref for the next render
        prevVisibleMessagesRef.current = currentMessages;
    }, [visibleMessages]);

    // --- Virtualization Callbacks ---
    const getItemSize = useCallback((index: number): number => {
        const message = visibleMessages[index];
        return itemHeights.current.get(message.id) || 120; // Default estimate
    }, [visibleMessages]);

    const handleHeightChange = useCallback((messageId: string, height: number) => {
        const currentHeight = itemHeights.current.get(messageId);
        // Only trigger reset if height changes significantly to avoid jitter
        if (currentHeight === undefined || Math.abs(currentHeight - height) > 1) {
            itemHeights.current.set(messageId, height);
            const index = visibleMessages.findIndex(m => m.id === messageId);
            if (index !== -1 && listRef.current) {
                listRef.current.resetAfterIndex(index);
            }
        }
    }, [visibleMessages]);
    // --- End Virtualization Callbacks ---

    const handleLoadAll = useCallback(() => {
        if (!currentChatSession) return;
        handleLoadAllDisplayMessages(currentChatSession.id);
        setShowLoadButtonsUI(false);
    }, [currentChatSession, handleLoadAllDisplayMessages]);

    useImperativeHandle(ref, () => ({
        scrollToMessage: (messageId: string) => {
            const messageIndex = visibleMessages.findIndex(m => m.id === messageId);
            if (messageIndex !== -1) {
                listRef.current?.scrollToItem(messageIndex, 'center');
                setTimeout(() => {
                    const messageElement = document.getElementById(`message-item-${messageId}`);
                    if (messageElement) {
                        messageElement.classList.add('ring-2', 'ring-blue-400', 'transition-all', 'duration-1000', 'ease-out');
                        setTimeout(() => {
                            messageElement.classList.remove('ring-2', 'ring-blue-400', 'transition-all', 'duration-1000', 'ease-out');
                        }, 2500);
                    }
                }, 100);
            } else {
                if (currentChatSession && visibleMessages.length < totalMessagesInSession) {
                    const isMessageInFullList = currentChatSession.messages.some(m => m.id === messageId);
                    if (isMessageInFullList) {
                        setScrollToMessageId({ id: messageId, align: 'center' });
                        handleLoadAll();
                    }
                }
            }
        }
    }), [visibleMessages, totalMessagesInSession, currentChatSession, handleLoadAll]);

    useEffect(() => {
        setCharactersState(currentChatSession?.aiCharacters || []);
        if (!currentChatSession?.isCharacterModeActive && isInfoInputModeActive) {
            setIsInfoInputModeActive(false);
        }
    }, [currentChatSession?.aiCharacters, currentChatSession?.isCharacterModeActive, isInfoInputModeActive]);

    useLayoutEffect(() => {
        const container = messageListContainerRef.current;
        if (!container) return;
        const resizeObserver = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setListDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);
    
    // --- Virtualized Layout Effects ---
    useEffect(() => {
        // Effect to scroll to a message after its data has been loaded
        if (scrollToMessageId) {
            const index = visibleMessages.findIndex(m => m.id === scrollToMessageId.id);
            if (index !== -1) {
                listRef.current?.scrollToItem(index, scrollToMessageId.align);
                setScrollToMessageId(null);
            }
        }
    }, [scrollToMessageId, visibleMessages]);

    useLayoutEffect(() => {
        const listElement = listRef.current;
        if (!listElement) return;

        const isNewChatOrSwitched = prevChatIdRef.current !== currentChatId;
        const prevLength = prevVisibleMessagesLengthRef.current || 0;
        const currentLength = visibleMessages.length;
        const messagesAddedAtEnd = currentLength > prevLength;
        
        if (isNewChatOrSwitched) {
            listRef.current?.scrollToItem(currentLength - 1, 'end');
            userHasScrolledRef.current = false;
        } else if (messagesAddedAtEnd && !userHasScrolledRef.current) {
            const lastMessage = visibleMessages[currentLength - 1];
            const isStreamingOrNewOwnMessage = lastMessage?.isStreaming || lastMessage?.role === ChatMessageRole.USER;
            if (isStreamingOrNewOwnMessage) {
                listRef.current?.scrollToItem(currentLength - 1, 'end');
            }
        }
        prevVisibleMessagesLengthRef.current = currentLength;
        prevChatIdRef.current = currentChatId;
    }, [visibleMessages, currentChatId]);
    // --- End Virtualized Layout Effects ---
    
    // Effect for handling window resize
    useEffect(() => {
        let debounceTimer: number;

        const handleResize = () => {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                // Clear the entire height cache
                itemHeights.current.clear();
                // Force the list to re-measure all items
                if (listRef.current) {
                    listRef.current.resetAfterIndex(0);
                }
            }, 150); // 150ms debounce
        };

        window.addEventListener('resize', handleResize);

        // Cleanup function
        return () => {
            clearTimeout(debounceTimer);
            window.removeEventListener('resize', handleResize);
        };
    }, []); // Empty dependency array means this runs once on mount and cleans up on unmount.


    const handleSendMessageClick = useCallback(async (characterId?: string) => {
        const currentInputMessageValue = inputMessage;
        const attachmentsToSend = getValidAttachmentsToSend();
        let temporaryContextFlag = false;

        if (isLoading || !currentChatSession || autoSendHook.isAutoSendingActive) return;

        if (isAnyFileStillProcessing()) {
            ui.showToast("Some files are still being processed. Please wait for them to complete before sending.", "error");
            return;
        }

        if (isCharacterMode && characterId) {
            if (autoSendHook.isPreparingAutoSend) {
                autoSendHook.startAutoSend(autoSendHook.autoSendText, parseInt(autoSendHook.autoSendRepetitionsInput, 10) || 1, characterId);
                setInputMessage('');
                resetSelectedFiles();
                return;
            }
            if (isInfoInputModeActive) {
                temporaryContextFlag = !!currentInputMessageValue.trim();
            }
        } else if (!isCharacterMode) {
            if (currentInputMessageValue.trim() === '' && attachmentsToSend.length === 0) {
                return;
            }
        } else {
            return;
        }

        userHasScrolledRef.current = false; // User is sending, so they are at the bottom.
        setInputMessage('');
        resetSelectedFiles();
        if (isInfoInputModeActive && temporaryContextFlag) {
            setIsInfoInputModeActive(false);
        }
        await handleSendMessage(currentInputMessageValue, attachmentsToSend, undefined, characterId, temporaryContextFlag);
    }, [inputMessage, getValidAttachmentsToSend, isLoading, currentChatSession, autoSendHook, isAnyFileStillProcessing, ui, isCharacterMode, isInfoInputModeActive, handleSendMessage, resetSelectedFiles]);

    const handleContinueFlowClick = useCallback(async () => {
        if (isLoading || !currentChatSession || currentChatSession.messages.length === 0 || isCharacterMode || autoSendHook.isAutoSendingActive) return;
        userHasScrolledRef.current = false; // User is continuing, so they are at the bottom.
        setInputMessage('');
        resetSelectedFiles();
        await handleContinueFlow();
    }, [isLoading, currentChatSession, isCharacterMode, autoSendHook.isAutoSendingActive, handleContinueFlow, resetSelectedFiles]);

    const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isCharacterMode && !autoSendHook.isAutoSendingActive) {
                handleSendMessageClick();
            }
        }
    }, [isCharacterMode, autoSendHook.isAutoSendingActive, handleSendMessageClick]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputMessage(e.target.value);
    }, []);

    const handleListScroll = useCallback(({ scrollDirection, scrollOffset }: { scrollDirection: 'forward' | 'backward', scrollOffset: number }) => {
        if (scrollDirection === 'backward' && scrollOffset > 0) {
            userHasScrolledRef.current = true;
        }
        if (scrollOffset < 5 && currentChatSession && visibleMessages.length < totalMessagesInSession) {
            setShowLoadButtonsUI(true);
        } else if (showLoadButtonsUI) {
            setShowLoadButtonsUI(false);
        }
    }, [currentChatSession, visibleMessages.length, totalMessagesInSession, showLoadButtonsUI]);
    

    const handleLoadMore = useCallback((count: number) => {
        if (!currentChatSession) return;
        const topMessageId = visibleMessages[0]?.id;
        if(topMessageId) setScrollToMessageId({ id: topMessageId, align: 'start'});
        handleLoadMoreDisplayMessages(currentChatSession.id, count);
        setShowLoadButtonsUI(false);
    }, [currentChatSession, handleLoadMoreDisplayMessages, visibleMessages]);

    const toggleInfoInputMode = useCallback(() => {
        setIsInfoInputModeActive(prev => {
            if (!prev) {
                setInputMessage('');
                resetSelectedFiles();
                if (textareaRef.current) textareaRef.current.focus();
            }
            return !prev;
        });
    }, [resetSelectedFiles]);

    const handleDragStart = useCallback((e: React.DragEvent<HTMLButtonElement>, char: AICharacter) => {
        if (!isReorderingActive) return;
        draggedCharRef.current = char;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', char.id);
        e.currentTarget.classList.add('opacity-50', 'ring-2', 'ring-blue-500');
    }, [isReorderingActive]);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement | HTMLButtonElement>) => {
        e.preventDefault();
        if (!isReorderingActive || !draggedCharRef.current) return;
        e.dataTransfer.dropEffect = 'move';
    }, [isReorderingActive]);

    const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement | HTMLButtonElement>) => {
        e.preventDefault();
        if (!isReorderingActive || !draggedCharRef.current || !currentChatSession) return;
        
        const targetCharId = (e.target as HTMLElement).closest('button[data-char-id]')?.getAttribute('data-char-id');
        if (!targetCharId) return;

        const draggedChar = draggedCharRef.current;
        const currentChars = [...characters];
        
        const draggedIndex = currentChars.findIndex(c => c.id === draggedChar.id);
        const targetIndex = currentChars.findIndex(c => c.id === targetCharId);

        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

        const [removed] = currentChars.splice(draggedIndex, 1);
        currentChars.splice(targetIndex, 0, removed);
        
        setCharactersState(currentChars);
        await handleReorderCharacters(currentChars);
        draggedCharRef.current = null;
    }, [isReorderingActive, currentChatSession, characters, handleReorderCharacters]);

    const handleDragEnd = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
        if (!isReorderingActive) return;
        e.currentTarget.classList.remove('opacity-50', 'ring-2', 'ring-blue-500');
    }, [isReorderingActive]);

    const toggleReordering = useCallback(() => setIsReorderingActive(prev => !prev), []);
    
    const handleMainCancelButtonClick = useCallback(async () => {
        if (autoSendHook.isAutoSendingActive) {
            await autoSendHook.stopAutoSend();
        } else if (isLoading) {
            handleCancelGeneration();
        }
    }, [autoSendHook, isLoading, handleCancelGeneration]);

    const amountToLoad = Math.min(LOAD_MORE_MESSAGES_COUNT, totalMessagesInSession - visibleMessages.length);
    const hasValidInputForMainSend = inputMessage.trim() !== '' || getValidAttachmentsToSend().length > 0;
    
    const loadingMessageText = isLoading
        ? autoSendHook.isAutoSendingActive
            ? `Auto-sending: ${autoSendHook.autoSendRemaining} left... (${currentGenerationTimeDisplay})`
            : `Gemini is thinking... (${currentGenerationTimeDisplay})`
        : "";

    let placeholderText = "Type your message here... (Shift+Enter for new line, or paste files)";
    if (isCharacterMode) {
        placeholderText = isInfoInputModeActive
            ? "Enter one-time contextual info for the character..."
            : "Type message (optional), then select character...";
    }

    const Row = useMemo(() => memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: ChatMessage[] }) => {
        const msg = data[index];
        if (!msg) return <div style={style}></div>; // Should not happen but a good guard
    
        const fullMessageList = currentChatSession!.messages; 
        const currentMessageIndexInFullList = fullMessageList.findIndex(m => m.id === msg.id);
        const nextMessageInFullList = (currentMessageIndexInFullList !== -1 && currentMessageIndexInFullList < fullMessageList.length - 1) ? fullMessageList[currentMessageIndexInFullList + 1] : null;
        const canRegenerateFollowingAI = msg.role === ChatMessageRole.USER && nextMessageInFullList !== null && (nextMessageInFullList.role === ChatMessageRole.MODEL || nextMessageInFullList.role === ChatMessageRole.ERROR) && !isCharacterMode;
        
        return (
            <div style={style}>
                 <MessageItem 
                     message={msg} 
                     canRegenerateFollowingAI={canRegenerateFollowingAI} 
                     onEnterReadMode={onEnterReadMode}
                     onHeightChange={handleHeightChange}
                 />
            </div>
        );
    }), [currentChatSession, isCharacterMode, onEnterReadMode, handleHeightChange]);
    

    return (
        <div className="flex flex-col h-full bg-transparent overflow-hidden">
            <header className="p-3 sm:p-4 border-b border-[var(--aurora-border)] flex items-center space-x-3 flex-shrink-0 z-20 bg-black/20 backdrop-blur-sm">
                <button
                    onClick={ui.handleToggleSidebar}
                    className="p-1.5 text-[var(--aurora-text-secondary)] hover:text-[var(--aurora-text-primary)] bg-white/5 rounded-md focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)] transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]"
                    aria-label={ui.isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                    title={ui.isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                >
                    <Bars3Icon className="w-5 h-5" />
                </button>
                <div className="flex-grow overflow-hidden">
                    <h1 className="text-lg sm:text-xl font-semibold text-[var(--aurora-text-primary)] truncate flex items-center">
                        {currentChatSession ? currentChatSession.title : "Gemini Chat Interface"}
                        {isCharacterMode && <UsersIcon className="w-5 h-5 ml-2 text-purple-400 flex-shrink-0" />}
                    </h1>
                    <div className="flex items-center space-x-2">
                        {currentChatSession && <p className="text-xs text-[var(--aurora-text-secondary)] truncate" title={getModelDisplayName(currentChatSession.model)}>Model: {getModelDisplayName(currentChatSession.model)}</p>}
                        {currentChatSession && <ManualSaveButton onManualSave={handleManualSave} disabled={!currentChatSession || isLoading} />}
                        {currentChatSession && (
                            <button
                                onClick={ui.toggleSelectionMode}
                                className={`p-1.5 rounded-md transition-all focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)] ${ui.isSelectionModeActive ? 'bg-[var(--aurora-accent-primary)] text-white hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)]' : 'text-[var(--aurora-text-secondary)] hover:text-white hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]'}`}
                                title={ui.isSelectionModeActive ? "Done Selecting" : "Select Multiple Messages"}
                                aria-label={ui.isSelectionModeActive ? "Exit multiple selection mode" : "Enter multiple selection mode"}
                            >
                                {ui.isSelectionModeActive ? <XCircleIcon className="w-5 h-5" /> : <ClipboardDocumentCheckIcon className="w-5 h-5" />}
                            </button>
                        )}
                    </div>
                </div>
                {isCharacterMode && currentChatSession && (
                    <div className="ml-auto flex items-center space-x-2">
                        <button onClick={toggleReordering} className={`p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium rounded-md transition-all flex items-center ${isReorderingActive ? 'bg-green-600 text-white hover:shadow-[0_0_12px_2px_rgba(34,197,94,0.6)]' : 'bg-white/5 text-[var(--aurora-text-secondary)] hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]'}`} title={isReorderingActive ? "Done Reordering" : "Edit Character Order"}>
                            {isReorderingActive ? <CheckIcon className="w-4 h-4 sm:mr-1.5" /> : <ArrowsUpDownIcon className="w-4 h-4 sm:mr-1.5" />}
                            <span className="hidden sm:inline">{isReorderingActive ? "Done" : "Edit Order"}</span>
                        </button>
                        <button onClick={ui.openCharacterManagementModal} className="flex items-center p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium text-purple-300 bg-purple-600 bg-opacity-30 rounded-md transition-all hover:shadow-[0_0_12px_2px_rgba(156,51,245,0.6)]" title="Manage AI Characters" disabled={isReorderingActive}>
                            <PlusIcon className="w-4 h-4 sm:mr-1.5" />
                            <span className="hidden sm:inline">Manage Characters</span>
                        </button>
                    </div>
                )}
            </header>

            {currentChatSession && visibleMessages.length < totalMessagesInSession && (
                <div className="flex-shrink-0 flex justify-center py-2 z-10">
                    <div className={`transition-opacity duration-300 ${showLoadButtonsUI ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        {amountToLoad > 0 && <button onClick={() => handleLoadMore(amountToLoad)} className="px-4 py-2 text-xs bg-[var(--aurora-accent-primary)] text-white rounded-full shadow-lg transition-all transform hover:scale-105 hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)] mr-2">Show {amountToLoad} More</button>}
                        <button onClick={handleLoadAll} className="px-4 py-2 text-xs bg-white/10 text-white rounded-full shadow-lg transition-all transform hover:scale-105 hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]">Show All History ({totalMessagesInSession - visibleMessages.length} more)</button>
                    </div>
                </div>
            )}
            
            <div ref={messageListContainerRef} className={`flex-1 min-h-0 px-4 sm:px-6 relative ${ui.isSelectionModeActive ? 'pb-20' : ''}`} role="log" aria-live="polite">
                {currentChatSession ? (
                    visibleMessages.length > 0 ? (
                        listDimensions.height > 0 && (
                            <VariableSizeList
                                ref={listRef}
                                height={listDimensions.height}
                                width={listDimensions.width}
                                itemCount={visibleMessages.length}
                                itemSize={getItemSize}
                                itemData={visibleMessages}
                                onScroll={handleListScroll}
                            >
                                {Row}
                            </VariableSizeList>
                        )
                    ) : (
                        <div className="text-center text-gray-500 italic mt-10">
                            {isCharacterMode && characters.length === 0 ? "Add some characters and start the scene!" : (isCharacterMode ? "Select a character to speak." : "Start the conversation!")}
                        </div>
                    )
                ) : (
                    <div className="text-center text-gray-500 italic mt-10">Select a chat from the history or start a new one.</div>
                )}
            </div>
            
            <div className="flex-shrink-0 z-20 bg-transparent flex flex-col">
                {selectedFiles.length > 0 && (
                    <div className="p-2 sm:p-3 border-t border-[var(--aurora-border)] bg-transparent">
                        <div className="flex flex-wrap gap-3">
                            {selectedFiles.map(file => (
                                <div key={file.id} className="relative group p-2.5 aurora-panel rounded-lg shadow flex items-center w-full sm:w-auto sm:max-w-xs md:max-w-sm lg:max-w-md" style={{ minWidth: '200px' }}>
                                    <div className="flex-shrink-0 w-10 h-10 bg-black/20 rounded-full flex items-center justify-center overflow-hidden mr-3">
                                        {(file.uploadState === 'reading_client' || (file.uploadState === 'uploading_to_cloud' && !file.progress) || file.uploadState === 'processing_on_server') && file.isLoading && !(file.dataUrl && (file.type === 'image' || file.type === 'video')) ? (
                                            file.uploadState === 'uploading_to_cloud' ? <CloudArrowUpIcon className="w-5 h-5 text-blue-400 animate-pulse" /> :
                                            file.uploadState === 'processing_on_server' ? <ServerIcon className="w-5 h-5 text-blue-400 animate-pulse" /> :
                                            <DocumentIcon className="w-5 h-5 text-gray-400 animate-pulse" />
                                        ) : (file.uploadState === 'error_client_read' || file.uploadState === 'error_cloud_upload') && file.error ? (
                                            <DocumentIcon className="w-6 h-6 text-red-400" />
                                        ) : file.dataUrl && file.mimeType.startsWith('image/') && file.type === 'image' ? (
                                            <img src={file.dataUrl} alt={file.name} className="w-full h-full object-cover" />
                                        ) : file.dataUrl && file.mimeType.startsWith('video/') && file.type === 'video' ? (
                                            <PlayCircleIcon className="w-6 h-6 text-gray-300" />
                                        ) : (
                                            <DocumentIcon className="w-6 h-6 text-gray-300" />
                                        )}
                                    </div>
                                    <div className="flex-grow flex flex-col min-w-0 mr-2">
                                        <p className="text-sm font-medium text-gray-200 truncate" title={file.name}>{getDisplayFileType(file)}</p>
                                        <p className="text-xs text-gray-400 truncate" title={file.statusMessage || getFileProgressDisplay(file)}>{getFileProgressDisplay(file)}</p>
                                        {(file.uploadState === 'uploading_to_cloud' && file.progress !== undefined && file.progress > 0) && (
                                            <div className="w-full bg-black/20 rounded-full h-1 mt-1"><div className="bg-blue-500 h-1 rounded-full transition-all duration-150 ease-linear" style={{ width: `${file.progress || 0}%` }}></div></div>
                                        )}
                                    </div>
                                    <button onClick={() => removeSelectedFile(file.id)} className="flex-shrink-0 p-1 bg-black/20 text-gray-300 hover:text-white rounded-full transition-shadow hover:shadow-[0_0_10px_1px_rgba(239,68,68,0.7)]" title="Remove file" aria-label="Remove file">
                                        <XCircleIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {isCharacterMode && characters.length > 0 && (
                    <div ref={characterButtonContainerRef} className="p-2 sm:p-3 border-t border-[var(--aurora-border)] bg-transparent" onDragOver={handleDragOver} onDrop={handleDrop}>
                        <p className="text-xs text-gray-400 mb-2">{isReorderingActive ? "Drag to reorder characters, then click 'Done'." : (isInfoInputModeActive ? "Input is for one-time info. Select character to speak:" : (autoSendHook.isPreparingAutoSend ? "Auto-send ready. Select character to start:" : "Select a character to speak (can be empty input):"))}</p>
                        <div className="flex flex-wrap gap-2">
                            {characters.map((char) => (
                                <button key={char.id} data-char-id={char.id} onClick={() => !isReorderingActive && handleSendMessageClick(char.id)} 
                                disabled={!currentChatSession || isAnyFileStillProcessing() || autoSendHook.isAutoSendingActive || (isReorderingActive && !!draggedCharRef.current && draggedCharRef.current.id === char.id)} 
                                draggable={isReorderingActive} onDragStart={(e) => handleDragStart(e, char)} onDragEnd={handleDragEnd} 
                                className={`px-3 py-1.5 text-sm bg-[var(--aurora-accent-secondary)] text-white rounded-md disabled:opacity-50 transition-all duration-150 ease-in-out hover:shadow-[0_0_12px_2px_rgba(156,51,245,0.6)] ${isReorderingActive ? 'cursor-grab hover:ring-2 hover:ring-purple-400' : 'disabled:cursor-not-allowed'} ${draggedCharRef.current?.id === char.id ? 'opacity-50 ring-2 ring-blue-500' : ''} ${(autoSendHook.isPreparingAutoSend && !autoSendHook.isAutoSendingActive && !isLoading) ? 'ring-2 ring-green-500 hover:ring-green-400' : ''}`} 
                                title={isReorderingActive ? `Drag to reorder ${char.name}` : (autoSendHook.isPreparingAutoSend && !autoSendHook.isAutoSendingActive && !isLoading ? `Start auto-sending as ${char.name}` : `Speak as ${char.name}`)}>
                                    {char.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {(currentChatSession?.settings?.showAutoSendControls) && (
                    <AutoSendControls
                        onStartAutoSend={() => {
                            if (!isCharacterMode && autoSendHook.canStartAutoSend(autoSendHook.autoSendText, autoSendHook.autoSendRepetitionsInput) && !autoSendHook.isAutoSendingActive && !isLoading) {
                                autoSendHook.startAutoSend(autoSendHook.autoSendText, parseInt(autoSendHook.autoSendRepetitionsInput, 10) || 1);
                            }
                        }}
                        currentChatSessionExists={!!currentChatSession}
                        isCharacterMode={isCharacterMode}
                    />
                )}
                <div className="p-3 sm:p-4 border-t border-[var(--aurora-border)] bg-transparent">
                    {isLoading && <p className="text-xs text-center text-blue-400 mb-2 animate-pulse">{loadingMessageText}</p>}
                    <div className="flex items-end aurora-panel rounded-lg p-1 focus-within:ring-2 focus-within:ring-[var(--aurora-accent-primary)] transition-shadow">
                        <input type="file" multiple ref={fileInputRef} onChange={(e) => handleFileSelection(e.target.files)} className="hidden" accept="image/*,video/*,.pdf,text/*,application/json" />
                        <button 
                            onClick={() => fileInputRef.current?.click()} 
                            disabled={!currentChatSession || isInfoInputModeActive || autoSendHook.isAutoSendingActive || ui.isSelectionModeActive} 
                            className="p-2.5 sm:p-3 m-1 text-gray-300 hover:text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)] focus:outline-none" 
                            title="Attach files" 
                            aria-label="Attach files">
                            <PaperClipIcon className="w-5 h-5" />
                        </button>
                        {isCharacterMode && (
                            <button onClick={toggleInfoInputMode} disabled={isLoading || !currentChatSession || autoSendHook.isAutoSendingActive || ui.isSelectionModeActive} className={`p-2.5 sm:p-3 m-1 text-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-shadow focus:outline-none ${isInfoInputModeActive ? 'bg-yellow-500/20 text-yellow-300 hover:shadow-[0_0_12px_2px_rgba(234,179,8,0.6)]' : 'hover:text-white hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]'}`} title={isInfoInputModeActive ? "Disable One-Time Info Input" : "Enable One-Time Info Input"} aria-label={isInfoInputModeActive ? "Disable One-Time Info Input" : "Enable One-Time Info Input"} aria-pressed={isInfoInputModeActive}>
                                <InfoIcon className="w-5 h-5" />
                            </button>
                        )}
                        <textarea 
                            ref={textareaRef} 
                            rows={1} 
                            className="flex-grow p-2.5 sm:p-3 bg-transparent text-gray-200 focus:outline-none resize-none placeholder-gray-400 hide-scrollbar" 
                            placeholder={placeholderText} 
                            value={inputMessage} 
                            onChange={handleInputChange} 
                            onKeyPress={handleKeyPress} 
                            onPaste={handlePaste} 
                            disabled={!currentChatSession || autoSendHook.isAutoSendingActive || ui.isSelectionModeActive} 
                            aria-label="Chat input" />
                        {!isCharacterMode && (
                            <button onClick={handleContinueFlowClick} disabled={isLoading || !currentChatSession || (currentChatSession && currentChatSession.messages.length === 0) || isAnyFileStillProcessing() || isCharacterMode || autoSendHook.isAutoSendingActive || ui.isSelectionModeActive} className="p-2.5 sm:p-3 m-1 text-white bg-teal-600/50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-shadow hover:shadow-[0_0_12px_2px_rgba(13,148,136,0.6)] focus:outline-none" title="Continue Flow" aria-label="Continue flow">
                                <FlowRightIcon className="w-5 h-5" />
                            </button>
                        )}
                        {(isLoading || autoSendHook.isAutoSendingActive) ? (
                            <button onClick={handleMainCancelButtonClick} className="p-2.5 sm:p-3 m-1 text-white bg-red-600/80 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(239,68,68,0.6)] focus:outline-none" aria-label={autoSendHook.isAutoSendingActive ? "Stop automated sending" : "Cancel generation"} title={autoSendHook.isAutoSendingActive ? "Stop automated sending" : "Cancel generation"}>
                                <StopIcon className="w-5 h-5" />
                            </button>
                        ) : (
                            <button onClick={() => handleSendMessageClick()} disabled={!hasValidInputForMainSend || !currentChatSession || isAnyFileStillProcessing() || isCharacterMode || autoSendHook.isAutoSendingActive || ui.isSelectionModeActive} className={`p-2.5 sm:p-3 m-1 text-white bg-[var(--aurora-accent-primary)] rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-shadow hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)] focus:outline-none ${isCharacterMode ? 'hidden' : ''}`} aria-label="Send message" title="Send message">
                                <SendIcon className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}));

export default ChatView;
