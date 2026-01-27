
import { v4 as uuidv4 } from 'uuid';
import { NodeData, EdgeData, Position, GroupData } from '../types';

export const getCanvasPos = (clientX: number, clientY: number, offset: Position, scale: number): Position => {
    return {
        x: (clientX - offset.x) / scale,
        y: (clientY - offset.y) / scale,
    };
};

export const getHandlePosition = (nodeId: string, handleId: string, side: 'left' | 'right', nodes: NodeData[]): Position | null => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;

    const index = node.ports.indexOf(handleId);
    if (index === -1) return null;

    const y = node.position.y + 50 + (index * 28) + 28; // Center of the port handle (16px offset + 12px halfway point of w-6/h-6 container)
    const x = side === 'left' ? node.position.x : node.position.x + node.width;

    return { x, y };
};

export const getCleanedPorts = (node: NodeData, currentEdges: EdgeData[]) => {
    const activePorts = new Set<string>();
    currentEdges.forEach(e => {
        if (e.source === node.id && e.sourceHandle) activePorts.add(e.sourceHandle);
        if (e.target === node.id && e.targetHandle) activePorts.add(e.targetHandle);
    });

    let newPorts = [...node.ports];
    while (newPorts.length > 1) {
        const lastIndex = newPorts.length - 1;
        const lastPort = newPorts[lastIndex];
        const secondLastPort = newPorts[lastIndex - 1];
        const isLastActive = activePorts.has(lastPort);

        if (isLastActive) {
            break;
        } else {
            const isSecondLastActive = activePorts.has(secondLastPort);
            if (!isSecondLastActive) {
                newPorts.pop();
            } else {
                break;
            }
        }
    }
    return newPorts;
};

export const performLayout = (targetNodes: NodeData[], targetEdges: EdgeData[], originX: number = 100, originY: number = 100): NodeData[] => {
    if (targetNodes.length === 0) return [];

    const targetNodeIds = new Set(targetNodes.map(n => n.id));

    // 1. Assign Levels (Longest Path Layering)
    const levels = new Map<string, number>();
    targetNodes.forEach(n => levels.set(n.id, 0));

    for (let i = 0; i < targetNodes.length + 1; i++) {
        let changed = false;
        targetEdges.forEach(e => {
            if (targetNodeIds.has(e.source) && targetNodeIds.has(e.target)) {
                const uLvl = levels.get(e.source) || 0;
                const vLvl = levels.get(e.target) || 0;
                if (vLvl < uLvl + 1) {
                    levels.set(e.target, uLvl + 1);
                    changed = true;
                }
            }
        });
        if (!changed) break;
    }

    const maxLevel = Math.max(...Array.from(levels.values()));
    const levelGroups: string[][] = Array.from({ length: maxLevel + 1 }, () => []);

    const sortedNodes = [...targetNodes].sort((a, b) => a.position.y - b.position.y);
    sortedNodes.forEach(n => {
        const lvl = levels.get(n.id)!;
        levelGroups[lvl].push(n.id);
    });

    // 2. Coordinate Assignment
    const HORIZONTAL_SPACING = 350;
    const VERTICAL_SPACING = 200;

    return targetNodes.map(node => {
        const level = levels.get(node.id) || 0;
        const indexInGroup = levelGroups[level].indexOf(node.id);

        return {
            ...node,
            position: {
                x: originX + level * HORIZONTAL_SPACING,
                y: originY + indexInGroup * VERTICAL_SPACING
            }
        };
    });
};

/**
 * Traverses the graph backwards from a trigger node to find the execution context sequence.
 * Returns sorted list of nodes that form the context.
 */
export const getExecutionSequence = (
    triggerNodeId: string,
    nodes: NodeData[],
    edges: EdgeData[]
): { sequence: NodeData[], ancestorEdgeIds: Set<string> } => {

    const visitedNodes = new Set<string>();
    const ancestorEdges = new Set<string>();
    const stack: { nodeId: string; inputPortId?: string }[] = [{ nodeId: triggerNodeId }];

    while (stack.length > 0) {
        const { nodeId, inputPortId } = stack.pop()!;
        visitedNodes.add(nodeId);

        // Find edges targeting this node (and specific port if applicable)
        const incoming = edges.filter(e => {
            if (e.target !== nodeId) return false;
            if (inputPortId && e.targetHandle !== inputPortId) return false;
            return true;
        });

        incoming.forEach(edge => {
            ancestorEdges.add(edge.id);
            stack.push({ nodeId: edge.source, inputPortId: edge.sourceHandle });
        });
    }

    const sequence = nodes
        .filter(n => visitedNodes.has(n.id))
        .sort((a, b) => a.position.x - b.position.x);

    return { sequence, ancestorEdgeIds: ancestorEdges };
};

/**
 * Calculates graph state after deleting nodes, including edge bridging and subtree shifting.
 */
export const calculateDeletionEffects = (
    nodes: NodeData[],
    edges: EdgeData[],
    groups: GroupData[],
    deletedNodeIds: string[]
) => {
    const idsSet = new Set(deletedNodeIds);

    // Separate edges
    const incomingEdges: EdgeData[] = [];
    const outgoingEdges: EdgeData[] = [];
    const remainingEdges: EdgeData[] = [];

    edges.forEach(edge => {
        const sourceDeleted = idsSet.has(edge.source);
        const targetDeleted = idsSet.has(edge.target);

        if (sourceDeleted && targetDeleted) {
            return; // Delete internal edges
        } else if (sourceDeleted) {
            outgoingEdges.push(edge);
        } else if (targetDeleted) {
            incomingEdges.push(edge);
        } else {
            remainingEdges.push(edge);
        }
    });

    // Bridge Edges
    const bridgedEdges: EdgeData[] = [];

    deletedNodeIds.forEach(deletedId => {
        const node = nodes.find(n => n.id === deletedId);
        if (!node) return;

        const relevantIncoming = incomingEdges.filter(e => e.target === deletedId);
        const relevantOutgoing = outgoingEdges.filter(e => e.source === deletedId);

        node.ports.forEach(portId => {
            const portInEdges = relevantIncoming.filter(e => e.targetHandle === portId);
            const portOutEdges = relevantOutgoing.filter(e => e.sourceHandle === portId);

            portInEdges.forEach(inEdge => {
                portOutEdges.forEach(outEdge => {
                    const exists = bridgedEdges.some(ne =>
                        ne.source === inEdge.source &&
                        ne.target === outEdge.target &&
                        ne.sourceHandle === inEdge.sourceHandle &&
                        ne.targetHandle === outEdge.targetHandle
                    ) || remainingEdges.some(re =>
                        re.source === inEdge.source &&
                        re.target === outEdge.target &&
                        re.sourceHandle === inEdge.sourceHandle &&
                        re.targetHandle === outEdge.targetHandle
                    );

                    if (!exists) {
                        bridgedEdges.push({
                            id: uuidv4(),
                            source: inEdge.source,
                            target: outEdge.target,
                            sourceHandle: inEdge.sourceHandle,
                            targetHandle: outEdge.targetHandle,
                            color: inEdge.color
                        });
                    }
                });
            });
        });
    });

    const finalEdges = [...remainingEdges, ...bridgedEdges];

    // Process Nodes (and shift subtrees)
    let nextNodes = nodes
        .filter(n => !idsSet.has(n.id))
        .map(n => ({ ...n, position: { ...n.position } })); // Deep copy positions

    // Subtree Shifting Logic
    const movedNodesSet = new Set<string>();
    const shiftSubtreeLeft = (rootId: string, deltaX: number) => {
        if (movedNodesSet.has(rootId)) return;
        movedNodesSet.add(rootId);

        const node = nextNodes.find(n => n.id === rootId);
        if (node) {
            node.position.x += deltaX;
            const children = finalEdges
                .filter(e => e.source === rootId)
                .map(e => e.target);
            children.forEach(childId => shiftSubtreeLeft(childId, deltaX));
        }
    };

    bridgedEdges.forEach(edge => {
        const parent = nextNodes.find(n => n.id === edge.source);
        const child = nextNodes.find(n => n.id === edge.target);

        if (parent && child) {
            const IDEAL_GAP = 400;
            const currentDist = child.position.x - parent.position.x;
            if (currentDist > IDEAL_GAP + 50) {
                const shiftAmount = IDEAL_GAP - currentDist;
                shiftSubtreeLeft(child.id, shiftAmount);
            }
        }
    });

    // Clean ports for remaining nodes
    nextNodes = nextNodes.map(node => ({
        ...node,
        ports: getCleanedPorts(node, finalEdges)
    }));

    // Update Groups
    const nextGroups = groups.map(g => ({
        ...g,
        nodeIds: g.nodeIds.filter(nid => !idsSet.has(nid))
    })).filter(g => g.nodeIds.length > 0);

    return {
        nodes: nextNodes,
        edges: finalEdges,
        groups: nextGroups
    };
};

/**
 * Calculates graph state after merging multiple nodes into one.
 */
export const calculateMergeEffects = (
    nodes: NodeData[],
    edges: EdgeData[],
    groups: GroupData[],
    mergeNodeIds: string[],
    NODE_WIDTH: number = 300
) => {
    const nodesToMerge = mergeNodeIds.map(id => nodes.find(n => n.id === id)).filter(n => n !== undefined) as NodeData[];
    if (nodesToMerge.length === 0) return null;

    const mergedContent = nodesToMerge
        .map(n => n.content)
        .filter(text => text.trim().length > 0)
        .join('\n\n');

    const minX = Math.min(...nodesToMerge.map(n => n.position.x));
    const minY = Math.min(...nodesToMerge.map(n => n.position.y));

    const newNodeId = uuidv4();
    const newPortId = uuidv4();

    const newNode: NodeData = {
        id: newNodeId,
        type: 'text',
        source: 'user',
        content: mergedContent,
        position: { x: minX, y: minY },
        width: NODE_WIDTH,
        height: 150,
        ports: [newPortId],
        model: nodesToMerge[0]?.model || 'gemini-2.0-flash'
    };

    const newEdges: EdgeData[] = [];
    const seenConnections = new Set<string>();

    edges.forEach(edge => {
        const isSourceSelected = mergeNodeIds.includes(edge.source);
        const isTargetSelected = mergeNodeIds.includes(edge.target);

        // Remove internal edges
        if (isSourceSelected && isTargetSelected) return;

        if (isTargetSelected) {
            // Incoming to merge group -> Point to new node
            const key = `${edge.source}:${edge.sourceHandle}-${newNodeId}:${newPortId}`;
            if (!seenConnections.has(key)) {
                newEdges.push({
                    id: uuidv4(),
                    source: edge.source,
                    sourceHandle: edge.sourceHandle,
                    target: newNodeId,
                    targetHandle: newPortId,
                    color: edge.color
                });
                seenConnections.add(key);
            }
        } else if (isSourceSelected) {
            // Outgoing from merge group -> Source from new node
            const key = `${newNodeId}:${newPortId}-${edge.target}:${edge.targetHandle}`;
            if (!seenConnections.has(key)) {
                newEdges.push({
                    id: uuidv4(),
                    source: newNodeId,
                    sourceHandle: newPortId,
                    target: edge.target,
                    targetHandle: edge.targetHandle,
                    color: edge.color
                });
                seenConnections.add(key);
            }
        } else {
            // Unrelated edge
            newEdges.push(edge);
        }
    });

    const nextNodes = [
        ...nodes.filter(n => !mergeNodeIds.includes(n.id)),
        newNode
    ];

    const nextGroups = groups.map(g => ({
        ...g,
        nodeIds: g.nodeIds.filter(nid => !mergeNodeIds.includes(nid))
    })).filter(g => g.nodeIds.length > 0);

    return {
        nodes: nextNodes,
        edges: newEdges,
        groups: nextGroups,
        newNode
    };
};
