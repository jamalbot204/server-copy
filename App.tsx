import React, { memo } from 'react';
import { UIProvider } from './contexts/UIContext.tsx';
import { ChatProvider } from './contexts/ChatContext.tsx';
import { AudioProvider } from './contexts/AudioContext.tsx';
import { ApiKeyProvider } from './contexts/ApiKeyContext.tsx';
import AppContent from './components/AppContent.tsx'; 

const App: React.FC = memo(() => {
  return (
    <ApiKeyProvider>
      <UIProvider>
        <ChatProvider>
          <AudioProvider>
            <AppContent />
          </AudioProvider>
        </ChatProvider>
      </UIProvider>
    </ApiKeyProvider>
  );
});

export default App;