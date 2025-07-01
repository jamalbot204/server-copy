

// Fix: Removed incorrect import of 'ChatSession as GeminiChatSessionSDK'
import React from 'react';
import { Content, Part as GeminiPart, SafetySetting as GeminiSafetySettingSDK, Tool } from "@google/genai";
import { EditMessagePanelAction, EditMessagePanelDetails } from './components/EditMessagePanel.tsx';


export enum ChatMessageRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system', // For system instructions, not directly a message role in Gemini chat history
  ERROR = 'error' // For displaying error messages in chat
}

export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}

export type AttachmentUploadState =
  | 'idle'                    // Initial state
  | 'reading_client'          // Client-side FileReader is active
  | 'uploading_to_cloud'      // SDK's ai.files.uploadFile is in progress
  | 'processing_on_server'    // File API status is PROCESSING, polling getFile
  | 'completed_cloud_upload'  // File API status is ACTIVE, fileUri is available
  | 'completed'               // Client-side read complete (e.g. base64 ready, no cloud upload attempted/failed)
  | 'error_client_read'       // FileReader failed
  | 'error_cloud_upload';     // Cloud upload or processing failed

export interface Attachment {
  id: string; 
  type: 'image' | 'video'; // Simplified, can be expanded for generic files
  mimeType: string; // Original MIME type of the file
  name: string;
  base64Data?: string; // Pure base64 encoded content, for re-upload or fallback
  dataUrl?: string;    // Full Data URL for client-side preview (images/videos)
  size: number;       // File size in bytes
  
  fileUri?: string;           // URI from Gemini File API
  fileApiName?: string;       // Resource name from Gemini File API (e.g., files/your-id)
  uploadState?: AttachmentUploadState; 
  statusMessage?: string;     
  progress?: number;          // Client read: 0-100. Cloud upload: 0-100 (if available) or undefined for spinner.

  error?: string;     
  isLoading?: boolean;

  // For re-upload feature
  isReUploading?: boolean;
  reUploadError?: string;
}


export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: Attachment[]; 
  groundingMetadata?: { 
    groundingChunks?: GroundingChunk[];
  };
  characterName?: string; 
  cachedAudioBuffers?: (ArrayBuffer | null)[] | null; // Updated for multi-part TTS
  // Field for exported audio, not used at runtime directly in ChatMessage objects
  // but helps type-checking during import/export transformation
  exportedMessageAudioBase64?: (string | null)[]; 
}

// As defined by the Google AI SDK for Harm Categories
export enum HarmCategory {
  HARM_CATEGORY_UNSPECIFIED = "HARM_CATEGORY_UNSPECIFIED",
  HARM_CATEGORY_HARASSMENT = "HARM_CATEGORY_HARASSMENT",
  HARM_CATEGORY_HATE_SPEECH = "HARM_CATEGORY_HATE_SPEECH",
  HARM_CATEGORY_SEXUALLY_EXPLICIT = "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  HARM_CATEGORY_DANGEROUS_CONTENT = "HARM_CATEGORY_DANGEROUS_CONTENT",
}

// As defined by the Google AI SDK for Harm Block Thresholds
export enum HarmBlockThreshold {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED = "HARM_BLOCK_THRESHOLD_UNSPECIFIED",
  BLOCK_LOW_AND_ABOVE = "BLOCK_LOW_AND_ABOVE", 
  BLOCK_MEDIUM_AND_ABOVE = "BLOCK_MEDIUM_AND_ABOVE", 
  BLOCK_ONLY_HIGH = "BLOCK_ONLY_HIGH", 
  BLOCK_NONE = "BLOCK_NONE", 
}

export interface SafetySetting {
  category: HarmCategory;
  threshold: HarmBlockThreshold;
}

export type TTSModelId = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts'; // Example model IDs
export type TTSVoiceId = string; // Represents one of the 30 voice names like 'Kore', 'Puck'

export interface TTSSettings {
  model: TTSModelId;
  voice: TTSVoiceId;
  autoPlayNewMessages?: boolean; // Renamed from autoFetchAudioEnabled
  systemInstruction?: string; 
  maxWordsPerSegment?: number; // New: Max words per TTS segment
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
}

export interface GeminiSettings {
  systemInstruction?: string;
  userPersonaInstruction?: string; 
  temperature?: number;
  topP?: number;
  topK?: number;
  safetySettings?: SafetySetting[];
  contextWindowMessages?: number; 
  aiSeesTimestamps?: boolean; 
  useGoogleSearch?: boolean; 
  urlContext?: string[]; 
  maxInitialMessagesDisplayed?: number; 
  debugApiRequests?: boolean; 
  ttsSettings: TTSSettings; 
  showAutoSendControls?: boolean; 
  showReadModeButton?: boolean; 
  thinkingBudget?: number; // Added thinkingBudget
  _characterIdForCacheKey?: string; 
  _characterIdForAPICall?: string;  
  _characterNameForLog?: string; 
}

export interface AICharacter {
  id: string;
  name: string;
  systemInstruction: string; 
  contextualInfo?: string; 
}

export enum AppMode {
  NORMAL_CHAT = 'normal_chat',
  CHARACTER_CHAT = 'character_chat',
}

// For Gemini API history, used in constructing requests
export interface GeminiHistoryEntry {
  role: "user" | "model";
  parts: GeminiPart[]; 
}


// Specific type for the 'config' object used in API request logging and error formatting
export interface LoggedGeminiGenerationConfig {
  systemInstruction?: string | Content; 
  temperature?: number;
  topP?: number;
  topK?: number;
  safetySettings?: GeminiSafetySettingSDK[]; 
  tools?: Tool[]; 
  thinkingConfig?: { thinkingBudget?: number }; 
  responseMimeType?: string;
  seed?: number;
}

// Type for the payload sent to the Gemini SDK, adapted for logging and error context
export interface ApiRequestPayload {
  model?: string; 
  history?: GeminiHistoryEntry[]; // Used by chat.create
  contents?: Content[] | GeminiPart[] | string; // Used by models.generateContent or chat.sendMessage
  config?: Partial<LoggedGeminiGenerationConfig>; // Config for either chat.create or models.generateContent
  file?: { name: string, type: string, size: number, data?: string }; // For files.uploadFile (input)
  fileName?: string; // For files.getFile, files.delete (input)
  fileApiResponse?: any; // For logging responses from file operations
  apiKeyUsed?: string; // For logging which key was used
}


export interface ApiRequestLog {
  id: string;
  timestamp: Date;
  requestType: 'chat.create' | 'chat.sendMessage' | 'models.generateContent' | 'files.uploadFile' | 'files.getFile' | 'files.delete' | 'tts.generateSpeech'; 
  payload: ApiRequestPayload; 
  characterName?: string;
  apiSessionId?: string; 
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  model: string; 
  settings: GeminiSettings; 
  lastUpdatedAt: Date;
  isCharacterModeActive?: boolean; 
  aiCharacters?: AICharacter[];    
  apiRequestLogs?: ApiRequestLog[]; 
}

export interface UserDefinedDefaults {
    model: string;
    settings: GeminiSettings; 
}

export interface FileUploadResult {
    fileUri?: string; 
    fileApiName?: string; 
    mimeType: string;
    originalFileName: string;
    size: number;
    error?: string; 
}


export interface FullResponseData {
    text: string;
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
}

export interface UserMessageInput {
    text: string;
    attachments?: Attachment[]; 
}


export type LogApiRequestCallback = (logDetails: Omit<ApiRequestLog, 'id' | 'timestamp'>) => void;

export interface AudioPlayerState {
  isLoading: boolean; 
  isPlaying: boolean;
  currentMessageId: string | null; 
  error: string | null; 
  currentTime?: number; 
  duration?: number;    
  currentPlayingText?: string | null; 
  playbackRate: number; 
}

export interface UseGeminiReturn {
  isLoading: boolean;
  currentGenerationTimeDisplay: string;
  lastMessageHadAttachments: boolean;
  logApiRequest: LogApiRequestCallback;
  handleSendMessage: (
    promptContent: string,
    attachments?: Attachment[],
    historyContextOverride?: ChatMessage[],
    characterIdForAPICall?: string,
    isTemporaryContext?: boolean
  ) => Promise<void>;
  handleContinueFlow: () => Promise<void>;
  handleCancelGeneration: () => Promise<void>;
  handleRegenerateAIMessage: (sessionId: string, aiMessageIdToRegenerate: string) => Promise<void>;
  handleRegenerateResponseForUserMessage: (sessionId: string, userMessageId: string) => Promise<void>;
  handleEditPanelSubmit: (action: EditMessagePanelAction, newContent: string, editingMessageDetail: EditMessagePanelDetails) => Promise<void>;
}

export interface GeminiFileResource {
    name: string; 
    displayName?: string;
    mimeType: string;
    sizeBytes?: string; 
    createTime?: string; 
    updateTime?: string; 
    expirationTime?: string; 
    sha256Hash?: string;
    uri: string; 
    state: 'PROCESSING' | 'ACTIVE' | 'FAILED' | 'STATE_UNSPECIFIED';
    error?: { code: number; message: string; details: any[] }; 
}

export type UseAudioPlayerCacheCallback = (uniqueSegmentId: string, audioBuffer: ArrayBuffer) => Promise<void>;

export interface MessageItemProps {
  message: ChatMessage;
  chatSessionId: string;
  messageGenerationTimes: Record<string, number>; 
  onCopyMessage: (content: string) => Promise<boolean>; 
  onAttemptDeleteMessageAndHistory: (sessionId: string, messageId: string) => void; 
  onDeleteSingleMessage: (sessionId: string, messageId: string) => void; 
  onEditUserMessage: (sessionId: string, messageId: string, currentContent: string, role: ChatMessageRole, attachments?: Attachment[]) => void;
  onEditModelMessage: (sessionId: string, messageId: string, currentContent: string, role: ChatMessageRole, attachments?: Attachment[]) => void;
  onRegenerateAIMessage: (sessionId: string, aiMessageId: string) => void;
  onRegenerateResponseForUserMessage?: (sessionId: string, userMessageId: string) => void;
  canRegenerateFollowingAI?: boolean;
  chatScrollContainerRef?: React.RefObject<HTMLDivElement>;
  onPlayText: (fullText: string, baseMessageId: string, partIndex?: number) => void; 
  onStopPlayback: () => void; 
  audioPlayerState: AudioPlayerState;
  isApiFetchingThisSegment: (uniqueSegmentId: string) => boolean; 
  onCancelApiFetchThisSegment: (uniqueSegmentId: string) => void; 
  getSegmentFetchError: (uniqueSegmentId: string) => string | undefined; 
  isMainButtonMultiFetchingApi: (baseMessageId: string) => boolean;
  onCancelMainButtonMultiFetchApi: (baseMessageId: string) => void;
  onRequestResetAudioCacheConfirmation: (sessionId: string, messageId: string) => void;
  onDownloadAudio?: (sessionId: string, messageId: string) => void;
  highlightTerm?: string; 
  onReUploadAttachment?: (sessionId: string, messageId: string, attachmentId: string) => Promise<void>; 
  maxWordsPerSegmentForTts?: number;
  showReadModeButton?: boolean;
  onEnterReadMode: (content: string) => void;
  onInsertEmptyMessageAfter?: (sessionId: string, afterMessageId: string, roleToInsert: ChatMessageRole.USER | ChatMessageRole.MODEL) => Promise<void>;
}


export interface UseAudioPlayerOptions {
  apiKey: string;
  logApiRequest?: LogApiRequestCallback;
  onCacheAudio?: UseAudioPlayerCacheCallback;
  onAutoplayNextSegment?: (baseMessageId: string, justFinishedPartIndex: number) => void;
  onFetchStart?: (uniqueSegmentId: string) => void;
  onFetchEnd?: (uniqueSegmentId: string, error?: Error) => void;
}
export interface UseAudioPlayerReturn {
  audioPlayerState: AudioPlayerState;
  playText: (
    textSegment: string,
    uniqueSegmentId: string,
    ttsSettings: TTSSettings,
    cachedBufferForSegment?: ArrayBuffer | null
  ) => Promise<void>;
  stopPlayback: () => void; 
  clearPlayerViewAndStopAudio: () => void; 
  seekRelative: (offsetSeconds: number) => Promise<void>;
  seekToAbsolute: (timeInSeconds: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  pausePlayback: () => void;
  resumePlayback: () => Promise<void>;
  cancelCurrentSegmentAudioLoad: (uniqueSegmentId: string) => void;
  isApiFetchingThisSegment: (uniqueSegmentId: string) => boolean;
  getSegmentFetchError: (uniqueSegmentId: string) => string | undefined; 
  increaseSpeed: () => void; 
  decreaseSpeed: () => void; 
}

// Updated options for useAutoFetchAudio (now simpler, for auto-play)
export interface UseAutoPlayOptions { // Renamed from UseAutoFetchAudioOptions
    currentChatSession: ChatSession | null;
    playFunction: (originalFullText: string, baseMessageId: string, partIndexToPlay?: number) => Promise<void>;
}

export interface ExportConfiguration {
  // Core Chat Data
  includeChatSessionsAndMessages: boolean;
  includeMessageContent: boolean;
  includeMessageTimestamps: boolean;
  includeMessageRoleAndCharacterNames: boolean;
  includeMessageAttachmentsMetadata: boolean; 
  includeFullAttachmentFileData: boolean;    
  includeCachedMessageAudio: boolean;       
  includeGroundingMetadata: boolean;

  // Chat-Specific Settings
  includeChatSpecificSettings: boolean; 

  // AI Character Definitions
  includeAiCharacterDefinitions: boolean; 

  // API Request Logs
  includeApiLogs: boolean;

  // Global Application State
  includeLastActiveChatId: boolean;
  includeMessageGenerationTimes: boolean;
  includeUiConfiguration: boolean; 
  includeUserDefinedGlobalDefaults: boolean;
  includeApiKeys: boolean;
}

// Props for ExportConfigurationModal
export interface ExportConfigurationModalProps {
  isOpen: boolean;
  currentConfig: ExportConfiguration;
  allChatSessions: ChatSession[]; 
  onClose: () => void;
  onSaveConfig: (newConfig: ExportConfiguration) => void; 
  onExportSelected: (config: ExportConfiguration, selectedChatIds: string[]) => void; 
}

// Type for items in the ChatAttachmentsModal
export interface AttachmentWithContext {
  attachment: Attachment;
  messageId: string;
  messageTimestamp: Date;
  messageRole: ChatMessageRole;
  messageContentSnippet?: string;
}

export interface UseAutoSendReturn {
  isAutoSendingActive: boolean;
  autoSendText: string;
  setAutoSendText: React.Dispatch<React.SetStateAction<string>>;
  autoSendRepetitionsInput: string;
  setAutoSendRepetitionsInput: React.Dispatch<React.SetStateAction<string>>;
  autoSendRemaining: number;
  startAutoSend: (text: string, repetitions: number, targetCharacterId?: string) => void;
  stopAutoSend: () => Promise<void>;
  canStartAutoSend: (text: string, repetitionsInput: string) => boolean;
  isPreparingAutoSend: boolean;
  isWaitingForErrorRetry: boolean; 
  errorRetryCountdown: number;
}