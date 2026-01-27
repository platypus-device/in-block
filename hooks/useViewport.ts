
import React, { useState, useCallback } from 'react';
import { Position } from '../types';

export const useViewport = () => {
    const [offset, setOffset] = useState<Position>({ x: 0, y: 0 });
    const [scale, setScale] = useState<number>(1);
    const [isPanning, setIsPanning] = useState(false);

    const zoomIn = useCallback(() => {
        const centerScreenX = window.innerWidth / 2;
        const centerScreenY = window.innerHeight / 2;
        const newScale = Math.min(scale * 1.2, 5);
        const worldX = (centerScreenX - offset.x) / scale;
        const worldY = (centerScreenY - offset.y) / scale;
        const newOffsetX = centerScreenX - worldX * newScale;
        const newOffsetY = centerScreenY - worldY * newScale;
        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
    }, [scale, offset]);

    const zoomOut = useCallback(() => {
        const centerScreenX = window.innerWidth / 2;
        const centerScreenY = window.innerHeight / 2;
        const newScale = Math.max(scale / 1.2, 0.1);
        const worldX = (centerScreenX - offset.x) / scale;
        const worldY = (centerScreenY - offset.y) / scale;
        const newOffsetX = centerScreenX - worldX * newScale;
        const newOffsetY = centerScreenY - worldY * newScale;
        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
    }, [scale, offset]);

    const resetView = useCallback(() => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    }, []);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.min(Math.max(0.1, scale + delta), 5);

        const screenX = e.clientX;
        const screenY = e.clientY;

        const worldX = (screenX - offset.x) / scale;
        const worldY = (screenY - offset.y) / scale;
        const newOffsetX = screenX - worldX * newScale;
        const newOffsetY = screenY - worldY * newScale;

        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
    }, [scale, offset]);

    return {
        offset,
        setOffset,
        scale,
        setScale,
        isPanning,
        setIsPanning,
        zoomIn,
        zoomOut,
        resetView,
        handleWheel
    };
};
