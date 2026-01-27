
import { useCallback, Dispatch, SetStateAction, MutableRefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { NodeData, EdgeData, Position, ProviderType, ProviderConfig } from '../types';
import { getCanvasPos } from '../utils/graph';

export const useNodeInteractions = (
    nodes: NodeData[],
    setNodes: Dispatch<SetStateAction<NodeData[]>>,
    edges: EdgeData[],
    setEdges: Dispatch<SetStateAction<EdgeData[]>>,
    selectedNodeIds: Set<string>,
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>,
    scale: number,
    offset: Position,
    saveHistory: () => void
) => {
    const handleAddNode = useCallback((type: 'text' | 'image', pos?: Position) => {
        saveHistory();
        const newNode: NodeData = {
            id: uuidv4(),
            type,
            source: 'user',
            content: type === 'text' ? '' : '',
            position: pos || { x: 100, y: 100 },
            width: 300,
            height: type === 'image' ? 200 : 150,
            ports: [uuidv4(), uuidv4()]
        };
        setNodes(prev => [...prev, newNode]);
    }, [saveHistory, setNodes]);

    const handleDeleteNodes = useCallback((ids: string[]) => {
        saveHistory();
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setEdges(prev => prev.filter(e => !ids.includes(e.source) && !ids.includes(e.target)));
        setSelectedNodeIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
        });
    }, [saveHistory, setNodes, setEdges, setSelectedNodeIds]);

    const handleConnect = useCallback((source: string, sourceHandle: string | undefined, target: string, targetHandle: string | undefined, color?: string) => {
        saveHistory();
        const newEdge: EdgeData = {
            id: uuidv4(),
            source,
            sourceHandle: sourceHandle || '',
            target,
            targetHandle: targetHandle || '',
            color: color || '#3b82f6'
        };
        setEdges(prev => [...prev, newEdge]);
    }, [saveHistory, setEdges]);

    return {
        handleAddNode,
        handleDeleteNodes,
        handleConnect
    };
};
