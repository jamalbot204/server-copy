

import React, { useRef, useEffect, memo, useCallback } from 'react';
import { useChatState, useChatActions } from '../contexts/ChatContext.tsx';
import { useUIContext } from '../contexts/UIContext.tsx';
import { APP_TITLE } from '../constants.ts';
import { PlusIcon, TrashIcon, CogIcon, ExportIcon, ImportIcon, UsersIcon, IconDirectionLtr, IconDirectionRtl, PencilIcon, CheckIcon, XCircleIcon, DocumentDuplicateIcon } from './Icons.tsx';

const Sidebar: React.FC = memo(() => {
  const { chatHistory, currentChatId, currentChatSession, editingTitleInfo } = useChatState();
  const {
      handleNewChat, handleToggleCharacterMode, handleImportAll,
      handleSelectChat, handleStartEditChatTitle, handleSaveChatTitle,
      handleCancelEditChatTitle, handleEditTitleInputChange, handleDuplicateChat,
      handleDeleteChat,
  } = useChatActions();
  const ui = useUIContext();
  
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitleInfo.id && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTitleInfo.id]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSaveChatTitle();
    } else if (e.key === 'Escape') {
      handleCancelEditChatTitle();
    }
  }, [handleSaveChatTitle, handleCancelEditChatTitle]);

  return (
    <div className="w-full aurora-panel h-full flex flex-col border-r border-[var(--aurora-border)]">
      <div className="p-4 border-b border-[var(--aurora-border)] flex justify-between items-center">
        <h1 className="text-xl font-semibold text-gray-100">{APP_TITLE}</h1>
        <button
          onClick={ui.handleToggleLayoutDirection}
          title={ui.layoutDirection === 'rtl' ? "Switch to Left-to-Right" : "Switch to Right-to-Left"}
          className="p-1.5 text-[var(--aurora-text-secondary)] hover:text-[var(--aurora-text-primary)] rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)] focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)]"
          aria-label={ui.layoutDirection === 'rtl' ? "Switch to Left-to-Right layout" : "Switch to Right-to-Left layout"}
        >
          {ui.layoutDirection === 'rtl' ? <IconDirectionLtr className="w-5 h-5" /> : <IconDirectionRtl className="w-5 h-5" />}
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex space-x-2">
            <button
            onClick={handleNewChat}
            className="flex-1 flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white bg-[var(--aurora-accent-primary)] rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)] focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)]"
            >
            <PlusIcon className="w-5 h-5 mr-2 rtl:ml-2 rtl:mr-0" /> 
            New Chat
            </button>
            <button
                onClick={handleToggleCharacterMode}
                disabled={!currentChatId}
                title={currentChatSession?.isCharacterModeActive ? "Disable Character Mode" : "Enable Character Mode"}
                className={`p-2.5 text-sm font-medium rounded-md transition-shadow focus:outline-none focus:ring-2 focus:ring-opacity-50
                            ${currentChatSession?.isCharacterModeActive 
                                ? 'bg-[var(--aurora-accent-secondary)] text-white ring-[var(--aurora-accent-secondary)] hover:shadow-[0_0_12px_2px_rgba(156,51,245,0.6)]' 
                                : 'bg-white/5 text-[var(--aurora-text-secondary)] ring-white/20 hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]'}
                            ${!currentChatId ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <UsersIcon className="w-5 h-5" />
            </button>
        </div>
        <div className="flex space-x-2 rtl:space-x-reverse">
            <button
                onClick={ui.openExportConfigurationModal}
                title="Export Selected Chats"
                className="w-full flex items-center justify-center px-3 py-2 text-xs font-medium text-[var(--aurora-text-secondary)] bg-white/5 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]"
            >
                <ExportIcon className="w-4 h-4 mr-1.5 rtl:ml-1.5 rtl:mr-0" />
                Export
            </button>
            <button
                onClick={handleImportAll}
                title="Import Chats"
                className="w-full flex items-center justify-center px-3 py-2 text-xs font-medium text-[var(--aurora-text-secondary)] bg-white/5 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)]"
            >
                <ImportIcon className="w-4 h-4 mr-1.5 rtl:ml-1.5 rtl:mr-0" />
                Import
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <h2 className="text-xs font-semibold text-[var(--aurora-text-secondary)] uppercase tracking-wider mb-2">History</h2>
        {chatHistory.length === 0 && (
          <p className="text-sm text-gray-400 italic">No chats yet.</p>
        )}
        {chatHistory.map(session => (
          <div
            key={session.id}
            onClick={() => editingTitleInfo.id !== session.id && handleSelectChat(session.id)}
            className={`flex items-center justify-between p-2.5 rounded-md group transition-all duration-200
                        ${editingTitleInfo.id === session.id ? 'bg-white/20 ring-1 ring-[var(--aurora-accent-primary)]' : 
                         currentChatId === session.id ? 'bg-white/10 text-[var(--aurora-text-primary)] shadow-[0_0_15px_-5px_var(--aurora-accent-primary)]' : 
                         'text-[var(--aurora-text-secondary)] hover:bg-white/5 hover:text-[var(--aurora-text-primary)] cursor-pointer'}`}
          >
            <div className="flex items-center overflow-hidden flex-grow">
                {session.isCharacterModeActive && <UsersIcon className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0 text-purple-400 flex-shrink-0"/>}
                {editingTitleInfo.id === session.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingTitleInfo.value}
                    onChange={(e) => handleEditTitleInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => setTimeout(handleCancelEditChatTitle, 100)}
                    className="text-sm bg-black/50 text-gray-100 rounded-sm px-1 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-[var(--aurora-accent-primary)]"
                    aria-label="Edit chat title"
                  />
                ) : (
                  <span className="truncate text-sm" title={session.title}>{session.title}</span>
                )}
            </div>
            <div className="flex items-center space-x-0.5 ml-2 rtl:mr-2 rtl:ml-0 flex-shrink-0">
              {editingTitleInfo.id === session.id ? (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSaveChatTitle(); }}
                    className="p-1 text-green-400 transition-all hover:text-green-300 hover:drop-shadow-[0_0_4px_rgba(34,197,94,0.9)]"
                    title="Save title"
                    aria-label="Save chat title"
                  >
                    <CheckIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancelEditChatTitle(); }}
                    className="p-1 text-gray-400 transition-all hover:text-gray-200 hover:drop-shadow-[0_0_4px_rgba(255,255,255,0.5)]"
                    title="Cancel edit"
                    aria-label="Cancel editing chat title"
                  >
                    <XCircleIcon className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStartEditChatTitle(session.id, session.title); }}
                    className="p-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-all hover:text-blue-400 hover:drop-shadow-[0_0_4px_rgba(90,98,245,0.9)]"
                    title="Edit title"
                    aria-label="Edit chat title"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDuplicateChat(session.id); }}
                    className="p-1 text-gray-400 opacity-0 group-hover:opacity-100 transition-all hover:text-green-400 hover:drop-shadow-[0_0_4px_rgba(34,197,94,0.9)]"
                    title="Duplicate chat"
                    aria-label="Duplicate chat session"
                  >
                    <DocumentDuplicateIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteChat(session.id); }}
                    className="p-1 text-gray-500 opacity-0 group-hover:opacity-100 transition-all hover:text-red-400 hover:drop-shadow-[0_0_4px_rgba(239,68,68,0.9)]"
                    title="Delete chat"
                    aria-label="Delete chat"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-[var(--aurora-border)]">
        <button
          onClick={ui.openSettingsPanel}
          className="w-full flex items-center justify-center px-4 py-2.5 text-sm font-medium text-[var(--aurora-text-secondary)] bg-white/5 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)] hover:text-[var(--aurora-text-primary)] focus:outline-none focus:ring-2 ring-[var(--aurora-accent-primary)]"
        >
          <CogIcon className="w-5 h-5 mr-2 rtl:ml-2 rtl:mr-0" />
          Settings
        </button>
      </div>
    </div>
  );
});

export default Sidebar;