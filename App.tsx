

import React, { memo } from 'react';
import { UIProvider } from './contexts/UIContext.tsx';
import { SessionProvider } from './contexts/SessionContext.tsx';
import { MessageProvider } from './contexts/MessageContext.tsx';
import { AudioProvider } from './contexts/AudioContext.tsx';
import { ApiKeyProvider } from './contexts/ApiKeyContext.tsx';
import AppContent from './components/AppContent.tsx'; 

const App: React.FC = memo(() => {
  return (
    <ApiKeyProvider>
      <UIProvider>
        <SessionProvider>
          <MessageProvider>
            <AudioProvider>
              <AppContent />
            </AudioProvider>
          </MessageProvider>
        </SessionProvider>
      </UIProvider>
    </ApiKeyProvider>
  );
});

export default App;