import React, { useMemo } from 'react';
import { GroupData, NodeData } from '../types';

interface GroupLayerProps {
  groups: GroupData[];
  nodes: NodeData[];
  selectedGroupId: string | null;
  isDarkMode: boolean;
  onContextMenu: (e: React.MouseEvent, group: GroupData) => void;
  onMouseDown: (e: React.MouseEvent, groupId: string) => void;
}

export const GroupLayer: React.FC<GroupLayerProps> = ({ groups, nodes, selectedGroupId, isDarkMode, onContextMenu, onMouseDown }) => {
  
  // Calculate bounding boxes for groups dynamically
  const groupRects = useMemo(() => {
    return groups.map(group => {
      const groupNodes = nodes.filter(n => group.nodeIds.includes(n.id));
      if (groupNodes.length === 0) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      groupNodes.forEach(n => {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
        if (n.position.x + n.width > maxX) maxX = n.position.x + n.width;
        // Estimate height roughly since actual height is dynamic, or use a safe buffer
        const nodeHeight = n.height || 150; 
        if (n.position.y + nodeHeight > maxY) maxY = n.position.y + nodeHeight;
      });

      const padding = 40; // Space for title and breathing room

      return {
        ...group,
        x: minX - padding,
        y: minY - padding * 1.5, // Extra top padding for title
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2.5)
      };
    }).filter(Boolean);
  }, [groups, nodes]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {groupRects.map(g => {
        if (!g) return null;
        const isSelected = g.id === selectedGroupId;

        // Dynamic styles based on theme
        const defaultBorder = isDarkMode ? 'border-gray-600/50' : 'border-gray-400/50';
        const defaultBg = isDarkMode ? 'bg-gray-800/20' : 'bg-gray-200/20';
        const hoverBorder = 'hover:border-blue-500/50';

        return (
          <div
            key={g.id}
            className={`absolute rounded-xl backdrop-blur-[2px] pointer-events-auto cursor-grab active:cursor-grabbing transition-colors duration-200 border-2 border-dashed ${
                isSelected 
                  ? "border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.3)]" 
                  : `${defaultBorder} ${defaultBg} ${hoverBorder}`
            }`}
            style={{
              left: g.x,
              top: g.y,
              width: g.width,
              height: g.height,
            }}
            onContextMenu={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onContextMenu(e, g);
            }}
            onMouseDown={(e) => onMouseDown(e, g.id)}
          >
            <div className={`absolute -top-8 left-0 text-lg font-bold px-2 py-1 truncate max-w-full select-none transition-colors duration-200 ${
                isSelected 
                    ? "text-blue-400" 
                    : (isDarkMode ? "text-blue-200/80" : "text-blue-600/80")
            }`}>
              {g.title}
            </div>
          </div>
        );
      })}
    </div>
  );
};