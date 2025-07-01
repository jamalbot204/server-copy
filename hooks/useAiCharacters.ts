
import { useCallback } from 'react';
import { ChatSession, AICharacter, GeminiSettings } from '../types.ts';
import { clearCachedChat as geminiServiceClearCachedChat } from '../services/geminiService.ts';

export function useAiCharacters(
  currentChatSession: ChatSession | null,
  updateChatSession: (sessionId: string, updater: (session: ChatSession) => ChatSession | null) => Promise<void>
) {

  const handleToggleCharacterMode = useCallback(async () => {
    if (!currentChatSession) return;

    if (currentChatSession.isCharacterModeActive && currentChatSession.aiCharacters && currentChatSession.aiCharacters.length > 0) {
        currentChatSession.aiCharacters.forEach(character => {
            const settingsForThisCharacterCache: GeminiSettings & { _characterIdForCacheKey?: string } = {
                ...currentChatSession.settings,
                systemInstruction: character.systemInstruction,
                _characterIdForCacheKey: character.id,
            };
            geminiServiceClearCachedChat(currentChatSession.id, currentChatSession.model, settingsForThisCharacterCache);
        });
    } else if (!currentChatSession.isCharacterModeActive) {
        const settingsForNonCharCache = { ...currentChatSession.settings };
        delete (settingsForNonCharCache as any)._characterIdForCacheKey;
        geminiServiceClearCachedChat(currentChatSession.id, currentChatSession.model, settingsForNonCharCache);
    }

    await updateChatSession(currentChatSession.id, session => session ? ({
        ...session,
        isCharacterModeActive: !session.isCharacterModeActive,
        aiCharacters: session.aiCharacters || [], 
    }) : null);
  }, [currentChatSession, updateChatSession]);

  const handleAddCharacter = useCallback(async (name: string, systemInstruction: string) => {
    if (!currentChatSession) return;
    const newCharacter: AICharacter = {
      id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name,
      systemInstruction,
      contextualInfo: '',
    };
    await updateChatSession(currentChatSession.id, session => session ? ({
      ...session,
      aiCharacters: [...(session.aiCharacters || []), newCharacter],
    }) : null);
  }, [currentChatSession, updateChatSession]);

  const handleEditCharacter = useCallback(async (id: string, name: string, systemInstruction: string) => {
    if (!currentChatSession) return;

    const characterBeingEdited = currentChatSession.aiCharacters?.find(c => c.id === id);
    if (characterBeingEdited) {
        const settingsForThisCharacterCache: GeminiSettings & { _characterIdForCacheKey?: string } = {
            ...currentChatSession.settings,
            systemInstruction: characterBeingEdited.systemInstruction,
            _characterIdForCacheKey: characterBeingEdited.id,
        };
        geminiServiceClearCachedChat(currentChatSession.id, currentChatSession.model, settingsForThisCharacterCache);
    }

    await updateChatSession(currentChatSession.id, session => session ? ({
      ...session,
      aiCharacters: (session.aiCharacters || []).map(char => 
        char.id === id ? { ...char, name, systemInstruction } : char
      ),
    }) : null);
  }, [currentChatSession, updateChatSession]);

  const handleDeleteCharacter = useCallback(async (id: string) => {
    if (!currentChatSession) return;

    const characterBeingDeleted = currentChatSession.aiCharacters?.find(c => c.id === id);
    if (characterBeingDeleted) {
        const settingsForThisCharacterCache: GeminiSettings & { _characterIdForCacheKey?: string } = {
            ...currentChatSession.settings,
            systemInstruction: characterBeingDeleted.systemInstruction,
            _characterIdForCacheKey: characterBeingDeleted.id,
        };
        geminiServiceClearCachedChat(currentChatSession.id, currentChatSession.model, settingsForThisCharacterCache);
    }

    await updateChatSession(currentChatSession.id, session => session ? ({
      ...session,
      aiCharacters: (session.aiCharacters || []).filter(char => char.id !== id),
    }) : null);
  }, [currentChatSession, updateChatSession]);

  const handleReorderCharacters = useCallback(async (newCharacters: AICharacter[]) => {
    if (!currentChatSession) return;
    if (currentChatSession.isCharacterModeActive && currentChatSession.aiCharacters && currentChatSession.aiCharacters.length > 0) {
      currentChatSession.aiCharacters.forEach(character => {
        const settingsForThisCharacterCache: GeminiSettings & { _characterIdForCacheKey?: string } = {
          ...currentChatSession.settings,
          systemInstruction: character.systemInstruction,
          _characterIdForCacheKey: character.id,
        };
        geminiServiceClearCachedChat(currentChatSession.id, currentChatSession.model, settingsForThisCharacterCache);
      });
    }

    await updateChatSession(currentChatSession.id, session => session ? ({
      ...session,
      aiCharacters: newCharacters,
    }) : null);
  }, [currentChatSession, updateChatSession]);

  const handleSaveCharacterContextualInfo = useCallback(async (characterId: string, newInfo: string) => {
    if (!currentChatSession) return;
    await updateChatSession(currentChatSession.id, session => {
      if (!session || !session.aiCharacters) return session;
      return {
        ...session,
        aiCharacters: session.aiCharacters.map(char =>
          char.id === characterId ? { ...char, contextualInfo: newInfo } : char
        ),
      };
    });
  }, [currentChatSession, updateChatSession]);

  return {
    handleToggleCharacterMode,
    handleAddCharacter,
    handleEditCharacter,
    handleDeleteCharacter,
    handleReorderCharacters,
    handleSaveCharacterContextualInfo,
  };
}