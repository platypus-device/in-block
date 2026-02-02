import { GoogleGenAI } from "@google/genai";
import { ProviderConfig } from "../types";

export interface GeneratedPart {
    type: 'text' | 'image';
    content: string;
}

export interface AIModel {
    id: string;
    displayName: string;
    description: string;
}

export interface GenerationOptions {
    temperature?: number;
    signal?: AbortSignal;
}

/**
 * Generates content based on a prompt (string or multimodal parts) using the appropriate provider.
 */
export const generateContent = async (
    input: string | Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    model: string = 'gemini-2.0-flash',
    options: GenerationOptions = {},
    configs?: Record<string, ProviderConfig>
): Promise<GeneratedPart[]> => {
    // Determine the provider based on the model ID or value
    let provider = 'gemini';
    let actualModelValue = model;

    if (configs) {
        for (const [p, config] of Object.entries(configs)) {
            // Find by unique configuration ID first, then fallback to value (model name)
            const found = config.models.find(m => m.id === model || m.value === model);
            if (found) {
                provider = p;
                actualModelValue = found.value;
                break;
            }
        }
    }

    if (provider === 'openai') {
        return generateOpenAIContent(input, model, actualModelValue, options, configs?.['openai']);
    }

    if (provider === 'anthropic') {
        return generateAnthropicContent(input, model, actualModelValue, options, configs?.['anthropic']);
    }

    // Default to Gemini
    return generateGeminiContent(input, model, actualModelValue, options, configs?.['gemini']);
};

const generateGeminiContent = async (
    input: string | Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    modelId: string,
    actualModel: string,
    options: GenerationOptions,
    config?: ProviderConfig
): Promise<GeneratedPart[]> => {
    try {
        const apiKey = config?.key;
        if (!apiKey) return [{ type: 'text', content: "Error: Gemini API Key is missing." }];

        const modelConfig = config?.models.find(m => m.id === modelId || m.value === modelId);
        const ai = new GoogleGenAI({ apiKey: apiKey });

        let contents;
        if (typeof input === 'string') {
            contents = input;
        } else {
            contents = { parts: input };
        }

        const requestPayload: any = {
            model: actualModel,
            contents: contents,
            ...(modelConfig?.config || {})
        };

        if (!modelConfig?.config && !requestPayload.generationConfig) {
            requestPayload.generationConfig = { temperature: options.temperature ?? 1 };
        }

        // The @google/genai SDK (v1.38.0) generateContent expects only the payload.
        // Signal can be passed if supported by the SDK version, but here it caused an error.
        const response = await ai.models.generateContent(requestPayload);
        const parts: GeneratedPart[] = [];
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text?.trim()) parts.push({ type: 'text', content: part.text });
                else if (part.inlineData) {
                    parts.push({ type: 'image', content: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
                }
            }
        }
        return parts.length > 0 ? parts : [{ type: 'text', content: response.text || "No response." }];
    } catch (error: any) {
        return [{ type: 'text', content: `Error (Gemini): ${error.message || error}` }];
    }
};

const generateOpenAIContent = async (
    input: string | Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    modelId: string,
    actualModel: string,
    options: GenerationOptions,
    config?: ProviderConfig
): Promise<GeneratedPart[]> => {
    try {
        const apiKey = config?.key;
        if (!apiKey) return [{ type: 'text', content: "Error: API Key is missing." }];

        const modelConfig = config?.models.find(m => m.id === modelId || m.value === modelId);
        const baseUrl = config?.baseUrl || 'https://api.openai.com/v1';

        const messages: any[] = [];
        if (typeof input === 'string') {
            messages.push({ role: 'user', content: input });
        } else {
            const content = input.map(part => {
                if (part.text) return { type: 'text', text: part.text };
                if (part.inlineData) {
                    return { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } };
                }
                return null;
            }).filter(Boolean);
            messages.push({ role: 'user', content });
        }

        let body: any = {
            model: actualModel,
            messages: messages,
            temperature: options.temperature ?? 1,
            ...modelConfig?.config
        };

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: options.signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return [{ type: 'text', content: data.choices?.[0]?.message?.content || "No response." }];
    } catch (error: any) {
        return [{ type: 'text', content: `Error (OpenAI Format): ${error.message || error}` }];
    }
};

const generateAnthropicContent = async (
    input: string | Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
    modelId: string,
    actualModel: string,
    options: GenerationOptions,
    config?: ProviderConfig
): Promise<GeneratedPart[]> => {
    try {
        const apiKey = config?.key;
        if (!apiKey) return [{ type: 'text', content: "Error: Anthropic API Key is missing." }];

        const modelConfig = config?.models.find(m => m.id === modelId || m.value === modelId);
        const baseUrl = config?.baseUrl || 'https://api.anthropic.com/v1';

        const messages: any[] = [];
        if (typeof input === 'string') {
            messages.push({ role: 'user', content: input });
        } else {
            const content = input.map(part => {
                if (part.text) return { type: 'text', text: part.text };
                if (part.inlineData) {
                    return {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: part.inlineData.mimeType,
                            data: part.inlineData.data
                        }
                    };
                }
                return null;
            }).filter(Boolean);
            messages.push({ role: 'user', content });
        }

        let body: any = {
            model: actualModel,
            messages: messages,
            max_tokens: 4096, // Anthropic requires max_tokens
            temperature: options.temperature ?? 1,
            ...modelConfig?.config
        };

        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
                'dangerously-allow-browser': 'true' // In some environments
            } as any,
            body: JSON.stringify(body),
            signal: options.signal
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return [{ type: 'text', content: data.content?.[0]?.text || "No response." }];
    } catch (error: any) {
        return [{ type: 'text', content: `Error (Anthropic): ${error.message || error}` }];
    }
};

export const getGeminiModels = async (apiKey: string): Promise<AIModel[]> => {
    if (!apiKey) return [];
    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const response = await ai.models.list();
        const models = [];
        for await (const model of response) { models.push(model); }
        return models.map((m: any) => ({
            id: m.name.replace(/^models\//, ''),
            displayName: m.displayName || m.name,
            description: m.description || ''
        }));
    } catch (error: any) { throw new Error(error.message); }
};

export const getOpenAIModels = async (apiKey: string, baseUrl?: string): Promise<AIModel[]> => {
    try {
        const finalUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const response = await fetch(`${finalUrl}/models`, {
            headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        // OpenRouter or OpenAI format
        const modelList = data.data || data;
        return modelList.map((m: any) => ({
            id: m.id,
            displayName: m.name || m.id,
            description: m.description || ''
        }));
    } catch (error: any) { throw new Error(error.message); }
};

export const getAnthropicModels = async (): Promise<AIModel[]> => {
    // Anthropic doesn't have a public "list models" API, return common ones
    return [
        { id: 'claude-3-5-sonnet-20240620', displayName: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
        { id: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', description: 'Powerful' },
        { id: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet', description: 'Balanced' },
        { id: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', description: 'Fast and cheap' },
    ];
};
