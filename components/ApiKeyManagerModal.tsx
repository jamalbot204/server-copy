import React, { memo } from 'react';
import { useUIContext } from '../contexts/UIContext.tsx';
import ApiKeyManager from './ApiKeyManager.tsx';
import { CloseIcon, KeyIcon } from './Icons.tsx';

const ApiKeyManagerModal: React.FC = memo(() => {
  const { isApiKeyModalOpen, closeApiKeyModal } = useUIContext();

  if (!isApiKeyModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center p-4 backdrop-blur-md">
      <div className="aurora-panel p-6 rounded-lg shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col text-gray-200">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-100 flex items-center">
            <KeyIcon className="w-5 h-5 mr-2 text-yellow-400" />
            API Key Management
          </h2>
          <button
            onClick={closeApiKeyModal}
            className="p-1 text-gray-400 rounded-full transition-all hover:text-gray-100 hover:drop-shadow-[0_0_4px_rgba(255,255,255,0.5)]"
            aria-label="Close API Key Management"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto pr-2 -mr-2 flex-grow">
          <ApiKeyManager isModal={true} />
        </div>
        <div className="mt-6 flex justify-end flex-shrink-0">
          <button onClick={closeApiKeyModal} className="px-4 py-2 text-sm bg-white/5 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]">Close</button>
        </div>
      </div>
    </div>
  );
});

export default ApiKeyManagerModal;
