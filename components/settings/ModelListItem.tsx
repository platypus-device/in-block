
import React from 'react';
import { ModelConfig, ProviderType } from '../../types';

interface ModelListItemProps {
    provider: string;
    model: ModelConfig;
    index: number;
    isDarkMode: boolean;
    draggedModelItem: { provider: ProviderType, index: number } | null;
    handleDragStart: (e: React.DragEvent, provider: ProviderType, index: number) => void;
    handleModelDragOver: (e: React.DragEvent) => void;
    handleDropModel: (e: React.DragEvent, targetProvider: ProviderType, targetIndex: number) => void;
    handleDragEnd: () => void;
    handleDeleteModel: (provider: ProviderType, modelValue: string) => void;
}

export const ModelListItem: React.FC<ModelListItemProps> = ({
    provider,
    model,
    index,
    isDarkMode,
    draggedModelItem,
    handleDragStart,
    handleModelDragOver,
    handleDropModel,
    handleDragEnd,
    handleDeleteModel
}) => {
    // Helper to extract nice preview info from config
    const temp = model.config?.temperature;

    return (
        <div
            draggable
            onDragStart={(e) => handleDragStart(e, provider as ProviderType, index)}
            onDragOver={handleModelDragOver}
            onDrop={(e) => handleDropModel(e, provider as ProviderType, index)}
            onDragEnd={handleDragEnd}
            className={`p-3.5 rounded-xl border flex items-center justify-between group transition-all overflow-hidden relative cursor-move ${draggedModelItem?.provider === provider && draggedModelItem?.index === index
                ? 'opacity-40 border-dashed border-blue-500/50'
                : (isDarkMode ? 'bg-gray-800/40 border-gray-700 hover:bg-gray-800 hover:border-gray-600' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm')
                }`}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <div className="text-xs font-bold truncate">{model.label}</div>
                        {model.label !== model.value && (
                            <span className="text-[10px] opacity-40 font-mono truncate max-w-[150px]">{model.value}</span>
                        )}
                    </div>
                    <div className="text-[9px] opacity-50 font-mono flex items-center gap-2">
                        {model.type === 'image' ? (
                            <span>Configurable</span>
                        ) : (
                            <span>Temp: {temp !== undefined ? temp : 'Default'}</span>
                        )}
                    </div>
                </div>
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteModel(provider as ProviderType, model.value);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="px-2.5 py-1.5 text-[9px] font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer uppercase tracking-wide opacity-60 group-hover:opacity-100"
            >
                Delete
            </button>
        </div>
    );
};
