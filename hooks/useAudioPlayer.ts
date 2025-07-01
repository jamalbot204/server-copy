import { useState, useCallback, useRef, useEffect } from 'react';
import { TTSSettings, AudioPlayerState, UseAudioPlayerOptions, UseAudioPlayerReturn } from '../types.ts';
import { generateSpeech, playPcmAudio } from '../services/ttsService.ts';
import { strictAbort } from '../services/cancellationService.ts'; // Import strictAbort
import { PLAYBACK_SPEEDS } from '../constants.ts';


export function useAudioPlayer(
  options: UseAudioPlayerOptions
): UseAudioPlayerReturn {
  const { apiKey, logApiRequest, onCacheAudio, onAutoplayNextSegment, onFetchStart, onFetchEnd } = options;
  const [audioPlayerState, setAudioPlayerState] = useState<AudioPlayerState>({
    isLoading: false,
    isPlaying: false,
    currentMessageId: null,
    error: null,
    currentTime: 0,
    duration: 0,
    currentPlayingText: null,
    playbackRate: 1.0, // Initialize playbackRate
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentPcmDataBufferRef = useRef<ArrayBuffer | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const audioStartTimeRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);

  const activeFetchControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [fetchingSegmentIds, setFetchingSegmentIds] = useState<Set<string>>(new Set());
  const [segmentFetchErrors, setSegmentFetchErrors] = useState<Map<string, string>>(new Map());


  useEffect(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return () => {
      // Cleanup AbortControllers
      activeFetchControllersRef.current.forEach(controller => strictAbort(controller));
      activeFetchControllersRef.current.clear();
      setFetchingSegmentIds(new Set()); // Clear fetching IDs on unmount

      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch (e) {}
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      }
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  const resumeAudioContext = async () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch (err) {
        console.error("Failed to resume AudioContext:", err);
        setAudioPlayerState(prev => ({ ...prev, error: "Audio playback requires user interaction."}));
      }
    }
  };

  const stopCurrentPlayback = useCallback((clearFullState = false) => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.onended = null;
        audioSourceRef.current.stop();
      } catch (e) { /* ignore */ }
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (clearFullState) {
        currentPcmDataBufferRef.current = null;
        setAudioPlayerState(prev => ({
            ...prev,
            isLoading: false, // isLoading here refers to player loading, not API fetch
            isPlaying: false,
            currentMessageId: null,
            currentPlayingText: null,
            currentTime: 0,
            duration: 0,
            error: null,
            // playbackRate is a user setting, don't reset it on full stop unless intended
        }));
        playbackOffsetRef.current = 0;
    } else {
         playbackOffsetRef.current = audioPlayerState.currentTime || 0;
         setAudioPlayerState(prev => ({ ...prev, isPlaying: false }));
    }
  }, [audioPlayerState.currentTime]);

  const updateProgress = useCallback(() => {
    if (!audioContextRef.current || !audioSourceRef.current?.buffer) {
        if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
            animationFrameIdRef.current = null;
        }
        return;
    }

    setAudioPlayerState(prev => {
        if (!prev.isPlaying || prev.currentMessageId === null || prev.duration === undefined) {
            if (animationFrameIdRef.current) { // Ensure cleanup if conditions aren't met
                cancelAnimationFrame(animationFrameIdRef.current);
                animationFrameIdRef.current = null;
            }
            return prev;
        }

        const elapsed_context_time = audioContextRef.current!.currentTime - audioStartTimeRef.current;
        const newCurrentTime = elapsed_context_time * (audioSourceRef.current?.playbackRate.value || 1.0);
        animationFrameIdRef.current = requestAnimationFrame(updateProgress);

        return {
            ...prev,
            currentTime: Math.min(prev.duration, Math.max(0, newCurrentTime)),
        };
    });
  }, [/* No direct dependencies, relies on refs and functional state updates */]);


  const startPlaybackInternal = useCallback(async (
    pcmBuffer: ArrayBuffer,
    startTimeOffset: number = 0,
    textSegment: string,
    uniqueSegmentId: string
  ) => {
    if (!audioContextRef.current) throw new Error("AudioContext not available.");

    stopCurrentPlayback(false); 

    currentPcmDataBufferRef.current = pcmBuffer;
    playbackOffsetRef.current = startTimeOffset; 

    const { sourceNode, duration } = await playPcmAudio(audioContextRef.current, pcmBuffer, 24000);
    audioSourceRef.current = sourceNode;
    audioSourceRef.current.playbackRate.value = audioPlayerState.playbackRate;


    setAudioPlayerState(prev => ({ 
      ...prev,
      isLoading: false, 
      isPlaying: true,
      currentMessageId: uniqueSegmentId,
      error: null, // Clear player-level error when starting new playback
      currentTime: startTimeOffset, 
      duration: duration,
      currentPlayingText: textSegment,
    }));
    // Clear segment-specific fetch error now that playback is starting successfully
    setSegmentFetchErrors(prev => {
      const next = new Map(prev);
      next.delete(uniqueSegmentId);
      return next;
    });


    audioStartTimeRef.current = audioContextRef.current.currentTime - (startTimeOffset / audioPlayerState.playbackRate);
    
    if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    animationFrameIdRef.current = requestAnimationFrame(updateProgress);

    audioSourceRef.current.onended = () => {
      if (audioSourceRef.current === sourceNode) { 
        const finishedSegmentId = uniqueSegmentId;
        audioSourceRef.current = null;
        if (animationFrameIdRef.current) {
          cancelAnimationFrame(animationFrameIdRef.current);
          animationFrameIdRef.current = null;
        }

        setAudioPlayerState(prev => {
          if (prev.currentMessageId === finishedSegmentId) {
            return { ...prev, isPlaying: false, currentTime: prev.duration !== undefined ? prev.duration : prev.currentTime };
          }
          return prev;
        });

        if (onAutoplayNextSegment) {
            const parts = finishedSegmentId.split('_part_');
            if (parts.length === 2) {
                const baseMessageId = parts[0];
                const playedPartIndex = parseInt(parts[1], 10);
                if (!isNaN(playedPartIndex)) {
                    onAutoplayNextSegment(baseMessageId, playedPartIndex);
                }
            }
        }
      }
    };

    audioSourceRef.current.start(0, startTimeOffset); 

  }, [stopCurrentPlayback, updateProgress, onAutoplayNextSegment, audioPlayerState.playbackRate]);

  const pausePlayback = useCallback(() => {
    if (audioPlayerState.isPlaying) {
      stopCurrentPlayback(false); 
    }
  }, [audioPlayerState.isPlaying, stopCurrentPlayback]);

  const resumePlayback = useCallback(async () => {
    if (!audioPlayerState.isPlaying && audioPlayerState.currentMessageId && currentPcmDataBufferRef.current) {
      if (!audioContextRef.current) return;
      await resumeAudioContext();
      try {
        setAudioPlayerState(prev => ({ ...prev, isLoading: true, error: null })); 
        await startPlaybackInternal(
          currentPcmDataBufferRef.current,
          audioPlayerState.currentTime || 0, 
          audioPlayerState.currentPlayingText || "",
          audioPlayerState.currentMessageId
        );
      } catch (caughtError: any) {
        console.error("Error resuming playback:", caughtError);
        setAudioPlayerState(prev => ({ ...prev, isLoading: false, isPlaying: false, error: (caughtError as Error).message || "Failed to resume." }));
      }
    }
  }, [audioPlayerState.isPlaying, audioPlayerState.currentMessageId, audioPlayerState.currentTime, audioPlayerState.currentPlayingText, startPlaybackInternal]);

  const playText = useCallback(async (
    textSegment: string,
    uniqueSegmentId: string,
    ttsSettings: TTSSettings,
    cachedBufferForSegment?: ArrayBuffer | null
  ) => {
    if (!audioContextRef.current) {
      setAudioPlayerState(prev => ({ ...prev, error: "AudioContext not available."}));
      return;
    }
    await resumeAudioContext();

    setSegmentFetchErrors(prev => {
        const next = new Map(prev);
        next.delete(uniqueSegmentId);
        return next;
    });
    if (audioPlayerState.currentMessageId === uniqueSegmentId) {
        setAudioPlayerState(prev => ({...prev, error: null}));
    }

    if (audioPlayerState.currentMessageId === uniqueSegmentId) { 
      if (audioPlayerState.isPlaying) {
        pausePlayback();
        return;
      } else if (currentPcmDataBufferRef.current) { 
        await resumePlayback();
        return;
      }
    }
    
    if (cachedBufferForSegment) {
      // If cached, play immediately (or if it was already playing this segment and was paused, resumePlayback would have been called)
      // This path is taken when the user clicks play on an already cached item.
      stopCurrentPlayback(true); // Stop anything else, ensure clean state for this new play
      setAudioPlayerState(prev => ({ 
        ...prev,
        isLoading: true, // Player is loading the buffer
        isPlaying: false, 
        currentMessageId: uniqueSegmentId,
        currentPlayingText: textSegment,
        error: null,
        currentTime: 0, 
        duration: 0,    
      }));
      await startPlaybackInternal(cachedBufferForSegment, 0, textSegment, uniqueSegmentId);
      return;
    }
    
    // If not cached, fetch but DO NOT play automatically.
    stopCurrentPlayback(true); // Stop anything else

    const existingController = activeFetchControllersRef.current.get(uniqueSegmentId);
    if (existingController) { 
        return; 
    }

    const controller = new AbortController();
    activeFetchControllersRef.current.set(uniqueSegmentId, controller);
    setFetchingSegmentIds(prev => new Set(prev).add(uniqueSegmentId)); 
    onFetchStart?.(uniqueSegmentId);

    setAudioPlayerState(prev => ({ 
        ...prev,
        isLoading: true, // API is loading
        isPlaying: false,
        currentMessageId: uniqueSegmentId,
        error: null,
        currentTime:0,
        duration:0,
        currentPlayingText: textSegment
    }));

    let fetchError: Error | undefined;
    try {
      const pcmDataBuffer = await generateSpeech(apiKey, textSegment, ttsSettings, logApiRequest, controller.signal);
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      onCacheAudio?.(uniqueSegmentId, pcmDataBuffer);

      // Audio fetched and cached. Update state to reflect readiness but DO NOT PLAY.
      setAudioPlayerState(prev => {
        if (prev.currentMessageId === uniqueSegmentId) { // If this is still the targeted segment
             return {
                 ...prev,
                 isLoading: false, // API loading finished
                 isPlaying: false, // Not playing
                 error: null,
                 // Duration will be determined when startPlaybackInternal is called after user clicks play
             };
        }
        return prev; // Player target changed during fetch
      });

    } catch (caughtError: any) {
      fetchError = caughtError as Error;
      if (fetchError.name === 'AbortError') {
        console.log(`Fetch for ${uniqueSegmentId} was aborted.`);
        if (!segmentFetchErrors.has(uniqueSegmentId)) {
             setSegmentFetchErrors(prev => {
                const next = new Map(prev);
                next.delete(uniqueSegmentId); 
                return next;
            });
        }
        setAudioPlayerState(prev => {
            if (prev.currentMessageId === uniqueSegmentId) {
                 return { ...prev, isLoading: false, isPlaying: false, error: segmentFetchErrors.get(uniqueSegmentId) || null };
            }
            return prev;
        });

      } else {
        console.error(`Error in TTS playback for segment ${uniqueSegmentId}:`, caughtError);
        const errorMsg = caughtError.message || "Failed to play audio.";
        setSegmentFetchErrors(prev => new Map(prev).set(uniqueSegmentId, errorMsg));
        setAudioPlayerState(prev => {
            if (prev.currentMessageId === uniqueSegmentId) {
                return { ...prev, isLoading: false, isPlaying: false, error: errorMsg };
            }
            return prev;
        });
      }
      currentPcmDataBufferRef.current = null; 
    } finally {
        if (activeFetchControllersRef.current.get(uniqueSegmentId) === controller) {
            activeFetchControllersRef.current.delete(uniqueSegmentId);
        }
        setFetchingSegmentIds(prev => {
            const next = new Set(prev);
            next.delete(uniqueSegmentId);
            return next;
        });
        onFetchEnd?.(uniqueSegmentId, fetchError);
    }
  }, [
      apiKey,
      logApiRequest,
      startPlaybackInternal,
      stopCurrentPlayback,
      audioPlayerState.isPlaying, 
      audioPlayerState.currentMessageId,
      // audioPlayerState.isLoading, // Removed isLoading from here as it creates loops with setAudioPlayerState
      onCacheAudio,
      onFetchStart,
      onFetchEnd,
      pausePlayback,
      resumePlayback,
      segmentFetchErrors
    ]);

  const cancelCurrentSegmentAudioLoad = useCallback((segmentIdToCancel: string) => {
    const controller = activeFetchControllersRef.current.get(segmentIdToCancel);

    if (controller) {
      strictAbort(controller); 
      activeFetchControllersRef.current.delete(segmentIdToCancel); // Remove controller
    }
    
    setFetchingSegmentIds(prev => {
      const next = new Set(prev);
      next.delete(segmentIdToCancel);
      return next;
    });
    setSegmentFetchErrors(prev => {
      const next = new Map(prev);
      next.delete(segmentIdToCancel); 
      return next;
    });

    onFetchEnd?.(segmentIdToCancel, new DOMException('Cancelled by user', 'AbortError'));

    if (audioPlayerState.currentMessageId === segmentIdToCancel) {
      setAudioPlayerState(prev => ({
        ...prev,
        isLoading: false, 
        isPlaying: false, 
        error: null, 
      }));
    }
  }, [
      audioPlayerState.currentMessageId,
      onFetchEnd 
  ]);

  const isApiFetchingThisSegment = useCallback((uniqueSegmentId: string): boolean => {
    return fetchingSegmentIds.has(uniqueSegmentId);
  }, [fetchingSegmentIds]);

  const getSegmentFetchError = useCallback((uniqueSegmentId: string): string | undefined => {
    return segmentFetchErrors.get(uniqueSegmentId);
  }, [segmentFetchErrors]);


  const stopPlayback = useCallback(() => {
    if (audioPlayerState.currentMessageId) {
        if (isApiFetchingThisSegment(audioPlayerState.currentMessageId)) {
            cancelCurrentSegmentAudioLoad(audioPlayerState.currentMessageId);
        }
    }
    stopCurrentPlayback(true); 
  }, [stopCurrentPlayback, audioPlayerState.currentMessageId, cancelCurrentSegmentAudioLoad, isApiFetchingThisSegment]);
  
  const clearPlayerViewAndStopAudio = useCallback(() => {
    stopCurrentPlayback(true); 
  }, [stopCurrentPlayback]);

  const togglePlayPause = useCallback(async () => {
    if (audioPlayerState.isPlaying) {
      pausePlayback();
    } else if (audioPlayerState.currentMessageId && currentPcmDataBufferRef.current) {
      await resumePlayback();
    }
  }, [audioPlayerState.isPlaying, audioPlayerState.currentMessageId, pausePlayback, resumePlayback]);


  const seekInternal = useCallback(async (newStartTime: number) => {
    if (!audioContextRef.current || !currentPcmDataBufferRef.current || !audioPlayerState.currentMessageId || audioPlayerState.duration === undefined) {
      return;
    }
    await resumeAudioContext();

    const currentBuffer = currentPcmDataBufferRef.current;
    const currentText = audioPlayerState.currentPlayingText || "";
    const msgId = audioPlayerState.currentMessageId;

    const clampedNewStartTime = Math.max(0, Math.min(newStartTime, audioPlayerState.duration));

    setAudioPlayerState(prev => ({ 
        ...prev, 
        isPlaying: false, 
        currentTime: clampedNewStartTime, 
        isLoading: true 
    }));
    setSegmentFetchErrors(prev => {
        const next = new Map(prev);
        next.delete(msgId); 
        return next;
    });

    try {
        await startPlaybackInternal(currentBuffer, clampedNewStartTime, currentText, msgId);
    } catch (caughtError: any) {
        console.error("Error seeking audio:", caughtError);
        const errorMsg = (caughtError as Error).message || "Seek failed.";
        setSegmentFetchErrors(prev => new Map(prev).set(msgId, errorMsg));
        setAudioPlayerState(prev => ({
            ...prev,
            isLoading: false, isPlaying: false, error: errorMsg
        }));
    }
  }, [audioPlayerState.currentMessageId, audioPlayerState.duration, audioPlayerState.currentPlayingText, startPlaybackInternal]);


  const seekRelative = useCallback(async (offsetSeconds: number) => {
    if (audioPlayerState.duration === undefined || audioPlayerState.currentTime === undefined) return;
    const newStartTime = (audioPlayerState.currentTime || 0) + offsetSeconds;
    await seekInternal(newStartTime);
  }, [audioPlayerState.currentTime, audioPlayerState.duration, seekInternal]);

  const seekToAbsolute = useCallback(async (timeInSeconds: number) => {
    if (audioPlayerState.duration === undefined) return;
    await seekInternal(timeInSeconds);
  }, [audioPlayerState.duration, seekInternal]);

  const changeSpeed = useCallback((direction: 'increase' | 'decrease') => {
    setAudioPlayerState(prev => {
      const currentIndex = PLAYBACK_SPEEDS.indexOf(prev.playbackRate);
      let nextIndex;
      if (direction === 'increase') {
        nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
      } else {
        nextIndex = Math.max(currentIndex - 1, 0);
      }
      const newRate = PLAYBACK_SPEEDS[nextIndex];
      
      if (audioSourceRef.current && prev.isPlaying) {
        audioSourceRef.current.playbackRate.value = newRate;
        if (audioContextRef.current && prev.currentTime !== undefined) {
             audioStartTimeRef.current = audioContextRef.current.currentTime - (prev.currentTime / newRate);
        }
      }
      return { ...prev, playbackRate: newRate };
    });
  }, []);

  const increaseSpeed = useCallback(() => changeSpeed('increase'), [changeSpeed]);
  const decreaseSpeed = useCallback(() => changeSpeed('decrease'), [changeSpeed]);


  return {
    audioPlayerState,
    playText,
    stopPlayback,
    clearPlayerViewAndStopAudio,
    seekRelative,
    seekToAbsolute,
    togglePlayPause,
    pausePlayback,
    resumePlayback,
    cancelCurrentSegmentAudioLoad,
    isApiFetchingThisSegment,
    getSegmentFetchError,
    increaseSpeed,
    decreaseSpeed,
  };
}
