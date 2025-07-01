
import { useCallback } from 'react';
import { ChatSession, Attachment, ExportConfiguration, ChatMessage, ApiRequestLog, ApiKey } from '../types.ts'; // Added ApiRequestLog
import * as dbService from '../services/dbService.ts';
import { METADATA_KEYS } from '../services/dbService.ts'; // Corrected import
import { DEFAULT_SETTINGS, DEFAULT_SAFETY_SETTINGS, INITIAL_MESSAGES_COUNT, DEFAULT_TTS_SETTINGS, DEFAULT_EXPORT_CONFIGURATION } from '../constants.ts';

export function useImportExport(
  setChatHistory: React.Dispatch<React.SetStateAction<ChatSession[]>>,
  setCurrentChatId: (id: string | null) => Promise<void>,
  setMessageGenerationTimes: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>,
  setMessagesToDisplayConfig: (updater: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => Promise<void>,
  showToast: (message: string, type?: 'success' | 'error', duration?: number) => void, // Added showToast
  chatHistoryForExport: ChatSession[] // Added: Current chat history state from App
) {

  const transformImportedData = (importedRawData: any): {
    sessions: ChatSession[],
    generationTimes: Record<string, number>,
    displayConfig: Record<string,number>,
    activeChatId?: string | null,
    exportConfiguration?: ExportConfiguration,
    apiKeys?: ApiKey[],
  } => {
    const importedGenerationTimes: Record<string, number> =
      (importedRawData?.data?.messageGenerationTimes && typeof importedRawData.data.messageGenerationTimes === 'object')
      ? importedRawData.data.messageGenerationTimes : {};

    const importedDisplayConfig: Record<string, number> = 
      (importedRawData?.data?.messagesToDisplayConfig && typeof importedRawData.data.messagesToDisplayConfig === 'object')
      ? importedRawData.data.messagesToDisplayConfig : {};
      
    const importedExportConfig: ExportConfiguration | undefined = 
        (importedRawData?.data?.exportConfigurationUsed && typeof importedRawData.data.exportConfigurationUsed === 'object') // Check new key first
        ? { ...DEFAULT_EXPORT_CONFIGURATION, ...importedRawData.data.exportConfigurationUsed }
        : (importedRawData?.data?.exportConfiguration && typeof importedRawData.data.exportConfiguration === 'object') // Fallback for older exports
        ? { ...DEFAULT_EXPORT_CONFIGURATION, ...importedRawData.data.exportConfiguration }
        : undefined;

    const importedApiKeys: ApiKey[] | undefined =
        (importedRawData?.data?.apiKeys && Array.isArray(importedRawData.data.apiKeys))
        ? importedRawData.data.apiKeys : undefined;


    let importedActiveChatId: string | null | undefined = undefined;
    if (importedRawData?.data?.appState && Array.isArray(importedRawData.data.appState)) {
        const activeChatState = importedRawData.data.appState.find((s: any) => s.key === 'activeChatId');
        if (activeChatState) {
            importedActiveChatId = activeChatState.value;
        }
    } else if (importedRawData?.data?.lastActiveChatId) { // Support older single key format
        importedActiveChatId = importedRawData.data.lastActiveChatId;
    }


    if (importedRawData?.data?.chats) { 
        const sessions: ChatSession[] = importedRawData.data.chats.map((s: any) => ({
            ...s,
            createdAt: new Date(s.createdAt),
            lastUpdatedAt: new Date(s.lastUpdatedAt),
            messages: s.messages.map((m: any) => {
                const importedMessage: Partial<ChatMessage> = {
                    ...m,
                    timestamp: new Date(m.timestamp),
                    groundingMetadata: m.groundingMetadata || undefined,
                    characterName: m.characterName || undefined, 
                    cachedAudioBuffers: null, // Initialize
                };

                // Import attachments
                if (m.attachments) {
                    importedMessage.attachments = m.attachments.map((att: any) => {
                        const importedAttachment: Attachment = {
                            id: att.id || `imported-att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                            type: att.type || (att.mimeType?.startsWith('image/') ? 'image' : 'video'),
                            mimeType: att.mimeType,
                            name: att.name,
                            size: att.size,
                            fileUri: att.fileUri,
                            fileApiName: att.fileApiName,
                            base64Data: att.base64Data,
                            dataUrl: att.dataUrl,
                            uploadState: undefined,
                            statusMessage: undefined,
                            error: undefined,
                            isLoading: false,
                        };
                        if (importedAttachment.fileUri && importedAttachment.fileApiName) {
                            importedAttachment.uploadState = 'completed_cloud_upload';
                            importedAttachment.statusMessage = 'Cloud file (from import)';
                        } else if (importedAttachment.base64Data && importedAttachment.mimeType) {
                            if (!importedAttachment.dataUrl) {
                               importedAttachment.dataUrl = `data:${importedAttachment.mimeType};base64,${importedAttachment.base64Data}`;
                            }
                            importedAttachment.uploadState = 'completed';
                            importedAttachment.statusMessage = 'Local data (from import)';
                        } else {
                            importedAttachment.uploadState = 'error_client_read'; 
                            importedAttachment.statusMessage = 'Imported file data incomplete or missing.';
                            importedAttachment.error = 'Incomplete file data from import.';
                        }
                        return importedAttachment;
                    });
                } else {
                    importedMessage.attachments = undefined;
                }
                
                // Import cached message audio
                if (m.exportedMessageAudioBase64 && Array.isArray(m.exportedMessageAudioBase64)) {
                    const audioBuffers: (ArrayBuffer | null)[] = (m.exportedMessageAudioBase64 as string[]).map(base64String => {
                        if (typeof base64String === 'string') {
                            try {
                                const binary_string = window.atob(base64String);
                                const len = binary_string.length;
                                const bytes = new Uint8Array(len);
                                for (let i = 0; i < len; i++) {
                                    bytes[i] = binary_string.charCodeAt(i);
                                }
                                return bytes.buffer;
                            } catch (e) {
                                console.error("Failed to decode base64 audio string during import for message:", m.id, e);
                                return null;
                            }
                        }
                        return null;
                    });
                    if (audioBuffers.some(b => b !== null)) {
                        importedMessage.cachedAudioBuffers = audioBuffers;
                    }
                }
                delete importedMessage.exportedMessageAudioBase64; // Clean up temporary field

                return importedMessage as ChatMessage;
            }),
            settings: {
                ...DEFAULT_SETTINGS, 
                ...s.settings,      
                safetySettings: s.settings?.safetySettings?.length ? s.settings.safetySettings : [...DEFAULT_SAFETY_SETTINGS],
                ttsSettings: s.settings?.ttsSettings || { ...DEFAULT_TTS_SETTINGS }, // Handle TTS settings on import
                aiSeesTimestamps: s.settings?.aiSeesTimestamps === undefined ? DEFAULT_SETTINGS.aiSeesTimestamps : s.settings.aiSeesTimestamps,
                useGoogleSearch: s.settings?.useGoogleSearch === undefined ? DEFAULT_SETTINGS.useGoogleSearch : s.settings.useGoogleSearch,
                urlContext: s.settings?.urlContext || DEFAULT_SETTINGS.urlContext || [],
                maxInitialMessagesDisplayed: s.settings?.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT,
                debugApiRequests: s.settings?.debugApiRequests === undefined ? DEFAULT_SETTINGS.debugApiRequests : s.settings.debugApiRequests,
            },
            isCharacterModeActive: s.isCharacterModeActive || false, 
            aiCharacters: (s.aiCharacters || []).map((char: any) => ({ ...char, contextualInfo: char.contextualInfo || ''})),
            apiRequestLogs: (s.apiRequestLogs || []).map((log: any) => ({
                ...log,
                timestamp: new Date(log.timestamp)
            })),                   
        }));
        return { 
            sessions, 
            generationTimes: importedGenerationTimes, 
            displayConfig: importedDisplayConfig,
            activeChatId: importedActiveChatId,
            exportConfiguration: importedExportConfig,
            apiKeys: importedApiKeys,
        };
    }

    if (typeof importedRawData !== 'object' || importedRawData === null ) {
      console.error("Imported JSON structure is invalid.");
      return { sessions: [], generationTimes: {}, displayConfig: {}, activeChatId: null };
    }
    console.warn("Attempting to import legacy data format. Some features or data might be missing or transformed.")
    return { 
        sessions: [], 
        generationTimes: importedGenerationTimes, 
        displayConfig: importedDisplayConfig, 
        activeChatId: importedActiveChatId,
        exportConfiguration: importedExportConfig,
        apiKeys: importedApiKeys,
    };
  };

  const handleExportChats = useCallback(async (chatIdsToExport: string[], exportConfig: ExportConfiguration) => {
    if (chatIdsToExport.length === 0) {
        showToast("No chats selected for export.", "error");
        return;
    }

    // Use the chatHistoryForExport state directly
    const sessionsToProcess = chatHistoryForExport.filter(s => chatIdsToExport.includes(s.id));

    if (sessionsToProcess.length === 0) {
        showToast("Selected chats could not be found.", "error");
        return;
    }
    
    let sessionsForExport: Partial<ChatSession>[] = [];
    if (exportConfig.includeChatSessionsAndMessages) {
        sessionsForExport = sessionsToProcess.map(session => {
            // Ensure latest TTS settings are in the session object before stripping anything
             const sessionWithUpToDateTTS: ChatSession = {
                ...session,
                settings: {
                    ...session.settings,
                    ttsSettings: session.settings.ttsSettings || { ...DEFAULT_TTS_SETTINGS }
                },
                apiRequestLogs: session.apiRequestLogs || [], // Ensure apiRequestLogs is an array
            };

            let processedSession: Partial<ChatSession> = { ...sessionWithUpToDateTTS };
            
            if (!exportConfig.includeApiLogs) {
                delete processedSession.apiRequestLogs;
            } else {
                processedSession.apiRequestLogs = (sessionWithUpToDateTTS.apiRequestLogs || []).map(log => ({
                    ...log,
                    timestamp: new Date(log.timestamp) 
                })) as ApiRequestLog[];
            }

            processedSession.messages = sessionWithUpToDateTTS.messages.map(message => {
                let processedMessage: Partial<ChatMessage> = { ...message };
                
                if (exportConfig.includeCachedMessageAudio && message.cachedAudioBuffers && message.cachedAudioBuffers.length > 0) {
                    const audioBase64Array: (string | null)[] = message.cachedAudioBuffers.map(buffer => {
                        if (buffer) {
                            try {
                                let binary = '';
                                const bytes = new Uint8Array(buffer);
                                const len = bytes.byteLength;
                                for (let i = 0; i < len; i++) {
                                    binary += String.fromCharCode(bytes[i]);
                                }
                                return window.btoa(binary);
                            } catch (e) {
                                console.error("Error converting ArrayBuffer to Base64 for export:", e);
                                return null;
                            }
                        }
                        return null;
                    });
                    const validAudioStrings = audioBase64Array.filter(b => b !== null) as string[];
                    if (validAudioStrings.length > 0) {
                         processedMessage.exportedMessageAudioBase64 = validAudioStrings;
                    }
                }
                delete processedMessage.cachedAudioBuffers;

                if (!exportConfig.includeMessageContent) delete processedMessage.content;
                if (!exportConfig.includeMessageTimestamps) delete processedMessage.timestamp;
                if (!exportConfig.includeMessageRoleAndCharacterNames) {
                    delete processedMessage.role;
                    delete processedMessage.characterName;
                }
                if (!exportConfig.includeGroundingMetadata) delete processedMessage.groundingMetadata;

                if (message.attachments) {
                    if (!exportConfig.includeMessageAttachmentsMetadata) {
                        delete processedMessage.attachments;
                    } else {
                        processedMessage.attachments = message.attachments.map(att => {
                            const attachmentToExport: Partial<Attachment> = {
                                id: att.id,
                                type: att.type,
                                mimeType: att.mimeType,
                                name: att.name,
                                size: att.size,
                            };
                            // Always include cloud file metadata if it exists,
                            // as per includeMessageAttachmentsMetadata being true here.
                            if (att.fileUri && att.fileApiName) { 
                                attachmentToExport.fileUri = att.fileUri;
                                attachmentToExport.fileApiName = att.fileApiName;
                            }
                            
                            // If includeFullAttachmentFileData is true, also include base64 and dataUrl if they exist
                            if (exportConfig.includeFullAttachmentFileData) {
                                if (att.base64Data) {
                                    attachmentToExport.base64Data = att.base64Data; 
                                }
                                if (att.dataUrl) {
                                    attachmentToExport.dataUrl = att.dataUrl; 
                                }
                            }
                            return attachmentToExport as Attachment;
                        });
                    }
                }
                return processedMessage as ChatMessage;
            });

            if (!exportConfig.includeChatSpecificSettings) {
                delete processedSession.settings;
                delete processedSession.model;
            } else {
                 processedSession.settings = {
                    ...(processedSession.settings || DEFAULT_SETTINGS), 
                    ttsSettings: processedSession.settings?.ttsSettings || { ...DEFAULT_TTS_SETTINGS }
                 };
            }
            
            if (!exportConfig.includeAiCharacterDefinitions) {
                delete processedSession.aiCharacters;
            }
            
            return processedSession;
        });
    }


    const appStateForExport: {key: string, value: any}[] = [];
    if(exportConfig.includeLastActiveChatId) {
        const activeId = await dbService.getAppMetadata<string | null>(METADATA_KEYS.ACTIVE_CHAT_ID);
        appStateForExport.push({ key: "activeId", value: activeId || null });
    }
    
    let genTimesForExport: Record<string, number> | undefined;
    if(exportConfig.includeMessageGenerationTimes) {
        genTimesForExport = await dbService.getAppMetadata<Record<string, number>>(METADATA_KEYS.MESSAGE_GENERATION_TIMES) || {};
    }

    let dispConfigForExport: Record<string, number> | undefined;
    if(exportConfig.includeUiConfiguration) {
        dispConfigForExport = await dbService.getAppMetadata<Record<string, number>>(METADATA_KEYS.MESSAGES_TO_DISPLAY_CONFIG) || {};
    }
    
    let globalDefaultsForExport: any | undefined;
    if(exportConfig.includeUserDefinedGlobalDefaults) {
        globalDefaultsForExport = await dbService.getAppMetadata<any>(METADATA_KEYS.USER_DEFINED_GLOBAL_DEFAULTS);
    }

    let apiKeysForExport: any | undefined;
    if (exportConfig.includeApiKeys) {
        apiKeysForExport = await dbService.getAppMetadata<any>(METADATA_KEYS.API_KEYS);
    }


    const exportData: any = {
        version: 20, // Incremented version for using in-memory state for export
        exportedAt: new Date().toISOString(),
        data: {
        }
    };
    
    if (exportConfig.includeChatSessionsAndMessages && sessionsForExport.length > 0) {
        exportData.data.chats = sessionsForExport;
    }
    if (appStateForExport.length > 0) { 
        exportData.data.appState = appStateForExport;
    }
    if (genTimesForExport) {
        exportData.data.messageGenerationTimes = genTimesForExport;
    }
    if (dispConfigForExport) {
        exportData.data.messagesToDisplayConfig = dispConfigForExport;
    }
    if (globalDefaultsForExport) {
        exportData.data.userDefinedGlobalDefaults = globalDefaultsForExport;
    }
    if (apiKeysForExport) {
        exportData.data.apiKeys = apiKeysForExport;
    }
    exportData.data.exportConfigurationUsed = exportConfig;


    const jsonString = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(exportData, null, 2))}`;
    const link = document.createElement("a");
    link.href = jsonString;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const timestamp = `${year}-${month}-${day}_${hours}-${minutes}`;
    const fileNameSuffix = chatIdsToExport.length === 1 ? `_chat-${chatIdsToExport[0].substring(0,8)}` : `_selected-chats`;
    link.download = `gemini-chat-export-${timestamp}${fileNameSuffix}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [chatHistoryForExport, showToast]);

  const handleImportAll = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json'; 

    const cleanupInputElement = () => {
        if (input.parentNode === document.body) {
            document.body.removeChild(input);
        }
        window.removeEventListener('focus', handleFocusForCleanup);
    };

    const handleFocusForCleanup = () => {
        setTimeout(() => {
            if (input.isConnected) { 
                cleanupInputElement();
            }
        }, 300); 
    };
    
    input.onchange = async (e) => {
        window.removeEventListener('focus', handleFocusForCleanup); 
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            try {
                const text = await file.text();
                let importedRawData;
                try {
                    importedRawData = JSON.parse(text);
                } catch (jsonError: any) {
                    console.error("File is not valid JSON:", file.name, jsonError);
                    showToast(`Failed to import: The file "${file.name}" is not a valid JSON file.`, "error");
                    cleanupInputElement();
                    return;
                }

                const { 
                    sessions: importedSessions, 
                    generationTimes: importedGenTimes, 
                    displayConfig: importedDisplayConfig, 
                    activeChatId: importedActiveId,
                    exportConfiguration: importedExportConfig,
                    apiKeys: importedApiKeys,
                } = transformImportedData(importedRawData);

                if (importedSessions.length === 0 && !Object.keys(importedGenTimes).length && !importedActiveId && !Object.keys(importedDisplayConfig).length) {
                     const isEmptyShell = importedRawData && Object.keys(importedRawData).length === 0;
                     const isMinimalValidStructureButEmpty = importedRawData?.data && Object.keys(importedRawData.data).length === 0 && !importedRawData.version;
                     if (isEmptyShell || isMinimalValidStructureButEmpty) {
                         showToast("Could not import any data. The file appears to be empty or in an unrecognized format.", "error");
                         cleanupInputElement();
                         return;
                    }
                }

                for (const session of importedSessions) {
                    await dbService.addOrUpdateChatSession(session);
                }

                const currentGenTimes = await dbService.getAppMetadata<Record<string,number>>(METADATA_KEYS.MESSAGE_GENERATION_TIMES) || {};
                await setMessageGenerationTimes({...currentGenTimes, ...importedGenTimes});
                
                if (importedRawData?.data?.userDefinedGlobalDefaults) {
                    await dbService.setAppMetadata(METADATA_KEYS.USER_DEFINED_GLOBAL_DEFAULTS, importedRawData.data.userDefinedGlobalDefaults);
                }
                if (importedExportConfig) { 
                     await dbService.setAppMetadata(METADATA_KEYS.EXPORT_CONFIGURATION, importedExportConfig);
                }
                if (importedApiKeys) {
                    await dbService.setAppMetadata(METADATA_KEYS.API_KEYS, importedApiKeys);
                }


                const allSessionsAfterImport = await dbService.getAllChatSessions();
                const newDisplayConfigFromImport: Record<string, number> = {};
                allSessionsAfterImport.forEach(session => {
                    if (importedDisplayConfig[session.id] !== undefined) {
                        newDisplayConfigFromImport[session.id] = Math.min(session.messages.length, importedDisplayConfig[session.id]);
                    } else {
                        const maxInitial = session.settings?.maxInitialMessagesDisplayed || DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT;
                        newDisplayConfigFromImport[session.id] = Math.min(session.messages.length, maxInitial);
                    }
                });
                await setMessagesToDisplayConfig(newDisplayConfigFromImport);

                setChatHistory(allSessionsAfterImport.map(s => ({...s, apiRequestLogs: s.apiRequestLogs || [] })));

                if (importedActiveId && allSessionsAfterImport.find(s => s.id === importedActiveId)) {
                    await setCurrentChatId(importedActiveId);
                } else if (allSessionsAfterImport.length > 0) {
                     const sortedForActive = [...allSessionsAfterImport].sort((a,b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
                    await setCurrentChatId(sortedForActive[0].id);
                } else {
                    await setCurrentChatId(null);
                }
                
                let toastMessage = `Import successful! ${importedSessions.length} session(s) processed.`;
                let willReload = false;
                if (importedApiKeys && importedApiKeys.length > 0) {
                    toastMessage = `Import successful! ${importedSessions.length} session(s) & ${importedApiKeys.length} API key(s) processed. App will refresh.`;
                    willReload = true;
                }
                showToast(toastMessage, "success", willReload ? 2500 : 2000);
                if (willReload) {
                    setTimeout(() => window.location.reload(), 2500);
                }

            } catch (err: any) {
                console.error("Error importing chats:", err);
                showToast(`Failed to import chats. Error: ${err.message || "Invalid file format or processing error."}`, "error");
            }
        }
        cleanupInputElement(); 
    };

    document.body.appendChild(input);
    input.click(); 
    window.addEventListener('focus', handleFocusForCleanup, { once: false }); 
  }, [setChatHistory, setCurrentChatId, setMessageGenerationTimes, setMessagesToDisplayConfig, showToast]);

  return {
    handleExportChats,
    handleImportAll,
  };
}