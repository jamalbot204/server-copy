
import React, { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { useChatState, useChatActions } from '../contexts/ChatContext.tsx';
import { useUIContext } from '../contexts/UIContext.tsx';
import { GeminiSettings, SafetySetting } from '../types.ts';
import { DEFAULT_SETTINGS, MODEL_DEFINITIONS, DEFAULT_MODEL_ID, INITIAL_MESSAGES_COUNT, MODELS_SUPPORTING_THINKING_BUDGET_UI, MODELS_SENDING_THINKING_CONFIG_API } from '../constants.ts';
import { CloseIcon, ShieldCheckIcon, PencilIcon, MagnifyingGlassIcon, LinkIcon, BugAntIcon, ArrowPathIcon, SpeakerWaveIcon, CalculatorIcon, ExportBoxIcon, PlayIcon, BookOpenIcon, FolderOpenIcon, KeyIcon } from './Icons.tsx';
import SafetySettingsModal from './SafetySettingsModal.tsx';
import InstructionEditModal from './InstructionEditModal.tsx';
import TtsSettingsModal from './TtsSettingsModal.tsx';
import ThinkingBudgetControl from './ThinkingBudgetControl.tsx';
import ApiKeyManagerModal from './ApiKeyManagerModal.tsx';
import * as dbService from '../services/dbService.ts';
import { METADATA_KEYS } from '../services/dbService.ts';

const InstructionButton: React.FC<{
    label: string; value: string | undefined; onClick: () => void; placeholder: string;
}> = memo(({ label, value, onClick, placeholder }) => (
    <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
        <button type="button" onClick={onClick} className="w-full p-2.5 aurora-input text-left flex justify-between items-center transition-shadow hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)]">
            <span className={`truncate ${value ? 'text-gray-200' : 'text-gray-400'}`}>{value ? (value.length > 60 ? value.substring(0, 60) + "..." : value) : placeholder}</span>
            <PencilIcon className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
        </button>
    </div>
));

// No more props needed!
const SettingsPanel: React.FC = memo(() => {
    const { currentChatSession } = useChatState();
    const { updateChatSession, handleClearChatCacheForCurrentSession } = useChatActions();
    const ui = useUIContext();

    const [localSettings, setLocalSettings] = useState<GeminiSettings>(currentChatSession?.settings || DEFAULT_SETTINGS);
    const [localModel, setLocalModel] = useState<string>(currentChatSession?.model || DEFAULT_MODEL_ID);
    const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
    const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
    const [editingInstructionType, setEditingInstructionType] = useState<'systemInstruction' | 'userPersonaInstruction' | null>(null);
    const [instructionModalContent, setInstructionModalContent] = useState('');

    useEffect(() => {
        if (ui.isSettingsPanelOpen && currentChatSession) {
            setLocalSettings(currentChatSession.settings);
            setLocalModel(currentChatSession.model);
        }
    }, [ui.isSettingsPanelOpen, currentChatSession]);

    const estimatedTokens = useMemo(() => {
        if (!currentChatSession?.messages || currentChatSession.messages.length === 0) return 0;
        const totalWords = currentChatSession.messages.reduce((sum, message) => {
            const words = message.content.trim().split(/\s+/).filter(Boolean).length;
            return sum + words;
        }, 0);
        return Math.round(totalWords * 1.5);
    }, [currentChatSession?.messages]);

    const handleOpenInstructionModal = useCallback((type: 'systemInstruction' | 'userPersonaInstruction') => {
        setEditingInstructionType(type);
        setInstructionModalContent(localSettings[type] || '');
        setIsInstructionModalOpen(true);
    }, [localSettings]);

    const handleApplyInstructionChange = useCallback((newInstruction: string) => {
        if (editingInstructionType) {
            setLocalSettings(prev => ({ ...prev, [editingInstructionType]: newInstruction }));
        }
        setIsInstructionModalOpen(false);
        setEditingInstructionType(null);
    }, [editingInstructionType]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        if (name === "model") {
            setLocalModel(value);
            if (!MODELS_SUPPORTING_THINKING_BUDGET_UI.includes(value)) {
                setLocalSettings(prev => ({ ...prev, thinkingBudget: undefined }));
            } else if (localSettings.thinkingBudget === undefined) { 
                 setLocalSettings(prev => ({ ...prev, thinkingBudget: DEFAULT_SETTINGS.thinkingBudget }));
            }

        } else if (type === 'checkbox') {
            const { checked } = e.target as HTMLInputElement;
            setLocalSettings(prev => ({ ...prev, [name]: checked }));
        } else if (name === 'urlContext') {
            setLocalSettings(prev => ({ ...prev, urlContext: value.split('\\n').map(url => url.trim()).filter(url => url) }));
        } else {
            setLocalSettings(prev => ({ ...prev, [name]: value }));
        }
    }, [localSettings.thinkingBudget]);

    const handleRangeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setLocalSettings(prev => ({ ...prev, [name]: parseFloat(value) }));
    }, []);

    const handleNumericInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        let numValue: number | undefined = parseInt(value, 10);
        if (isNaN(numValue) || value === '') {
            numValue = undefined;
        }
        setLocalSettings(prev => ({ ...prev, [name]: numValue }));
    }, []);
    
    const handleThinkingBudgetChange = useCallback((newValue: number | undefined) => {
        setLocalSettings(prev => ({...prev, thinkingBudget: newValue}));
    }, []);

    const handleSubmit = useCallback(() => {
        if (!currentChatSession) return;
        updateChatSession(currentChatSession.id, session => session ? ({ ...session, settings: localSettings, model: localModel }) : null);
        ui.closeSettingsPanel();
    }, [updateChatSession, currentChatSession, localSettings, localModel, ui.closeSettingsPanel]);
    
    const handleMakeDefaults = useCallback(async () => {
        await dbService.setAppMetadata(METADATA_KEYS.USER_DEFINED_GLOBAL_DEFAULTS, {
            model: localModel,
            settings: localSettings,
        });
        ui.showToast("Default settings saved!", "success");
    }, [localModel, localSettings, ui.showToast]);

    const resetToDefaults = useCallback(() => {
        setLocalSettings(DEFAULT_SETTINGS);
        setLocalModel(DEFAULT_MODEL_ID);
    }, []);

    const handleApplySafetySettings = useCallback((newSafetySettings: SafetySetting[]) => {
        setLocalSettings(prev => ({ ...prev, safetySettings: newSafetySettings }));
        setIsSafetyModalOpen(false);
    }, []);


    const handleCustomizeExportClick = useCallback(() => {
        ui.openExportConfigurationModal();
    }, [ui]);

    const handleViewChatAttachments = useCallback(() => {
        if (currentChatSession) {
            const attachmentsExist = currentChatSession.messages.some(msg => msg.attachments && msg.attachments.length > 0);
            if (attachmentsExist) {
                ui.openChatAttachmentsModal(currentChatSession);
            } else {
                ui.showToast("No attachments found in this chat.", "success");
            }
        } else {
            ui.showToast("No active chat session.", "error");
        }
    }, [currentChatSession, ui]);

    if (!ui.isSettingsPanelOpen || !currentChatSession) return null;

    const showThinkingBudgetControl = MODELS_SUPPORTING_THINKING_BUDGET_UI.includes(localModel);
    const thinkingBudgetActuallyUsedByApi = MODELS_SENDING_THINKING_CONFIG_API.includes(localModel);

    return (
        <>
            <div className="fixed inset-0 bg-black/60 z-40 flex justify-center items-center p-4 backdrop-blur-md">
                <div className="aurora-panel p-6 rounded-lg shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto text-gray-200 relative">
                     <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-semibold text-gray-100">Settings</h2>
                        <div className="flex items-center space-x-2">
                           <button
                                onClick={ui.openApiKeyModal}
                                className="p-2 text-yellow-300 bg-yellow-600/20 rounded-md transition-all hover:shadow-[0_0_12px_2px_rgba(234,179,8,0.6)] focus:outline-none focus:ring-2 ring-yellow-500"
                                title="Manage API Keys"
                                aria-label="Manage API Keys"
                            >
                                <KeyIcon className="w-5 h-5" />
                            </button>
                            <button onClick={ui.closeSettingsPanel} className="text-gray-400 p-1 rounded-full transition-shadow hover:text-gray-100 hover:shadow-[0_0_10px_1px_rgba(255,255,255,0.2)]" aria-label="Close settings"><CloseIcon className="w-6 h-6" /></button>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label htmlFor="model" className="block text-sm font-medium text-gray-300 mb-1">Model</label>
                            <select id="model" name="model" className="w-full p-2.5 aurora-select" value={localModel} onChange={handleInputChange}>
                                {MODEL_DEFINITIONS.map(model => (<option key={model.id} value={model.id}>{model.name}</option>))}
                            </select>
                        </div>
                        <InstructionButton label="System Instruction (for AI)" value={localSettings.systemInstruction} onClick={() => handleOpenInstructionModal('systemInstruction')} placeholder="e.g., You are a helpful assistant." />
                        <InstructionButton label="User Persona Instruction (for AI to mimic user)" value={localSettings.userPersonaInstruction} onClick={() => handleOpenInstructionModal('userPersonaInstruction')} placeholder="e.g., I am a creative writer exploring narratives." />
                        
                        {showThinkingBudgetControl && (
                            <ThinkingBudgetControl
                                value={localSettings.thinkingBudget}
                                onChange={handleThinkingBudgetChange}
                                modelActuallyUsesApi={thinkingBudgetActuallyUsedByApi}
                            />
                        )}

                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center"><SpeakerWaveIcon className="w-5 h-5 mr-2 text-gray-400" /><h3 className="text-md font-medium text-gray-300">Text-to-Speech (TTS) settings</h3></div>
                                <button onClick={ui.openTtsSettingsModal} className="text-sm text-blue-400 flex items-center transition-all hover:text-blue-300 hover:drop-shadow-[0_0_3px_rgba(147,197,253,0.8)]" aria-label="Configure Text-to-Speech settings">Configure <PencilIcon className="w-3 h-3 ml-1" /></button>
                            </div>
                            <p className="text-xs text-gray-400">Configure voice model and other TTS options.</p>
                        </div>
                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center"><ShieldCheckIcon className="w-5 h-5 mr-2 text-gray-400" /><h3 className="text-md font-medium text-gray-300">Safety settings</h3></div>
                                <button onClick={() => setIsSafetyModalOpen(true)} className="text-sm text-blue-400 flex items-center transition-all hover:text-blue-300 hover:drop-shadow-[0_0_3px_rgba(147,197,253,0.8)]" aria-label="Edit Safety settings">Edit <PencilIcon className="w-3 h-3 ml-1" /></button>
                            </div>
                            <p className="text-xs text-gray-400">Adjust content filtering for harassment, hate speech, and other harmful content. These are overridden during 'Continue Flow' when AI mimics the user.</p>
                        </div>
                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center"><ExportBoxIcon className="w-5 h-5 mr-2 text-gray-400" /><h3 className="text-md font-medium text-gray-300">Export preferences</h3></div>
                                <button onClick={handleCustomizeExportClick} className="text-sm text-blue-400 flex items-center transition-all hover:text-blue-300 hover:drop-shadow-[0_0_3px_rgba(147,197,253,0.8)]" aria-label="Customize export data">Customize & Export <PencilIcon className="w-3 h-3 ml-1" /></button>
                            </div>
                            <p className="text-xs text-gray-400">Choose chats and data to include when exporting.</p>
                        </div>
                         {/* New Chat Attachments Button */}
                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center"><FolderOpenIcon className="w-5 h-5 mr-2 text-gray-400" /><h3 className="text-md font-medium text-gray-300">Chat Attachments</h3></div>
                                <button onClick={handleViewChatAttachments} className="text-sm text-blue-400 flex items-center transition-all hover:text-blue-300 hover:drop-shadow-[0_0_3px_rgba(147,197,253,0.8)]" aria-label="View chat attachments">View <PencilIcon className="w-3 h-3 ml-1" /></button>
                            </div>
                            <p className="text-xs text-gray-400">View all attachments in the current chat session.</p>
                        </div>
                        <div>
                            <label htmlFor="temperature" className="block text-sm font-medium text-gray-300">Temperature: {localSettings.temperature?.toFixed(2) ?? DEFAULT_SETTINGS.temperature?.toFixed(2)}</label>
                            <input type="range" id="temperature" name="temperature" min="0" max="2" step="0.01" value={localSettings.temperature ?? DEFAULT_SETTINGS.temperature} onChange={handleRangeChange} />
                        </div>
                        <div>
                            <label htmlFor="topP" className="block text-sm font-medium text-gray-300">Top P: {localSettings.topP?.toFixed(2) ?? DEFAULT_SETTINGS.topP?.toFixed(2)}</label>
                            <input type="range" id="topP" name="topP" min="0" max="1" step="0.01" value={localSettings.topP ?? DEFAULT_SETTINGS.topP} onChange={handleRangeChange} />
                        </div>
                        <div>
                            <label htmlFor="topK" className="block text-sm font-medium text-gray-300 mb-1">Top K</label>
                            <input type="number" id="topK" name="topK" min="1" className="w-full p-2 aurora-input" placeholder={`Default: ${DEFAULT_SETTINGS.topK}`} value={localSettings.topK ?? ''} onChange={handleNumericInputChange} />
                        </div>
                        <div>
                            <label htmlFor="contextWindowMessages" className="block text-sm font-medium text-gray-300 mb-1">Context Window (Max Messages)</label>
                            <input type="number" id="contextWindowMessages" name="contextWindowMessages" min="0" className="w-full p-2 aurora-input" placeholder="Default: All (0 or empty)" value={localSettings.contextWindowMessages ?? ''} onChange={handleNumericInputChange} />
                            <p className="text-xs text-gray-400 mt-1">Max number of recent messages sent as history. 0 or empty means all.</p>
                        </div>
                        <div>
                            <label htmlFor="maxInitialMessagesDisplayed" className="block text-sm font-medium text-gray-300 mb-1">Max Initial Messages Displayed</label>
                            <input type="number" id="maxInitialMessagesDisplayed" name="maxInitialMessagesDisplayed" min="1" className="w-full p-2 aurora-input" placeholder={`Default: ${DEFAULT_SETTINGS.maxInitialMessagesDisplayed || INITIAL_MESSAGES_COUNT}`} value={localSettings.maxInitialMessagesDisplayed ?? ''} onChange={handleNumericInputChange} />
                            <p className="text-xs text-gray-400 mt-1">Number of messages to show initially or when switching chats.</p>
                        </div>
                        <div className="border-t border-[var(--aurora-border)] pt-4">
                            <div className="flex items-center">
                                <input id="aiSeesTimestamps" name="aiSeesTimestamps" type="checkbox" className="h-4 w-4 text-blue-600 bg-black/30 border-white/20 rounded focus:ring-blue-500 focus:ring-offset-black" checked={localSettings.aiSeesTimestamps ?? false} onChange={handleInputChange} />
                                <label htmlFor="aiSeesTimestamps" className="ml-2 block text-sm text-gray-300">Include message timestamps for AI</label>
                            </div>
                            <p className="text-xs text-gray-400 mt-1 ml-6">If enabled, AI sees when each message was sent.</p>
                        </div>
                        <div>
                            <div className="flex items-center">
                                <input id="useGoogleSearch" name="useGoogleSearch" type="checkbox" className="h-4 w-4 text-blue-600 bg-black/30 border-white/20 rounded focus:ring-blue-500 focus:ring-offset-black" checked={localSettings.useGoogleSearch ?? false} onChange={handleInputChange} />
                                <label htmlFor="useGoogleSearch" className="ml-2 block text-sm text-gray-300 flex items-center"><MagnifyingGlassIcon className="w-4 h-4 mr-1.5 text-gray-400" />Use Google Search</label>
                            </div>
                            <p className="text-xs text-gray-400 mt-1 ml-6">If enabled, AI can use Google Search to inform responses. May increase response time.</p>
                        </div>
                        <div>
                            <label htmlFor="urlContext" className="block text-sm font-medium text-gray-300 mb-1 flex items-center"><LinkIcon className="w-4 h-4 mr-1.5 text-gray-400" />URL Context (Optional - One per line)</label>
                            <textarea id="urlContext" name="urlContext" rows={3} className="w-full p-2 aurora-textarea" placeholder="e.g., https://example.com/article1\nhttps://example.com/article2" value={(localSettings.urlContext || []).join('\n')} onChange={handleInputChange} />
                            <p className="text-xs text-gray-400 mt-1">Provide URLs for the AI to consider as context. One URL per line.</p>
                        </div>
                        <div className="border-t border-[var(--aurora-border)] pt-4">
                            <h3 className="text-md font-medium text-gray-300 mb-2 flex items-center"><CalculatorIcon className="w-5 h-5 mr-2 text-gray-400" />Session Statistics</h3>
                            <p className="text-sm text-gray-300">Estimated Tokens (Words * 1.5): <span className="font-semibold text-blue-400">{estimatedTokens}</span></p>
                        </div>
                        <div className="border-t border-[var(--aurora-border)] pt-4">
                            <h3 className="text-md font-medium text-gray-300 mb-2">UI Customization</h3>
                            <div className="flex items-center">
                                <input id="showAutoSendControls" name="showAutoSendControls" type="checkbox" className="h-4 w-4 text-blue-600 bg-black/30 border-white/20 rounded focus:ring-blue-500 focus:ring-offset-black" checked={localSettings.showAutoSendControls ?? false} onChange={handleInputChange} />
                                <label htmlFor="showAutoSendControls" className="ml-2 block text-sm text-gray-300 flex items-center"><PlayIcon className="w-4 h-4 mr-1.5 text-gray-400" />Show Auto-Send Controls</label>
                            </div>
                            <div className="flex items-center mt-2">
                                <input id="showReadModeButton" name="showReadModeButton" type="checkbox" className="h-4 w-4 text-blue-600 bg-black/30 border-white/20 rounded focus:ring-blue-500 focus:ring-offset-black" checked={localSettings.showReadModeButton ?? false} onChange={handleInputChange} />
                                <label htmlFor="showReadModeButton" className="ml-2 block text-sm text-gray-300 flex items-center"><BookOpenIcon className="w-4 h-4 mr-1.5 text-gray-400" />Show "Read Mode" Button</label>
                            </div>
                        </div>
                        <div className="border-t border-[var(--aurora-border)] pt-4">
                            <div className="flex items-center">
                                <input id="debugApiRequests" name="debugApiRequests" type="checkbox" className="h-4 w-4 text-blue-600 bg-black/30 border-white/20 rounded focus:ring-blue-500 focus:ring-offset-black" checked={localSettings.debugApiRequests ?? false} onChange={handleInputChange} />
                                <label htmlFor="debugApiRequests" className="ml-2 block text-sm text-gray-300 flex items-center"><BugAntIcon className="w-4 h-4 mr-1.5 text-gray-400" />Enable API Request Logger</label>
                            </div>
                            {currentChatSession.settings.debugApiRequests && (
                                <button onClick={() => { ui.openDebugTerminal(); ui.closeSettingsPanel(); }} disabled={!(currentChatSession.apiRequestLogs && currentChatSession.apiRequestLogs.length > 0) && !localSettings.debugApiRequests} className="mt-2 flex items-center px-3 py-1.5 text-xs font-medium text-orange-300 bg-orange-600 bg-opacity-30 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(249,115,22,0.6)] disabled:opacity-50 disabled:cursor-not-allowed" title="View API Request Logs for this session">
                                    <BugAntIcon className="w-4 h-4 mr-1.5" />
                                    {currentChatSession.apiRequestLogs && currentChatSession.apiRequestLogs.length > 0 ? 'View API Logs' : (localSettings.debugApiRequests ? 'View API Logs (None Yet)' : 'Enable logging to view logs')}
                                </button>
                            )}
                        </div>
                        <div className="border-t border-[var(--aurora-border)] pt-4">
                            <h3 className="text-md font-medium text-gray-300 mb-2 flex items-center"><ArrowPathIcon className="w-5 h-5 mr-2 text-gray-400" />Cache Management</h3>
                            <button onClick={handleClearChatCacheForCurrentSession} type="button" className="w-full px-4 py-2 text-sm font-medium text-white bg-orange-600/80 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(249,115,22,0.6)] flex items-center justify-center space-x-2" title={currentChatSession.isCharacterModeActive && currentChatSession.aiCharacters && currentChatSession.aiCharacters.length > 0 ? "Clears cache for all characters in this chat." : "Clears the model's cache for this chat."}>
                                <ArrowPathIcon className="w-4 h-4" /><span>{currentChatSession.isCharacterModeActive && currentChatSession.aiCharacters && currentChatSession.aiCharacters.length > 0 ? 'Clear All Characters Cache' : 'Clear Model Cache'}</span>
                            </button>
                        </div>
                    </div>
                    <div className="mt-8 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3">
                        <button onClick={resetToDefaults} type="button" className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/5 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(255,255,255,0.2)] w-full sm:w-auto">Reset to Defaults</button>
                        <button onClick={handleMakeDefaults} type="button" className="px-4 py-2 text-sm font-medium text-white bg-green-600/80 rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(34,197,94,0.6)] w-full sm:w-auto">Make Global Defaults</button>
                        <button onClick={handleSubmit} type="button" className="px-4 py-2 text-sm font-medium text-white bg-[var(--aurora-accent-primary)] rounded-md transition-shadow hover:shadow-[0_0_12px_2px_rgba(90,98,245,0.6)] w-full sm:w-auto">Apply Settings</button>
                    </div>
                </div>
            </div>
            {isSafetyModalOpen && localSettings.safetySettings && (<SafetySettingsModal isOpen={isSafetyModalOpen} currentSafetySettings={localSettings.safetySettings} onClose={() => setIsSafetyModalOpen(false)} onApply={handleApplySafetySettings} />)}
            {ui.isTtsSettingsModalOpen && <TtsSettingsModal />}
            {isInstructionModalOpen && editingInstructionType && (<InstructionEditModal isOpen={isInstructionModalOpen} title={editingInstructionType === 'systemInstruction' ? "Edit System Instruction" : "Edit User Persona Instruction"} currentInstruction={instructionModalContent} onApply={handleApplyInstructionChange} onClose={() => { setIsInstructionModalOpen(false); setEditingInstructionType(null); }} />)}
            {ui.isApiKeyModalOpen && <ApiKeyManagerModal />}
        </>
    );
});

export default SettingsPanel;
