
import React, { useRef, useState, useCallback } from 'react';
import { NodeData, EdgeData, GroupData, Position, CanvasState } from '../types';

export const useHistory = (
    nodes: NodeData[],
    edges: EdgeData[],
    groups: GroupData[],
    scale: number,
    offset: Position,
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>,
    setEdges: React.Dispatch<React.SetStateAction<EdgeData[]>>,
    setGroups: React.Dispatch<React.SetStateAction<GroupData[]>>
) => {
    const historyRef = useRef<CanvasState[]>([]);
    const redoStackRef = useRef<CanvasState[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // Keep internal refs to avoid dependency loops if needed, 
    // though passing them as args is fine if we use them carefully.

    const saveHistory = useCallback(() => {
        const snapshot: CanvasState = {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
            groups: JSON.parse(JSON.stringify(groups)),
            scale: scale,
            offset: offset
        };

        const last = historyRef.current[historyRef.current.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snapshot)) {
            return; // No change
        }

        historyRef.current.push(snapshot);
        if (historyRef.current.length > 20) historyRef.current.shift();
        redoStackRef.current = [];

        setCanUndo(true);
        setCanRedo(false);
    }, [nodes, edges, groups, scale, offset]);

    const handleUndo = useCallback(() => {
        if (historyRef.current.length === 0) return;

        const currentSnapshot: CanvasState = {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
            groups: JSON.parse(JSON.stringify(groups)),
            scale: scale,
            offset: offset
        };
        redoStackRef.current.push(currentSnapshot);

        const previous = historyRef.current.pop();
        if (previous) {
            setNodes(previous.nodes);
            setEdges(previous.edges);
            setGroups(previous.groups);
        }

        setCanUndo(historyRef.current.length > 0);
        setCanRedo(true);
    }, [nodes, edges, groups, scale, offset, setNodes, setEdges, setGroups]);

    const handleRedo = useCallback(() => {
        if (redoStackRef.current.length === 0) return;

        const currentSnapshot: CanvasState = {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
            groups: JSON.parse(JSON.stringify(groups)),
            scale: scale,
            offset: offset
        };
        historyRef.current.push(currentSnapshot);

        const next = redoStackRef.current.pop();
        if (next) {
            setNodes(next.nodes);
            setEdges(next.edges);
            setGroups(next.groups);
        }

        setCanUndo(true);
        setCanRedo(redoStackRef.current.length > 0);
    }, [nodes, edges, groups, scale, offset, setNodes, setEdges, setGroups]);

    return { saveHistory, handleUndo, handleRedo, canUndo, canRedo };
};
