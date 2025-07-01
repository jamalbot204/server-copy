



import { useState, useCallback, useRef } from 'react';
import { ChatSession, UseAudioPlayerReturn, LogApiRequestCallback } from '../types.ts'; // Adjusted paths
import { MAX_WORDS_PER_TTS_SEGMENT } from '../constants.ts'; // Adjusted paths
import { generateSpeech } from '../services/ttsService.ts'; // Adjusted paths
import { strictAbort } from '../services/cancellationService.ts'; // Adjusted paths
import * as audioUtils from '../services/audioUtils.ts'; // Adjusted paths
import { splitTextForTts, sanitizeFilename, triggerDownload } from '../services/utils.ts'; // Updated imports

interface UseAudioControlsProps {
  apiKey: string;
  currentChatSession: ChatSession | null;
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>;
  logApiRequest: LogApiRequestCallback;
  showToast: (message: string, type?: 'success' | 'error') => void;
  audioPlayerHook: UseAudioPlayerReturn; // From useAudioPlayer
  requestResetAudioCacheConfirmationModal: (sessionId: string, messageId: string) => void; // From useAppModals
  isAutoFetchingSegment: (uniqueSegmentId: string) => boolean; 
  onCancelAutoFetchSegment: (uniqueSegmentId: string) => void; 
}

export function useAudioControls({
  apiKey,
  currentChatSession,
  updateChatSession,
  logApiRequest,
  showToast,
  audioPlayerHook,
  requestResetAudioCacheConfirmationModal,
  isAutoFetchingSegment,
  onCancelAutoFetchSegment,
}: UseAudioControlsProps) {
  const multiPartFetchControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [activeMultiPartFetches, setActiveMultiPartFetches] = useState<Set<string>>(new Set());

  const handleCacheAudioForMessageCallback = useCallback(async (uniqueSegmentId: string, audioBuffer: ArrayBuffer) => {
    if (!currentChatSession?.id) return;
    const parts = uniqueSegmentId.split('_part_');
    const baseMessageId = parts[0];
    const partIndex = parts.length > 1 ? parseInt(parts[1], 10) : 0;

    await updateChatSession(currentChatSession.id, (session) => {
        if (!session) return null;
        const messageIndex = session.messages.findIndex(m => m.id === baseMessageId);
        if (messageIndex === -1) return session;

        const updatedMessages = [...session.messages];
        const existingBuffers = updatedMessages[messageIndex].cachedAudioBuffers || [];
        
        const newBuffers = [...existingBuffers];
        while (newBuffers.length <= partIndex) {
          newBuffers.push(null);
        }
        newBuffers[partIndex] = audioBuffer;
        
        updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            cachedAudioBuffers: newBuffers,
        };
        return { ...session, messages: updatedMessages };
    });
  }, [currentChatSession?.id, updateChatSession]);

  const handleCancelMultiPartFetch = useCallback((baseMessageId: string) => {
    const controller = multiPartFetchControllersRef.current.get(baseMessageId);
    if (controller) {
      strictAbort(controller); 
      multiPartFetchControllersRef.current.delete(baseMessageId);
      setActiveMultiPartFetches(prev => {
        const next = new Set(prev);
        next.delete(baseMessageId);
        return next;
      });
      showToast("Multi-part audio fetch cancelled.", "success");
    }
  }, [showToast]);

  const handlePlayTextForMessage = useCallback(async (originalFullText: string, baseMessageId: string, partIndexToPlay?: number) => {
    const chat = currentChatSession;
    if (!chat || !chat.settings?.ttsSettings || !originalFullText.trim()) {
      showToast("TTS settings not configured, message empty, or chat not found.", "error");
      return;
    }
    const ttsSettings = chat.settings.ttsSettings;
    const message = chat.messages.find(m => m.id === baseMessageId);
    if (!message) {
      return;
    }


    const targetSegmentId = partIndexToPlay !== undefined ? `${baseMessageId}_part_${partIndexToPlay}` : baseMessageId;

    if (audioPlayerHook.audioPlayerState.currentMessageId && 
        audioPlayerHook.audioPlayerState.currentMessageId !== targetSegmentId
    ) {
        const currentAudioMsgId = audioPlayerHook.audioPlayerState.currentMessageId;
        const currentBaseId = currentAudioMsgId.split('_part_')[0];
        if (multiPartFetchControllersRef.current.has(currentBaseId)) {
            handleCancelMultiPartFetch(currentBaseId);
        }
        if (audioPlayerHook.isApiFetchingThisSegment(currentAudioMsgId)) {
            audioPlayerHook.cancelCurrentSegmentAudioLoad(currentAudioMsgId);
        }
        audioPlayerHook.stopPlayback(); 
    }

    const segmentIdForAutoFetchCheck = partIndexToPlay !== undefined ? `${baseMessageId}_part_${partIndexToPlay}` : `${baseMessageId}_part_0`;
    if (isAutoFetchingSegment(`autofetch_${segmentIdForAutoFetchCheck}`)) {
        onCancelAutoFetchSegment(`autofetch_${segmentIdForAutoFetchCheck}`);
    }
    
    const maxWords = ttsSettings.maxWordsPerSegment || MAX_WORDS_PER_TTS_SEGMENT;
    const textSegments = splitTextForTts(originalFullText, maxWords);
    const numExpectedSegments = textSegments.length;

    const allPartsAreCached = message.cachedAudioBuffers &&
                             message.cachedAudioBuffers.length === numExpectedSegments &&
                             message.cachedAudioBuffers.every(buffer => !!buffer);


    if (partIndexToPlay !== undefined) { 
        const textSegmentToPlayNow = textSegments[partIndexToPlay];
        if (!textSegmentToPlayNow) {
            return;
        }
        const uniqueSegmentId = `${baseMessageId}_part_${partIndexToPlay}`;
        const cachedBuffer = message.cachedAudioBuffers?.[partIndexToPlay];
        // If cached, playText will play. If not, it will fetch and make ready.
        audioPlayerHook.playText(textSegmentToPlayNow, uniqueSegmentId, ttsSettings, cachedBuffer);
    } else { 
        const firstSegmentText = textSegments[0] || "";
        const firstSegmentId = numExpectedSegments > 1 ? `${baseMessageId}_part_0` : baseMessageId;
        const firstSegmentCached = !!message.cachedAudioBuffers?.[0];

        const needsAnyFetching = (numExpectedSegments > 1 && !allPartsAreCached) || (numExpectedSegments === 1 && !firstSegmentCached);

        if (needsAnyFetching) {
            if (multiPartFetchControllersRef.current.has(baseMessageId)) { 
                return;
            }

            const controller = new AbortController();
            multiPartFetchControllersRef.current.set(baseMessageId, controller);
            setActiveMultiPartFetches(prev => new Set(prev).add(baseMessageId));
            
            const partsToFetchCount = textSegments.filter((_, idx) => !message.cachedAudioBuffers?.[idx]).length;
            if (partsToFetchCount > 0) {
                showToast(`Fetching ${partsToFetchCount} audio part${partsToFetchCount > 1 ? 's' : ''}...`, "success");
            }

            try {
                let newBuffers: (ArrayBuffer | null)[] = message.cachedAudioBuffers ? [...message.cachedAudioBuffers] : [];
                while(newBuffers.length < numExpectedSegments) newBuffers.push(null);

                let allFetchesSucceededForPlayback = true;

                const fetchPromises = textSegments.map(async (segmentText, index) => {
                    if (controller.signal.aborted) {
                        throw new DOMException('Aborted by user', 'AbortError');
                    }
                    if (!newBuffers[index]) { 
                        const audioBuffer = await generateSpeech(apiKey, segmentText, ttsSettings, logApiRequest, controller.signal);
                        if (controller.signal.aborted) {
                            throw new DOMException('Aborted by user', 'AbortError');
                        }
                        newBuffers[index] = audioBuffer;
                    }
                    return { status: 'fulfilled', index }; 
                });

                const results = await Promise.allSettled(fetchPromises);


                if (controller.signal.aborted) {
                     showToast("Audio fetch cancelled.", "success");
                     return; 
                }

                results.forEach((result, i) => { 
                    if (result.status === 'rejected') {
                        allFetchesSucceededForPlayback = false;
                        console.error(`[AudioControls] Failed to fetch audio for part ${i + 1} of ${baseMessageId}:`, result.reason);
                    }
                });
                
                await updateChatSession(chat.id, (session) => {
                    if (!session) return null;
                    const msgIndex = session.messages.findIndex(m => m.id === baseMessageId);
                    if (msgIndex === -1) return session;
                    const updatedMessages = [...session.messages];
                    updatedMessages[msgIndex] = { ...updatedMessages[msgIndex], cachedAudioBuffers: newBuffers };
                    return { ...session, messages: updatedMessages };
                });

                // After fetching, do not auto-play. Just show toast.
                if (allFetchesSucceededForPlayback && partsToFetchCount > 0) {
                    showToast("Audio fetched and ready.", "success");
                } else if (!allFetchesSucceededForPlayback && partsToFetchCount > 0) {
                    showToast("Some audio parts failed to fetch. Playable parts are ready.", "error");
                }
                // If newBuffers[0] is not available, cannot play.
                if (!newBuffers[0] && !allFetchesSucceededForPlayback) {
                     showToast("Failed to fetch initial audio part. Cannot play.", "error");
                }
                // If partsToFetchCount was 0, it means everything was already cached. 
                // The `else` block below will handle playing cached audio.

            } catch (error: any) {
                if (error.name !== 'AbortError') {
                    console.error(`[AudioControls] Error during main button audio fetch for ${baseMessageId}:`, error);
                    showToast("Failed to fetch audio: " + error.message, "error");
                } else {
                     if (!controller.signal.aborted) { 
                        showToast("Audio fetch process was aborted.", "success");
                    }
                }
            } finally {
                if (multiPartFetchControllersRef.current.get(baseMessageId) === controller) {
                    multiPartFetchControllersRef.current.delete(baseMessageId);
                }
                setActiveMultiPartFetches(prev => {
                    const next = new Set(prev);
                    next.delete(baseMessageId);
                    return next;
                });
            }
        } else { 
            // All parts were already cached when the button was clicked. Play it.
            audioPlayerHook.playText(firstSegmentText, firstSegmentId, ttsSettings, message.cachedAudioBuffers?.[0]);
        }
    }
  }, [apiKey, currentChatSession, showToast, logApiRequest, audioPlayerHook, updateChatSession, isAutoFetchingSegment, onCancelAutoFetchSegment, handleCancelMultiPartFetch]);


  const handleStopAndCancelAllForCurrentAudio = useCallback(() => {
    const currentAudioMessageId = audioPlayerHook.audioPlayerState.currentMessageId;
    if (currentAudioMessageId) {
        const baseMessageId = currentAudioMessageId.split('_part_')[0];
        if (multiPartFetchControllersRef.current.has(baseMessageId)) {
            handleCancelMultiPartFetch(baseMessageId);
        }
        if (audioPlayerHook.isApiFetchingThisSegment(currentAudioMessageId)) {
            audioPlayerHook.cancelCurrentSegmentAudioLoad(currentAudioMessageId);
        }
    }
    audioPlayerHook.stopPlayback(); 
  }, [audioPlayerHook, handleCancelMultiPartFetch]);

  const handleClosePlayerViewOnly = useCallback(() => {
    audioPlayerHook.clearPlayerViewAndStopAudio(); 
  }, [audioPlayerHook]);


  const handleDownloadAudio = useCallback(async (_sessionId: string, messageId: string, userProvidedName?: string) => {
    const chat = currentChatSession; 
    const message = chat?.messages.find(m => m.id === messageId);

    if (!chat || !message || !message.content.trim() || !chat.settings.ttsSettings) {
        showToast("Cannot download audio: message or TTS settings not found.", "error");
        return;
    }
    
    const maxWords = chat.settings.ttsSettings.maxWordsPerSegment || MAX_WORDS_PER_TTS_SEGMENT;
    const textSegments = splitTextForTts(message.content, maxWords);
    const numExpectedParts = textSegments.length;
    const allPartsAreCached = message.cachedAudioBuffers &&
                             message.cachedAudioBuffers.length === numExpectedParts &&
                             message.cachedAudioBuffers.every(buffer => !!buffer);

    if (!allPartsAreCached) {
        showToast("Audio not fully ready for download. Ensure all parts are fetched.", "error");
        return;
    }

    const desiredMimeType = 'audio/mpeg';
    const fileExtension = '.mp3';
    
    let finalFilename: string;

    if (userProvidedName && userProvidedName.trim() !== '') {
        finalFilename = `${sanitizeFilename(userProvidedName.trim(), 100)}${fileExtension}`;
    } else {
        // Fallback to old naming if no name provided (though prompt should ensure one)
        const words = message.content.trim().split(/\s+/);
        const firstWords = words.slice(0, 7).join(' ');
        const baseName = sanitizeFilename(firstWords, 50);
        const uniqueIdSuffix = message.id.substring(message.id.length - 6);
        finalFilename = `${baseName || 'audio'}_${uniqueIdSuffix}${fileExtension}`;
    }


    const combinedPcm = audioUtils.concatenateAudioBuffers(message.cachedAudioBuffers!.filter(b => b !== null) as ArrayBuffer[]);
    if (combinedPcm.byteLength === 0) {
        showToast("No audio data to download.", "error");
        return;
    }
    const audioBlob = audioUtils.createAudioFileFromPcm(combinedPcm, desiredMimeType);
    triggerDownload(audioBlob, finalFilename); 
    showToast(`Audio download started as "${finalFilename}".`, "success");
  }, [currentChatSession, showToast]);
  
  const handleResetAudioCache = useCallback((sessionId: string, messageId: string) => {
    requestResetAudioCacheConfirmationModal(sessionId, messageId);
  }, [requestResetAudioCacheConfirmationModal]);

  return {
    handlePlayTextForMessage,
    handleCancelMultiPartFetch,
    handleStopAndCancelAllForCurrentAudio, 
    handleClosePlayerViewOnly, 
    handleDownloadAudio,
    handleResetAudioCache,
    activeMultiPartFetches, 
    isMainButtonMultiFetchingApi: (baseId: string) => activeMultiPartFetches.has(baseId),
    handleCacheAudioForMessageCallback, 
    getSegmentFetchError: audioPlayerHook.getSegmentFetchError, 
  };
}