import React, { useRef, useEffect, useState, useMemo } from 'react';
import { NodeData, ContentPart } from '../types';
import { X, Loader2, Play, Image as ImageIcon, Maximize2, Eraser, ChevronUp, ChevronDown, Power, Trash2 } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { saveImage } from '../services/imageDb';
import { v4 as uuidv4 } from 'uuid';

interface NodeItemProps {
    node: NodeData;
    isSelected: boolean;
    isConnectable?: boolean;
    hasOutgoingConnection?: boolean;
    connectedPortIds?: Set<string>;
    highlightedPortIds?: Set<string>; // New prop for upstream highlights
    mergeIndex?: number;
    isDarkMode: boolean;
    isDragging?: boolean;
    availableModels?: { value: string; label: string; category?: string }[];
    activeDragHandleId?: string;
    onUpdate: (id: string, content: string) => void;
    onUpdateModel?: (id: string, model: string) => void;
    onUpdateConfig?: (id: string, config: Partial<NodeData>) => void;
    onDelete: (id: string) => void;
    onGenerate: (id: string) => void;
    onCancelGenerate?: (id: string) => void;
    onClear: (id: string) => void;
    onMouseDown: (e: React.MouseEvent, id: string) => void;
    onMouseLeave?: (id: string) => void;
    onConnectStart: (e: React.MouseEvent, id: string, handleId: string, type: 'source' | 'target', color: string) => void;
    onConnectEnd: (e: React.MouseEvent, id: string, handleId?: string) => void;
    onContextMenu: (e: React.MouseEvent, id: string) => void;
    onStartEdit?: () => void;
    onViewImage?: (url: string) => void;
    onToggleActive: (id: string) => void;
}

export const NodeItem: React.FC<NodeItemProps> = React.memo(({
    node,
    isSelected,
    isConnectable,
    hasOutgoingConnection,
    connectedPortIds,
    highlightedPortIds,
    mergeIndex,
    isDarkMode,
    isDragging,
    availableModels = [],
    activeDragHandleId,
    onUpdate,
    onUpdateModel,
    onUpdateConfig,
    onDelete,
    onGenerate,
    onCancelGenerate,
    onClear,
    onMouseDown,
    onMouseLeave,
    onConnectStart,
    onConnectEnd,
    onContextMenu,
    onStartEdit,
    onViewImage,
    onToggleActive
}) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    const contentWrapperRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const lastHeight = useRef<number>(node.height || 0);

    const [isFocused, setIsFocused] = useState(false);
    const [hoveredZoneIndex, setHoveredZoneIndex] = useState<number | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [draggedPartIndex, setDraggedPartIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Local state to control UI
    const [isResizing, setIsResizing] = useState(false);
    const manuallyResizedRef = useRef(false);

    // Auto-resize logic
    useEffect(() => {
        if (contentWrapperRef.current && !isResizing) {
            const wrapper = contentWrapperRef.current;
            
            const rafId = requestAnimationFrame(() => {
                const scrollTop = wrapper.scrollTop;
                // Ensure all textareas fit their content
                const textareas = wrapper.querySelectorAll('textarea');
                textareas.forEach(ta => {
                    const offset = ta.offsetHeight - ta.clientHeight;
                    ta.style.height = 'auto';
                    const newHeight = ta.scrollHeight + offset;
                    ta.style.height = newHeight + 'px';
                });
                wrapper.scrollTop = scrollTop;

                // Only update the overall block height if it hasn't been manually resized
                if (!manuallyResizedRef.current) {
                    const totalHeight = wrapper.scrollHeight;
                    const overhead = 120; // Header + Footer
                    const targetHeight = totalHeight + overhead;

                    const minH = node.ports && node.ports.length > 0 ? (50 + node.ports.length * 28 + 20) : 150;
                    const maxH = 550;
                    const finalHeight = Math.min(Math.max(targetHeight, minH), maxH);

                    if (Math.abs(finalHeight - node.height) > 2) {
                        onUpdateConfig && onUpdateConfig(node.id, { height: finalHeight });
                    }
                }
            });
            return () => cancelAnimationFrame(rafId);
        }
    }, [node.parts, node.content, node.type, isResizing, node.height, node.width, node.collapsed, onUpdateConfig]);

    // Helper to get parts for rendering (Migration on the fly)
    const displayParts = useMemo<ContentPart[]>(() => {
        let parts: ContentPart[] = [];
        if (node.parts && node.parts.length > 0) {
            parts = [...node.parts];
        } else {
            // Legacy fallback
            if (node.content) {
                parts.push({ id: 'legacy-text', type: 'text', content: node.content });
            }
            if (node.imageId) {
                parts.push({ id: 'legacy-image', type: 'image', content: '', imageId: node.imageId });
            }
        }

        if (parts.length === 0) {
            parts.push({ id: 'empty', type: 'text', content: '' });
        } else {
            // Ensure trailing text part for user input
            const lastPart = parts[parts.length - 1];
            if (lastPart.type !== 'text' || (lastPart.type === 'text' && lastPart.content && lastPart.content.trim().length > 0)) {
                parts.push({ id: 'virtual-trailing-text', type: 'text', content: '' });
            }
        }
        return parts;
    }, [node.parts, node.content, node.imageId]);

    // Helper to resolve image URL
    const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
    const objectUrlsRef = useRef<Record<string, string>>({});
    
    useEffect(() => {
        const loadImages = async () => {
             const newUrls: Record<string, string> = {};
             let hasUpdates = false;
             
             // 1. Identify which imageIds we need but don't have URLs for
             const neededImageIds = new Set<string>(
                 displayParts
                    .filter(p => p.type === 'image' && p.imageId)
                    .map(p => p.imageId!)
             );

             // 2. Load missing images
             for (const imageId of neededImageIds) {
                 if (!objectUrlsRef.current[imageId]) {
                     const mod = await import('../services/imageDb');
                     const blob = await mod.getImageBlob(imageId);
                     if (blob) {
                         const url = URL.createObjectURL(blob);
                         objectUrlsRef.current[imageId] = url;
                         newUrls[imageId] = url;
                         hasUpdates = true;
                     }
                 }
             }

             // 3. Clean up URLs that are no longer needed
             const currentIds = Object.keys(objectUrlsRef.current);
             for (const id of currentIds) {
                 if (!neededImageIds.has(id)) {
                     URL.revokeObjectURL(objectUrlsRef.current[id]);
                     delete objectUrlsRef.current[id];
                     hasUpdates = true;
                 }
             }

             if (hasUpdates) {
                 setImageUrls({ ...objectUrlsRef.current });
             }
        };

        loadImages();

        return () => {
            // Cleanup all on unmount
            Object.values(objectUrlsRef.current).forEach(url => {
                if (typeof url === 'string') URL.revokeObjectURL(url);
            });
            objectUrlsRef.current = {};
        };
    }, [displayParts]);

    // Revoke transient preview URLs when parts change or on unmount to avoid leaking object URLs
    useEffect(() => {
        const prevPreviewUrls = displayParts
            .map((p: any) => p.__previewUrl as string)
            .filter(Boolean);
        return () => {
            for (const pv of prevPreviewUrls) {
                try { URL.revokeObjectURL(pv); } catch (e) { /* ignore */ }
            }
        };
    }, [displayParts]);

    // Reset manual resize lock if content is totally cleared
    useEffect(() => {
        if (!node.content) manuallyResizedRef.current = false;
    }, [node.content]);

    // Reset hovered zone when drag ends
    useEffect(() => {
        if (!isConnectable) {
            setHoveredZoneIndex(null);
        }
    }, [isConnectable]);

    // Helper to consolidate adjacent text parts
    const consolidateTextParts = (parts: ContentPart[]): ContentPart[] => {
        if (parts.length <= 1) return parts;
        
        const consolidated: ContentPart[] = [];
        parts.forEach(part => {
            const last = consolidated[consolidated.length - 1];
            if (last && last.type === 'text' && part.type === 'text') {
                // Merge text
                const separator = (last.content.trim() && part.content.trim()) ? '\n\n' : '';
                last.content = last.content + separator + part.content;
            } else {
                consolidated.push({ ...part });
            }
        });
        return consolidated;
    };

    // --- Intra-block Reordering Logic ---

    const handlePartDragStart = (e: React.DragEvent, index: number) => {
        e.stopPropagation();
        setDraggedPartIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Set some data to make it work in all browsers
        e.dataTransfer.setData('text/plain', `part-${index}`);
    };

    const handlePartDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (draggedPartIndex !== null && draggedPartIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handlePartDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverIndex(null);

        if (draggedPartIndex === null || draggedPartIndex === targetIndex) {
            setDraggedPartIndex(null);
            return;
        }

        const newParts = [...displayParts]
            .filter(p => p.id !== 'virtual-trailing-text' && p.id !== 'empty');
        
        // Only reorder if indices are valid for non-virtual parts
        if (draggedPartIndex < newParts.length && targetIndex < newParts.length) {
            const [movedItem] = newParts.splice(draggedPartIndex, 1);
            newParts.splice(targetIndex, 0, movedItem);

            // Reorder without merging
            const fullText = newParts.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
            onUpdateConfig && onUpdateConfig(node.id, { 
                parts: newParts,
                content: fullText
            });
        }
        
        setDraggedPartIndex(null);
    };

    const handlePartDragEnd = () => {
        setDraggedPartIndex(null);
        setDragOverIndex(null);
    };

    // Load image from IndexedDB when imageId changes
    useEffect(() => {
        // No-op for main image logic, handled by displayParts loader now
    }, []);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (onStartEdit) onStartEdit();
            const reader = new FileReader();
            reader.onload = async (event) => {
                if (event.target?.result) {
                    const base64String = event.target.result as string;
                    const imageId = uuidv4();
                    const mimeType = file.type || 'image/jpeg';
                    
                    // Save image to IndexedDB
                    try {
                        await saveImage(imageId, base64String, mimeType);
                        
                        const partIndex = (nodeRef.current as any)._uploadingPartIndex;
                        if (partIndex !== undefined) {
                            const newParts = [...displayParts];
                            // Replace or update the specific part
                            newParts[partIndex] = {
                                ...newParts[partIndex],
                                id: uuidv4(),
                                type: 'image',
                                imageId,
                                mimeType
                            };

                            // Ensure trailing text part if this was the last part
                            if (partIndex === newParts.length - 1) {
                                newParts.push({ id: uuidv4(), type: 'text', content: '' });
                            }

                            const filtered = newParts.filter(p => p.id !== 'virtual-trailing-text' && p.id !== 'empty');
                            const fullText = filtered.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                            onUpdateConfig && onUpdateConfig(node.id, { 
                                parts: filtered,
                                content: fullText
                            });
                            delete (nodeRef.current as any)._uploadingPartIndex;
                        } else {
                            // Append to end if no specific part index (general upload/paste)
                            const currentParts = [...displayParts].filter(p => {
                                // Only remove virtual/empty parts if they are truly empty
                                if (p.id === 'virtual-trailing-text' || p.id === 'empty') {
                                    return p.content && p.content.trim().length > 0;
                                }
                                return true;
                            });
                            
                            currentParts.push({
                                id: uuidv4(),
                                type: 'image',
                                imageId,
                                mimeType
                            });
                            
                            const consolidated = consolidateTextParts(currentParts);
                            const fullText = consolidated.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                            onUpdateConfig && onUpdateConfig(node.id, { 
                                parts: consolidated,
                                content: fullText
                            });
                        }
                    } catch (error) {
                        console.error('Failed to save image:', error);
                    }
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                e.stopPropagation();
                if (onStartEdit) onStartEdit();
                const blob = item.getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = async (evt) => {
                        if (evt.target?.result) {
                            const base64String = evt.target.result as string;
                            const imageId = uuidv4();
                            const mimeType = blob.type || 'image/jpeg';
                            
                            try {
                                await saveImage(imageId, base64String, mimeType);
                                
                                // Append image part to end
                                const newParts = [...displayParts]
                                    .filter(p => {
                                        // Only remove virtual/empty parts if they are truly empty
                                        if (p.id === 'virtual-trailing-text' || p.id === 'empty') {
                                            return p.content && p.content.trim().length > 0;
                                        }
                                        return true;
                                    });
                                
                                newParts.push({
                                    id: uuidv4(),
                                    type: 'image',
                                    content: '',
                                    imageId: imageId,
                                    mimeType: mimeType
                                });
                                
                                // Always add a text part after image for further input
                                newParts.push({
                                    id: uuidv4(),
                                    type: 'text',
                                    content: ''
                                });

                                const consolidated = consolidateTextParts(newParts);
                                const fullText = consolidated.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                                
                                onUpdateConfig && onUpdateConfig(node.id, { 
                                    parts: consolidated,
                                    content: fullText
                                });
                            } catch (error) {
                                console.error('Failed to save pasted image:', error);
                            }
                        }
                    };
                    reader.readAsDataURL(blob);
                }
                break;
            }
        }
    };

    const handleTogglePartCollapse = (index: number) => {
        const part = displayParts[index];
        if (part.id === 'empty' || part.id === 'virtual-trailing-text') return;
        
        const updatedParts = displayParts.map((p, i) => i === index ? { ...p, collapsed: !p.collapsed } : p);
        const realParts = updatedParts.filter(p => p.id !== 'virtual-trailing-text' && p.id !== 'empty');
        
        onUpdateConfig && onUpdateConfig(node.id, { parts: realParts });
    };

    const handleToggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onUpdateConfig) {
            onUpdateConfig(node.id, { collapsed: !node.collapsed });
        }
    };

    const isActive = isSelected || isFocused;
    const isMergeSelected = mergeIndex !== undefined && mergeIndex >= 0;
    const isAI = node.source === 'ai';
    const isInactive = node.isInactive;

    const mainImageUrl = node.imageId ? imageUrls[node.imageId] : node.content;

    // --- Styling Logic ---

    let nodeBgClass = '';
    if (isAI) {
        nodeBgClass = isDarkMode
            ? 'bg-gray-800/80 backdrop-blur-xl'
            : 'bg-white/95 backdrop-blur-xl';
    } else {
        nodeBgClass = isDarkMode ? 'bg-gray-900/70 backdrop-blur-xl' : 'bg-white/80 backdrop-blur-xl';
    }

    if (isInactive) {
        nodeBgClass = isDarkMode ? 'bg-black/10 backdrop-blur-sm' : 'bg-gray-100/40 backdrop-blur-sm';
    }

    let borderClass = '';
    if (isMergeSelected) {
        borderClass = 'border-2 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)] scale-[1.02] z-50';
    } else if (isActive) {
        borderClass = 'border border-blue-500/80 shadow-[0_0_20px_rgba(59,130,246,0.25)] z-50';
    } else if (isConnectable) {
        borderClass = 'border border-gray-400/50 shadow-lg z-20';
    } else if (isInactive) {
        // FIX: Changed from border-2 to border (1px) to prevent size jumping when selecting (since active is 1px)
        borderClass = `border border-dashed opacity-60 z-0 ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`;
    } else if (isAI) {
        borderClass = isDarkMode
            ? 'border border-indigo-500/20 shadow-lg shadow-black/20 hover:border-indigo-400/30 z-10'
            : 'border border-indigo-200 shadow-xl shadow-indigo-100/50 hover:border-indigo-300 z-10';
    } else {
        borderClass = isDarkMode
            ? 'border border-white/10 shadow-xl shadow-black/20 hover:border-white/20 z-10'
            : 'border border-gray-200 shadow-xl shadow-gray-200/50 hover:border-gray-300 z-10';
    }

    const containerClass = isInactive ? 'grayscale opacity-60 hover:opacity-100 transition-opacity' : '';

    let textColor = isDarkMode ? 'text-gray-200' : 'text-gray-800';
    const placeholderColor = isDarkMode ? 'placeholder-gray-600' : 'placeholder-gray-400';

    let headerTextColor = isDarkMode ? 'text-gray-400' : 'text-gray-500';

    let runButtonClass = '';
    if (node.isGenerating) {
        runButtonClass = isDarkMode
            ? 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/30 hover:bg-red-500/20 hover:text-red-400 hover:ring-red-500/40 transition-all duration-300'
            : 'bg-blue-50 text-blue-500 ring-1 ring-blue-200 hover:bg-red-50 hover:text-red-500 hover:ring-red-200 transition-all duration-300';
    } else if (isInactive) {
        runButtonClass = 'bg-transparent border border-current opacity-30 cursor-not-allowed';
    } else if (hasOutgoingConnection) {
        runButtonClass = isDarkMode
            ? 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'
            : 'bg-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-200';
    } else {
        runButtonClass = 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30 hover:scale-110 active:scale-95';
    }

    let headerDotColor = 'bg-blue-500';
    let headerText = 'Text Block';

    if (node.isInactive) {
        headerDotColor = 'bg-transparent border border-current';
        headerText = 'Deactivated';
    } else if (isAI) {
        headerDotColor = 'bg-indigo-500';
        headerText = 'AI Block';
    } else {
        headerDotColor = 'bg-blue-500';
        headerText = 'Block';
    }

    const transitionClass = (isDragging || isResizing)
        ? 'transition-[box-shadow,border-color,transform,background-color] duration-150'
        : 'transition-[left,top,box-shadow,border-color,transform,background-color] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]';

    const handleResizeStart = (e: React.MouseEvent, direction: 'e' | 's' | 'se') => {
        e.stopPropagation();
        e.preventDefault();
        setIsResizing(true);
        manuallyResizedRef.current = true;

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = node.width;
        const startHeight = nodeRef.current?.offsetHeight || (node.height || 150);

        const onMouseMove = (moveEvent: MouseEvent) => {
            const dx = (moveEvent.clientX - startX);
            const dy = (moveEvent.clientY - startY);

            const updates: Partial<NodeData> = {};
            if (direction.includes('e')) updates.width = Math.max(250, startWidth + dx);
            if (direction.includes('s')) updates.height = Math.max(100, startHeight + dy);

            if (onUpdateConfig) {
                onUpdateConfig(node.id, updates);
            }
        };

        const onMouseUp = () => {
            setIsResizing(false);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const settingsBg = isDarkMode ? 'bg-black/40' : 'bg-gray-50/90';

    // Get current model label
    const currentModelLabel = useMemo(() => {
        const m = availableModels.find(opt => opt.value === node.model);
        return m ? m.label : (node.model || 'Select Model');
    }, [node.model, availableModels]);

    // Extract first line of content for collapsed view
    const firstLineContent = useMemo(() => {
        if (!node.content && displayParts.some(p => p.type === 'image')) return 'Image Block';
        if (!node.content) return 'Empty Block';
        const lines = node.content.split('\n');
        const firstLine = lines[0].trim();
        return firstLine.length > 30 ? firstLine.substring(0, 30) + '...' : firstLine;
    }, [node.content, displayParts]);

    // Visibility logic for footer controls (hide on parent unless hovered or generating)
    const footerVisibilityClass = (hasOutgoingConnection && !node.isGenerating)
        ? 'opacity-0 group-hover:opacity-100 transition-opacity duration-200'
        : '';

    return (
        <div
            ref={nodeRef}
            className={`absolute flex flex-col rounded-2xl node-item select-none cursor-grab active:cursor-grabbing group transform-gpu backface-hidden ${transitionClass} ${borderClass} ${nodeBgClass} ${containerClass}`}
            style={{
                left: node.position.x,
                top: node.position.y,
                width: node.collapsed ? 220 : node.width,
                height: node.collapsed ? 'auto' : node.height,
                // Min height handling based on ports to ensure they are always visible
                minHeight: node.collapsed 
                    ? Math.max(70, (node.ports?.length || 0) * 28 + 45)
                    : (node.ports && node.ports.length > 0 ? (50 + node.ports.length * 28 + 20) : 100)
            }}
            onMouseEnter={() => setIsHovered(true)}
            onWheel={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
                e.stopPropagation();
                onMouseDown(e, node.id);
            }}
            onMouseUp={(e) => onConnectEnd(e, node.id)}
            onMouseLeave={() => {
                setHoveredZoneIndex(null);
                setIsHovered(false);
                if (onMouseLeave) onMouseLeave(node.id);
            }}
            onContextMenu={(e) => onContextMenu(e, node.id)}
        >
            {/* --- Connection Drop Zones (Overlay) --- */}
            {isConnectable && !isInactive && (
                <div className="absolute inset-0 z-30 flex flex-col rounded-2xl overflow-hidden pointer-events-auto">
                    {node.ports.map((portId, index) => (
                        <div
                            key={`zone-${portId}`}
                            className={`flex-1 transition-all duration-200 px-2 flex items-center justify-between ${hoveredZoneIndex === index
                                ? 'bg-blue-500/10 backdrop-blur-[1px]'
                                : 'bg-transparent'
                                }`}
                            onMouseEnter={() => setHoveredZoneIndex(index)}
                            onMouseLeave={() => setHoveredZoneIndex(null)}
                            onMouseUp={(e) => {
                                e.stopPropagation();
                                onConnectEnd(e, node.id, portId);
                            }}
                        >
                        </div>
                    ))}
                </div>
            )}

            {/* --- Merge Mode Badge --- */}
            {isMergeSelected && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden rounded-2xl">
                    <span className="text-[8rem] font-black text-emerald-500/10 leading-none select-none animate-in zoom-in duration-300">
                        {mergeIndex + 1}
                    </span>
                </div>
            )}

            {/* --- Header --- */}
            <div
                className={`flex items-center justify-between px-4 ${node.collapsed ? 'py-2 pb-1' : 'py-3'} rounded-t-2xl select-none relative z-10 group/header`}
                onMouseDown={(e) => {
                    e.stopPropagation();
                    onMouseDown(e, node.id);
                }}
            >
                <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 ${headerTextColor} ${isAI && !isInactive ? '' : 'opacity-80'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${headerDotColor} ${isInactive ? '' : 'shadow-[0_0_8px_currentColor]'}`} />
                    {!node.collapsed && headerText}
                </div>

                {/* Actions Group (Power & Delete) */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={handleToggleCollapse}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${isDarkMode
                            ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                            : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                            }`}
                        onMouseDown={(e) => e.stopPropagation()}
                        title={node.collapsed ? "Expand" : "Collapse"}
                    >
                        {node.collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleActive(node.id);
                        }}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${isDarkMode
                            ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                            : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                            }`}
                        onMouseDown={(e) => e.stopPropagation()}
                        title={node.isInactive ? "Activate Block" : "Deactivate Block"}
                    >
                        <Power className="w-3.5 h-3.5" />
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(node.id);
                        }}
                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${isDarkMode
                            ? 'hover:bg-white/10 text-gray-400 hover:text-red-400'
                            : 'hover:bg-black/5 text-gray-400 hover:text-red-500'
                            }`}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Delete Block"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* --- Content --- */}
            {!node.collapsed ? (
            <div className={`px-4 pb-2 cursor-default relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden ${isInactive ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div 
                        ref={contentWrapperRef}
                        className="flex flex-col w-full h-full overflow-y-auto custom-scrollbar gap-2"
                        onWheel={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            // If clicking empty space, focus the last textarea
                            if (e.target === e.currentTarget && contentWrapperRef.current) {
                                const textareas = contentWrapperRef.current.querySelectorAll('textarea');
                                if (textareas.length > 0) {
                                    (textareas[textareas.length - 1] as HTMLTextAreaElement).focus();
                                }
                            }
                        }}
                        onPaste={handlePaste}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleImageUpload}
                        />
                        {displayParts.map((part, index) => {
                            const isDraggingPart = draggedPartIndex === index;
                            const isDragOver = dragOverIndex === index;
                            const dropIndicatorClass = isDraggingPart ? 'opacity-20 grayscale scale-95' : '';
                            const dragOverClass = isDragOver ? (index < draggedPartIndex! ? 'border-t-2 border-t-blue-500 shadow-[0_-4px_10px_-4px_rgba(59,130,246,0.5)]' : 'border-b-2 border-b-blue-500 shadow-[0_4px_10px_-4px_rgba(59,130,246,0.5)]') : '';
                            
                            if (part.type === 'text') {
                                const isCollapsed = part.collapsed;
                                const firstLine = part.content.split('\n')[0] || 'Empty Text';
                                const displaySummary = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;

                                return (
                                    <div
                                        key={part.id || index}
                                        draggable={!isInactive && part.id !== 'virtual-trailing-text' && part.id !== 'empty' && isCollapsed}
                                        onDragStart={(e) => handlePartDragStart(e, index)}
                                        onDragOver={(e) => handlePartDragOver(e, index)}
                                        onDragLeave={() => setDragOverIndex(null)}
                                        onDrop={(e) => handlePartDrop(e, index)}
                                        onDragEnd={handlePartDragEnd}
                                        className={`relative group/part transition-all ${dropIndicatorClass} ${dragOverClass} hover:bg-black/5 dark:hover:bg-white/10 rounded-xl px-2 py-2 border-l-2 border-transparent hover:border-blue-500/30 mb-1 last:mb-0 w-full`}
                                    >
                                        {/* Actions for Part - Sticky Header */}
                                        <div className={!isCollapsed 
                                            ? "sticky top-2 right-0 ml-auto w-fit h-0 overflow-visible z-20" 
                                            : "absolute top-1/2 right-2 -translate-y-1/2 z-20"
                                        }>
                                            <div className={`flex items-center gap-1 opacity-0 group-hover/part:opacity-100 transition-all duration-200 ${!isCollapsed ? 'absolute right-2 top-0' : ''}`}>
                                                {/* Collapse Toggle */}
                                                {part.id !== 'virtual-trailing-text' && part.id !== 'empty' && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleTogglePartCollapse(index);
                                                        }}
                                                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                                                            isDarkMode 
                                                                ? 'hover:bg-white/10 text-gray-400 hover:text-white' 
                                                                : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                                                        }`}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        title={isCollapsed ? "Expand Part" : "Collapse Part"}
                                                    >
                                                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                                                    </button>
                                                )}

                                                {/* Delete Button for Text Part */}
                                                {(!isInactive && part.id !== 'virtual-trailing-text' && part.id !== 'empty') && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const filtered = displayParts.filter((_, i) => i !== index)
                                                                .filter(p => {
                                                                    if (p.id === 'virtual-trailing-text' || p.id === 'empty') {
                                                                        return p.content && p.content.trim().length > 0;
                                                                    }
                                                                    return true;
                                                                });
                                                            
                                                            const partsToSave = filtered;
                                                            const fullText = partsToSave.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                                                            onUpdateConfig && onUpdateConfig(node.id, { 
                                                                parts: partsToSave,
                                                                content: fullText
                                                            });
                                                        }}
                                                        className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                                                            isDarkMode 
                                                                ? 'hover:bg-white/10 text-gray-400 hover:text-red-400' 
                                                                : 'hover:bg-black/5 text-gray-400 hover:text-red-500'
                                                        }`}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        title="Delete Text Part"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {!isCollapsed ? (
                                            <textarea
                                                value={part.content}
                                                onChange={(e) => {
                                                    const ta = e.target;
                                                    const wrapper = contentWrapperRef.current;
                                                    const scrollTop = wrapper ? wrapper.scrollTop : 0;
                                                    
                                                    // Handle auto-resize on input
                                                    const offset = ta.offsetHeight - ta.clientHeight;
                                                    ta.style.height = 'auto';
                                                    ta.style.height = (ta.scrollHeight + offset) + 'px';
                                                    
                                                    if (wrapper) wrapper.scrollTop = scrollTop;
                                                    
                                                    const newContent = ta.value;
                                                    const newParts = [...displayParts];
                                                    const updatedParts = newParts.map((p, i) => {
                                                        if (i === index) {
                                                            let newId = p.id;
                                                            if (newId === 'virtual-trailing-text' || newId === 'empty') {
                                                                newId = uuidv4();
                                                            }
                                                            return { ...p, content: newContent, id: newId };
                                                        }
                                                        return p;
                                                    });
                                                    
                                                    const partsToSave = updatedParts.filter(p => p.id !== 'virtual-trailing-text' && p.id !== 'empty');
                                                    const fullText = partsToSave.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                                                    
                                                    onUpdateConfig && onUpdateConfig(node.id, { 
                                                        parts: partsToSave,
                                                        content: fullText
                                                    });
                                                }}
                                                placeholder="Type here..."
                                                onPaste={handlePaste}
                                                readOnly={isInactive}
                                                className={`w-full bg-transparent ${textColor} text-sm font-normal leading-relaxed resize-none focus:outline-none select-text cursor-text ${placeholderColor} overflow-hidden whitespace-pre-wrap break-words min-w-0 pr-8`}
                                                rows={1}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onFocus={() => {
                                                    setIsFocused(true);
                                                    if (onStartEdit) onStartEdit();
                                                }}
                                                onBlur={() => setIsFocused(false)}
                                            />
                                        ) : (
                                            <div 
                                                className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} italic py-1 cursor-pointer`}
                                                onClick={() => handleTogglePartCollapse(index)}
                                            >
                                                {displaySummary}
                                            </div>
                                        )}
                                        

                                    </div>
                                );
                            } else if (part.type === 'image') {
                                const url = (part as any).__previewUrl || (part.imageId ? imageUrls[part.imageId] : part.content);
                                const isDraggingPart = draggedPartIndex === index;
                                const isDragOver = dragOverIndex === index;
                                const dropIndicatorClass = isDraggingPart ? 'opacity-20 grayscale scale-95' : '';
                                const dragOverClass = isDragOver ? (index < draggedPartIndex! ? 'border-t-2 border-t-blue-500 shadow-[0_-4px_10px_-4px_rgba(59,130,246,0.5)]' : 'border-b-2 border-b-blue-500 shadow-[0_4px_10px_-4px_rgba(59,130,246,0.5)]') : '';
                                const isCollapsed = part.collapsed;
                                
                                return (
                                    <div
                                        key={part.id || index}
                                        draggable={!isInactive && isCollapsed}
                                        onDragStart={(e) => handlePartDragStart(e, index)}
                                        onDragOver={(e) => handlePartDragOver(e, index)}
                                        onDragLeave={() => setDragOverIndex(null)}
                                        onDrop={(e) => handlePartDrop(e, index)}
                                        onDragEnd={handlePartDragEnd}
                                        className={`relative flex flex-col items-center group/image transition-all ${dropIndicatorClass} ${dragOverClass} hover:bg-black/5 dark:hover:bg-white/10 rounded-xl px-2 border-l-2 border-transparent hover:border-blue-500/30 mb-2 last:mb-0 w-full`}
                                    >
                                        {!isCollapsed ? (
                                            url ? (
                                                <div className="relative py-2 w-full flex justify-center">
                                                    <img 
                                                        src={url} 
                                                        alt="Content" 
                                                        className="object-contain w-full max-w-[268px] max-h-[400px] rounded-lg cursor-pointer transition-transform hover:scale-[1.01] block" 
                                                        draggable={false}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (onViewImage) {
                                                                onViewImage(url);
                                                            }
                                                        }}
                                                    />
                                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/image:opacity-100 transition-all duration-200">
                                                        {/* Collapse Toggle */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleTogglePartCollapse(index);
                                                            }}
                                                            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                                                                isDarkMode
                                                                    ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                                                                    : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                                                            }`}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            title="Collapse Image"
                                                        >
                                                            <ChevronUp className="w-3.5 h-3.5" />
                                                        </button>

                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const filtered = displayParts.filter((p, i) => {
                                                                    if (i === index) return false;
                                                                    if (p.id === 'virtual-trailing-text' || p.id === 'empty') {
                                                                        return p.content && p.content.trim().length > 0;
                                                                    }
                                                                    return true;
                                                                });
                                                                
                                                                const consolidated = consolidateTextParts(filtered);
                                                                const fullText = consolidated.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                                                                onUpdateConfig && onUpdateConfig(node.id, { 
                                                                    parts: consolidated,
                                                                    content: fullText
                                                                });
                                                            }}
                                                            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                                                                isDarkMode
                                                                    ? 'hover:bg-white/10 text-gray-400 hover:text-red-400'
                                                                    : 'hover:bg-black/5 text-gray-400 hover:text-red-500'
                                                            }`}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            title="Delete Image"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div 
                                                    className={`w-full py-8 border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors rounded-lg relative ${isDarkMode ? 'border-gray-700 hover:border-gray-500 bg-white/5' : 'border-gray-200 hover:border-gray-400 bg-black/5'}`}
                                                    onClick={() => {
                                                        (nodeRef.current as any)._uploadingPartIndex = index;
                                                        fileInputRef.current?.click();
                                                    }}
                                                >
                                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/image:opacity-100 transition-all duration-200">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const filtered = displayParts.filter((p, i) => {
                                                                    if (i === index) return false;
                                                                    if (p.id === 'virtual-trailing-text' || p.id === 'empty') {
                                                                        return p.content && p.content.trim().length > 0;
                                                                    }
                                                                    return true;
                                                                });
                                                                
                                                                const consolidated = consolidateTextParts(filtered);
                                                                const fullText = consolidated.filter((p: any) => p.type === 'text').map((p: any) => p.content).join('\n');
                                                                onUpdateConfig && onUpdateConfig(node.id, { 
                                                                    parts: consolidated,
                                                                    content: fullText
                                                                });
                                                            }}
                                                            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                                                                isDarkMode 
                                                                    ? 'hover:bg-white/10 text-gray-400 hover:text-red-400' 
                                                                    : 'hover:bg-black/5 text-gray-400 hover:text-red-500'
                                                            }`}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            title="Remove Placeholder"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <ImageIcon className="w-6 h-6 text-gray-400" />
                                                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Upload Image</span>
                                                </div>
                                            )
                                        ) : (
                                            <div 
                                                className={`w-full py-2 flex items-center justify-between px-2 cursor-pointer group/collapsed-img`}
                                                onClick={() => handleTogglePartCollapse(index)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                                                    <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                                        Image Content
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleTogglePartCollapse(index);
                                                    }}
                                                    className={`w-8 h-8 flex items-center justify-center rounded-full opacity-0 group-hover/collapsed-img:opacity-100 transition-all ${
                                                        isDarkMode ? 'hover:bg-white/10 text-gray-400 hover:text-white' : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'
                                                    }`}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                >
                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                            return null;
                        })}
                    </div>
            </div>
            ) : (
                <div className={`px-4 pb-3 pt-0 cursor-default relative z-10 ${isInactive ? 'opacity-50' : ''}`}>
                     <div className={`text-xs leading-relaxed line-clamp-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {firstLineContent}
                     </div>
                </div>
            )}

            {/* --- Footer (Controls) --- */}
            {!isInactive && (!node.collapsed || node.isGenerating) && (
                <div className={`px-4 py-3 flex justify-between items-center relative z-10 mt-auto flex-shrink-0 ${footerVisibilityClass}`}>

                    {/* Model Name Trigger (Left) */}
                    {/* Model Selector (Direct) */}
                    <div className="flex-1 max-w-[180px] mr-2" onMouseDown={(e) => e.stopPropagation()}>
                        <CustomSelect
                            value={node.model || ''}
                            options={availableModels}
                            onChange={(val) => onUpdateModel && onUpdateModel(node.id, val)}
                            isDarkMode={isDarkMode}
                            className={`w-full text-[10px] font-bold uppercase tracking-wider opacity-50 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                            placeholder="Select Model"
                            minimal
                        />
                    </div>

                    {/* Action Buttons (Right) */}
                    <div className="flex items-center gap-2">
                        {node.content && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClear(node.id);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${isDarkMode ? 'hover:bg-white/10 text-gray-500 hover:text-gray-300' : 'hover:bg-black/5 text-gray-400 hover:text-gray-600'}`}
                                title="Clear Content"
                            >
                                <Eraser className="w-3.5 h-3.5" />
                            </button>
                        )}

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (node.isGenerating) {
                                    onCancelGenerate && onCancelGenerate(node.id);
                                } else {
                                    onGenerate(node.id);
                                }
                            }}
                            disabled={!!isInactive}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300 ${runButtonClass}`}
                            title={node.isGenerating ? "Cancel Generation" : "Run Block"}
                        >
                            {node.isGenerating ? (
                                <div className="relative flex items-center justify-center w-full h-full">
                                    <Loader2 className="w-full h-full p-0.5 animate-[spin_2s_linear_infinite] opacity-40" />
                                    <div className="w-2 h-2 rounded-[1px] bg-current absolute" />
                                </div>
                            ) : (
                                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            )}
                        </button>
                    </div>
                </div>
            )}



            {/* --- Ports (Connectors) --- */}
            {node.ports && node.ports.map((portId, index) => {
                const topPosition = node.collapsed ? (23 + (index * 28)) : (50 + (index * 28) + 16);

                // Logic to check if this specific port index should be active
                const isZoneHovered = hoveredZoneIndex === index;
                const isActivePort = isZoneHovered || activeDragHandleId === portId;
                const isHighlighted = highlightedPortIds?.has(portId);

                const portBaseColor = isDarkMode ? 'border-gray-600 bg-gray-900' : 'border-gray-300 bg-white';

                let portStyleClass = `${portBaseColor} hover:border-blue-500 hover:scale-110`;

                // Style Priorities: Dragging/Hovered > Highlighted (Upstream) > Normal
                if (isActivePort) {
                    portStyleClass = 'bg-blue-500 border-blue-400 scale-125 shadow-[0_0_10px_rgba(59,130,246,0.6)]';
                } else if (isHighlighted) {
                    portStyleClass = 'bg-violet-500 border-violet-400 scale-125 shadow-[0_0_10px_rgba(139,92,246,0.6)]';
                }

                // Visibility Logic: Connected OR Hovered OR Global Drag (isConnectable) OR Active Dragging From This Port OR Highlighted
                const isConnected = connectedPortIds?.has(portId);
                const isPortVisible = isConnected || isHovered || isConnectable || isActivePort || isHighlighted;
                const visibilityClass = isPortVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none';

                return (
                    <React.Fragment key={portId}>
                        {/* Input (Left) */}
                        <div
                            className={`absolute -left-3 w-6 h-6 flex items-center justify-center cursor-crosshair group z-[70] transition-all duration-300 ${isInactive ? 'opacity-50' : ''} ${visibilityClass}`}
                            style={{ top: `${topPosition}px` }}
                            onMouseEnter={() => setHoveredZoneIndex(index)}
                            onMouseLeave={() => setHoveredZoneIndex(null)}
                            onMouseUp={(e) => {
                                e.stopPropagation();
                                onConnectEnd(e, node.id, portId);
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onConnectStart(e, node.id, portId, 'target', '#3b82f6');
                            }}
                        >
                            <div className={`w-3 h-3 rounded-full border-2 transition-all duration-300 shadow-sm ${portStyleClass}`} />
                        </div>

                        {/* Output (Right) */}
                        <div
                            className={`absolute -right-3 w-6 h-6 flex items-center justify-center cursor-crosshair group z-[70] transition-all duration-300 ${isInactive ? 'opacity-50' : ''} ${visibilityClass}`}
                            style={{ top: `${topPosition}px` }}
                            onMouseEnter={() => setHoveredZoneIndex(index)}
                            onMouseLeave={() => setHoveredZoneIndex(null)}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onConnectStart(e, node.id, portId, 'source', '#3b82f6');
                            }}
                            onMouseUp={(e) => {
                                e.stopPropagation();
                                onConnectEnd(e, node.id, portId);
                            }}
                        >
                            <div className={`w-3 h-3 rounded-full border-2 transition-all duration-300 shadow-sm ${portStyleClass}`} />
                        </div>
                    </React.Fragment>
                );
            })}
            {/* Resize Handles */}
            {!isInactive && !node.collapsed && (
                <>
                    {/* Right Border Resize Handle */}
                    <div
                        className="absolute top-0 -right-1 w-3 h-full cursor-e-resize z-50 hover:bg-blue-500/20 transition-colors rounded-r-2xl"
                        onMouseDown={(e) => handleResizeStart(e, 'e')}
                    />
                    
                    {/* Bottom Border Resize Handle */}
                    <div
                        className="absolute -bottom-1 left-0 w-full h-3 cursor-s-resize z-50 hover:bg-blue-500/20 transition-colors rounded-b-2xl"
                        onMouseDown={(e) => handleResizeStart(e, 's')}
                    />

                    {/* Corner Resize Handle */}
                    <div
                        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-[60] group/corner"
                        onMouseDown={(e) => handleResizeStart(e, 'se')}
                    >
                         <div className={`absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 ${isDarkMode ? 'border-gray-500' : 'border-gray-400'} rounded-br-lg opacity-30 group-hover/corner:opacity-100 transition-opacity`} />
                    </div>
                </>
            )}
        </div>
    );
});
