import React, { useState, useEffect } from 'react';
import { Moon, Sun, Loader2, ArrowRight, X, Edit3 } from 'lucide-react';
import { ProviderConfig, ProviderType, ModelConfig } from '../types';
import { getGeminiModels, getOpenAIModels, getAnthropicModels, AIModel } from '../services/ai';
import { ModelListItem } from './settings/ModelListItem';
import { TutorialCard, ShortcutItem } from './settings/SettingsComponents';
import { v4 as uuidv4 } from 'uuid';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    setIsDarkMode: (isDark: boolean) => void;
    providerConfigs: Record<ProviderType, ProviderConfig>;
    setProviderConfigs: React.Dispatch<React.SetStateAction<Record<ProviderType, ProviderConfig>>>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    isDarkMode,
    setIsDarkMode,
    providerConfigs,
    setProviderConfigs
}) => {
    // Default to available_models as it contains the API Key input (primary setting)
    const [activeSettingsTab, setActiveSettingsTab] = useState<'ai_config' | 'available_models' | 'shortcuts' | 'tutorial'>('available_models');
    const [draggedModelItem, setDraggedModelItem] = useState<{ provider: ProviderType, index: number } | null>(null);

    // Available Models Tab State
    const [selectedProvider, setSelectedProvider] = useState<ProviderType>('openai');
    const [availableModelsListState, setAvailableModelsListState] = useState<AIModel[]>([]);
    const [loadingAvailableModels, setLoadingAvailableModels] = useState(false);
    const [availableModelsError, setAvailableModelsError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Expanded Model & Config State
    const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
    const [editingModelConfigId, setEditingModelConfigId] = useState<string | null>(null);

    // Config Form State
    const [modelConfigForm, setModelConfigForm] = useState<{
        label: string;
        type: 'text' | 'image';
        jsonConfig: string; // Store raw JSON string
    }>({
        label: '',
        type: 'text',
        jsonConfig: '{}'
    });

    const [jsonError, setJsonError] = useState<string | null>(null);

    // Manual Model Add State (for Custom provider)
    const [manualModelId, setManualModelId] = useState('');
    const [manualModelName, setManualModelName] = useState('');

    // Auto-fetch if key exists when tab is opened or provider changes
    useEffect(() => {
        if (activeSettingsTab === 'available_models') {
            const key = providerConfigs[selectedProvider].key;
            if (key && availableModelsListState.length === 0) {
                fetchAvailableModels();
            }
        }
    }, [activeSettingsTab, selectedProvider]);

    const fetchAvailableModels = async () => {
        const config = providerConfigs[selectedProvider];
        const apiKey = config.key;

        // Gemini and Anthropic need specific handling
        if (!apiKey && (selectedProvider === 'gemini')) {
            setAvailableModelsError("Please enter an API Key above.");
            return;
        }

        setLoadingAvailableModels(true);
        setAvailableModelsError(null);
        try {
            let models: AIModel[] = [];
            if (selectedProvider === 'gemini') {
                models = await getGeminiModels(apiKey);
            } else if (selectedProvider === 'openai') {
                models = await getOpenAIModels(apiKey, config.baseUrl);
            } else if (selectedProvider === 'anthropic') {
                models = await getAnthropicModels();
            }
            setAvailableModelsListState(models);
        } catch (e: any) {
            setAvailableModelsError(e.message);
        } finally {
            setLoadingAvailableModels(false);
        }
    };

    const filteredModels = React.useMemo(() => {
        if (!searchQuery.trim()) return availableModelsListState;
        const query = searchQuery.toLowerCase();
        return availableModelsListState.filter(model =>
            model.displayName.toLowerCase().includes(query) ||
            model.id.toLowerCase().includes(query)
        );
    }, [availableModelsListState, searchQuery]);

    if (!isOpen) return null;

    // --- Handlers ---

    const handleExpandModel = (model: AIModel) => {
        if (expandedModelId === model.id && !editingModelConfigId) {
            setExpandedModelId(null);
            return;
        }
        
        setExpandedModelId(model.id);
        setEditingModelConfigId(null);
        setJsonError(null);

        // Check if already configured (just for defaulting the label)
        const existingConfig = providerConfigs[selectedProvider].models.find(m => m.value === model.id);

        const outputIsImage = model.id.toLowerCase().includes('image') && !model.id.toLowerCase().includes('vision');
        const defaultType = outputIsImage ? 'image' : 'text';

        // Updated Provider-specific Defaults
        let defaultConfig = {};
        if (selectedProvider === 'gemini') {
            defaultConfig = {
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95
                }
            };
        } else if (selectedProvider === 'openai' || selectedProvider === 'custom') {
            defaultConfig = {
                temperature: 0.7,
                top_p: 1
            };
        } else if (selectedProvider === 'anthropic') {
            defaultConfig = {
                temperature: 0.7,
            };
        }

        setModelConfigForm({
            label: model.displayName,
            type: defaultType,
            jsonConfig: JSON.stringify(defaultConfig, null, 2)
        });
    };

    const handleEditModel = (provider: ProviderType, modelConfig: ModelConfig) => {
        setSelectedProvider(provider);
        setExpandedModelId(modelConfig.value);
        setEditingModelConfigId(modelConfig.id);
        // Remove: setActiveSettingsTab('available_models'); 
        setJsonError(null);

        setModelConfigForm({
            label: modelConfig.label,
            type: modelConfig.type || 'text',
            jsonConfig: JSON.stringify(modelConfig.config || {}, null, 2)
        });
    };

    const handleCancelEdit = () => {
        setEditingModelConfigId(null);
        setExpandedModelId(null);
        setJsonError(null);
    };

    const handleJsonChange = (value: string) => {
        setModelConfigForm(prev => ({ ...prev, jsonConfig: value }));
        try {
            JSON.parse(value);
            setJsonError(null);
        } catch (e: any) {
            setJsonError(e.message);
        }
    };

    const handleSaveModelConfig = (modelId: string) => {
        if (jsonError) return;

        try {
            const parsedConfig = JSON.parse(modelConfigForm.jsonConfig);

            setProviderConfigs(prev => {
                const config = prev[selectedProvider];
                let newModels = [...config.models];

                if (editingModelConfigId) {
                    const existingIndex = newModels.findIndex(m => m.id === editingModelConfigId);
                    if (existingIndex >= 0) {
                        newModels[existingIndex] = {
                            ...newModels[existingIndex],
                            label: modelConfigForm.label || modelId,
                            config: parsedConfig,
                            type: modelConfigForm.type,
                        };
                    }
                } else {
                    const newModelConfig: ModelConfig = {
                        id: uuidv4(),
                        value: modelId,
                        label: modelConfigForm.label || modelId,
                        enabled: true,
                        config: parsedConfig,
                        type: modelConfigForm.type,
                    };
                    newModels.push(newModelConfig);
                }

                localStorage.setItem(`${selectedProvider}_models`, JSON.stringify(newModels));

                return {
                    ...prev,
                    [selectedProvider]: {
                        ...config,
                        models: newModels
                    }
                };
            });
            
            // Close expansion after save
            setExpandedModelId(null);
            setEditingModelConfigId(null);
            
        } catch (e) {
            console.error("Failed to parse JSON config", e);
            setJsonError("Invalid JSON");
        }
    };

    const handleDeleteModel = (provider: ProviderType, modelId: string) => {
        setProviderConfigs(prev => {
            const config = prev[provider];
            const newModels = config.models.filter(m => m.id !== modelId);
            localStorage.setItem(`${provider}_models`, JSON.stringify(newModels));
            return {
                ...prev,
                [provider]: { ...config, models: newModels }
            };
        });
    };

    const handleDragStart = (e: React.DragEvent, provider: ProviderType, index: number) => {
        e.stopPropagation();
        setDraggedModelItem({ provider, index });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ provider, index }));
    };

    const handleModelDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDropModel = (e: React.DragEvent, targetProvider: ProviderType, targetIndex: number) => {
        e.preventDefault();
        e.stopPropagation();

        const data = e.dataTransfer.getData('text/plain');
        let sourceProvider: ProviderType | undefined;
        let sourceIndex: number | undefined;

        if (data) {
            try {
                const parsed = JSON.parse(data);
                sourceProvider = parsed.provider;
                sourceIndex = parsed.index;
            } catch (err) {
                console.error("Failed to parse DnD data", err);
            }
        } else if (draggedModelItem) {
            sourceProvider = draggedModelItem.provider;
            sourceIndex = draggedModelItem.index;
        }

        if (!sourceProvider || sourceIndex === undefined) return;
        if (sourceProvider !== targetProvider) return;
        if (sourceIndex === targetIndex) return;

        setProviderConfigs(prev => {
            const config = prev[sourceProvider!];
            const newModels = [...config.models];
            const [movedItem] = newModels.splice(sourceIndex!, 1);
            newModels.splice(targetIndex, 0, movedItem);

            localStorage.setItem(`${sourceProvider}_models`, JSON.stringify(newModels));

            return {
                ...prev,
                [sourceProvider!]: { ...config, models: newModels }
            };
        });
        setDraggedModelItem(null);
    };

    const handleDragEnd = () => {
        setDraggedModelItem(null);
    };

    const handleManualAddModel = () => {
        if (!manualModelId.trim()) return;

        const newModel: AIModel = {
            id: manualModelId.trim(),
            displayName: manualModelName.trim() || manualModelId.trim(),
            description: 'Manually added model'
        };

        setAvailableModelsListState(prev => {
            if (prev.some(m => m.id === newModel.id)) return prev;
            return [newModel, ...prev];
        });

        // Auto-expand the newly added model
        setExpandedModelId(newModel.id);
        
        // Reset manual inputs
        setManualModelId('');
        setManualModelName('');
    };

    const handleRemoveManualModelFromList = (e: React.MouseEvent, modelId: string) => {
        e.stopPropagation();
        setAvailableModelsListState(prev => prev.filter(m => m.id !== modelId));
        if (expandedModelId === modelId) setExpandedModelId(null);
    };

    // --- Render Helpers ---

    // Unified Glass Panel Style
    const modalClass = isDarkMode
        ? 'bg-gray-900/95 border-gray-700 text-gray-200 backdrop-blur-2xl ring-1 ring-white/5'
        : 'bg-white/95 border-gray-200 text-gray-800 backdrop-blur-2xl ring-1 ring-black/5';

    const renderModelConfigEditor = (modelId: string, isUpdate: boolean = false) => {
        return (
            <div className={`mt-3 p-5 rounded-2xl border flex flex-col gap-5 shadow-sm animate-in slide-in-from-top-2 duration-200 ${isDarkMode ? 'bg-black/20 border-gray-700' : 'bg-gray-50 border-gray-200'}`} onClick={(e) => e.stopPropagation()}>
                {/* Display Name */}
                <div className="group/input">
                    <label className="text-[9px] font-bold uppercase tracking-widest opacity-40 block mb-2 transition-opacity group-focus-within/input:opacity-80">Display Name</label>
                    <input
                        type="text"
                        value={modelConfigForm.label}
                        onChange={(e) => setModelConfigForm({ ...modelConfigForm, label: e.target.value })}
                        placeholder="Enter a friendly label name"
                        className={`w-full px-3 py-2.5 text-xs rounded-xl border-2 transition-all focus:outline-none focus:ring-0 ${isDarkMode ? 'bg-transparent border-gray-600 focus:border-blue-500/50 text-white placeholder-gray-600' : 'bg-white border-gray-200 focus:border-blue-500 placeholder-gray-400'}`}
                    />
                </div>

                {/* RAW JSON Configuration */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest opacity-40">
                            Configuration (JSON)
                        </label>
                        {jsonError && (
                            <span className="text-[9px] text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded">{jsonError}</span>
                        )}
                    </div>
                    <div className={`relative rounded-xl border-2 overflow-hidden transition-colors ${isDarkMode ? 'bg-black/30 border-gray-700 focus-within:border-emerald-500/50' : 'bg-white border-gray-200 focus-within:border-emerald-500'}`}>
                        <textarea
                            value={modelConfigForm.jsonConfig}
                            onChange={(e) => handleJsonChange(e.target.value)}
                            className={`w-full p-3 h-32 text-[10px] font-mono leading-relaxed bg-transparent border-none focus:outline-none custom-scrollbar resize-y ${isDarkMode ? 'text-emerald-400' : 'text-gray-800'}`}
                            placeholder='{ "temperature": 0.7, ... }'
                            spellCheck={false}
                        />
                    </div>
                    <p className="text-[9px] opacity-40 mt-2 leading-relaxed">
                        Advanced users can edit raw parameters like temperature and tools directly.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={handleCancelEdit}
                        className={`flex-1 h-10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${isDarkMode ? 'border-gray-700 hover:bg-white/5 text-gray-400' : 'border-gray-200 hover:bg-black/5 text-gray-500'}`}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => handleSaveModelConfig(modelId)}
                        disabled={!!jsonError}
                        className={`flex-[2] h-10 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2 ${jsonError
                            ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                            : (isDarkMode
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20'
                            )
                            } hover:scale-[1.01] active:scale-[0.99]`}
                    >
                        {isUpdate ? 'Update Configuration' : 'Add to Callable Models'}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className={`absolute bottom-full left-0 mb-4 rounded-3xl border shadow-2xl w-[90vw] min-w-[600px] max-w-[850px] h-[80vh] min-h-[450px] max-h-[650px] flex overflow-hidden origin-bottom-left animate-in zoom-in-95 duration-200 z-50 ${modalClass}`}
        >
            {/* Left Sidebar */}
            <div className={`w-[185px] flex flex-col p-3 border-r flex-shrink-0 ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-gray-200 text-gray-800 backdrop-blur-2xl ring-1 ring-black/5'}`}>
                <div className="text-[10px] font-bold mb-4 px-3 pt-2 opacity-40 uppercase tracking-widest">
                    Settings
                </div>
                <div className="flex flex-col gap-1">
                    <button
                        onClick={() => setActiveSettingsTab('available_models')}
                        className={`text-left px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap overflow-hidden text-ellipsis ${activeSettingsTab === 'available_models' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-md') : (isDarkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-black/5 text-gray-600')}`}
                    >
                        Add New Models
                    </button>
                    <button
                        onClick={() => setActiveSettingsTab('ai_config')}
                        className={`text-left px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap overflow-hidden text-ellipsis ${activeSettingsTab === 'ai_config' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-md') : (isDarkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-black/5 text-gray-600')}`}
                    >
                        Model Management
                    </button>
                    <button
                        onClick={() => setActiveSettingsTab('shortcuts')}
                        className={`text-left px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap overflow-hidden text-ellipsis ${activeSettingsTab === 'shortcuts' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-md') : (isDarkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-black/5 text-gray-600')}`}
                    >
                        Shortcuts
                    </button>
                    <button
                        onClick={() => setActiveSettingsTab('tutorial')}
                        className={`text-left px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap overflow-hidden text-ellipsis ${activeSettingsTab === 'tutorial' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-md') : (isDarkMode ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-black/5 text-gray-600')}`}
                    >
                        Quick Start
                    </button>
                </div>

                {/* Bottom Left: Dark Mode Toggle */}
                <div className="mt-auto pt-3 border-t border-dashed border-gray-500/20">
                    <button
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className={`w-full flex items-center gap-3 px-2 py-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-white/5 text-gray-400 hover:text-gray-200' : 'hover:bg-black/5 text-gray-500 hover:text-gray-800'}`}
                    >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shadow-sm ${isDarkMode ? 'bg-gray-800 text-blue-400' : 'bg-white text-amber-500 border border-gray-200'}`}>
                            {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Appearance</span>
                            <span className="text-[9px] opacity-60">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Right Content Area */}
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar relative">

                {/* Tutorial Tab */}
                {activeSettingsTab === 'tutorial' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold">User Guide</h3>
                                <p className="text-[11px] opacity-50">Learn the core features of Gemini Infinite Canvas.</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2 space-y-4">
                            <TutorialCard
                                icon={<ArrowRight className="w-4 h-4" />}
                                title="1. Basic Controls"
                                isDarkMode={isDarkMode}
                                content={
                                    <ul className="list-disc pl-4 space-y-1">
                                        <li><strong>Right Click</strong> on the canvas to add new Text or Image blocks.</li>
                                        <li><strong>Drag</strong> blocks to organize your workspace.</li>
                                        <li><strong>Scroll</strong> to zoom in and out.</li>
                                        <li><strong>Ctrl + Drag</strong> to select multiple blocks at once.</li>
                                    </ul>
                                }
                            />

                            <TutorialCard
                                icon={<ArrowRight className="w-4 h-4" />}
                                title="2. Smart Connections"
                                isDarkMode={isDarkMode}
                                content={
                                    <div className="space-y-3">
                                        <p>Connections define the flow of context from one AI block to another.</p>

                                        <div className={`p-3 rounded-lg border flex items-center justify-center gap-4 ${isDarkMode ? 'bg-black/30 border-gray-700' : 'bg-gray-100 border-gray-300'}`}>
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-8 h-8 rounded border-2 border-dashed flex items-center justify-center text-[10px] font-mono opacity-50">Src</div>
                                                <span className="text-[9px] uppercase font-bold text-blue-400">Right (Out)</span>
                                            </div>
                                            <ArrowRight className="w-4 h-4 opacity-50" />
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-8 h-8 rounded border-2 border-dashed flex items-center justify-center text-[10px] font-mono opacity-50">Dst</div>
                                                <span className="text-[9px] uppercase font-bold text-blue-400">Left (In)</span>
                                            </div>
                                        </div>

                                        <ul className="list-disc pl-4 space-y-1">
                                            <li><strong>Inputs:</strong> Located on the LEFT side of a block.</li>
                                            <li><strong>Outputs:</strong> Located on the RIGHT side of a block.</li>
                                        </ul>

                                        <div className={`mt-2 p-2 rounded border-l-2 text-[10px] ${isDarkMode ? 'bg-blue-900/20 border-blue-500 text-blue-200' : 'bg-blue-50 border-blue-500 text-blue-800'}`}>
                                            <strong>Dynamic Ports:</strong> When you use a connection point, a new one automatically appears below it. This allows you to branch one block into many, or merge many blocks into one.
                                        </div>
                                    </div>
                                }
                            />

                            <TutorialCard
                                icon={<ArrowRight className="w-4 h-4" />}
                                title="3. Executing AI"
                                isDarkMode={isDarkMode}
                                content={
                                    <ul className="list-disc pl-4 space-y-1">
                                        <li>Click the <strong>Play Button</strong> on a block to generate content.</li>
                                        <li>The block will read all text/images from connected <strong>Input (Left)</strong> blocks as context.</li>
                                        <li>You can chain multiple blocks to create complex workflows (e.g., Translate -&gt; Summarize -&gt; Extract Keywords).</li>
                                    </ul>
                                }
                            />

                            <TutorialCard
                                icon={<ArrowRight className="w-4 h-4" />}
                                title="4. Context Management"
                                isDarkMode={isDarkMode}
                                content={
                                    <ul className="list-disc pl-4 space-y-1">
                                        <li>Right-click a generated block and select <strong>Show Prompt Context</strong> to see exactly what data was sent to Gemini.</li>
                                        <li>Use <strong>Merge Mode</strong> (via Context Menu) to combine multiple blocks into a single text block.</li>
                                    </ul>
                                }
                            />
                        </div>
                    </div>
                )}

                {/* AI Config Tab (Configured Models Only) */}
                {activeSettingsTab === 'ai_config' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold">Configured Models</h3>
                                <p className="text-[11px] opacity-50">Models available in your workspace.</p>
                            </div>
                        </div>

                        {/* Callable Models List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2">
                            {providerConfigs.gemini.models.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 opacity-30 text-center border-2 border-dashed border-gray-500 rounded-2xl">
                                    <p className="text-xs font-medium">No models configured</p>
                                    <p className="text-[10px] mt-1">Go to "Add New Models" to get started.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {Object.entries(providerConfigs).map(([provider, config]) =>
                                        (config as ProviderConfig).models.map((model, index) => (
                                            <React.Fragment key={model.id}>
                                                <ModelListItem
                                                    provider={provider}
                                                    model={model}
                                                    index={index}
                                                    isDarkMode={isDarkMode}
                                                    draggedModelItem={draggedModelItem}
                                                    handleDragStart={handleDragStart}
                                                    handleModelDragOver={handleModelDragOver}
                                                    handleDropModel={handleDropModel}
                                                    handleDragEnd={handleDragEnd}
                                                    handleDeleteModel={handleDeleteModel}
                                                    onEdit={() => handleEditModel(provider as ProviderType, model)}
                                                />
                                                {editingModelConfigId === model.id && (
                                                    <div className="mb-4">
                                                        {renderModelConfigEditor(model.id, true)}
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Available Models Tab (API Key + Fetch) */}
                {activeSettingsTab === 'available_models' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold">Discover AI Models</h3>
                                <p className="text-[11px] opacity-50">Fetch and enable models from your preferred provider.</p>
                            </div>

                            {/* Provider Toggle */}
                            <div className={`flex p-1 rounded-xl border ${isDarkMode ? 'bg-black/40 border-white/10' : 'bg-gray-100 border-gray-200'}`}>
                                <button
                                    onClick={() => { setSelectedProvider('openai'); setAvailableModelsListState([]); }}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${selectedProvider === 'openai' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')}`}
                                >
                                    OpenAI Format
                                </button>
                                <button
                                    onClick={() => { setSelectedProvider('gemini'); setAvailableModelsListState([]); }}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${selectedProvider === 'gemini' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')}`}
                                >
                                    Gemini
                                </button>
                                <button
                                    onClick={() => { setSelectedProvider('anthropic'); setAvailableModelsListState([]); }}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${selectedProvider === 'anthropic' ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white text-blue-600 shadow-sm') : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700')}`}
                                >
                                    Anthropic
                                </button>
                            </div>
                        </div>

                        {/* API Key & Base URL Input Section */}
                        <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <div className="flex flex-col gap-4">
                                <div>
                                    <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2">
                                        {selectedProvider === 'openai' ? 'OpenAI / Generic API Key' : selectedProvider === 'gemini' ? 'Google Gemini API Key' : 'Anthropic API Key'}
                                    </h4>
                                    <div className="relative group">
                                        <input
                                            type="password"
                                            value={providerConfigs[selectedProvider].key}
                                            onChange={(e) => {
                                                const newKey = e.target.value;
                                                setProviderConfigs(prev => ({
                                                    ...prev,
                                                    [selectedProvider]: { ...prev[selectedProvider], key: newKey, isValid: !!newKey }
                                                }));
                                                localStorage.setItem(`${selectedProvider}_api_key`, newKey);
                                            }}
                                            placeholder="Paste your API Key here..."
                                            className={`w-full py-2.5 px-3 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode ? 'bg-gray-800 border-gray-600 focus:border-blue-500/50 text-white' : 'bg-white border-gray-300 focus:border-blue-500 text-gray-800'}`}
                                        />
                                    </div>
                                </div>

                                {selectedProvider === 'openai' && (
                                    <div>
                                        <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2">
                                            Base URL
                                        </h4>
                                        <input
                                            type="text"
                                            value={providerConfigs['openai'].baseUrl}
                                            onChange={(e) => {
                                                const url = e.target.value;
                                                setProviderConfigs(prev => ({
                                                    ...prev,
                                                    openai: { ...prev.openai, baseUrl: url }
                                                }));
                                                localStorage.setItem(`openai_base_url`, url);
                                            }}
                                            placeholder="https://api.openai.com/v1"
                                            className={`w-full py-2 px-3 text-xs rounded-xl border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode ? 'bg-gray-800 border-gray-600 focus:border-blue-500/50 text-white' : 'bg-white border-gray-300 focus:border-blue-500 text-gray-800'}`}
                                        />
                                        <p className="text-[9px] mt-1 opacity-40">Use https://openrouter.ai/api/v1 for OpenRouter.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Controls & Search */}
                        <div className="flex flex-col gap-3 flex-shrink-0">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search models..."
                                        className={`w-full py-2 px-3 text-xs rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${isDarkMode ? 'bg-black/20 border-gray-700 focus:border-blue-500/50 placeholder-gray-600' : 'bg-gray-50 border-gray-200 focus:border-blue-500 placeholder-gray-400'}`}
                                    />
                                </div>
                                <button
                                    onClick={fetchAvailableModels}
                                    disabled={loadingAvailableModels || (!providerConfigs[selectedProvider].key && selectedProvider !== 'anthropic')}
                                    className={`px-4 py-2 rounded-lg border flex items-center gap-2 transition-all ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-200' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'} disabled:opacity-50`}
                                    title="Fetch Models"
                                >
                                    {loadingAvailableModels && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    <span className="text-xs font-bold">{selectedProvider === 'anthropic' ? 'Discover Models' : 'Fetch Model List'}</span>
                                </button>
                            </div>

                            {/* Manual Model Add Section */}
                            <div className={`p-3 rounded-xl border-2 border-dashed flex flex-col gap-3 ${isDarkMode ? 'bg-black/20 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-center justify-between">
                                    <h4 className="text-[9px] font-bold uppercase tracking-widest opacity-40 mb-2">Add Model Manually</h4>
                                    <span className="text-[8px] opacity-30 italic">Useful for non-listable models</span>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={manualModelId}
                                        onChange={(e) => setManualModelId(e.target.value)}
                                        placeholder="Model ID (e.g. gpt-4o)"
                                        className={`flex-[2] py-1.5 px-3 text-[10px] rounded-lg border transition-all focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-800'}`}
                                    />
                                    <input
                                        type="text"
                                        value={manualModelName}
                                        onChange={(e) => setManualModelName(e.target.value)}
                                        placeholder="Display Name"
                                        className={`flex-[1.5] py-1.5 px-3 text-[10px] rounded-lg border transition-all focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-800'}`}
                                    />
                                    <button
                                        onClick={handleManualAddModel}
                                        disabled={!manualModelId.trim()}
                                        className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold transition-all ${isDarkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-500 hover:bg-blue-400 text-white'} disabled:opacity-50`}
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Results List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2 space-y-3">
                            {loadingAvailableModels && availableModelsListState.length === 0 ? (
                                <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin opacity-50" /></div>
                            ) : availableModelsError ? (
                                <div className="p-4 rounded-xl bg-red-500/10 text-red-500 text-xs border border-red-500/20">
                                    {availableModelsError}
                                </div>
                            ) : availableModelsListState.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 opacity-50 text-center">
                                    <p className="text-xs">Enter API Key and click fetch list.</p>
                                </div>
                            ) : filteredModels.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-32 opacity-50 text-center">
                                    <p className="text-xs">No matching models found.</p>
                                </div>
                            ) : (
                                filteredModels.map(model => (
                                    <div
                                        key={model.id}
                                        onClick={() => handleExpandModel(model)}
                                        className={`p-4 rounded-xl border flex flex-col gap-2 transition-all cursor-pointer ${isDarkMode ? 'bg-gray-800/40 border-gray-700 hover:bg-gray-800' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm'} ${expandedModelId === model.id ? 'ring-1 ring-blue-500/50' : ''}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 pointer-events-none">
                                                <span className="text-xs font-bold">{model.displayName}</span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isDarkMode ? 'bg-white/10' : 'bg-black/5'}`}>{model.id}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {providerConfigs[selectedProvider].models.some(m => m.value === model.id) && (
                                                    <div className="text-[9px] text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider pointer-events-none">
                                                        Enabled
                                                    </div>
                                                )}
                                                {model.description === 'Manually added model' && (
                                                    <button
                                                        onClick={(e) => handleRemoveManualModelFromList(e, model.id)}
                                                        className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors"
                                                        title="Remove from list"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {model.description && (
                                            <p className="text-[10px] opacity-60 leading-relaxed pointer-events-none">{model.description}</p>
                                        )}

                                        {expandedModelId === model.id && (
                                            renderModelConfigEditor(model.id, !!editingModelConfigId)
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* Shortcuts Tab */}
                {activeSettingsTab === 'shortcuts' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 h-full flex flex-col">
                        <div className="flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold">Shortcuts</h3>
                                <p className="text-[11px] opacity-50">Boost your productivity with keyboard and mouse interactions.</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2 space-y-6">

                            {/* Section: General */}
                            <div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-3 pl-1">General</h4>
                                <ShortcutItem keys={['Ctrl', 'Z']} description="Undo" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Ctrl', 'Y']} description="Redo" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Esc']} description="Close / Deselect" isDarkMode={isDarkMode} />
                            </div>

                            {/* Section: Manipulation */}
                            <div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-3 pl-1">Editing</h4>
                                <ShortcutItem keys={['Del', 'Backspace']} description="Delete Selection" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Ctrl', 'Drag']} description="Box Selection" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Right Click']} description="Context Menu" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Ctrl', 'C']} description="Copy Text" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Ctrl', 'V']} description="Paste (Image/Text)" isDarkMode={isDarkMode} />
                            </div>

                            {/* Section: Navigation */}
                            <div>
                                <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-3 pl-1">Navigation</h4>
                                <ShortcutItem keys={['Wheel']} description="Zoom Canvas" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Drag']} description="Pan Canvas" isDarkMode={isDarkMode} />
                                <ShortcutItem keys={['Ctrl', 'Scroll']} description="Zoom Canvas" isDarkMode={isDarkMode} />
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};
