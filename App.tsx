import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ZoomIn, ZoomOut, Settings, X, Undo2, Redo2, Download, Upload, Merge } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { NodeData, EdgeData, Position, GroupData, ProviderConfig, ProviderType, CanvasState } from './types';
import { NodeItem } from './components/NodeItem';
import { ConnectionLine } from './components/ConnectionLine';
import { GroupLayer } from './components/GroupLayer';
import { SettingsModal } from './components/SettingsModal';
import { generateContent } from './services/ai';
import { useHistory } from './hooks/useHistory';
import { useViewport } from './hooks/useViewport';
import { deleteMultipleImages, getImage, getImageBlob, saveImage } from './services/imageDb';
import {
    getCanvasPos,
    getHandlePosition,
    getCleanedPorts,
    performLayout,
    getExecutionSequence,
    calculateDeletionEffects,
    calculateMergeEffects
} from './utils/graph';

const NODE_WIDTH = 300;

const App: React.FC = () => {
    // --- State ---
    const [nodes, setNodes] = useState<NodeData[]>(() => {
        const saved = localStorage.getItem('canvas_nodes');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse saved nodes", e);
            }
        }
        return [
            {
                id: '1',
                type: 'text',
                source: 'user',
                content: '讲个100字以内的笑话',
                position: { 
                    x: (window.innerWidth - NODE_WIDTH) / 2, 
                    y: (window.innerHeight - 150) / 2 
                },
                width: NODE_WIDTH,
                height: 150,
                ports: [uuidv4()],
                model: ''
            },
        ];
    });
    const [edges, setEdges] = useState<EdgeData[]>(() => {
        const saved = localStorage.getItem('canvas_edges');
        return saved ? JSON.parse(saved) : [];
    });
    const [groups, setGroups] = useState<GroupData[]>(() => {
        const saved = localStorage.getItem('canvas_groups');
        return saved ? JSON.parse(saved) : [];
    });


    // Canvas Viewport State
    const {
        offset, setOffset,
        scale, setScale,
        isPanning, setIsPanning,
        zoomIn, zoomOut, resetView,
        handleWheel
    } = useViewport();

    // Auto-Save & Restore Logic
    useEffect(() => {
        const savedOffset = localStorage.getItem('canvas_offset');
        const savedScale = localStorage.getItem('canvas_scale');
        if (savedOffset) {
            try {
                setOffset(JSON.parse(savedOffset));
            } catch (e) { console.error(e); }
        }
        if (savedScale) {
            try {
                setScale(JSON.parse(savedScale));
            } catch (e) { console.error(e); }
        }
    }, [setOffset, setScale]);

    useEffect(() => {
        const saveData = () => {
            localStorage.setItem('canvas_nodes', JSON.stringify(nodes));
            localStorage.setItem('canvas_edges', JSON.stringify(edges));
            localStorage.setItem('canvas_groups', JSON.stringify(groups));
            localStorage.setItem('canvas_offset', JSON.stringify(offset));
            localStorage.setItem('canvas_scale', JSON.stringify(scale));
        };
        const timer = setTimeout(saveData, 2000);
        return () => clearTimeout(timer);
    }, [nodes, edges, groups, offset, scale]);

    const [isDarkMode, setIsDarkMode] = useState(true);

    // Keep a ref to nodes/edges/groups for async/event access without triggering re-renders or dependency updates
    const nodesRef = useRef<NodeData[]>(nodes);
    const edgesRef = useRef<EdgeData[]>(edges);
    const groupsRef = useRef<GroupData[]>(groups);

    // Ref for mouse position to avoid re-binding keyboard/paste events on mousemove
    const mousePosRef = useRef<Position>({ x: 0, y: 0 });
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    useEffect(() => { edgesRef.current = edges; }, [edges]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

    // Auto-restore images from IndexedDB on app load or when nodes change
    useEffect(() => {
        const restoreImages = async () => {
            // Preload images that are referenced in nodes
            const imageIds = new Set<string>();
            nodes.forEach(node => {
                if (node.imageId) {
                    imageIds.add(node.imageId);
                }
            });
            
            // Try to load each image to trigger caching in browser
            for (const imageId of imageIds) {
                try {
                    await getImage(imageId);
                } catch (err) {
                    console.error(`Failed to preload image ${imageId}:`, err);
                }
            }
        };
        
        restoreImages();
    }, [nodes]);

    // Migrate existing Base64 images from node.content to IndexedDB on app load
    useEffect(() => {
        const migrateBase64Images = async () => {
            const migratedNodes = [...nodes];
            let hasChanges = false;

            for (let i = 0; i < migratedNodes.length; i++) {
                const node = migratedNodes[i];
                // Check if node has Base64 image data in content and no imageId yet
                if (!node.imageId && node.content.startsWith('data:image/')) {
                    const mimeMatch = node.content.match(/^data:(image\/[a-z\+]+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                    const base64Match = node.content.match(/^data:image\/[a-z\+]+;base64,(.+)$/);

                    if (base64Match) {
                        const imageId = uuidv4();
                        try {
                            await saveImage(imageId, base64Match[1], mimeType);
                            migratedNodes[i] = {
                                ...node,
                                imageId,
                                imageMimeType: mimeType,
                                content: '' // Clear Base64 from content
                            };
                            hasChanges = true;
                        } catch (err) {
                            console.error(`Failed to migrate image for node ${node.id}:`, err);
                        }
                    }
                }
            }

            if (hasChanges) {
                setNodes(migratedNodes);
            }
        };

        // Only run migration on first load
        const migrationFlag = localStorage.getItem('images_migrated_to_indexeddb');
        if (!migrationFlag) {
            migrateBase64Images().then(() => {
                localStorage.setItem('images_migrated_to_indexeddb', 'true');
            });
        }
    }, []); // Run only once on mount

    // --- AI Configuration State ---
    const [providerConfigs, setProviderConfigs] = useState<Record<ProviderType, ProviderConfig>>({
        openai: {
            key: '',
            baseUrl: 'https://api.openai.com/v1',
            models: [],
            isValid: true
        },
        gemini: {
            key: '',
            baseUrl: '',
            models: [],
            isValid: true
        },
        anthropic: {
            key: '',
            baseUrl: 'https://api.anthropic.com/v1',
            models: [],
            isValid: true
        }
    });

    // Settings UI State
    const [showSettings, setShowSettings] = useState(false);

    // Load from LocalStorage
    useEffect(() => {
        const loadConfig = (provider: ProviderType) => {
            const storedKey = localStorage.getItem(`${provider}_api_key`);
            const storedBaseUrl = localStorage.getItem(`${provider}_base_url`);
            const storedModels = localStorage.getItem(`${provider}_models`);

            setProviderConfigs(prev => {
                let parsedModels = storedModels ? JSON.parse(storedModels) : prev[provider].models;
                
                // Migration: Ensure all models have unique IDs
                let hasMigrated = false;
                parsedModels = parsedModels.map((m: any) => {
                    if (!m.id) {
                        hasMigrated = true;
                        return { ...m, id: uuidv4() };
                    }
                    return m;
                });

                if (hasMigrated) {
                    localStorage.setItem(`${provider}_models`, JSON.stringify(parsedModels));
                }

                return {
                    ...prev,
                    [provider]: {
                        ...prev[provider],
                        key: storedKey || prev[provider].key,
                        baseUrl: (provider === 'openai' && storedBaseUrl) ? storedBaseUrl : prev[provider].baseUrl,
                        models: parsedModels
                    }
                };
            });
        };
        loadConfig('openai');
        loadConfig('gemini');
        loadConfig('anthropic');
    }, []);

    // Interaction State
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

    // Merge Mode State
    const [isMergeMode, setIsMergeMode] = useState(false);
    const [mergeSelection, setMergeSelection] = useState<string[]>([]);

    // Dragging State
    const [isDraggingNodes, setIsDraggingNodes] = useState(false);
    const [dragStart, setDragStart] = useState<Position | null>(null); // Screen coords for delta calc
    const initialNodePositions = useRef<Map<string, Position>>(new Map()); // Store initial positions for stable dragging

    // Selection Box State
    const [selectionBox, setSelectionBox] = useState<{ start: Position, end: Position } | null>(null);

    // Connection State
    const [connectingHandle, setConnectingHandle] = useState<{
        nodeId: string;
        handleId: string;
        type: 'source' | 'target';
        color: string;
    } | null>(null);
    const [mousePos, setMousePos] = useState<Position>({ x: 0, y: 0 }); // State for rendering temporary lines

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'canvas' | 'node' | 'selection' | 'group'; targetId?: string } | null>(null);

    // Modal States
    const [promptModal, setPromptModal] = useState<{ isOpen: boolean; content: { type: string; content: string }[] } | null>(null);
    const [renameGroupModal, setRenameGroupModal] = useState<{ isOpen: boolean; groupId: string; currentTitle: string } | null>(null);
    const [imageModal, setImageModal] = useState<string | null>(null);

    // --- File System Handle State ---
    const [fileHandle, setFileHandle] = useState<any>(null); // FileSystemFileHandle
    const [isAutoSaving, setIsAutoSaving] = useState(false);

    // Auto-Save to File Handle
    useEffect(() => {
        if (!fileHandle) return;

        const saveToFile = async () => {
            try {
                setIsAutoSaving(true);
                const data = {
                    nodes,
                    edges,
                    groups,
                    offset,
                    scale,
                    providerConfigs,
                    version: "1.1"
                };
                
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(data, null, 2));
                await writable.close();
                setIsAutoSaving(false);
            } catch (err) {
                console.error("Auto-save failed", err);
                setIsAutoSaving(false);
            }
        };

        const timer = setTimeout(saveToFile, 1000);
        return () => clearTimeout(timer);
    }, [nodes, edges, groups, offset, scale, fileHandle, providerConfigs]);

    const canvasRef = useRef<HTMLDivElement>(null);
    const loadCanvasInputRef = useRef<HTMLInputElement>(null);

    // Consolidate enabled models for node dropdowns
    const availableModelsList = useMemo(() => {
        const models: { value: string; label: string; category?: string }[] = [];

        Object.values(providerConfigs).forEach((conf: any) => {
            if (conf.models) {
                conf.models.forEach((m: any) => {
                    if (m.enabled) {
                        // Use unique ID as the value for the dropdown, but keep label for UI
                        models.push({ value: m.id || m.value, label: m.label });
                    }
                });
            }
        });
        return models;
    }, [providerConfigs]);

    // Determine Default Model (Top-most configured model from any provider)
    const defaultModel = useMemo(() => {
        for (const config of Object.values(providerConfigs) as ProviderConfig[]) {
            if (config.models.length > 0) return config.models[0].id || config.models[0].value;
        }
        return 'gemini-2.0-flash';
    }, [providerConfigs]);

    // Compute connected ports for visibility logic
    const connectedPortIds = useMemo(() => {
        const ids = new Set<string>();
        edges.forEach(e => {
            if (e.sourceHandle) ids.add(e.sourceHandle);
            if (e.targetHandle) ids.add(e.targetHandle);
        });
        return ids;
    }, [edges]);

    // Compute upstream flow highlights for single selection
    const flowHighlights = useMemo(() => {
        if (selectedNodeIds.size !== 1) return { edges: new Set<string>(), ports: new Set<string>() };

        const selectedId = Array.from(selectedNodeIds)[0] as string | undefined;
        if (!selectedId || typeof selectedId !== 'string') return { edges: new Set<string>(), ports: new Set<string>() };

        const { ancestorEdgeIds } = getExecutionSequence(selectedId, nodes, edges);

        const portIds = new Set<string>();

        edges.forEach(e => {
            if (ancestorEdgeIds.has(e.id)) {
                if (e.sourceHandle) portIds.add(e.sourceHandle);
                if (e.targetHandle) portIds.add(e.targetHandle);
            }
        });

        return { edges: ancestorEdgeIds, ports: portIds };
    }, [selectedNodeIds, nodes, edges]);

    const draggingNodeIds = useMemo(() => {
        if (!isDraggingNodes) return new Set<string>();
        const ids = new Set(selectedNodeIds);
        if (selectedGroupId) {
            const group = groups.find(g => g.id === selectedGroupId);
            if (group) {
                group.nodeIds.forEach(id => ids.add(id));
            }
        }
        return ids;
    }, [isDraggingNodes, selectedNodeIds, selectedGroupId, groups]);

    const nodeMap = useMemo(() => {
        const map = new Map<string, NodeData>();
        nodes.forEach(n => map.set(n.id, n));
        return map;
    }, [nodes]);

    // --- History Logic ---
    const { saveHistory, handleUndo, handleRedo, canUndo, canRedo } = useHistory(
        nodes,
        edges,
        groups,
        scale,
        offset,
        setNodes,
        setEdges,
        setGroups
    );

    // --- Actions ---

    const handleDeleteNodes = useCallback((ids: string[]) => {
        saveHistory();
        const result = calculateDeletionEffects(nodesRef.current, edgesRef.current, groupsRef.current, ids);

        // Cancel any pending generations and delete associated images
        const imagesToDelete: string[] = [];
        ids.forEach(id => {
            // Cancel pending generation
            if (abortControllersRef.current.has(id)) {
                abortControllersRef.current.get(id)?.abort();
                abortControllersRef.current.delete(id);
            }

            const node = nodesRef.current.find(n => n.id === id);
            if (node && node.imageId) {
                imagesToDelete.push(node.imageId);
            }
        });
        if (imagesToDelete.length > 0) {
            deleteMultipleImages(imagesToDelete).catch(err => console.error('Failed to delete images:', err));
        }

        setNodes(result.nodes);
        setEdges(result.edges);
        setGroups(result.groups);

        setSelectedNodeIds(new Set());
        setContextMenu(null);
    }, [saveHistory]);

    const handleToggleActive = useCallback((id: string) => {
        saveHistory();
        setNodes(prev => prev.map(n => n.id === id ? { ...n, isInactive: !n.isInactive } : n));
        setContextMenu(null);
    }, [saveHistory]);

    const handleDeleteSingleNode = useCallback((id: string) => {
        handleDeleteNodes([id]);
    }, [handleDeleteNodes]);

    const handleStartEdit = useCallback(() => {
        saveHistory();
    }, [saveHistory]);

    const handleViewImage = useCallback((url: string) => {
        setImageModal(url);
    }, []);

    const handleCreateGroup = () => {
        saveHistory();
        const selected: string[] = Array.from(selectedNodeIds);
        if (selected.length === 0) return;

        const targetNodes = nodesRef.current.filter(n => selectedNodeIds.has(n.id));
        const minX = Math.min(...targetNodes.map(n => n.position.x));
        const minY = Math.min(...targetNodes.map(n => n.position.y));

        const organizedNodes = performLayout(targetNodes, edgesRef.current, minX, minY);

        setNodes(prev => prev.map(n => {
            const organized = organizedNodes.find(on => on.id === n.id);
            return organized || n;
        }));

        const newGroup: GroupData = {
            id: uuidv4(),
            title: 'New Group',
            nodeIds: selected,
            color: 'gray'
        };
        setGroups(prev => [...prev, newGroup]);
        setContextMenu(null);
    };

    const handleRemoveFromGroup = (nodeId: string) => {
        saveHistory();
        setGroups(prev => prev.map(g => ({
            ...g,
            nodeIds: g.nodeIds.filter(id => id !== nodeId)
        })).filter(g => g.nodeIds.length > 0));
        setContextMenu(null);
    };

    const handleDeleteGroup = (groupId: string) => {
        saveHistory();
        setGroups(prev => prev.filter(g => g.id !== groupId));
        setContextMenu(null);
        setSelectedGroupId(null);
    };

    const handleRenameGroup = () => {
        if (!renameGroupModal) return;
        saveHistory();
        setGroups(prev => prev.map(g => g.id === renameGroupModal.groupId ? { ...g, title: renameGroupModal.currentTitle } : g));
        setRenameGroupModal(null);
    };

    const handleOrganizeSelected = () => {
        saveHistory();
        const selected = Array.from(selectedNodeIds);
        if (selected.length === 0) return;

        const targetNodes = nodesRef.current.filter(n => selectedNodeIds.has(n.id));
        const minX = Math.min(...targetNodes.map(n => n.position.x));
        const minY = Math.min(...targetNodes.map(n => n.position.y));

        const organizedNodes = performLayout(targetNodes, edgesRef.current, minX, minY);

        setNodes(prev => prev.map(n => {
            const organized = organizedNodes.find(on => on.id === n.id);
            return organized || n;
        }));
        setContextMenu(null);
    };

    const handleOrganizeGroup = (groupId: string) => {
        saveHistory();
        const group = groupsRef.current.find(g => g.id === groupId);
        if (!group) return;

        const targetNodes = nodesRef.current.filter(n => group.nodeIds.includes(n.id));
        if (targetNodes.length === 0) return;

        const minX = Math.min(...targetNodes.map(n => n.position.x));
        const minY = Math.min(...targetNodes.map(n => n.position.y));

        const organizedNodes = performLayout(targetNodes, edgesRef.current, minX, minY);

        setNodes(prev => prev.map(n => {
            const organized = organizedNodes.find(on => on.id === n.id);
            return organized || n;
        }));
        setContextMenu(null);
    };

    // --- Save / Load Canvas Logic ---
    const handleOpenFile = async () => {
        if ('showOpenFilePicker' in window) {
            try {
                const [handle] = await (window as any).showOpenFilePicker({
                    types: [{
                        description: 'Block Canvas Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                    multiple: false,
                });
                
                const file = await handle.getFile();
                const text = await file.text();
                const data = JSON.parse(text);

                if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
                    alert("Invalid canvas file format.");
                    return;
                }

                saveHistory();

                setNodes(data.nodes);
                setEdges(data.edges);
                setGroups(data.groups || []);
                if (data.offset) setOffset(data.offset);
                if (data.scale) setScale(data.scale);

                setSelectedNodeIds(new Set());
                setSelectedGroupId(null);
                setSelectedEdgeId(null);
                
                setFileHandle(handle);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error(err);
                    alert("Failed to open file.");
                }
            }
        } else {
            loadCanvasInputRef.current?.click();
        }
    };

    const handleSaveCanvas = async () => {
        const data = {
            nodes: nodesRef.current,
            edges: edgesRef.current,
            groups: groupsRef.current,
            offset,
            scale,
            providerConfigs,
            version: "1.1"
        };
        const jsonString = JSON.stringify(data, null, 2);

        if ('showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: `Block-Canvas-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}-${new Date().getHours().toString().padStart(2, '0')}${new Date().getMinutes().toString().padStart(2, '0')}.json`,
                    types: [{
                        description: 'Block Canvas Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                
                const writable = await handle.createWritable();
                await writable.write(jsonString);
                await writable.close();
                
                setFileHandle(handle);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error("Save failed", err);
                    alert("Failed to save file.");
                }
            }
        } else {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Block-Canvas-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}-${new Date().getHours().toString().padStart(2, '0')}${new Date().getMinutes().toString().padStart(2, '0')}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    const handleLoadCanvas = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const result = event.target?.result as string;
                const data = JSON.parse(result);

                if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
                    alert("Invalid canvas file format.");
                    return;
                }

                saveHistory();

                setNodes(data.nodes);
                setEdges(data.edges);
                setGroups(data.groups || []);

                if (data.offset) setOffset(data.offset);
                if (data.scale) setScale(data.scale);

                // Restore provider configurations if available
                if (data.providerConfigs) {
                    setProviderConfigs(data.providerConfigs);
                }

                setSelectedNodeIds(new Set());
                setSelectedGroupId(null);
                setSelectedEdgeId(null);

            } catch (err) {
                console.error(err);
                alert("Failed to parse the canvas file.");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // --- Merge Mode Logic ---
    const handleStartMergeMode = () => {
        setIsMergeMode(true);
        setMergeSelection([]);
        setSelectedNodeIds(new Set());
        setSelectedGroupId(null);
        setContextMenu(null);
        setShowSettings(false);
    };

    const handleCancelMergeMode = () => {
        setIsMergeMode(false);
        setMergeSelection([]);
    };

    const handleConfirmMerge = () => {
        if (mergeSelection.length < 2) return;
        saveHistory();

        const result = calculateMergeEffects(
            nodesRef.current,
            edgesRef.current,
            groupsRef.current,
            mergeSelection,
            NODE_WIDTH
        );

        if (result) {
            setNodes(result.nodes);
            setEdges(result.edges);
            setGroups(result.groups);
            setSelectedNodeIds(new Set([result.newNode.id]));
        }

        handleCancelMergeMode();
    };

    // --- Handlers (Mouse, Drag, etc) ---
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (isMergeMode) return;
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas' });
    }, [isMergeMode]);

    const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT';

        if (!isInput) {
            e.preventDefault();
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        }

        if (isMergeMode) {
            setMergeSelection(prev => {
                if (prev.includes(id)) return prev.filter(pid => pid !== id);
                return [...prev, id];
            });
            return;
        }

        if (selectedGroupId) setSelectedGroupId(null);

        if (e.button !== 2) {
            setContextMenu(null);
        }
        setShowSettings(false);

        if (e.button !== 0) return;

        if (!isInput) {
            saveHistory();
            const posMap = new Map();
            nodesRef.current.forEach(n => posMap.set(n.id, { ...n.position }));
            initialNodePositions.current = posMap;

            setDragStart({ x: e.clientX, y: e.clientY });
            setIsDraggingNodes(true);
        }

        // Toggle Selection Logic
        setSelectedNodeIds(prev => {
            const newSet = new Set(prev);
            if (!prev.has(id)) {
                if (!e.shiftKey) {
                    return new Set([id]);
                } else {
                    newSet.add(id);
                    return newSet;
                }
            } else {
                if (e.shiftKey) {
                    newSet.delete(id);
                    return newSet;
                }
            }
            return newSet; // Return existing set if no change? Actually we should return new set if we want to be safe, but typically we want to keep selection if clicking already selected
        });

        if (!selectedNodeIds.has(id) && !e.shiftKey) {
            setSelectedEdgeId(null);
        }

    }, [isMergeMode, selectedGroupId, selectedNodeIds, saveHistory]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (isMergeMode) return;

        setSelectedNodeIds(prev => {
            if (!prev.has(id)) {
                setSelectedEdgeId(null);
                return new Set([id]);
            }
            return prev;
        });
        if (selectedGroupId) setSelectedGroupId(null);

        // We need to know the selection size to show "delete selection" vs "delete node"
        // Since setState is async, we check if the clicked node IS in the current selection or we just made it the selection.
        const currentSelected = selectedNodeIds.has(id) ? selectedNodeIds : new Set([id]);

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: currentSelected.size > 1 ? 'selection' : 'node',
            targetId: id
        });
    }, [isMergeMode, selectedGroupId, selectedNodeIds]);

    const handleGroupContextMenu = useCallback((e: React.MouseEvent, group: GroupData) => {
        e.stopPropagation();
        e.preventDefault();
        if (isMergeMode) return;

        setSelectedGroupId(group.id);
        setSelectedNodeIds(new Set());
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: 'group',
            targetId: group.id
        });
    }, [isMergeMode]);

    const handleGroupMouseDown = useCallback((e: React.MouseEvent, groupId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (isMergeMode) return;

        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        if (e.button !== 2) {
            setContextMenu(null);
        }
        setShowSettings(false);

        if (e.button !== 0) return;

        const group = groupsRef.current.find(g => g.id === groupId);
        if (!group) return;

        saveHistory();
        setSelectedGroupId(groupId);
        setSelectedNodeIds(new Set());

        const posMap = new Map();
        nodesRef.current.forEach(n => posMap.set(n.id, { ...n.position }));
        initialNodePositions.current = posMap;

        setIsDraggingNodes(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    }, [isMergeMode, saveHistory]);

    const handleCanvasMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 2) {
            if (contextMenu) setContextMenu(null);
        }

        if (connectingHandle) return;
        setShowSettings(false);

        if (isMergeMode) return;

        if (e.ctrlKey && e.button === 0) {
            const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);
            setSelectionBox({ start: pos, end: pos });
            return;
        }

        if (e.button === 0) {
            setIsPanning(true);
            if (!e.shiftKey) {
                setSelectedNodeIds(new Set());
                setSelectedEdgeId(null);
                setSelectedGroupId(null);
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const currentMousePos = getCanvasPos(e.clientX, e.clientY, offset, scale);
        setMousePos(currentMousePos);
        mousePosRef.current = currentMousePos; // Update ref

        if (isMergeMode) {
            if (isPanning) {
                setOffset((prev) => ({
                    x: prev.x + e.movementX,
                    y: prev.y + e.movementY,
                }));
            }
            return;
        }

        if (selectionBox) {
            setSelectionBox(prev => prev ? { ...prev, end: currentMousePos } : null);
            return;
        }

        if (isPanning) {
            setOffset((prev) => ({
                x: prev.x + e.movementX,
                y: prev.y + e.movementY,
            }));
            return;
        }

        if (isDraggingNodes && dragStart) {
            const scaleFactor = 1 / scale;
            const dx = (e.clientX - dragStart.x) * scaleFactor;
            const dy = (e.clientY - dragStart.y) * scaleFactor;

            setNodes(prev => prev.map(n => {
                const isNodeSelected = selectedNodeIds.has(n.id);
                const isInSelectedGroup = selectedGroupId && groupsRef.current.find(g => g.id === selectedGroupId)?.nodeIds.includes(n.id);

                if (isNodeSelected || isInSelectedGroup) {
                    const initial = initialNodePositions.current.get(n.id);
                    if (initial) {
                        return {
                            ...n,
                            position: {
                                x: initial.x + dx,
                                y: initial.y + dy
                            }
                        };
                    }
                }
                return n;
            }));
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (selectionBox) {
            const x1 = Math.min(selectionBox.start.x, selectionBox.end.x);
            const y1 = Math.min(selectionBox.start.y, selectionBox.end.y);
            const x2 = Math.max(selectionBox.start.x, selectionBox.end.x);
            const y2 = Math.max(selectionBox.start.y, selectionBox.end.y);

            const newSelection = new Set<string>();
            if (e.shiftKey) {
                selectedNodeIds.forEach(id => newSelection.add(id));
            }

            nodesRef.current.forEach(node => {
                const nx = node.position.x;
                const ny = node.position.y;
                const nw = node.width;
                const nh = node.height || 150;

                if (nx < x2 && nx + nw > x1 && ny < y2 && ny + nh > y1) {
                    newSelection.add(node.id);
                }
            });

            setSelectedNodeIds(newSelection);
            setSelectionBox(null);
            if (!e.shiftKey && newSelection.size > 0) {
                setSelectedGroupId(null);
            }
            return;
        }

        if (connectingHandle) {
            // ... (Connecting logic same as before)
            const target = e.target as HTMLElement;
            const isNode = target.closest('.node-item');

            if (!isNode) {
                saveHistory();
                const newNodeId = uuidv4();
                const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);
                const newPortId = uuidv4();

                // Find the origin node and inherit its model if it exists
                const originNode = nodesRef.current.find(n => n.id === connectingHandle.nodeId);
                const inheritedModel = originNode?.model || defaultModel;

                const newNode: NodeData = {
                    id: newNodeId,
                    type: 'text',
                    source: 'user',
                    content: '',
                    position: { x: pos.x, y: pos.y - 75 },
                    width: NODE_WIDTH,
                    height: 150,
                    ports: [newPortId, uuidv4()],
                    model: inheritedModel
                };

                let sourceId, targetId, sourceHandle, targetHandle;

                if (connectingHandle.type === 'source') {
                    sourceId = connectingHandle.nodeId;
                    sourceHandle = connectingHandle.handleId;
                    targetId = newNodeId;
                    targetHandle = newPortId;
                } else {
                    sourceId = newNodeId;
                    sourceHandle = newPortId;
                    targetId = connectingHandle.nodeId;
                    targetHandle = connectingHandle.handleId;
                    newNode.position.x = pos.x - NODE_WIDTH;
                }

                setNodes(prev => {
                    const updated = prev.map(n => {
                        if (n.id === connectingHandle.nodeId) {
                            if (n.ports[n.ports.length - 1] === connectingHandle.handleId) {
                                return { ...n, ports: [...n.ports, uuidv4()] };
                            }
                        }
                        return n;
                    });
                    return [...updated, newNode];
                });

                setEdges(prev => [...prev, {
                    id: uuidv4(),
                    source: sourceId,
                    target: targetId,
                    sourceHandle: sourceHandle,
                    targetHandle: targetHandle,
                    color: connectingHandle.color
                }]);
            }
        }

        setIsPanning(false);
        setIsDraggingNodes(false);
        setDragStart(null);
        setConnectingHandle(null);
    };

    const handleCanvasDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (e: React.DragEvent) => {
        // ... (Drop logic same as before)
        e.preventDefault();

        // Check for File Drop
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                saveHistory();
                const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);
                const reader = new FileReader();
                reader.onload = async (event) => {
                    if (event.target?.result) {
                        const base64String = event.target.result as string;
                        const imageId = uuidv4();
                        const mimeType = file.type || 'image/jpeg';
                        
                        try {
                            await saveImage(imageId, base64String, mimeType);
                            const newNode: NodeData = {
                                id: uuidv4(),
                                type: 'text',
                                source: 'user',
                                content: '', 
                                parts: [
                                    { id: uuidv4(), type: 'image', content: '', imageId: imageId, mimeType: mimeType },
                                    { id: uuidv4(), type: 'text', content: '' }
                                ],
                                position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - 75 },
                                width: NODE_WIDTH,
                                height: 250,
                                ports: [uuidv4()],
                                model: defaultModel
                            };
                            setNodes(prev => [...prev, newNode]);
                        } catch (err) {
                            console.error("Failed to save dropped image:", err);
                            // Fallback if IDB fails
                            const newNode: NodeData = {
                                id: uuidv4(),
                                type: 'text',
                                source: 'user',
                                content: '',
                                parts: [
                                    { id: uuidv4(), type: 'image', content: base64String },
                                    { id: uuidv4(), type: 'text', content: '' }
                                ],
                                position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - 75 },
                                width: NODE_WIDTH,
                                height: 250,
                                ports: [uuidv4()],
                                model: defaultModel
                            };
                            setNodes(prev => [...prev, newNode]);
                        }
                    }
                };
                reader.readAsDataURL(file);
                return;
            }
        }

        saveHistory();

        // 1. Check for internal image drag-and-drop
        const internalImageId = e.dataTransfer.getData('application/x-block-image-id');
        if (internalImageId) {
            const mimeType = e.dataTransfer.getData('application/x-block-image-mime') || 'image/jpeg';
            const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);
            const newNode: NodeData = {
                id: uuidv4(),
                type: 'text',
                source: 'user',
                content: '',
                parts: [
                    { id: uuidv4(), type: 'image', content: '', imageId: internalImageId, mimeType: mimeType },
                    { id: uuidv4(), type: 'text', content: '' }
                ],
                position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - 75 },
                width: NODE_WIDTH,
                height: 250,
                ports: [uuidv4()],
                model: defaultModel
            };
            setNodes(prev => [...prev, newNode]);
            return;
        }

        const text = e.dataTransfer.getData('text/plain');
        if (text) {
            const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);

            // 2. Check if text looks like an image URL or data URL
            const isImageUrl = text.startsWith('data:image/') || 
                              text.startsWith('blob:') || 
                              /\.(jpeg|jpg|gif|png|webp|svg)($|\?)/i.test(text);

            if (isImageUrl) {
                const newNode: NodeData = {
                    id: uuidv4(),
                    type: 'text',
                    source: 'user',
                    content: '',
                    parts: [
                        { id: uuidv4(), type: 'image', content: text },
                        { id: uuidv4(), type: 'text', content: '' }
                    ],
                    position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - 75 },
                    width: NODE_WIDTH,
                    height: 250,
                    ports: [uuidv4()],
                    model: defaultModel
                };
                setNodes(prev => [...prev, newNode]);
                return;
            }

            const newNode: NodeData = {
                id: uuidv4(),
                type: 'text',
                source: 'user',
                content: text,
                position: { x: pos.x, y: pos.y },
                width: NODE_WIDTH,
                height: 150,
                ports: [uuidv4()],
                model: defaultModel
            };

            setNodes(prev => [...prev, newNode]);
            return;
        }
    };

    const handleAddNodeAtCursor = () => {
        if (!contextMenu) return;
        saveHistory();
        const pos = getCanvasPos(contextMenu.x, contextMenu.y, offset, scale);
        const newNode: NodeData = {
            id: uuidv4(),
            type: 'text',
            source: 'user',
            content: '',
            position: { x: pos.x, y: pos.y },
            width: NODE_WIDTH,
            height: 150,
            ports: [uuidv4()],
            model: defaultModel
        };
        setNodes((prev) => [...prev, newNode]);
        setContextMenu(null);
    };

    const handleGlobalAutoLayout = () => {
        saveHistory();
        const organized = performLayout(nodesRef.current, edgesRef.current, 100, 100);
        setNodes(organized);
        setOffset({ x: 0, y: 0 });
        setContextMenu(null);
    };

    // Callback wrappers for node updates to ensure stable function references
    const handleUpdateNode = useCallback((id: string, content: string) => {
        setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, content } : n)));
    }, []);

    const handleUpdateNodeModel = useCallback((id: string, model: string) => {
        setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, model } : n)));
    }, []);

    const handleUpdateNodeConfig = useCallback((id: string, config: Partial<NodeData>) => {
        setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...config } : n)));
    }, []);

    const handleClearNode = useCallback((id: string) => {
        saveHistory();
        setNodes((prev) => prev.map((n) => {
            if (n.id === id) {
                return { 
                    ...n, 
                    content: '', 
                    type: 'text', 
                    source: 'user',
                    parts: [],
                    imageId: undefined,
                    imageMimeType: undefined
                };
            }
            return n;
        }));
    }, [saveHistory]);

    const handleConnectStart = useCallback((e: React.MouseEvent, id: string, handleId: string, type: 'source' | 'target', color: string) => {
        if (isMergeMode) return;
        setContextMenu(null);
        setConnectingHandle({ nodeId: id, handleId, type, color });
    }, [isMergeMode]);

    const handleConnectEnd = useCallback((e: React.MouseEvent, id: string, handleId?: string) => {
        if (isMergeMode) return;

        setConnectingHandle(currentConnectingHandle => {
            if (!currentConnectingHandle) return null;
            if (currentConnectingHandle.nodeId === id) return null;

            const sourceNodeId = currentConnectingHandle.type === 'source' ? currentConnectingHandle.nodeId : id;
            const targetNodeId = currentConnectingHandle.type === 'source' ? id : currentConnectingHandle.nodeId;

            const nodeS = nodesRef.current.find(n => n.id === sourceNodeId);
            const nodeT = nodesRef.current.find(n => n.id === targetNodeId);

            if (!nodeS || !nodeT) return null;

            let sourcePortId = currentConnectingHandle.type === 'source' ? currentConnectingHandle.handleId : handleId;
            let targetPortId = currentConnectingHandle.type === 'source' ? handleId : currentConnectingHandle.handleId;

            if (!sourcePortId) sourcePortId = nodeS.ports[nodeS.ports.length - 1];
            if (!targetPortId) targetPortId = nodeT.ports[0];

            if (!sourcePortId || !targetPortId) return null;

            saveHistory();

            setNodes(prev => prev.map(n => {
                if (n.id !== sourceNodeId && n.id !== targetNodeId) return n;

                const newPorts = [...n.ports];
                let modified = false;

                if (n.id === sourceNodeId && n.ports[n.ports.length - 1] === sourcePortId) {
                    newPorts.push(uuidv4());
                    modified = true;
                }

                if (n.id === targetNodeId && n.ports[n.ports.length - 1] === targetPortId) {
                    newPorts.push(uuidv4());
                    modified = true;
                }

                return modified ? { ...n, ports: newPorts } : n;
            }));

            setEdges(prev => [...prev, {
                id: uuidv4(),
                source: sourceNodeId,
                target: targetNodeId,
                sourceHandle: sourcePortId!,
                targetHandle: targetPortId!,
                color: currentConnectingHandle.color
            }]);

            return null;
        });
    }, [isMergeMode, saveHistory]);

    const handleEdgeClick = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setContextMenu(null);
        setSelectedEdgeId(id);
        setSelectedNodeIds(new Set());
        setSelectedGroupId(null);
    }, []);

    const handleEdgeDoubleClick = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        saveHistory();
        const newEdges = edgesRef.current.filter(ed => ed.id !== id);
        setEdges(newEdges);
        setNodes(prev => prev.map(n => ({ ...n, ports: getCleanedPorts(n, newEdges) })));
    }, [saveHistory]);

    // --- Gemini Logic ---
    const handleGenerate = useCallback(async (triggerNodeId: string) => {
        saveHistory();
        // Unified color for the active execution flow (Violet-500)
        const getFlowColor = (id: string) => '#8b5cf6';

        // Use Refs to read current state without dependency
        const currentNodes = nodesRef.current;
        const currentEdges = edgesRef.current;

        const triggerNode = currentNodes.find(n => n.id === triggerNodeId);
        if (!triggerNode) return;
        const isTriggerEmpty = !triggerNode.content.trim();

        if (!triggerNode.model) {
            alert("Please select or type a model in the block.");
            return;
        }

        // Use utility for traversal
        const { sequence: sortedNodes, ancestorEdgeIds } = getExecutionSequence(triggerNodeId, currentNodes, currentEdges);

        setEdges(prev => prev.map(edge => ({
            ...edge,
            color: ancestorEdgeIds.has(edge.id) ? getFlowColor(triggerNodeId) : '#374151'
        })));

        // Construct multimodal prompt
        const promptPartsPromises = sortedNodes.map(async (n) => {
            if (n.isInactive) return null; // SKIP INACTIVE NODES

            // Use parts if available
            if (n.parts && n.parts.length > 0) {
                const nodeParts: any[] = [];
                for (const part of n.parts) {
                    if (part.type === 'text' && part.content) {
                        nodeParts.push({ text: part.content });
                    } else if (part.type === 'image' && part.imageId) {
                        try {
                            const dataUrl = await getImage(part.imageId);
                            if (dataUrl) {
                                const match = dataUrl.match(/^data:(image\/[a-z\+]+);base64,(.+)$/);
                                if (match) {
                                    nodeParts.push({ 
                                        inlineData: { mimeType: match[1], data: match[2] },
                                        imageId: part.imageId
                                    });
                                }
                            }
                        } catch (err) {
                            console.error("Failed to load part image:", err);
                        }
                    }
                }
                return nodeParts;
            }

            // Fallback for legacy nodes
            if (n.imageId) {
                try {
                    const dataUrl = await getImage(n.imageId);
                    if (dataUrl) {
                        const match = dataUrl.match(/^data:(image\/[a-z\+]+);base64,(.+)$/);
                        if (match) {
                            return { 
                                inlineData: { mimeType: match[1], data: match[2] },
                                imageId: n.imageId
                            };
                        }
                    }
                } catch (err) {
                    console.error("Failed to load image for prompt:", err);
                }
            }
            
            // Fallback: Check if content itself is a base64 image
            const imageMatch = n.content.match(/^data:(image\/[a-z\+]+);base64,(.+)$/);
            if (imageMatch) {
                return { inlineData: { mimeType: imageMatch[1], data: imageMatch[2] } };
            }

            if (n.type === 'image') {
                return null;
            } else {
                return { text: n.content };
            }
        });

        const promptPartsResults = await Promise.all(promptPartsPromises);
        const promptParts = promptPartsResults.flat().filter(Boolean) as any[];

        if (promptParts.length === 0) return;

        // Create a cleaned version of promptParts for executionContext to avoid bloating metadata with base64
        const cleanedExecutionContext = promptParts.map(part => {
            if (part.inlineData) {
                // If we have an imageId reference, we can replace the heavy data with a placeholder
                if (part.imageId) {
                    return { 
                        inlineData: { mimeType: part.inlineData.mimeType, data: "(image data)" },
                        imageId: part.imageId 
                    };
                }
                // Otherwise keep it as is (should be rare if migration and upload/paste are working correctly)
                return part;
            }
            return part;
        });

        let modelToUse = triggerNode.model;

        // Cancel any existing request for this node
        if (abortControllersRef.current.has(triggerNodeId)) {
            abortControllersRef.current.get(triggerNodeId)?.abort();
        }
        
        const controller = new AbortController();
        abortControllersRef.current.set(triggerNodeId, controller);

        setNodes(prev => prev.map(n => n.id === triggerNodeId ? { ...n, isGenerating: true } : n));

        try {
            const responseParts = await generateContent(
                promptParts,
                modelToUse,
                { signal: controller.signal },
                providerConfigs
            );

            // Clean up controller
            abortControllersRef.current.delete(triggerNodeId);

            // Prepare for update - Fetch latest state again in case it changed during await
            const latestNodes = [...nodesRef.current];
            const latestEdges = [...edgesRef.current];

            const freshTriggerIndex = latestNodes.findIndex(n => n.id === triggerNodeId);
            if (freshTriggerIndex === -1) return;

            latestNodes[freshTriggerIndex] = { ...latestNodes[freshTriggerIndex], isGenerating: false };

            const triggerNode = latestNodes[freshTriggerIndex];
            
            // Initialize parts if not present
            let currentParts: any[] = triggerNode.parts || [];
            
            // If parts are empty but we have content/image, migrate them to parts first
            if (currentParts.length === 0 && (triggerNode.content || triggerNode.imageId)) {
                if (triggerNode.content) {
                    currentParts.push({ id: uuidv4(), type: 'text', content: triggerNode.content });
                }
                if (triggerNode.imageId) {
                    currentParts.push({ 
                        id: uuidv4(), 
                        type: 'image', 
                        content: '', 
                        imageId: triggerNode.imageId, 
                        mimeType: triggerNode.imageMimeType 
                    });
                }
            }

            for (const part of responseParts) {
                if (part.type === 'text') {
                    // Create new text part for each AI response segment (stop merging)
                    currentParts.push({
                        id: uuidv4(),
                        type: 'text',
                        content: part.content
                    });
                } else if (part.type === 'image') {
                    if (part.content && part.content.startsWith && part.content.startsWith('data:image/')) {
                        const mimeMatch = part.content.match(/^data:([^;]+);base64,/);
                        const base64Match = part.content.match(/^data:[^;]+;base64,(.+)$/);
                        
                        if (base64Match && mimeMatch) {
                            const imageId = uuidv4();
                            const mimeType = mimeMatch[1];
                            await saveImage(imageId, base64Match[1], mimeType);
                            
                            // Try to create an immediate preview URL from the saved blob
                            try {
                                const blob = await getImageBlob(imageId);
                                const previewUrl = blob ? URL.createObjectURL(blob) : undefined;
                                const newPart: any = {
                                    id: uuidv4(),
                                    type: 'image',
                                    content: '',
                                    imageId: imageId,
                                    mimeType: mimeType
                                };
                                if (previewUrl) newPart.__previewUrl = previewUrl;
                                currentParts.push(newPart);
                            } catch (err) {
                                const newPart = {
                                    id: uuidv4(),
                                    type: 'image',
                                    content: '',
                                    imageId: imageId,
                                    mimeType: mimeType
                                };
                                currentParts.push(newPart);
                            }
                        }
                    }
                }
            }

            // Ensure we have a trailing text part for user to continue typing
            if (currentParts.length > 0 && currentParts[currentParts.length - 1].type !== 'text') {
                currentParts.push({
                    id: uuidv4(),
                    type: 'text',
                    content: '',
                    source: 'user'
                });
            }

            // Update content string for backward compatibility / search
            const fullContent = currentParts
                .filter(p => p.type === 'text')
                .map(p => p.content)
                .join('\n');

            latestNodes[freshTriggerIndex] = {
                ...triggerNode,
                type: 'text',
                content: fullContent,
                parts: currentParts,
                executionContext: cleanedExecutionContext,
                source: 'ai'
            };

            setNodes(latestNodes);
            // Edges unchanged
            
        } catch (e: any) {
            if (e.name === 'AbortError') {
                console.log('Generation aborted');
            } else {
                console.error(e);
            }
            setNodes(prev => prev.map(n => n.id === triggerNodeId ? { ...n, isGenerating: false } : n));
        } finally {
            abortControllersRef.current.delete(triggerNodeId);
        }
    }, [providerConfigs, saveHistory]);

    const handleCancelGenerate = useCallback((id: string) => {
        if (abortControllersRef.current.has(id)) {
            abortControllersRef.current.get(id)?.abort();
            abortControllersRef.current.delete(id);
        }
        setNodes(prev => prev.map(n => n.id === id ? { ...n, isGenerating: false } : n));
    }, []);

    // --- Keyboard Shortcuts ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                handleRedo();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                selectedNodeIds.forEach(id => handleGenerate(id));
                return;
            }

            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (isMergeMode) return;

                if (selectedNodeIds.size > 0) {
                    handleDeleteNodes(Array.from(selectedNodeIds));
                } else if (selectedGroupId) {
                    const group = groupsRef.current.find(g => g.id === selectedGroupId);
                    if (group) handleDeleteNodes(group.nodeIds);
                    setSelectedGroupId(null);
                } else if (selectedEdgeId) {
                    saveHistory();
                    const newEdges = edgesRef.current.filter(edge => edge.id !== selectedEdgeId);
                    setEdges(newEdges);
                    setNodes(prevNodes => prevNodes.map(node => ({
                        ...node,
                        ports: getCleanedPorts(node, newEdges)
                    })));
                    setSelectedEdgeId(null);
                }
            }

            if (e.key === 'Escape') {
                if (isMergeMode) {
                    handleCancelMergeMode();
                } else {
                    setContextMenu(null);
                    setPromptModal(null);
                    setRenameGroupModal(null);
                    if (imageModal) setImageModal(null);
                    if (selectionBox) setSelectionBox(null);
                    setSelectedGroupId(null);
                    setShowSettings(false);
                    setSelectedNodeIds(new Set());
                }
            }
        };

        const handleGlobalPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const items = e.clipboardData?.items;
            if (!items) return;

            const currentMousePos = mousePosRef.current;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        saveHistory();
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            if (event.target?.result) {
                                const newNode: NodeData = {
                                    id: uuidv4(),
                                    type: 'text',
                                    source: 'user',
                                    content: '',
                                    parts: [
                                        { id: uuidv4(), type: 'image', content: event.target.result as string },
                                        { id: uuidv4(), type: 'text', content: '' }
                                    ],
                                    position: { x: currentMousePos.x, y: currentMousePos.y },
                                    width: NODE_WIDTH,
                                    height: 250,
                                    ports: [uuidv4()],
                                    model: defaultModel
                                };
                                setNodes(prev => [...prev, newNode]);
                            }
                        };
                        reader.readAsDataURL(file);
                    }
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('paste', handleGlobalPaste);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('paste', handleGlobalPaste);
        };
    }, [selectedNodeIds, selectedEdgeId, selectedGroupId, selectionBox, isMergeMode, handleUndo, handleRedo, imageModal, handleDeleteNodes, saveHistory, defaultModel, handleGenerate]);

    const bgClass = isDarkMode ? 'bg-gray-950' : 'bg-gray-50';
    const dotColor = isDarkMode ? '#374151' : '#d1d5db';

    const glassPanelClass = isDarkMode
        ? 'bg-gray-900/95 border-gray-700 text-gray-200 backdrop-blur-2xl shadow-2xl ring-1 ring-white/5'
        : 'bg-white/95 border-gray-200 text-gray-800 backdrop-blur-2xl shadow-2xl ring-1 ring-black/5';

    const dividerClass = isDarkMode ? 'bg-gray-700' : 'bg-gray-200';

    const iconButtonClass = (isActive: boolean = false, disabled: boolean = false) => `
        p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center
        ${disabled
            ? 'opacity-30 cursor-not-allowed'
            : `hover:scale-105 active:scale-95 ${isActive
                ? (isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                : (isDarkMode ? 'hover:bg-gray-700 hover:text-gray-100' : 'hover:bg-gray-100 hover:text-gray-900')
            }`
        }
    `;

    const sourceNodeIds = useMemo(() => new Set(edges.map(e => e.source)), [edges]);

    return (
        <div
            className={`w-full h-screen overflow-hidden relative select-none ${isMergeMode ? 'cursor-default' : ''} ${bgClass}`}
            style={{
                backgroundPosition: `${offset.x}px ${offset.y}px`,
                backgroundSize: `${20 * scale}px ${20 * scale}px`,
                backgroundImage: `radial-gradient(${dotColor} 1px, transparent 1px)`,
                backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc'
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
            onMouseDown={handleCanvasMouseDown}
            onDragOver={handleCanvasDragOver}
            onDrop={handleDrop}
        >

            {/* Canvas Layer */}
            <div
                ref={canvasRef}
                className="absolute top-0 left-0 cursor-move"
                style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: '0 0',
                    width: '0px',
                    height: '0px',
                    overflow: 'visible'
                }}
            >
                <GroupLayer groups={groups} nodes={nodes} selectedGroupId={selectedGroupId} isDarkMode={isDarkMode} onContextMenu={handleGroupContextMenu} onMouseDown={handleGroupMouseDown} />

                <svg className="absolute top-0 left-0 w-[1px] h-[1px] pointer-events-none overflow-visible">
                    {edges.map(edge => {
                        const start = getHandlePosition(edge.source, edge.sourceHandle, 'right', nodeMap);
                        const end = getHandlePosition(edge.target, edge.targetHandle, 'left', nodeMap);
                        if (!start || !end) return null;
                        return (
                            <ConnectionLine
                                key={edge.id} id={edge.id} start={start} end={end} color={edge.color}
                                isSelected={selectedEdgeId === edge.id}
                                isUpstream={flowHighlights.edges.has(edge.id)}
                                onClick={handleEdgeClick}
                                onDoubleClick={handleEdgeDoubleClick}
                            />
                        );
                    })}

                    {connectingHandle && (
                        (() => {
                            if (connectingHandle.type === 'source') {
                                const startPos = getHandlePosition(connectingHandle.nodeId, connectingHandle.handleId, 'right', nodeMap);
                                return startPos ? <ConnectionLine start={startPos} end={mousePos} color={connectingHandle.color} isTemp /> : null;
                            } else {
                                const endPos = getHandlePosition(connectingHandle.nodeId, connectingHandle.handleId, 'left', nodeMap);
                                return endPos ? <ConnectionLine start={mousePos} end={endPos} color={connectingHandle.color} isTemp /> : null;
                            }
                        })()
                    )}
                </svg>

                {nodes.map(node => {
                    const activeDragHandleId = (connectingHandle && connectingHandle.nodeId === node.id) ? connectingHandle.handleId : undefined;

                    return (
                        <NodeItem
                            key={node.id}
                            node={node}
                            isSelected={selectedNodeIds.has(node.id)}
                            isConnectable={connectingHandle !== null && connectingHandle.nodeId !== node.id}
                            hasOutgoingConnection={sourceNodeIds.has(node.id)}
                            connectedPortIds={connectedPortIds}
                            highlightedPortIds={flowHighlights.ports}
                            mergeIndex={isMergeMode ? mergeSelection.indexOf(node.id) : undefined}
                            isDarkMode={isDarkMode}
                            isDragging={draggingNodeIds.has(node.id)}
                            availableModels={availableModelsList}
                            activeDragHandleId={activeDragHandleId}
                            onUpdate={handleUpdateNode}
                            onUpdateModel={handleUpdateNodeModel}
                            onUpdateConfig={handleUpdateNodeConfig}
                            onDelete={handleDeleteSingleNode}
                            onGenerate={handleGenerate}
                            onCancelGenerate={handleCancelGenerate}
                            onClear={handleClearNode}
                            onMouseDown={handleNodeMouseDown}
                            onConnectStart={handleConnectStart}
                            onConnectEnd={handleConnectEnd}
                            onContextMenu={handleNodeContextMenu}
                            onStartEdit={handleStartEdit}
                            onViewImage={handleViewImage}
                            onToggleActive={handleToggleActive}
                        />
                    );
                })}
            </div>

            {/* Top Level UI components */}
            {selectionBox && (
                <div
                    className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none z-50"
                    style={{
                        left: Math.min(selectionBox.start.x * scale + offset.x, selectionBox.end.x * scale + offset.x),
                        top: Math.min(selectionBox.start.y * scale + offset.y, selectionBox.end.y * scale + offset.y),
                        width: Math.abs(selectionBox.start.x - selectionBox.end.x) * scale,
                        height: Math.abs(selectionBox.start.y - selectionBox.end.y) * scale
                    }}
                />
            )}

            {contextMenu && (
                <div
                    className={`fixed z-[100] border rounded-xl shadow-2xl py-1 min-w-[200px] animate-in zoom-in-95 fade-in duration-150 origin-top-left ${glassPanelClass}`}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    {contextMenu.type === 'canvas' && (
                        <>
                            <button onClick={handleAddNodeAtCursor} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                                Add Block
                            </button>
                            <div className={`h-px my-1 ${isDarkMode ? 'bg-white/5' : 'bg-gray-200'}`} />
                            <button onClick={handleGlobalAutoLayout} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                                Organize All
                            </button>
                            <div className={`h-px my-1 ${isDarkMode ? 'bg-white/5' : 'bg-gray-200'}`} />
                        </>
                    )}

                    {contextMenu.type === 'node' && (
                        <>
                            <button onClick={async () => {
                                const node = nodes.find(n => n.id === contextMenu.targetId);
                                if (node && node.executionContext) {
                                    const formattedContextPromises = node.executionContext.map(async (part: any) => {
                                        if (part.text) return { type: 'text', content: part.text };
                                        if (part.inlineData) {
                                            // If we have an imageId, try to load the actual image from IndexedDB
                                            if (part.imageId) {
                                                try {
                                                    const actualImageData = await getImage(part.imageId);
                                                    if (actualImageData) {
                                                        return { type: 'image', content: actualImageData };
                                                    }
                                                } catch (err) {
                                                    console.error("Failed to load image from IndexedDB for modal:", err);
                                                }
                                            }
                                            // Fallback to what's in the part (which might be "(image data)")
                                            return { type: 'image', content: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
                                        }
                                        return null;
                                    });
                                    const formattedContext = (await Promise.all(formattedContextPromises)).filter(Boolean);
                                    setPromptModal({ isOpen: true, content: formattedContext });
                                }
                                setContextMenu(null);
                            }} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                                Show Prompt Context
                            </button>
                            <div className={`h-px my-1 ${isDarkMode ? 'bg-white/5' : 'bg-gray-200'}`} />
                        </>
                    )}

                    {contextMenu.targetId && groups.some(g => g.nodeIds.includes(contextMenu.targetId!)) && (
                        <>
                            <button onClick={() => handleRemoveFromGroup(contextMenu.targetId!)} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-orange-400' : 'hover:bg-black/5 hover:text-orange-600'}`}>
                                Remove from Group
                            </button>
                            <div className={`h-px my-1 ${isDarkMode ? 'bg-white/5' : 'bg-gray-200'}`} />
                        </>
                    )}

                    <button onClick={handleCreateGroup} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                        Group Selected
                    </button>
                    <button onClick={handleOrganizeSelected} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                        Organize Selected
                    </button>

                    <div className={`h-px my-1 ${isDarkMode ? 'bg-white/5' : 'bg-gray-200'}`} />

                    <button onClick={() => handleDeleteNodes(Array.from(selectedNodeIds))} className="w-full text-left px-4 py-2.5 text-xs font-medium text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                        Delete {selectedNodeIds.size > 1 ? `(${selectedNodeIds.size})` : 'Block'}
                    </button>
                </div>
            )}

            {contextMenu?.type === 'group' && contextMenu.targetId && (
                <div
                    className={`absolute z-[100] border rounded-xl shadow-2xl py-1 min-w-[160px] animate-in zoom-in-95 fade-in duration-150 origin-top-left ${glassPanelClass}`}
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button onClick={() => {
                        const g = groups.find(grp => grp.id === contextMenu.targetId);
                        if (g) setRenameGroupModal({ isOpen: true, groupId: g.id, currentTitle: g.title });
                        setContextMenu(null);
                    }} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                        Rename Group
                    </button>
                    <button onClick={() => handleOrganizeGroup(contextMenu.targetId!)} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                        Organize Group
                    </button>
                    <button onClick={() => handleDeleteGroup(contextMenu.targetId!)} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-orange-400' : 'hover:bg-black/5 hover:text-orange-600'}`}>
                        Ungroup
                    </button>
                </div>
            )}

            {/* --- Modals --- */}
            {promptModal && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setPromptModal(null)}>
                    <div
                        className={`border rounded-2xl shadow-2xl w-[600px] max-w-[90vw] flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200 ${glassPanelClass}`}
                        onClick={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                    >
                        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                            <h3 className={`font-bold text-sm uppercase tracking-wide ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Full Prompt Context</h3>
                            <button onClick={() => setPromptModal(null)} className="text-gray-400 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6 overflow-hidden flex-1 flex flex-col min-h-0">
                            <div className={`w-full border rounded-xl p-4 overflow-y-auto custom-scrollbar flex-1 ${isDarkMode ? 'bg-black/30 border-gray-800' : 'bg-gray-50 border-gray-200'}`} style={{ minHeight: '300px' }}>
                                {promptModal.content.map((item, idx) => (
                                    <div key={idx} className="mb-6 last:mb-0">
                                        {item.type === 'image' || (typeof item.content === 'string' && item.content.startsWith('data:image/')) ? (
                                            <div className="rounded-lg overflow-hidden border border-white/10 max-w-[300px] hover:border-white/30 transition-colors">
                                                <img src={item.content} alt="Context Image" className="w-full h-auto" />
                                            </div>
                                        ) : (
                                            <div className={`whitespace-pre-wrap text-sm font-mono leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                                {item.content}
                                            </div>
                                        )}
                                        {idx < promptModal.content.length - 1 && (
                                            <div className={`my-4 h-px border-t border-dashed ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className={`px-6 py-4 border-t flex justify-end ${isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-100 bg-gray-50'}`}>
                            <button onClick={() => setPromptModal(null)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {renameGroupModal && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setRenameGroupModal(null)}>
                    <div className={`border rounded-2xl shadow-2xl w-[320px] p-6 animate-in zoom-in-95 duration-200 ${glassPanelClass}`} onClick={(e) => e.stopPropagation()}>
                        <h3 className={`font-bold text-sm uppercase tracking-wide mb-4 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>Rename Group</h3>
                        <input
                            autoFocus
                            type="text"
                            className={`w-full border rounded-xl p-3 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${isDarkMode ? 'bg-black/30 border-gray-700 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                            value={renameGroupModal.currentTitle}
                            onChange={(e) => setRenameGroupModal(prev => prev ? { ...prev, currentTitle: e.target.value } : null)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameGroup();
                                if (e.key === 'Escape') setRenameGroupModal(null);
                            }}
                        />
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setRenameGroupModal(null)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>Cancel</button>
                            <button onClick={handleRenameGroup} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-blue-500/20">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {imageModal && (
                <div
                    className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md animate-in fade-in duration-200"
                    onClick={() => setImageModal(null)}
                >
                    <div className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center justify-center p-2 outline-none">
                        <img
                            src={imageModal}
                            alt="Full View"
                            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <button
                            className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-sm transition-colors border border-white/10"
                            onClick={() => setImageModal(null)}
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>
            )}

            {isMergeMode && (
                <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-[100] rounded-full shadow-2xl flex items-center gap-6 px-6 py-3 animate-in slide-in-from-bottom-6 duration-300 ring-1 ring-white/10 backdrop-blur-2xl border ${isDarkMode ? 'bg-gray-900/90 border-gray-700' : 'bg-white/90 border-gray-200'}`}>
                    <div className="flex flex-col">
                        <h3 className="text-emerald-500 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            Merge Mode
                        </h3>
                        <p className={`text-[10px] font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Select blocks in sequence</p>
                    </div>
                    <div className={`h-8 w-px ${isDarkMode ? 'bg-white/10' : 'bg-black/5'}`} />
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleCancelMergeMode}
                            className={`px-4 py-2 rounded-full text-xs font-bold transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-800 hover:bg-black/5'}`}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmMerge}
                            disabled={mergeSelection.length < 2}
                            className={`px-5 py-2 rounded-full text-xs font-bold transition-all shadow-lg ${mergeSelection.length >= 2
                                ? 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400 transform hover:scale-105'
                                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                }`}
                        >
                            Merge ({mergeSelection.length})
                        </button>
                    </div>
                </div>
            )}

            <div className={`absolute bottom-6 left-6 z-40 pointer-events-none transition-all duration-300 ${isMergeMode ? 'translate-y-20 opacity-0' : 'translate-y-0 opacity-100'}`}>
                <div className={`rounded-2xl p-1.5 flex items-center gap-1 pointer-events-auto ${glassPanelClass}`}>

                    {/* Settings Group */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className={iconButtonClass(showSettings)}
                            title="Settings"
                        >
                            <Settings className="w-4 h-4" />
                        </button>

                        {/* Settings Modal acts as a popover here */}
                        <SettingsModal
                            isOpen={showSettings}
                            onClose={() => setShowSettings(false)}
                            isDarkMode={isDarkMode}
                            setIsDarkMode={setIsDarkMode}
                            providerConfigs={providerConfigs}
                            setProviderConfigs={setProviderConfigs}
                        />
                    </div>

                    <div className={`w-px h-5 mx-1 ${dividerClass}`}></div>

                    {/* Merge Mode */}
                    <div className="flex items-center gap-0.5">
                        <button onClick={handleStartMergeMode} className={iconButtonClass()} title="Merge Mode">
                            <Merge className="w-4 h-4" />
                        </button>
                    </div>

                    <div className={`w-px h-5 mx-1 ${dividerClass}`}></div>

                    {/* File Group */}
                    <div className="flex items-center gap-0.5">
                         {/* Status Indicator */}
                         {fileHandle && (
                            <div className={`flex items-center gap-1.5 px-2 mr-1 h-8 rounded-lg border text-[10px] font-mono select-none ${isDarkMode ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isAutoSaving ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`} />
                                <span className={`max-w-[80px] truncate hidden sm:inline font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{fileHandle.name}</span>
                            </div>
                        )}
                        <button onClick={handleSaveCanvas} className={iconButtonClass()} title="Save Canvas As...">
                            <Download className="w-4 h-4" />
                        </button>
                        <button onClick={handleOpenFile} className={iconButtonClass()} title="Open File (Auto-Save)">
                            <Upload className="w-4 h-4" />
                        </button>
                    </div>

                    <div className={`w-px h-5 mx-1 ${dividerClass}`}></div>

                    {/* History Group */}
                    <div className="flex items-center gap-0.5">
                        <button onClick={handleUndo} disabled={!canUndo} className={iconButtonClass(false, !canUndo)} title="Undo (Ctrl+Z)">
                            <Undo2 className="w-4 h-4" />
                        </button>
                        <button onClick={handleRedo} disabled={!canRedo} className={iconButtonClass(false, !canRedo)} title="Redo (Ctrl+Y)">
                            <Redo2 className="w-4 h-4" />
                        </button>
                    </div>

                    <div className={`w-px h-5 mx-1 ${dividerClass}`}></div>

                    {/* Navigation Group */}
                    <div className="flex items-center gap-0.5">
                        <button onClick={zoomOut} className={iconButtonClass()} title="Zoom Out">
                            <ZoomOut className="w-4 h-4" />
                        </button>

                        <div
                            onClick={resetView}
                            className={`px-3 py-2.5 rounded-xl text-xs font-mono font-bold cursor-pointer transition-all ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`}
                            title="Reset View"
                        >
                            {Math.round(scale * 100)}%
                        </div>

                        <button onClick={zoomIn} className={iconButtonClass()} title="Zoom In">
                            <ZoomIn className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden File Input */}
            <input
                ref={loadCanvasInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleLoadCanvas}
            />
        </div>
    );
};

export default App;
