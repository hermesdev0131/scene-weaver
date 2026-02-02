import { useState, useCallback, useRef } from 'react';
import { Character, ScenePrompt, GenerationState, ApiKeyConfig } from '@/types/prompt';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const WORDS_PER_SECOND = 2.5;
const SCENE_DURATION = 8;
const WORDS_PER_SCENE = WORDS_PER_SECOND * SCENE_DURATION;

interface ScriptAnalysis {
  characters: Character[];
  era: string;
  scenes: string[];
}

export function useGeminiApi() {
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    currentScene: 0,
    totalScenes: 0,
    error: null,
  });

  const [apiKeys, setApiKeys] = useState<ApiKeyConfig>(() => {
    const stored = localStorage.getItem('gemini_api_keys');
    return stored ? JSON.parse(stored) : { keys: [], currentIndex: 0 };
  });

  // Store last analysis for regeneration
  const lastAnalysisRef = useRef<ScriptAnalysis | null>(null);
  const lastVisualStyleRef = useRef<string>('');

  const saveApiKeys = useCallback((keys: string[]) => {
    const config = { keys, currentIndex: 0 };
    setApiKeys(config);
    localStorage.setItem('gemini_api_keys', JSON.stringify(config));
  }, []);

  const rotateKey = useCallback(() => {
    setApiKeys(prev => {
      const nextIndex = (prev.currentIndex + 1) % prev.keys.length;
      const updated = { ...prev, currentIndex: nextIndex };
      localStorage.setItem('gemini_api_keys', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const callGemini = useCallback(async (prompt: string): Promise<string> => {
    if (apiKeys.keys.length === 0) {
      throw new Error('No API keys configured');
    }

    let lastError: Error | null = null;
    const triedKeys = new Set<number>();

    while (triedKeys.size < apiKeys.keys.length) {
      const keyIndex = (apiKeys.currentIndex + triedKeys.size) % apiKeys.keys.length;
      triedKeys.add(keyIndex);
      const key = apiKeys.keys[keyIndex];

      try {
        const response = await fetch(`${GEMINI_API_URL}?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (response.status === 429 || response.status === 403) {
            rotateKey();
            lastError = new Error(`API key ${keyIndex + 1} failed: ${error.error?.message || 'Rate limited'}`);
            continue;
          }
          throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Unknown error');
        rotateKey();
      }
    }

    throw new Error(`All API keys failed. Last error: ${lastError?.message}`);
  }, [apiKeys, rotateKey]);

  const analyzeScript = useCallback(async (script: string): Promise<{ characters: Character[]; era: string; scenes: string[] }> => {
    const analysisPrompt = `Analyze this narrative script and extract:
1. Main characters with their physical descriptions and roles
2. Historical era/time period
3. Divide the script into logical scenes of approximately ${WORDS_PER_SCENE} words each (about ${SCENE_DURATION} seconds of narration)

IMPORTANT: Scene boundaries must respect narrative meaning. Each scene should be a complete narrative unit.

Script:
${script}

Respond in this exact JSON format:
{
  "characters": [
    {"id": "char1", "name": "Name", "description": "Brief description", "appearance": "Physical appearance details", "role": "protagonist/antagonist/supporting"}
  ],
  "era": "Historical period or time setting",
  "scenes": ["Scene 1 narration text...", "Scene 2 narration text...", ...]
}`;

    const response = await callGemini(analysisPrompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse script analysis');
    return JSON.parse(jsonMatch[0]);
  }, [callGemini]);

  const generateScenePrompt = useCallback(async (
    sceneText: string,
    sceneNumber: number,
    characters: Character[],
    era: string,
    visualStyle: string
  ): Promise<ScenePrompt> => {
    const promptRequest = `Generate a video generation prompt for this scene.

Scene ${sceneNumber}:
"${sceneText}"

Characters in story:
${characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n')}

Era/Setting: ${era}
Visual Style: ${visualStyle}

Create a JSON prompt with this exact structure:
{
  "sceneNumber": ${sceneNumber},
  "duration": 8,
  "narrationText": "exact narration text",
  "visualDescription": "detailed visual description of what happens",
  "characters": ["character names appearing in this scene"],
  "environment": "setting/location description",
  "era": "${era}",
  "mood": "emotional tone",
  "cameraMovement": "camera direction suggestion",
  "visualStyle": "${visualStyle}",
  "actions": "specific actions happening"
}

Return ONLY the JSON, no additional text.`;

    const response = await callGemini(promptRequest);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Failed to parse scene ${sceneNumber} prompt`);
    return JSON.parse(jsonMatch[0]);
  }, [callGemini]);

  const generatePrompts = useCallback(async (
    script: string,
    visualStyle: string,
    onProgress: (prompts: ScenePrompt[]) => void
  ): Promise<ScenePrompt[]> => {
    setState({ isGenerating: true, currentScene: 0, totalScenes: 0, error: null });
    const prompts: ScenePrompt[] = [];

    try {
      // Step 1: Analyze script
      const analysis = await analyzeScript(script);
      lastAnalysisRef.current = analysis;
      lastVisualStyleRef.current = visualStyle;
      setState(prev => ({ ...prev, totalScenes: analysis.scenes.length }));

      // Step 2: Generate prompts one by one
      for (let i = 0; i < analysis.scenes.length; i++) {
        setState(prev => ({ ...prev, currentScene: i + 1 }));
        
        const scenePrompt = await generateScenePrompt(
          analysis.scenes[i],
          i + 1,
          analysis.characters,
          analysis.era,
          visualStyle
        );
        
        prompts.push(scenePrompt);
        onProgress([...prompts]);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setState({ isGenerating: false, currentScene: 0, totalScenes: 0, error: null });
      return prompts;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setState(prev => ({ ...prev, isGenerating: false, error: errorMessage }));
      throw err;
    }
  }, [analyzeScript, generateScenePrompt]);

  const regenerateScene = useCallback(async (
    sceneIndex: number,
    currentPrompts: ScenePrompt[]
  ): Promise<ScenePrompt> => {
    if (!lastAnalysisRef.current) {
      throw new Error('No previous analysis available. Please generate all prompts first.');
    }

    const analysis = lastAnalysisRef.current;
    const visualStyle = lastVisualStyleRef.current;

    if (sceneIndex < 0 || sceneIndex >= analysis.scenes.length) {
      throw new Error('Invalid scene index');
    }

    setState(prev => ({ ...prev, isGenerating: true, currentScene: sceneIndex + 1, totalScenes: currentPrompts.length }));

    try {
      const newPrompt = await generateScenePrompt(
        analysis.scenes[sceneIndex],
        sceneIndex + 1,
        analysis.characters,
        analysis.era,
        visualStyle
      );

      setState({ isGenerating: false, currentScene: 0, totalScenes: 0, error: null });
      return newPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Regeneration failed';
      setState(prev => ({ ...prev, isGenerating: false, error: errorMessage }));
      throw err;
    }
  }, [generateScenePrompt]);

  return {
    state,
    apiKeys,
    saveApiKeys,
    generatePrompts,
    regenerateScene,
    lastAnalysis: lastAnalysisRef.current,
  };
}
