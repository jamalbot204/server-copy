import { useState, useCallback, useRef } from 'react';
import { Attachment, LogApiRequestCallback } from '../types.ts';
import { uploadFileViaApi, deleteFileViaApi, formatGeminiError } from '../services/geminiService.ts';
import { SUPPORTED_IMAGE_MIME_TYPES, SUPPORTED_VIDEO_MIME_TYPES } from '../constants.ts';
import { getDisplayFileType } from '../services/utils.ts';

interface UseAttachmentHandlerProps {
  apiKey: string;
  logApiRequestCallback: LogApiRequestCallback;
  isInfoInputModeActive: boolean;
  showToastCallback: (message: string, type: 'success' | 'error') => void;
}

export function useAttachmentHandler({
  apiKey,
  logApiRequestCallback,
  isInfoInputModeActive,
  showToastCallback,
}: UseAttachmentHandlerProps) {
  const [selectedFiles, setSelectedFiles] = useState<Attachment[]>([]);
  const activeUploadControllersRef = useRef<Map<string, AbortController>>(new Map());

  const updateAttachmentState = useCallback((id: string, updates: Partial<Attachment>) => {
    setSelectedFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  }, []);

  const processCloudUpload = useCallback(async (file: File, attachmentId: string) => {
    updateAttachmentState(attachmentId, {
      uploadState: 'uploading_to_cloud',
      statusMessage: 'Initiating cloud upload...',
      isLoading: true,
      progress: undefined,
      error: undefined,
    });

    const controller = new AbortController();
    activeUploadControllersRef.current.set(attachmentId, controller);

    try {
      const uploadResult = await uploadFileViaApi(
        apiKey,
        file,
        logApiRequestCallback,
        (state, fileApiNameFromCb, messageFromCb, progressFromCb) => {
          // Check if the signal has been aborted before updating state for this attachment
          if (controller.signal.aborted) {
            console.log(`Upload for ${attachmentId} was aborted, skipping state update for ${state}`);
            return; 
          }
          updateAttachmentState(attachmentId, {
            uploadState: state,
            statusMessage: messageFromCb || state.replace(/_/g, ' '),
            fileApiName: fileApiNameFromCb,
            progress: progressFromCb,
            isLoading: state === 'uploading_to_cloud' || state === 'processing_on_server',
          });
        },
        controller.signal // Pass the signal
      );

      if (controller.signal.aborted) {
          // If aborted during/after uploadFileViaApi but before this block,
          // and if fileApiName was obtained, removal logic (deleteFileViaApi)
          // would have been (or will be) triggered by removeSelectedFile.
          // No further state update needed here for the UI element that's being removed.
          return;
      }
      
      if (uploadResult.error) {
        showToastCallback(uploadResult.error, 'error');
        updateAttachmentState(attachmentId, {
          error: uploadResult.error,
          uploadState: 'error_cloud_upload',
          statusMessage: `Cloud Error: ${uploadResult.error}`,
          isLoading: false,
        });
      } else if (uploadResult.fileUri) {
        updateAttachmentState(attachmentId, {
          fileUri: uploadResult.fileUri,
          fileApiName: uploadResult.fileApiName,
          uploadState: 'completed_cloud_upload',
          statusMessage: 'Cloud upload complete. Ready.',
          isLoading: false,
          error: undefined,
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
          // Already handled by abort signal, UI element will be removed.
          // Or if not removed yet, state will reflect cancellation.
           updateAttachmentState(attachmentId, {
              error: "Upload cancelled.",
              uploadState: 'error_cloud_upload', // Or a new 'cancelled' state if desired
              statusMessage: "Upload cancelled by user.",
              isLoading: false,
          });
      } else if (!controller.signal.aborted) { // Only update if not aborted by a concurrent removeSelectedFile
        const formattedError = formatGeminiError(err);
        showToastCallback(formattedError, 'error');
        updateAttachmentState(attachmentId, {
          error: formattedError,
          uploadState: 'error_cloud_upload',
          statusMessage: `Cloud Error: ${formattedError}`,
          isLoading: false,
        });
      }
    } finally {
        if (activeUploadControllersRef.current.get(attachmentId) === controller) {
            activeUploadControllersRef.current.delete(attachmentId);
        }
    }
  }, [apiKey, logApiRequestCallback, updateAttachmentState, showToastCallback]);

  const handleFileSelection = useCallback((files: FileList | null) => {
    if (!files || isInfoInputModeActive) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      let fileTypeForApp: 'image' | 'video' = 'image'; 
      if (SUPPORTED_IMAGE_MIME_TYPES.includes(file.type)) {
          fileTypeForApp = 'image';
      } else if (SUPPORTED_VIDEO_MIME_TYPES.includes(file.type)) {
          fileTypeForApp = 'video';
      } 
      
      const attachmentId = `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const newAttachmentInitial: Attachment = {
          id: attachmentId,
          name: file.name,
          mimeType: file.type, 
          size: file.size,
          type: fileTypeForApp, 
          uploadState: 'reading_client',
          statusMessage: 'Reading file...',
          isLoading: true, 
      };
      
      setSelectedFiles(prev => [...prev, newAttachmentInitial]); 

      const reader = new FileReader();
      reader.onload = (e_reader) => {
          const fileContentResult = e_reader.target?.result as string;
          let rawBase64Data = '';
          let dataUrlForPreview: string | undefined = undefined;

          if (fileContentResult && fileContentResult.startsWith('data:')) {
              dataUrlForPreview = fileContentResult;
              const commaIndex = fileContentResult.indexOf(',');
              if (commaIndex !== -1) {
                  rawBase64Data = fileContentResult.substring(commaIndex + 1);
              } else {
                  console.error("Malformed data URL, no comma found for base64 extraction.");
                  rawBase64Data = ''; 
              }
          } else {
              console.error("FileReader did not return a Data URL as expected.");
                updateAttachmentState(attachmentId, {
                  error: "Failed to read file content correctly.",
                  uploadState: 'error_client_read',
                  statusMessage: 'Error reading file content.',
                  isLoading: false,
              });
              return;
          }
          
          updateAttachmentState(attachmentId, {
              base64Data: rawBase64Data,
              dataUrl: (fileTypeForApp === 'image' || fileTypeForApp === 'video') ? dataUrlForPreview : undefined,
              uploadState: 'completed', // Client-side read complete, cloud upload will manage its own states
              statusMessage: 'Preview ready. Initiating cloud sync...',
              isLoading: true, // Set to true as cloud upload is next
          });
          processCloudUpload(file, attachmentId);
      };
      reader.onerror = (e_reader) => {
          console.error("FileReader error:", e_reader);
          updateAttachmentState(attachmentId, {
              error: "Failed to read file for preview or base64.",
              uploadState: 'error_client_read',
              statusMessage: 'Error reading file.',
              isLoading: false, 
          });
      };
      reader.readAsDataURL(file); 
    }
  }, [processCloudUpload, isInfoInputModeActive, updateAttachmentState]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isInfoInputModeActive) return;
    if (event.clipboardData.files && event.clipboardData.files.length > 0) {
      event.preventDefault();
      handleFileSelection(event.clipboardData.files);
    }
  }, [handleFileSelection, isInfoInputModeActive]);

  const removeSelectedFile = useCallback((id: string) => {
    const attachmentToRemove = selectedFiles.find(f => f.id === id);

    if (attachmentToRemove) {
      const controller = activeUploadControllersRef.current.get(id);
      if (controller) {
        controller.abort();
        activeUploadControllersRef.current.delete(id);
      }

      if (attachmentToRemove.fileApiName && 
          (attachmentToRemove.uploadState === 'uploading_to_cloud' || 
           attachmentToRemove.uploadState === 'processing_on_server' || 
           attachmentToRemove.uploadState === 'completed_cloud_upload' ||
           attachmentToRemove.error // even if errored, if it has a fileApiName, try to delete
          )
      ) {
        deleteFileViaApi(apiKey, attachmentToRemove.fileApiName, logApiRequestCallback)
          .then(() => {
            console.log(`Successfully deleted orphaned file ${attachmentToRemove.fileApiName} from cloud.`);
          })
          .catch(err => {
            // Log benignly, as this is a cleanup effort.
            console.warn(`Failed to delete file ${attachmentToRemove.fileApiName} from cloud during removal:`, err);
            showToastCallback(`Could not delete file from cloud: ${err.message}`, 'error');
          });
      }
    }
    setSelectedFiles(prev => prev.filter(file => file.id !== id));
  }, [selectedFiles, apiKey, logApiRequestCallback, showToastCallback]);

  const getValidAttachmentsToSend = useCallback((): Attachment[] => {
    return selectedFiles.filter(f => 
      f.uploadState === 'completed_cloud_upload' && f.fileUri && !f.error
    );
  }, [selectedFiles]);
  
  const isAnyFileStillProcessing = useCallback((): boolean => {
    return selectedFiles.some(f => 
        (f.uploadState === 'uploading_to_cloud' || f.uploadState === 'processing_on_server' || f.uploadState === 'reading_client') && !f.error
    );
  }, [selectedFiles]);

  const resetSelectedFiles = useCallback(() => {
    // Abort any ongoing uploads before clearing
    selectedFiles.forEach(file => {
        const controller = activeUploadControllersRef.current.get(file.id);
        if (controller) {
            controller.abort();
            activeUploadControllersRef.current.delete(file.id);
        }
        // Note: This doesn't trigger cloud deletion here, assuming reset is a full clear
        // and not necessarily requiring individual cleanup like a targeted removal.
        // If cloud cleanup is desired on full reset, it would need to be added.
    });
    setSelectedFiles([]);
  }, [selectedFiles]);

  const getFileProgressDisplay = useCallback((file: Attachment): string => {
    const totalSizeMB = (file.size / 1024 / 1024).toFixed(1);
    switch(file.uploadState) {
        case 'reading_client':
            return `Reading for preview...`; 
        case 'uploading_to_cloud':
            const uploadProgress = file.progress || 0;
            const uploadedMB = (file.size * uploadProgress / 100 / 1024 / 1024).toFixed(1);
            return `${uploadedMB}MB / ${totalSizeMB}MB`; 
        case 'processing_on_server':
            return `Processing on server...`;
        case 'completed_cloud_upload':
            return `Cloud ready (${totalSizeMB}MB)`;
        case 'completed': 
            return file.fileUri ? `Cloud ready (${totalSizeMB}MB)` : `Preview ready`;
        case 'error_client_read':
            return `Preview Error: ${file.error || 'Failed'}`;
        case 'error_cloud_upload':
            return `Upload Error: ${file.error || 'Failed'}`;
        default:
            return file.statusMessage || `Waiting... (${totalSizeMB}MB)`;
    }
  }, []);


  return {
    selectedFiles,
    handleFileSelection,
    handlePaste,
    removeSelectedFile,
    getValidAttachmentsToSend,
    isAnyFileStillProcessing,
    resetSelectedFiles,
    getFileProgressDisplay,
    getDisplayFileType, // Now refers to the imported utility
  };
}