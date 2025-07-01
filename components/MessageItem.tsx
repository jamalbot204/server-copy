
import React, { useState, useEffect, useRef, memo, useCallback, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LightAsync as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import Mark from 'mark.js/dist/mark.es6.js';
import { ChatMessage, ChatMessageRole, GroundingChunk, Attachment } from '../types.ts';
import ResetAudioCacheButton from './ResetAudioCacheButton.tsx';
import RefreshAttachmentButton from './RefreshAttachmentButton.tsx';
import { useSessionState } from '../contexts/SessionContext.tsx';
import { useMessageContext } from '../contexts/MessageContext.tsx';
import { useInteractionStatus } from '../contexts/InteractionStatusContext.tsx';
import { useUIContext } from '../contexts/UIContext.tsx';
import { useAudioContext } from '../contexts/AudioContext.tsx';
import { MAX_WORDS_PER_TTS_SEGMENT, MESSAGE_CONTENT_SNIPPET_THRESHOLD } from '../constants.ts';
import { 
    SparklesIcon, PencilIcon, TrashIcon, ClipboardDocumentListIcon, 
    ArrowPathIcon, MagnifyingGlassIcon, DocumentIcon, 
    ArrowDownTrayIcon, EllipsisVerticalIcon, ClipboardIcon, CheckIcon, UsersIcon,
    ChevronDownIcon, ChevronRightIcon, XCircleIcon, SpeakerWaveIcon, SpeakerXMarkIcon,
    PauseIcon, ChevronUpIcon, BookOpenIcon, ChatBubblePlusIcon
} from './Icons.tsx';
import { splitTextForTts, sanitizeFilename } from '../services/utils.ts';

interface MessageItemProps {
  message: ChatMessage;
  canRegenerateFollowingAI?: boolean;
  highlightTerm?: string;
  onEnterReadMode: (content: string) => void;
  onHeightChange: (messageId: string, height: number) => void;
}

const CodeBlock: React.FC<React.PropsWithChildren<{ inline?: boolean; className?: string }>> = ({
    inline,
    className, 
    children,
  }) => {
    const [isCodeCopied, setIsCodeCopied] = useState(false); 
    
    const codeString = Array.isArray(children) ? children.join('') : String(children);
    const finalCodeString = codeString.replace(/\n$/, '');

    const handleCopyCode = () => { 
      navigator.clipboard.writeText(finalCodeString).then(() => {
        setIsCodeCopied(true);
        setTimeout(() => setIsCodeCopied(false), 2000);
      }).catch(err => {
        console.error('Failed to copy code: ', err);
        alert('Failed to copy code.');
      });
    };

    if (inline) {
      return (
        <code 
          className="bg-black/30 text-indigo-300 rounded font-mono border border-white/10"
          style={{ 
            padding: '0.1em 0.3em', 
            fontSize: '0.875em', 
            margin: '0 0.05em',
            whiteSpace: 'pre-wrap', 
            wordBreak: 'break-all' 
          }}
        >
          {children}
        </code>
      );
    }
    
    const match = /language-([\w.-]+)/.exec(className || '');
    const lang = match && match[1] ? match[1] : ''; 

    return (
      <div className="relative group/codeblock my-2 rounded-md overflow-hidden shadow border border-white/10 bg-[#0A0910]">
        <div className="flex justify-start items-center px-3 py-1.5 bg-black/20">
          <span className="text-xs text-gray-300 font-mono">
            {lang || 'code'} 
          </span>
        </div>
        {lang ? ( 
          <SyntaxHighlighter
            style={atomOneDark}
            language={lang}
            PreTag="div" 
            customStyle={{ 
                margin: 0, 
                borderRadius: '0 0 0.375rem 0.375rem', 
                padding: '1rem', 
                overflowX: 'hidden', 
                fontSize: '0.9em',
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                backgroundColor: 'transparent'
            }}
            codeTagProps={{ 
                style: { 
                    fontFamily: 'inherit', 
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-word' 
                } 
            }}
            showLineNumbers={false}
            wrapLines={true} 
            lineProps={{ style: { wordBreak: 'break-word', whiteSpace: 'pre-wrap' } }} 
          >
            {finalCodeString}
          </SyntaxHighlighter>
        ) : ( 
          <pre 
            className="bg-transparent text-gray-200 p-4 text-sm font-mono overflow-x-hidden whitespace-pre-wrap break-words m-0 rounded-b-md" 
          >
            <code className={className || ''}> 
              {finalCodeString}
            </code>
          </pre>
        )}
        <button
          onClick={handleCopyCode}
          title={isCodeCopied ? "Copied!" : "Copy code"}
          aria-label={isCodeCopied ? "Copied code to clipboard" : "Copy code to clipboard"}
          className="absolute bottom-3 right-3 p-1.5 bg-black/30 text-gray-300 hover:text-white rounded-md transition-all duration-150 opacity-0 group-hover/codeblock:opacity-100 focus:opacity-100 hover:shadow-[0_0_8px_1px_rgba(255,255,255,0.2)]"
        >
          {isCodeCopied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ClipboardIcon className="w-4 h-4" />}
        </button>
      </div>
    );
  };

const Checkbox = memo(({ isSelected, onToggle, role }: { isSelected: boolean; onToggle: () => void; role: ChatMessageRole; }) => (
    <div className="flex-shrink-0 self-center px-2">
        <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 text-[var(--aurora-accent-primary)] bg-black/30 border-white/20 rounded focus:ring-[var(--aurora-accent-primary)] focus:ring-offset-black cursor-pointer"
            aria-label={`Select message from ${role}`}
        />
    </div>
));

const DropdownMenuItem = memo(({ onClick, icon: Icon, label, hoverGlowClassName, className, disabled = false }: {
    onClick: () => void;
    icon: React.FC<{ className?: string }>;
    label: string; 
    hoverGlowClassName?: string;
    className?: string;
    disabled?: boolean;
}) => (
    <button
      role="menuitem"
      disabled={disabled}
      title={label} 
      aria-label={label}
      className={`w-auto p-2 text-sm flex items-center justify-center rounded-md transition-all ${
        disabled 
          ? 'text-gray-500 cursor-not-allowed' 
          : `text-gray-200 ${hoverGlowClassName || 'hover:bg-white/10'} ${className || ''}`
      }`}
      onMouseDown={() => { if (!disabled) onClick(); }} 
      onTouchStart={() => { if (!disabled) onClick(); }} 
      onClick={(e) => { e.preventDefault(); }} 
    >
      <Icon className={`w-5 h-5 ${disabled ? 'text-gray-500' : ''}`} />
    </button>
));

const MessageBody = memo(({ message, displayContent, extractedThoughts, highlightTerm }: {
    message: ChatMessage;
    displayContent: string;
    extractedThoughts: string | null;
    highlightTerm?: string;
}) => {
    const { handleReUploadAttachment } = useMessageContext();
    const { currentChatSession } = useSessionState();
    const [isThoughtsExpanded, setIsThoughtsExpanded] = useState(false);
    const [isContentExpanded, setIsContentExpanded] = useState(false);
    const markdownContentRef = useRef<HTMLDivElement>(null);

    const isLongTextContent = displayContent.trim().length > MESSAGE_CONTENT_SNIPPET_THRESHOLD;
    const contentToRender = (isLongTextContent && !isContentExpanded) 
        ? displayContent.trim().substring(0, MESSAGE_CONTENT_SNIPPET_THRESHOLD) + "..." 
        : displayContent;

    useEffect(() => {
        if (markdownContentRef.current) {
            const instance = new Mark(markdownContentRef.current);
            instance.unmark({
                done: () => {
                    if (highlightTerm && highlightTerm.trim() !== "") {
                        instance.mark(highlightTerm, {
                            element: "mark", className: "highlighted-text", exclude: ["pre *", "code *", "pre", "code"],
                            separateWordSearch: false, accuracy: "partially", wildcards: "disabled",
                        });
                    }
                }
            });
        }
    }, [highlightTerm, contentToRender, isContentExpanded]);

    const handleDownloadAttachmentLocal = (attachment: Attachment) => {
        if (!attachment.dataUrl) {
            alert("Attachment data is not available for download.");
            return;
        }
        const link = document.createElement('a');
        link.href = attachment.dataUrl;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    return (
        <>
            {message.characterName && (
                <div className="flex items-center mb-1.5">
                    <UsersIcon className="w-4 h-4 mr-1.5 text-purple-300" />
                    <p className="text-xs font-semibold text-purple-300">{message.characterName}</p>
                </div>
            )}
            {extractedThoughts && (
                <div className="w-full mb-1.5">
                    <div className="bg-slate-800/50 border border-slate-700/80 rounded-lg shadow-md">
                    <button onClick={() => setIsThoughtsExpanded(!isThoughtsExpanded)} className="w-full flex items-center justify-between p-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-700/70 rounded-t-lg focus:outline-none" aria-expanded={isThoughtsExpanded}>
                        <div className="flex items-center"><SparklesIcon className="w-4 h-4 mr-2 text-blue-400" /> <span className="font-medium">Thoughts</span></div>
                        <div className="flex items-center text-slate-400">{isThoughtsExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}</div>
                    </button>
                    {isThoughtsExpanded && (
                        <div className="p-3 border-t border-slate-700/80 markdown-content text-xs text-slate-300 max-h-48 overflow-y-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, p: 'div' }}>{extractedThoughts}</ReactMarkdown>
                        </div>
                    )}
                    </div>
                </div>
            )}
            {contentToRender.trim() && (
                <div ref={markdownContentRef} className="text-sm markdown-content break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock, p: 'div' }}>{contentToRender}</ReactMarkdown>
                </div>
            )}
            {isLongTextContent && (
                <button onClick={() => setIsContentExpanded(!isContentExpanded)} className="text-blue-300 hover:text-blue-200 text-xs mt-1.5 focus:outline-none flex items-center transition-all hover:drop-shadow-[0_0_3px_rgba(147,197,253,0.8)]" aria-expanded={isContentExpanded}>
                    {isContentExpanded ? "Show less" : "Show more"}
                    {isContentExpanded ? <ChevronUpIcon className="w-3.5 h-3.5 ml-1" /> : <ChevronDownIcon className="w-3.5 h-3.5 ml-1" />}
                </button>
            )}
            {message.attachments && message.attachments.length > 0 && (
                <div className={`mt-2 grid gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {message.attachments.map(attachment => (
                    <div key={attachment.id} className="relative group/attachment border border-white/10 rounded-md overflow-hidden bg-black/20">
                    {attachment.mimeType.startsWith('image/') && attachment.type === 'image' && attachment.mimeType !== 'application/pdf' ? (
                        <img src={attachment.dataUrl} alt={attachment.name} className="max-w-full max-h-60 object-contain rounded-md cursor-pointer" onClick={() => attachment.dataUrl && window.open(attachment.dataUrl, '_blank')}/>
                    ) : attachment.mimeType.startsWith('video/') && attachment.type === 'video' ? (
                        <video src={attachment.dataUrl} controls className="max-w-full max-h-60 object-contain rounded-md"/>
                    ) : ( 
                        <div className="p-2 h-full flex flex-col items-center justify-center bg-transparent transition-colors hover:bg-white/5 cursor-pointer" onClick={() => attachment.dataUrl && window.open(attachment.dataUrl, '_blank')}>
                            <DocumentIcon className="w-8 h-8 mb-1 text-gray-300" />
                            <span className="text-xs text-gray-300 text-center break-all px-1">{attachment.name}</span>
                        </div>
                    )}
                    <div className="absolute top-1 right-1 flex space-x-1 opacity-0 group-hover/attachment:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); handleDownloadAttachmentLocal(attachment); }} title={`Download ${attachment.name}`} className="p-1 bg-black bg-opacity-40 text-white rounded-full transition-all hover:shadow-[0_0_8px_1px_rgba(255,255,255,0.2)]" aria-label={`Download ${attachment.name}`} disabled={!attachment.dataUrl}>
                            <ArrowDownTrayIcon className="w-3 h-3" />
                        </button>
                        {attachment.fileUri && (<RefreshAttachmentButton attachment={attachment} onReUpload={() => handleReUploadAttachment(currentChatSession!.id, message.id, attachment.id)} disabled={message.isStreaming}/> )}
                    </div>
                    {attachment.reUploadError && (<p className="text-xs text-red-400 p-1 bg-black/50 absolute bottom-0 w-full text-center" title={attachment.reUploadError}>Refresh Error</p>)}
                    </div>
                ))}
                </div>
            )}
            {message.groundingMetadata?.groundingChunks && message.groundingMetadata.groundingChunks.length > 0 && (
                <div className="mt-3 pt-2 border-t border-white/10">
                <h4 className="text-xs font-semibold mb-1 opacity-80 flex items-center"><MagnifyingGlassIcon className="w-3.5 h-3.5 mr-1.5 opacity-70" /> Sources:</h4>
                <ul className="list-none pl-0 space-y-1">
                    {message.groundingMetadata.groundingChunks.map((chunk: GroundingChunk, index: number) => (
                    <li key={index} className="text-xs"><a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" title={chunk.web.uri} className="text-blue-300 hover:text-blue-200 hover:underline break-all">{index + 1}. {chunk.web.title || chunk.web.uri}</a></li>
                    ))}
                </ul>
                </div>
            )}
        </>
    );
});

const MessageActions = memo(({ message, isUser, canRegenerateFollowingAI, isAnyAudioOperationActiveForMessage, displayContent, onEnterReadMode }: {
    message: ChatMessage;
    isUser: boolean;
    canRegenerateFollowingAI?: boolean;
    isAnyAudioOperationActiveForMessage: boolean;
    displayContent: string;
    onEnterReadMode: (content: string) => void;
}) => {
    const { currentChatSession } = useSessionState();
    const { isLoading } = useInteractionStatus();
    const { handleActualCopyMessage, handleDeleteSingleMessageOnly, handleRegenerateAIMessage, handleRegenerateResponseForUserMessage, handleInsertEmptyMessageAfter } = useMessageContext();
    const ui = useUIContext();
    const audio = useAudioContext();

    const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const optionsButtonRef = useRef<HTMLButtonElement>(null);
    const initialDropdownHorizontalClass = isUser ? 'left-0' : 'right-0';
    const [dynamicDropdownClass, setDynamicDropdownClass] = useState<string>(initialDropdownHorizontalClass);

    const textSegmentsForTts = splitTextForTts(displayContent, currentChatSession?.settings?.ttsSettings?.maxWordsPerSegment ?? MAX_WORDS_PER_TTS_SEGMENT);
    const allTtsPartsCached = message.cachedAudioBuffers && message.cachedAudioBuffers.length === textSegmentsForTts.length && message.cachedAudioBuffers.every(buffer => !!buffer);
    const hasAnyCachedAudio = message.cachedAudioBuffers && message.cachedAudioBuffers.some(buffer => !!buffer);
    
    useEffect(() => { /* Effect for closing dropdown on outside click/escape key */
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) && optionsButtonRef.current && !optionsButtonRef.current.contains(event.target as Node)) setIsOptionsMenuOpen(false);
        };
        const handleEscapeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOptionsMenuOpen(false); };
        if (isOptionsMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscapeKey);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscapeKey);
        };
    }, [isOptionsMenuOpen]);
    
    useEffect(() => { /* Effect for positioning dropdown */
        const calculateAndSetAlignment = () => {
            if (!isOptionsMenuOpen || !optionsButtonRef.current || !dropdownRef.current) return;
            const buttonContainer = optionsButtonRef.current.parentElement;
            if (!buttonContainer) return;
            const containerRect = buttonContainer.getBoundingClientRect(); 
            const dropdownWidth = dropdownRef.current.offsetWidth || 100; 
            const frameRight = window.innerWidth;
            let newAlignmentClass = isUser ? 'left-0' : 'right-0'; 
            if (isUser) { if (containerRect.left + dropdownWidth > frameRight) newAlignmentClass = 'right-0'; } 
            else { if (containerRect.right - dropdownWidth < 0) newAlignmentClass = 'left-0'; }
            setDynamicDropdownClass(newAlignmentClass);
        };
        if (isOptionsMenuOpen) {
            requestAnimationFrame(calculateAndSetAlignment);
            window.addEventListener('resize', calculateAndSetAlignment);
            return () => window.removeEventListener('resize', calculateAndSetAlignment);
        }
    }, [isOptionsMenuOpen, isUser]);

    const handleEditClick = useCallback(() => { if (!currentChatSession) return; ui.openEditPanel({ sessionId: currentChatSession.id, messageId: message.id, originalContent: message.content, role: message.role, attachments: message.attachments }); setIsOptionsMenuOpen(false); }, [currentChatSession, message, ui]);
    const handleCopyMessageClick = useCallback(async () => { await handleActualCopyMessage(message.content); setIsOptionsMenuOpen(false); }, [handleActualCopyMessage, message.content]);
    const handleMasterPlayButtonClick = useCallback(() => { if (audio.isMainButtonMultiFetchingApi(message.id)) audio.handleCancelMultiPartFetch(message.id); else audio.handlePlayTextForMessage(displayContent, message.id, undefined); setIsOptionsMenuOpen(false); }, [audio, message.id, displayContent]);
    const handlePartPlayButtonClick = useCallback((partIndex: number) => { const uniqueSegmentId = `${message.id}_part_${partIndex}`; if (audio.isApiFetchingThisSegment(uniqueSegmentId)) audio.onCancelApiFetchThisSegment(uniqueSegmentId); else audio.handlePlayTextForMessage(displayContent, message.id, partIndex); setIsOptionsMenuOpen(false); }, [audio, message.id, displayContent]);
    const handleResetCacheClick = useCallback(() => { if (!currentChatSession) return; ui.requestResetAudioCacheConfirmation(currentChatSession.id, message.id); setIsOptionsMenuOpen(false); }, [currentChatSession, message.id, ui]);
    const handleReadModeClick = useCallback(() => { onEnterReadMode(displayContent); setIsOptionsMenuOpen(false); }, [onEnterReadMode, displayContent]);
    const triggerAudioDownloadModal = useCallback(() => { if (!currentChatSession) return; const words = message.content.trim().split(/\s+/); const firstWords = words.slice(0, 7).join(' '); const defaultNameSuggestion = sanitizeFilename(firstWords, 50) || 'audio_download'; ui.openFilenameInputModal({ defaultFilename: defaultNameSuggestion, promptMessage: "Enter filename for audio (extension .mp3 will be added):", onSubmit: (name) => audio.handleDownloadAudio(currentChatSession!.id, message.id, name) }); setIsOptionsMenuOpen(false); }, [currentChatSession, message, ui, audio]);
    const handleInsertEmptyBubbleClick = useCallback(() => { if (!currentChatSession) return; const roleToInsert = message.role === ChatMessageRole.USER ? ChatMessageRole.MODEL : ChatMessageRole.USER; handleInsertEmptyMessageAfter(currentChatSession.id, message.id, roleToInsert); setIsOptionsMenuOpen(false); }, [currentChatSession, message, handleInsertEmptyMessageAfter]);

    const getAudioStateForSegment = (partIdx?: number) => {
        const segmentId = partIdx !== undefined ? `${message.id}_part_${partIdx}` : message.id;
        const isCurrentPlayerTarget = audio.audioPlayerState.currentMessageId === segmentId;
        return {
            isCurrentAudioPlayerTarget: isCurrentPlayerTarget,
            isAudioPlayingForThisSegment: isCurrentPlayerTarget && audio.audioPlayerState.isPlaying,
            isAudioLoadingForPlayer: isCurrentPlayerTarget && audio.audioPlayerState.isLoading, 
            hasAudioErrorForThisSegment: (isCurrentPlayerTarget && !!audio.audioPlayerState.error) || !!audio.getSegmentFetchError(segmentId),
            isAudioReadyToPlayFromCacheForSegment: !!(partIdx !== undefined ? message.cachedAudioBuffers?.[partIdx] : allTtsPartsCached)
        };
    };

    const renderPlayButtonForSegment = (partIndexInput?: number) => {
        const isMainContextButton = partIndexInput === undefined;
        const { isAudioPlayingForThisSegment, isAudioLoadingForPlayer, hasAudioErrorForThisSegment, isAudioReadyToPlayFromCacheForSegment } = getAudioStateForSegment(partIndexInput);
        const uniqueSegmentId = partIndexInput !== undefined ? `${message.id}_part_${partIndexInput}` : message.id;
        let IconComponent = SpeakerWaveIcon; let iconClassName = 'text-gray-300'; let title = "Play"; let isPulsing = false;
        if (audio.isMainButtonMultiFetchingApi(message.id) && isMainContextButton) { IconComponent = XCircleIcon; iconClassName = 'text-red-400'; title = "Cancel fetch"; isPulsing = true; }
        else if (audio.isApiFetchingThisSegment(uniqueSegmentId)) { IconComponent = XCircleIcon; iconClassName = 'text-red-400'; title = "Cancel fetch"; isPulsing = true; }
        else if (isAudioPlayingForThisSegment) { IconComponent = PauseIcon; iconClassName = 'text-orange-400'; title = "Pause"; }
        else if (isAudioLoadingForPlayer) { IconComponent = SpeakerWaveIcon; isPulsing = true; iconClassName = 'text-blue-400'; title = "Loading..."; }
        else if (hasAudioErrorForThisSegment) { IconComponent = SpeakerXMarkIcon; iconClassName = 'text-red-400'; title = "Error. Click to retry."; }
        else if (isAudioReadyToPlayFromCacheForSegment) { iconClassName = 'text-green-400'; title = "Play cached"; }
        return (
            <button onClick={isMainContextButton ? handleMasterPlayButtonClick : () => handlePartPlayButtonClick(partIndexInput!)} title={title} aria-label={title} className={`p-1.5 text-gray-300 rounded-md bg-black bg-opacity-20 transition-shadow focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)] hover:text-white hover:shadow-[0_0_8px_1px_rgba(34,197,94,0.6)] ${iconClassName} ${isPulsing ? 'animate-pulse' : ''}`} disabled={ui.isSelectionModeActive}><IconComponent className="w-4 h-4" />{partIndexInput !== undefined && <span className="text-xs ml-1">P{partIndexInput+1}</span>}</button>
        );
    };

    return (
        <div className={`absolute top-1 ${isUser ? 'left-1' : 'right-1'} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-10 flex items-center flex-wrap gap-1`} aria-label="Message actions">
            {displayContent.trim() && message.role !== ChatMessageRole.ERROR && (
                <>
                    {textSegmentsForTts.length > 1 && allTtsPartsCached ? textSegmentsForTts.map((_, index) => renderPlayButtonForSegment(index)) : renderPlayButtonForSegment()}
                    {hasAnyCachedAudio && !isAnyAudioOperationActiveForMessage && (<ResetAudioCacheButton onClick={handleResetCacheClick} disabled={isAnyAudioOperationActiveForMessage || ui.isSelectionModeActive} title="Reset Audio Cache"/>)}
                </>
            )}
            <button ref={optionsButtonRef} onClick={(e) => { if (ui.isSelectionModeActive) return; e.stopPropagation(); setIsOptionsMenuOpen(prev => !prev); }} title="Options" aria-haspopup="true" aria-expanded={isOptionsMenuOpen} className={`p-1.5 text-gray-300 rounded-md bg-black bg-opacity-20 transition-shadow focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)] hover:text-white hover:shadow-[0_0_8px_1px_rgba(255,255,255,0.2)] ${ui.isSelectionModeActive ? 'hidden' : ''}`}>
                <EllipsisVerticalIcon className="w-4 h-4" />
            </button>
            {isOptionsMenuOpen && (
                <div ref={dropdownRef} className={`absolute aurora-panel ${dynamicDropdownClass} top-full mt-1.5 w-auto rounded-md shadow-lg z-30 p-1 flex space-x-1 focus:outline-none`} role="menu">
                    {currentChatSession?.settings.showReadModeButton && (<DropdownMenuItem onClick={handleReadModeClick} icon={BookOpenIcon} label="Read Mode" hoverGlowClassName="hover:shadow-[0_0_10px_1px_rgba(255,255,255,0.2)]"/>)}
                    <DropdownMenuItem onClick={handleInsertEmptyBubbleClick} icon={ChatBubblePlusIcon} label="Insert Empty Bubble After" disabled={isAnyAudioOperationActiveForMessage || isLoading}/>
                    <DropdownMenuItem onClick={handleCopyMessageClick} icon={ClipboardDocumentListIcon} label="Copy Text"/>
                    {message.content.trim() && message.role !== ChatMessageRole.ERROR && allTtsPartsCached && (<DropdownMenuItem onClick={triggerAudioDownloadModal} icon={ArrowDownTrayIcon} label={"Download Audio"} disabled={isAnyAudioOperationActiveForMessage}/>)}
                    {message.role !== ChatMessageRole.ERROR && (<DropdownMenuItem onClick={handleEditClick} icon={PencilIcon} label="Edit Text" disabled={isAnyAudioOperationActiveForMessage}/>)}
                    {message.role === ChatMessageRole.MODEL && !message.characterName && (<DropdownMenuItem onClick={() => { handleRegenerateAIMessage(currentChatSession!.id, message.id); setIsOptionsMenuOpen(false); }} icon={ArrowPathIcon} label="Regenerate" disabled={isAnyAudioOperationActiveForMessage}/>)}
                    {isUser && canRegenerateFollowingAI && !message.characterName && (<DropdownMenuItem onClick={() => { handleRegenerateResponseForUserMessage(currentChatSession!.id, message.id); setIsOptionsMenuOpen(false); }} icon={ArrowPathIcon} label="Regenerate" disabled={isAnyAudioOperationActiveForMessage}/>)}
                    <DropdownMenuItem onClick={() => { handleDeleteSingleMessageOnly(currentChatSession!.id, message.id); setIsOptionsMenuOpen(false); }} icon={XCircleIcon} label="Delete Message" className="text-red-400" hoverGlowClassName="hover:shadow-[0_0_10px_1px_rgba(239,68,68,0.7)]" disabled={isAnyAudioOperationActiveForMessage}/>
                    <DropdownMenuItem onClick={() => { ui.requestDeleteConfirmation(currentChatSession!.id, message.id); setIsOptionsMenuOpen(false); }} icon={TrashIcon} label="Delete & History" className="text-red-400" hoverGlowClassName="hover:shadow-[0_0_10px_1px_rgba(239,68,68,0.7)]" disabled={isAnyAudioOperationActiveForMessage}/>
                </div>
            )}
        </div>
    );
});

const MessageFooter = memo(({ message, generationTime, audioError, displayContent }: {
    message: ChatMessage;
    generationTime?: number;
    audioError?: string | null;
    displayContent: string;
}) => (
    <>
        <div className="text-xs mt-1 opacity-60 flex items-center space-x-1.5">
            <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
            {displayContent.trim() && message.role !== ChatMessageRole.ERROR && (
                <>
                    <span className="opacity-50">&bull;</span>
                    <span>{displayContent.trim().split(/\s+/).filter(Boolean).length} word{displayContent.trim().split(/\s+/).filter(Boolean).length !== 1 ? 's' : ''}</span>
                </>
            )}
        </div>
        {message.role === ChatMessageRole.MODEL && generationTime !== undefined && (
            <p className="text-xs mt-0.5 text-red-400">Generated in {generationTime.toFixed(1)}s</p>
        )}
        {audioError && (
            <p className="text-xs mt-0.5 text-red-400" title={audioError}>Audio Error: {audioError.substring(0,50)}{audioError.length > 50 ? "..." : ""}</p>
        )}
    </>
));

const MessageItemComponent: React.FC<MessageItemProps> = ({ 
  message, 
  canRegenerateFollowingAI,
  highlightTerm,
  onEnterReadMode,
  onHeightChange,
}) => {
  const { messageGenerationTimes } = useSessionState();
  const audio = useAudioContext();
  const ui = useUIContext();

  const isUser = message.role === ChatMessageRole.USER;
  const isError = message.role === ChatMessageRole.ERROR;
  const isModel = message.role === ChatMessageRole.MODEL;

  const rootDivRef = useRef<HTMLDivElement>(null);
  
  useLayoutEffect(() => {
    const element = rootDivRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
        if (rootDivRef.current) {
            onHeightChange(message.id, rootDivRef.current.offsetHeight);
        }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id, onHeightChange]);

  const isSelected = ui.isSelectionModeActive && ui.selectedMessageIds.has(message.id);
  
  let displayContent = message.content;
  let extractedThoughts: string | null = null;
  const thoughtsMarker = "THOUGHTS:"; 
  if (isModel && !isError && message.content) {
    const thoughtsIndex = message.content.indexOf(thoughtsMarker);
    if (thoughtsIndex !== -1) {
      let thoughtsEndIndex = message.content.indexOf("\n\n", thoughtsIndex + thoughtsMarker.length);
      if (thoughtsEndIndex === -1) thoughtsEndIndex = message.content.length;
      extractedThoughts = message.content.substring(thoughtsIndex + thoughtsMarker.length, thoughtsEndIndex).trim();
      displayContent = message.content.substring(thoughtsEndIndex).trim().replace(/^\n+/, '');
    }
  }

  const bubbleClasses = isUser ? 'bg-indigo-500/10 border border-indigo-400/30 shadow-lg shadow-indigo-900/20 self-end text-white' : isError ? 'aurora-surface border-red-500/50 shadow-lg shadow-red-900/30 self-start text-white' : 'self-start text-gray-200';
  const layoutClasses = isUser ? 'justify-end' : 'justify-start';

  const { isCurrentAudioPlayerTarget, audioErrorMessage } = {
    isCurrentAudioPlayerTarget: audio.audioPlayerState.currentMessageId?.startsWith(message.id),
    audioErrorMessage: audio.audioPlayerState.currentMessageId?.startsWith(message.id) ? audio.audioPlayerState.error : null,
  };
  const isAnyAudioOperationActiveForMessage = message.isStreaming || audio.isMainButtonMultiFetchingApi(message.id) || (isCurrentAudioPlayerTarget && (audio.audioPlayerState.isLoading || audio.audioPlayerState.isPlaying));

  return (
    <div ref={rootDivRef} id={`message-item-${message.id}`} className={`group flex items-start mb-1 w-full relative transition-colors duration-200 ${isSelected ? 'bg-blue-900/40 rounded-md' : ''} ${ui.isSelectionModeActive ? 'cursor-pointer' : ''} ${layoutClasses}`} onClick={() => ui.isSelectionModeActive && ui.toggleMessageSelection(message.id)} role="listitem">
      {!isUser && ui.isSelectionModeActive && <Checkbox isSelected={isSelected} onToggle={() => ui.toggleMessageSelection(message.id)} role={message.role} />}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-xl lg:max-w-2xl xl:max-w-3xl`}>
        {isModel && message.isStreaming && !isError && !extractedThoughts && (
          <div className={`flex items-center space-x-1.5 mb-1.5 px-3 py-1.5 rounded-lg shadow ${message.characterName ? 'bg-purple-900/30' : 'bg-black/20'} animate-thinking-dots`} aria-label="AI is thinking" role="status">
            <div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div><div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div><div className="w-1.5 h-1.5 bg-gray-300 rounded-full"></div>
          </div>
        )}
        {(isUser || isModel || isError) && (
            <div className={`px-4 py-3 rounded-lg ${bubbleClasses} relative w-full mt-1`}>
                <MessageBody message={message} displayContent={displayContent} extractedThoughts={extractedThoughts} highlightTerm={highlightTerm} />
                <MessageFooter message={message} generationTime={messageGenerationTimes[message.id]} audioError={audioErrorMessage} displayContent={displayContent} />
                <MessageActions message={message} isUser={isUser} canRegenerateFollowingAI={canRegenerateFollowingAI} isAnyAudioOperationActiveForMessage={!!isAnyAudioOperationActiveForMessage} displayContent={displayContent} onEnterReadMode={onEnterReadMode} />
            </div>
        )}
      </div>
       {isUser && ui.isSelectionModeActive && <Checkbox isSelected={isSelected} onToggle={() => ui.toggleMessageSelection(message.id)} role={message.role} />}
    </div>
  );
};

export default memo(MessageItemComponent);
