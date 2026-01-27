
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
    const [nodes, setNodes] = useState<NodeData[]>([
        {
            id: '1',
            type: 'text',
            source: 'user',
            content: '讲个100字以内的笑话',
            position: { x: 100, y: 100 },
            width: NODE_WIDTH,
            height: 150,
            ports: [uuidv4()],
            model: 'gemini-2.0-flash'
        },
    ]);
    const [edges, setEdges] = useState<EdgeData[]>([]);
    const [groups, setGroups] = useState<GroupData[]>([]);


    // Canvas Viewport State
    const {
        offset, setOffset,
        scale, setScale,
        isPanning, setIsPanning,
        zoomIn, zoomOut, resetView,
        handleWheel
    } = useViewport();

    const [isDarkMode, setIsDarkMode] = useState(true);

    // Keep a ref to nodes/edges/groups for async/event access without triggering re-renders or dependency updates
    const nodesRef = useRef<NodeData[]>(nodes);
    const edgesRef = useRef<EdgeData[]>(edges);
    const groupsRef = useRef<GroupData[]>(groups);

    // Ref for mouse position to avoid re-binding keyboard/paste events on mousemove
    const mousePosRef = useRef<Position>({ x: 0, y: 0 });

    useEffect(() => { nodesRef.current = nodes; }, [nodes]);
    useEffect(() => { edgesRef.current = edges; }, [edges]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

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

            if (storedKey || storedBaseUrl || storedModels) {
                setProviderConfigs(prev => ({
                    ...prev,
                    [provider]: {
                        ...prev[provider],
                        key: storedKey || prev[provider].key,
                        baseUrl: storedBaseUrl || '',
                        models: storedModels ? JSON.parse(storedModels) : prev[provider].models
                    }
                }));
            }
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

    const canvasRef = useRef<HTMLDivElement>(null);
    const loadCanvasInputRef = useRef<HTMLInputElement>(null);

    // Consolidate enabled models for node dropdowns
    const availableModelsList = useMemo(() => {
        const models: { value: string; label: string; category?: string }[] = [];

        Object.values(providerConfigs).forEach((conf: any) => {
            if (conf.models) {
                conf.models.forEach((m: any) => {
                    if (m.enabled) {
                        models.push({ value: m.value, label: m.label });
                    }
                });
            }
        });
        return models;
    }, [providerConfigs]);

    // Determine Default Model (Top-most configured model from any provider)
    const defaultModel = useMemo(() => {
        for (const config of Object.values(providerConfigs) as ProviderConfig[]) {
            if (config.models.length > 0) return config.models[0].value;
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

        setNodes(result.nodes);
        setEdges(result.edges);
        setGroups(result.groups);

        setSelectedNodeIds(new Set());
        setContextMenu(null);
    }, [saveHistory]);

    const handleToggleActive = (id: string) => {
        saveHistory();
        setNodes(prev => prev.map(n => n.id === id ? { ...n, isInactive: !n.isInactive } : n));
        setContextMenu(null);
    };

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
    const handleSaveCanvas = () => {
        const data = {
            nodes: nodesRef.current,
            edges: edgesRef.current,
            groups: groupsRef.current,
            offset,
            scale,
            version: "1.0"
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `gemini-canvas-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
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
                    setSelectedNodeIds(new Set()); // Also clear selection on Escape
                }
            }
        };

        // ... Global Paste Logic
        const handleGlobalPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const items = e.clipboardData?.items;
            if (!items) return;

            // Use mousePosRef for current position without needing to be in dependency array
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
                                    type: 'image',
                                    source: 'user',
                                    content: event.target.result as string,
                                    position: { x: currentMousePos.x, y: currentMousePos.y },
                                    width: NODE_WIDTH,
                                    height: 200,
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
    }, [selectedNodeIds, selectedEdgeId, selectedGroupId, selectionBox, isMergeMode, handleUndo, handleRedo, imageModal, handleDeleteNodes, saveHistory, defaultModel]);

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
        if (e.dataTransfer.types.includes('application/gemini-canvas-text') || e.dataTransfer.types.includes('Files')) {
            e.dataTransfer.dropEffect = 'copy';
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
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
                reader.onload = (event) => {
                    if (event.target?.result) {
                        const newNode: NodeData = {
                            id: uuidv4(),
                            type: 'image',
                            source: 'user',
                            content: event.target.result as string,
                            position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - 75 },
                            width: NODE_WIDTH,
                            height: 200,
                            ports: [uuidv4()],
                            model: defaultModel
                        };
                        setNodes(prev => [...prev, newNode]);
                    }
                };
                reader.readAsDataURL(file);
                return;
            }
        }

        saveHistory();

        const customData = e.dataTransfer.getData('application/gemini-canvas-text');
        if (customData) {
            const data = JSON.parse(customData);
            const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);

            const newNode: NodeData = {
                id: uuidv4(),
                type: 'text',
                source: 'user',
                content: data.content,
                position: { x: pos.x, y: pos.y },
                width: NODE_WIDTH,
                height: 150,
                ports: [uuidv4()],
                model: defaultModel
            };
            setNodes(prev => [...prev, newNode]);
            return;
        }

        const text = e.dataTransfer.getData('text/plain');
        if (text) {
            const pos = getCanvasPos(e.clientX, e.clientY, offset, scale);

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

    const handleAddImageNodeAtCursor = () => {
        if (!contextMenu) return;
        saveHistory();
        const pos = getCanvasPos(contextMenu.x, contextMenu.y, offset, scale);
        const newNode: NodeData = {
            id: uuidv4(),
            type: 'image',
            source: 'user',
            content: '',
            position: { x: pos.x, y: pos.y },
            width: NODE_WIDTH,
            height: 200,
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
                return { ...n, content: '', type: 'text', source: 'user' };
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
        const promptParts = sortedNodes.map(n => {
            if (n.isInactive) return null; // SKIP INACTIVE NODES

            const imageMatch = n.content.match(/^data:(image\/[a-z]+);base64,(.+)$/);
            if (imageMatch) {
                return { inlineData: { mimeType: imageMatch[1], data: imageMatch[2] } };
            } else if (n.type === 'image') {
                return null;
            } else {
                return { text: n.content };
            }
        }).filter(Boolean);

        if (promptParts.length === 0) return;

        let modelToUse = triggerNode.model;

        setNodes(prev => prev.map(n => n.id === triggerNodeId ? { ...n, isGenerating: true } : n));

        try {
            const responseParts = await generateContent(
                promptParts,
                modelToUse,
                {}, // Use default options as per new spec
                providerConfigs
            );

            // Prepare for update - Fetch latest state again in case it changed during await
            const latestNodes = [...nodesRef.current];
            const latestEdges = [...edgesRef.current];

            const freshTriggerIndex = latestNodes.findIndex(n => n.id === triggerNodeId);
            if (freshTriggerIndex === -1) return;

            latestNodes[freshTriggerIndex] = { ...latestNodes[freshTriggerIndex], isGenerating: false };

            let startIdx = 0;
            let predecessorId = triggerNodeId;

            if (isTriggerEmpty && responseParts.length > 0) {
                const firstPart = responseParts[0];
                latestNodes[freshTriggerIndex] = {
                    ...latestNodes[freshTriggerIndex],
                    content: firstPart.content,
                    type: firstPart.type,
                    source: 'ai',
                    executionContext: promptParts
                };
                startIdx = 1;
            }

            let currentX = latestNodes[freshTriggerIndex].position.x + NODE_WIDTH + 100; // Gap
            let currentY = latestNodes[freshTriggerIndex].position.y;

            for (let i = startIdx; i < responseParts.length; i++) {
                const part = responseParts[i];
                const newNodeId = uuidv4();
                const newPortId = uuidv4();

                // Find predecessor to determine source handle
                const predNodeIndex = latestNodes.findIndex(n => n.id === predecessorId);
                const predNode = latestNodes[predNodeIndex];

                // STRICTLY use the first port of the predecessor
                const sourceHandleId = predNode.ports[0];

                // If we are connecting to the only port available, add a new one to satisfy "generate second port" rule
                if (predNode.ports.length === 1) {
                    const nextPortId = uuidv4();
                    latestNodes[predNodeIndex] = {
                        ...predNode,
                        ports: [...predNode.ports, nextPortId]
                    };
                }

                const newNode: NodeData = {
                    id: newNodeId,
                    type: part.type,
                    source: 'ai',
                    content: part.content,
                    position: { x: currentX, y: currentY },
                    width: NODE_WIDTH,
                    height: part.type === 'image' ? 200 : 150,
                    ports: [newPortId], // Start with 1 port
                    model: modelToUse,
                    executionContext: promptParts
                };

                newNode.ports.push(uuidv4());

                latestNodes.push(newNode);

                const newEdge: EdgeData = {
                    id: uuidv4(),
                    source: predecessorId,
                    target: newNodeId,
                    sourceHandle: sourceHandleId,
                    targetHandle: newPortId,
                    color: getFlowColor(triggerNodeId)
                };
                latestEdges.push(newEdge);

                // Move cursor
                predecessorId = newNodeId;
                currentX += NODE_WIDTH + 100;
            }

            setNodes(latestNodes);
            setEdges(latestEdges);

        } catch (e) {
            console.error(e);
            setNodes(prev => prev.map(n => n.id === triggerNodeId ? { ...n, isGenerating: false } : n));
        }
    }, [providerConfigs, saveHistory]);



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
                        const start = getHandlePosition(edge.source, edge.sourceHandle, 'right', nodes);
                        const end = getHandlePosition(edge.target, edge.targetHandle, 'left', nodes);
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
                                const startPos = getHandlePosition(connectingHandle.nodeId, connectingHandle.handleId, 'right', nodes);
                                return startPos ? <ConnectionLine start={startPos} end={mousePos} color={connectingHandle.color} isTemp /> : null;
                            } else {
                                const endPos = getHandlePosition(connectingHandle.nodeId, connectingHandle.handleId, 'left', nodes);
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
                            isDragging={isDraggingNodes && (
                                selectedNodeIds.has(node.id) ||
                                (!!selectedGroupId && groups.find(g => g.id === selectedGroupId)?.nodeIds.includes(node.id))
                            )}
                            availableModels={availableModelsList}
                            activeDragHandleId={activeDragHandleId}
                            onUpdate={handleUpdateNode}
                            onUpdateModel={handleUpdateNodeModel}
                            onUpdateConfig={handleUpdateNodeConfig}
                            onDelete={(id) => handleDeleteNodes([id])}
                            onGenerate={handleGenerate}
                            onClear={handleClearNode}
                            onMouseDown={handleNodeMouseDown}
                            onConnectStart={handleConnectStart}
                            onConnectEnd={handleConnectEnd}
                            onContextMenu={handleNodeContextMenu}
                            onStartEdit={() => saveHistory()}
                            onViewImage={(url) => setImageModal(url)}
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
                                Add Text Block
                            </button>
                            <button onClick={handleAddImageNodeAtCursor} className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${isDarkMode ? 'hover:bg-white/10 hover:text-blue-400' : 'hover:bg-black/5 hover:text-blue-600'}`}>
                                Add Image Block
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
                            <button onClick={() => {
                                const node = nodes.find(n => n.id === contextMenu.targetId);
                                if (node && node.executionContext) {
                                    const formattedContext = node.executionContext.map((part: any) => {
                                        if (part.text) return { type: 'text', content: part.text };
                                        if (part.inlineData) return { type: 'image', content: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
                                        return null;
                                    }).filter(Boolean);
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
                        <button onClick={handleSaveCanvas} className={iconButtonClass()} title="Save Canvas">
                            <Download className="w-4 h-4" />
                        </button>
                        <button onClick={() => loadCanvasInputRef.current?.click()} className={iconButtonClass()} title="Load Canvas">
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
