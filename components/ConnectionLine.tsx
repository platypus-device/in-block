import React from 'react';
import { Position } from '../types';

interface ConnectionLineProps {
  id?: string;
  start: Position;
  end: Position;
  isTemp?: boolean;
  isSelected?: boolean;
  isUpstream?: boolean; // New prop for upstream highlighting
  color?: string;
  onClick?: (e: React.MouseEvent, id: string) => void;
  onDoubleClick?: (e: React.MouseEvent, id: string) => void;
}

export const ConnectionLine: React.FC<ConnectionLineProps> = React.memo(({ 
  id, 
  start, 
  end, 
  isTemp = false, 
  isSelected = false,
  isUpstream = false,
  color = "#4b5563",
  onClick,
  onDoubleClick
}) => {
  // Calculate Bezier control points for a smooth S-curve
  const midX = (start.x + end.x) / 2;
  const path = `M ${start.x} ${start.y} C ${midX} ${start.y} ${midX} ${end.y} ${end.x} ${end.y}`;
  
  // Color Logic
  let strokeColor = color || "#4b5563";
  let strokeWidth = "2";
  let filter = "none";

  if (isSelected) {
      strokeColor = "#3b82f6"; // Blue-500
      strokeWidth = "3";
      filter = 'drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))';
  } else if (isUpstream) {
      strokeColor = "#8b5cf6"; // Violet-500
      strokeWidth = "3";
      filter = 'drop-shadow(0 0 4px rgba(139, 92, 246, 0.5))';
  } else if (isTemp) {
      strokeColor = color || "#60a5fa";
  }

  return (
    <g className="group">
      {/* Invisible wide path for easier hit testing */}
      {!isTemp && id && (
        <path
          d={path}
          stroke="transparent"
          strokeWidth="20"
          fill="none"
          className="cursor-pointer pointer-events-auto"
          onClick={(e) => onClick && onClick(e, id)}
          onDoubleClick={(e) => onDoubleClick && onDoubleClick(e, id)}
        />
      )}
      
      {/* Visible path */}
      <path
        d={path}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={isTemp ? "5,5" : "none"}
        className={`transition-[stroke,stroke-width,filter] duration-300 pointer-events-none ${!isTemp && !isSelected && !isUpstream ? 'group-hover:stroke-gray-400' : ''}`}
        style={{ filter }}
      />
      
      {isTemp && (
         <circle cx={end.x} cy={end.y} r="3" fill={strokeColor} />
      )}
    </g>
  );
});