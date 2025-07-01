// services/utils.ts
import { MODEL_DEFINITIONS } from '../constants.ts';
import { ChatMessage, ChatMessageRole, Attachment } from '../types.ts';

/**
 * Splits text into segments for Text-to-Speech processing.
 * Each segment will have at most `maxWordsPerSegment`.
 * If `maxWordsPerSegment` is undefined, 0, or non-positive, the text is not split.
 *
 * @param fullText The complete text to be split.
 * @param maxWordsPerSegment The maximum number of words allowed in a single segment, or undefined/non-positive for no splitting.
 * @returns An array of text segments.
 */
export const splitTextForTts = (fullText: string, maxWordsPerSegment?: number): string[] => {
  const words = fullText.trim().split(/\s+/).filter(Boolean);
  const totalWords = words.length;

  if (totalWords === 0) {
    return [];
  }

  // If maxWordsPerSegment is undefined, 0, non-positive, or if totalWords is less than/equal to it, don't split.
  if (maxWordsPerSegment === undefined || maxWordsPerSegment <= 0 || totalWords <= maxWordsPerSegment) {
    return [fullText];
  }

  // Calculate the number of segments needed.
  const numSegments = Math.ceil(totalWords / maxWordsPerSegment);

  // Calculate the target number of words for each segment to make them as equal as possible.
  const targetWordsPerSegment = Math.ceil(totalWords / numSegments);

  const segments: string[] = [];
  let currentWordIndex = 0;

  for (let i = 0; i < numSegments; i++) {
    const startIndex = currentWordIndex;
    const endIndex = Math.min(startIndex + targetWordsPerSegment, totalWords);
    
    const segmentWords = words.slice(startIndex, endIndex);
    if (segmentWords.length > 0) {
      segments.push(segmentWords.join(' '));
    }
    currentWordIndex = endIndex;
  }
  
  return segments.filter(s => s.trim() !== "");
};


export function sanitizeFilename(
    name: string,
    maxLength: number = 50,
    replacement: string = '_'
  ): string {
    if (!name) return '';
  
    // Convert to lowercase
    let SaneName = name.toLowerCase();
  
    // Replace sequences of whitespace and hyphens with a single replacement character
    SaneName = SaneName.replace(/[\s-]+/g, replacement);
  
    // Remove any characters that are not alphanumeric, underscore, or hyphen (if replacement is not hyphen)
    const allowedCharsRegex = replacement === '-' ? /[^a-z0-9_-]/g : /[^a-z0-9_]/g;
    SaneName = SaneName.replace(allowedCharsRegex, '');
  
    // Remove leading/trailing replacement characters
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trimRegex = new RegExp(`^${escapeRegex(replacement)}+|${escapeRegex(replacement)}+$`, 'g');
    SaneName = SaneName.replace(trimRegex, '');
  
    // Truncate to maxLength
    if (SaneName.length > maxLength) {
      SaneName = SaneName.substring(0, maxLength);
      // Ensure it doesn't end with a partial word or the replacement char after truncation
      SaneName = SaneName.replace(new RegExp(`${escapeRegex(replacement)}+$`), '');
    }
    
    // Ensure it's not empty after all operations
    if (!SaneName && name) {
        return 'untitled'; // Or some default
    }
  
    return SaneName;
}

export function triggerDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export const getModelDisplayName = (modelId: string | undefined): string => {
    if (!modelId) return "Unknown Model";
    const model = MODEL_DEFINITIONS.find(m => m.id === modelId);
    return model ? model.name : modelId.split('/').pop() || modelId;
};


// Helper for useGemini.ts
export const findPrecedingUserMessageIndex = (messages: ChatMessage[], targetMessageIndex: number): number => {
  for (let i = targetMessageIndex - 1; i >= 0; i--) {
    if (messages[i].role === ChatMessageRole.USER) {
      return i;
    }
  }
  return -1;
};

export const getHistoryUpToMessage = (messages: ChatMessage[], messageIndex: number): ChatMessage[] => {
  if (messageIndex < 0 || messageIndex >= messages.length) {
    return messages; // Return all messages if index is out of bounds, or handle as an error
  }
  return messages.slice(0, messageIndex);
};

export const getDisplayFileType = (file: Attachment): string => {
  if (file.type === 'image') return "Image";
  if (file.type === 'video') return "Video";
  if (file.mimeType === 'application/pdf') return "PDF";
  if (file.mimeType.startsWith('text/')) return "Text";
  return "File";
};