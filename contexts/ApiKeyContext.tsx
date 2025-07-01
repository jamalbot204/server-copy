import React, { createContext, useContext, ReactNode } from 'react';
import { ApiKey } from '../types.ts';
import { useApiKeys } from '../hooks/useApiKeys.ts';

interface ApiKeyContextType {
  apiKeys: ApiKey[];
  activeApiKey: ApiKey | null;
  isKeyVisible: boolean;
  isLoading: boolean;
  addApiKey: () => void;
  updateApiKey: (id: string, name: string, value: string) => void;
  deleteApiKey: (id: string) => void;
  toggleKeyVisibility: () => void;
  moveKey: (id: string, direction: 'up' | 'down') => void;
  moveKeyToEdge: (id: string, edge: 'top' | 'bottom') => void;
  rotateActiveKey: () => Promise<void>;
}

const ApiKeyContext = createContext<ApiKeyContextType | null>(null);

export const ApiKeyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const apiKeyManager = useApiKeys();

  return (
    <ApiKeyContext.Provider value={apiKeyManager}>
      {children}
    </ApiKeyContext.Provider>
  );
};

export const useApiKeyContext = (): ApiKeyContextType => {
  const context = useContext(ApiKeyContext);
  if (!context) {
    throw new Error('useApiKeyContext must be used within an ApiKeyProvider');
  }
  return context;
};