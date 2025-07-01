
import { useState, useEffect, useCallback, useMemo } from 'react';
import { ApiKey } from '../types.ts';
import * as dbService from '../services/dbService.ts';
import { METADATA_KEYS } from '../services/dbService.ts';

export function useApiKeys() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadKeys = async () => {
      // Always proceed with loading from IndexedDB for local development.
      setIsLoading(true);
      try {
        const storedKeys = await dbService.getAppMetadata<ApiKey[]>(METADATA_KEYS.API_KEYS);
        setApiKeys(storedKeys || []);
      } catch (error) {
        console.error("Failed to load API keys from storage:", error);
        setApiKeys([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadKeys();
  }, []);

  const persistKeys = useCallback(async (keys: ApiKey[]) => {
    try {
      await dbService.setAppMetadata(METADATA_KEYS.API_KEYS, keys);
    } catch (error) {
      console.error("Failed to save API keys:", error);
    }
  }, []);

  const addApiKey = useCallback(() => {
    const newKey: ApiKey = {
      id: `apikey-${Date.now()}`,
      name: `Key ${apiKeys.length + 1}`,
      value: '',
    };
    const newKeys = [...apiKeys, newKey];
    setApiKeys(newKeys);
    persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const updateApiKey = useCallback((id: string, name: string, value: string) => {
    const newKeys = apiKeys.map(key =>
      key.id === id ? { ...key, name, value } : key
    );
    setApiKeys(newKeys);
    persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const deleteApiKey = useCallback((id: string) => {
    const newKeys = apiKeys.filter(key => key.id !== id);
    setApiKeys(newKeys);
    persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const moveKey = useCallback((id: string, direction: 'up' | 'down') => {
    const index = apiKeys.findIndex(key => key.id === id);
    if (index === -1) return;

    const newKeys = [...apiKeys];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= newKeys.length) return;

    [newKeys[index], newKeys[newIndex]] = [newKeys[newIndex], newKeys[index]];
    
    setApiKeys(newKeys);
    persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const moveKeyToEdge = useCallback((id: string, edge: 'top' | 'bottom') => {
    const index = apiKeys.findIndex(key => key.id === id);
    if (index === -1 || (edge === 'top' && index === 0) || (edge === 'bottom' && index === apiKeys.length - 1)) return;

    const newKeys = [...apiKeys];
    const [item] = newKeys.splice(index, 1);

    if (edge === 'top') {
      newKeys.unshift(item);
    } else {
      newKeys.push(item);
    }
    
    setApiKeys(newKeys);
    persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const rotateActiveKey = useCallback(async () => {
    if (apiKeys.length < 2) {
      return;
    }
    const newKeys = [...apiKeys.slice(1), apiKeys[0]];
    setApiKeys(newKeys);
    await persistKeys(newKeys);
  }, [apiKeys, persistKeys]);

  const toggleKeyVisibility = useCallback(() => {
    setIsKeyVisible(prev => !prev);
  }, []);
  
  const activeApiKey = apiKeys.length > 0 ? apiKeys[0] : null;

  return useMemo(() => ({
    apiKeys,
    activeApiKey,
    isKeyVisible,
    isLoading,
    addApiKey,
    updateApiKey,
    deleteApiKey,
    toggleKeyVisibility,
    moveKey,
    moveKeyToEdge,
    rotateActiveKey,
  }), [apiKeys, activeApiKey, isKeyVisible, isLoading, addApiKey, updateApiKey, deleteApiKey, toggleKeyVisibility, moveKey, moveKeyToEdge, rotateActiveKey]);
}
