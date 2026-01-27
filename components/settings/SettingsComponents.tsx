
import React from 'react';

interface TutorialCardProps {
    icon: React.ReactNode;
    title: string;
    content: React.ReactNode;
    isDarkMode: boolean;
}

export const TutorialCard: React.FC<TutorialCardProps> = ({ icon, title, content, isDarkMode }) => (
    <div className={`p-4 rounded-xl border flex flex-col gap-3 transition-colors ${isDarkMode ? 'bg-gray-800/40 border-gray-700 hover:bg-gray-800' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm'}`}>
        <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${isDarkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-600'}`}>
                {icon}
            </div>
            <h4 className="text-xs font-bold uppercase tracking-wider">{title}</h4>
        </div>
        <div className="text-[11px] leading-relaxed opacity-80 pl-1">
            {content}
        </div>
    </div>
);

interface ShortcutItemProps {
    keys: string[];
    description: string;
    isDarkMode: boolean;
}

export const ShortcutItem: React.FC<ShortcutItemProps> = ({ keys, description, isDarkMode }) => (
    <div className={`flex items-center justify-between p-3 rounded-xl border mb-2 transition-colors ${isDarkMode ? 'bg-gray-800/40 border-gray-700 hover:bg-gray-800' : 'bg-white border-gray-200 hover:border-gray-300 shadow-sm'}`}>
        <span className="text-xs font-medium opacity-80">{description}</span>
        <div className="flex gap-1.5">
            {keys.map((k, i) => (
                <span key={i} className={`text-[10px] font-mono font-bold px-1.5 py-1 rounded-md border min-w-[24px] text-center flex items-center justify-center ${isDarkMode ? 'bg-black/40 border-gray-600 text-gray-300 shadow-inner' : 'bg-gray-100 border-gray-200 text-gray-600 shadow-inner'}`}>
                    {k}
                </span>
            ))}
        </div>
    </div>
);
