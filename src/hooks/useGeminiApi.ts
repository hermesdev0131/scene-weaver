import { useState, useCallback, useRef } from 'react';
import {
  CharacterIdentity,
  CharacterPerformance,
  CharacterLock,
  BackgroundLock,
  Camera,
  FoleyAmbience,
  DialogueLine,
  FullScenePrompt,
  SceneSegment,
  StoryAnalysis,
  GenerationState,
  ApiKeyConfig,
  // Legacy types for backwards compatibility
  Character,
  ScenePrompt,
} from '@/types/prompt';

// Free tier models - gemini-2.5-flash (10 RPM, 250 RPD on free tier)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_PRO_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const WORDS_PER_SECOND = 2.5;
const DEFAULT_SCENE_DURATION = 8;

// ============================================================================
// HOOK DEFINITION
// ============================================================================

export function useGeminiApi() {
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    currentScene: 0,
    totalScenes: 0,
    phase: 'idle',
    error: null,
  });

  const [apiKeys, setApiKeys] = useState<ApiKeyConfig>(() => {
    const stored = localStorage.getItem('gemini_api_keys');
    return stored ? JSON.parse(stored) : { keys: [], currentIndex: 0 };
  });

  // Locks - set once during analysis, never regenerated
  const storyAnalysisLock = useRef<StoryAnalysis | null>(null);

  // ============================================================================
  // API KEY MANAGEMENT (Proactive Round-Robin)
  // ============================================================================

  // Counter for proactive round-robin rotation
  const callCountRef = useRef(0);

  const saveApiKeys = useCallback((keys: string[]) => {
    const config = { keys, currentIndex: 0 };
    setApiKeys(config);
    localStorage.setItem('gemini_api_keys', JSON.stringify(config));
    callCountRef.current = 0; // Reset call count when keys change
  }, []);

  // Proactive round-robin: get next key before each call
  const getNextKey = useCallback((): { key: string; index: number } => {
    if (apiKeys.keys.length === 0) {
      throw new Error('No API keys configured');
    }
    // Use call count for true round-robin distribution
    const index = callCountRef.current % apiKeys.keys.length;
    callCountRef.current++;
    return { key: apiKeys.keys[index], index };
  }, [apiKeys.keys]);

  // Reactive rotation on failure (fallback)
  const rotateKey = useCallback(() => {
    setApiKeys(prev => {
      const nextIndex = (prev.currentIndex + 1) % prev.keys.length;
      const updated = { ...prev, currentIndex: nextIndex };
      localStorage.setItem('gemini_api_keys', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Calculate optimal delay based on number of keys
  // Free tier: 10 RPM per key = 6000ms minimum between calls per key
  // With round-robin: delay = 6500ms / numberOfKeys (with buffer)
  const calculateDelay = useCallback((): number => {
    const numKeys = apiKeys.keys.length;
    if (numKeys === 0) return 6500; // Default safe delay
    // 6500ms base / number of keys = delay between calls
    // Minimum 300ms to prevent bursting
    return Math.max(300, Math.ceil(6500 / numKeys));
  }, [apiKeys.keys.length]);

  // ============================================================================
  // GEMINI API CALL (with proactive round-robin)
  // ============================================================================

  const callGemini = useCallback(async (
    prompt: string,
    usePro: boolean = false,
    maxTokens: number = 4096
  ): Promise<string> => {
    if (apiKeys.keys.length === 0) {
      throw new Error('No API keys configured');
    }

    const url = usePro ? GEMINI_PRO_URL : GEMINI_API_URL;
    let lastError: Error | null = null;
    const triedIndices = new Set<number>();

    // Start with proactive round-robin key selection
    const { key: firstKey, index: firstIndex } = getNextKey();
    let currentKey = firstKey;
    let currentIndex = firstIndex;

    while (triedIndices.size < apiKeys.keys.length) {
      triedIndices.add(currentIndex);
      console.log(`Using API key ${currentIndex + 1}/${apiKeys.keys.length} (call #${callCountRef.current})`);

      try {
        const response = await fetch(`${url}?key=${currentKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: maxTokens,
            },
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (response.status === 429 || response.status === 403) {
            console.warn(`Key ${currentIndex + 1} rate limited, trying next...`);
            lastError = new Error(`API key ${currentIndex + 1} failed: ${error.error?.message || 'Rate limited'}`);
            // Move to next untried key
            for (let i = 0; i < apiKeys.keys.length; i++) {
              const nextIdx = (currentIndex + 1 + i) % apiKeys.keys.length;
              if (!triedIndices.has(nextIdx)) {
                currentIndex = nextIdx;
                currentKey = apiKeys.keys[nextIdx];
                break;
              }
            }
            continue;
          }
          throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();

        // Log finish reason to debug truncation
        const finishReason = data.candidates?.[0]?.finishReason;
        console.log('Gemini finish reason:', finishReason);
        if (finishReason && finishReason !== 'STOP') {
          console.warn('Gemini response may be incomplete. Finish reason:', finishReason);
        }

        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Unknown error');
        // Move to next untried key
        for (let i = 0; i < apiKeys.keys.length; i++) {
          const nextIdx = (currentIndex + 1 + i) % apiKeys.keys.length;
          if (!triedIndices.has(nextIdx)) {
            currentIndex = nextIdx;
            currentKey = apiKeys.keys[nextIdx];
            break;
          }
        }
      }
    }

    throw new Error(`All API keys failed. Last error: ${lastError?.message}`);
  }, [apiKeys.keys, getNextKey]);

  // ============================================================================
  // PHASE 1: DEEP STORY ANALYSIS
  // ============================================================================

  const analyzeStoryDeep = useCallback(async (
    script: string,
    visualStyle: string
  ): Promise<StoryAnalysis> => {
    // STEP 1: Extract characters only (smaller response)
    const charPrompt = `Extract characters from this script as JSON. Use SHORT descriptions (5-10 words max per field).

SCRIPT: ${script.substring(0, 2000)}

Return JSON:
{"characters":{"CHAR_A":{"name":"Name","species":"Human","gender":"M/F","age":"30s","body_build":"athletic","face_shape":"square jaw","hair":"short black","facial_hair":"none","skin_or_fur_color":"tan","eye_color":"brown","signature_feature":"scar","outfit_top":"tunic","outfit_bottom":"pants","helmet_or_hat":"none","shoes_or_footwear":"boots","accessories":"sword","texture_detail":"leather","material_reference":"wool,leather","voice_personality":"deep,calm"}},"era":"Roman era"}

Rules: CHAR_A=main character. Keep descriptions VERY SHORT. JSON only, no markdown.`;

    const charResponse = await callGemini(charPrompt, false, 4096);
    console.log('Character response:', charResponse.substring(0, 500));

    // Parse characters
    let charJsonStr = charResponse;
    const charCodeBlock = charResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (charCodeBlock) charJsonStr = charCodeBlock[1].trim();
    const charMatch = charJsonStr.match(/\{[\s\S]*\}/);
    if (!charMatch) throw new Error('Failed to extract characters');

    let charData: { characters: Record<string, CharacterIdentity>; era: string };
    try {
      charData = JSON.parse(charMatch[0]);
    } catch (e) {
      console.error('Character JSON parse error:', e, charMatch[0]);
      throw new Error('Failed to parse character data');
    }

    // STEP 2: Extract scenes separately
    const scenePrompt = `Divide this script into scenes of ~20 words each. Return JSON array only.

SCRIPT: ${script}

Return: {"scenes":[{"text":"exact narration text","duration_sec":8,"characters_present":["CHAR_A"]}]}

Character IDs available: ${Object.keys(charData.characters).join(', ')}
Return JSON only, no markdown.`;

    const sceneResponse = await callGemini(scenePrompt, false, 8192);
    console.log('Scene response:', sceneResponse.substring(0, 500));

    let sceneJsonStr = sceneResponse;
    const sceneCodeBlock = sceneResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (sceneCodeBlock) sceneJsonStr = sceneCodeBlock[1].trim();
    const sceneMatch = sceneJsonStr.match(/\{[\s\S]*\}/);
    if (!sceneMatch) throw new Error('Failed to extract scenes');

    let sceneData: { scenes: Array<{ text: string; duration_sec: number; characters_present: string[] }> };
    try {
      sceneData = JSON.parse(sceneMatch[0]);
    } catch (e) {
      console.error('Scene JSON parse error:', e, sceneMatch[0]);
      throw new Error('Failed to parse scene data');
    }

    // Combine into final analysis
    const analysis: StoryAnalysis = {
      characters: charData.characters,
      era: charData.era,
      visual_style_lock: visualStyle,
      scenes: sceneData.scenes
    };

    console.log('Analysis complete:', Object.keys(analysis.characters).length, 'characters,', analysis.scenes.length, 'scenes');

    return analysis;
  }, [callGemini]);

  // ============================================================================
  // PHASE 2: GENERATE SINGLE SCENE PROMPT (with stamping)
  // ============================================================================

  const generateScenePromptFull = useCallback(async (
    sceneSegment: SceneSegment,
    sceneIndex: number,
    characterIdentities: Record<string, CharacterIdentity>,
    era: string,
    visualStyleLock: string
  ): Promise<FullScenePrompt> => {
    const sceneId = `S${sceneIndex + 1}`;
    const presentCharacters = sceneSegment.characters_present;

    // Build character context for the prompt
    const characterContext = presentCharacters.map(charId => {
      const identity = characterIdentities[charId];
      if (!identity) return '';
      return `${charId} (${identity.name}): ${identity.body_build}, ${identity.face_shape}, ${identity.hair}, wearing ${identity.outfit_top} and ${identity.outfit_bottom}. Voice: ${identity.voice_personality}`;
    }).filter(Boolean).join('\n');

    const scenePrompt = `Generate a complete video scene prompt for scene ${sceneId}.

SCENE NARRATION:
"${sceneSegment.text}"

CHARACTERS IN THIS SCENE:
${characterContext}

ERA/SETTING: ${era}
VISUAL STYLE: ${visualStyleLock}
DURATION: ${sceneSegment.duration_sec} seconds

Generate the VARIABLE parts for this scene. For each character present, generate their PERFORMANCE (position, orientation, pose, expression, action_flow).

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "character_performances": {
    "${presentCharacters[0] || 'CHAR_A'}": {
      "position": "Where in frame (e.g., 'Foreground, seated at table')",
      "orientation": "Facing direction and target",
      "pose": "Body posture description",
      "expression": "Facial expression and emotion",
      "action_flow": {
        "pre_action": "What happens before main action",
        "main_action": "Primary action during scene",
        "post_action": "What happens after main action"
      }
    }
  },
  "background_lock": {
    "setting": "Location and time of day",
    "scenery": "Detailed environment description",
    "lighting": "Lighting setup with color references"
  },
  "camera": {
    "framing": "Shot type (close-up, medium, wide, etc.)",
    "angle": "Camera angle (eye-level, low, high)",
    "movement": "Camera movement description",
    "focus": "Depth of field and focus points"
  },
  "foley_and_ambience": {
    "ambience": ["Background sound 1", "Background sound 2"],
    "fx": ["Sound effect 1", "Sound effect 2"],
    "music": "Music description with melody, tempo, mood"
  },
  "dialogue": [
    {
      "speaker": "CHAR_A",
      "language": "Spanish",
      "line": "The exact dialogue line"
    }
  ],
  "lip_sync_director_note": "Direction for lip sync and facial acting"
}

RULES:
- Generate performance for ALL characters listed in CHARACTERS IN THIS SCENE
- If there's no dialogue in this scene, use an empty array: "dialogue": []
- action_flow must connect logically to adjacent scenes
- Use the era and visual style to inform all descriptions
- Return ONLY valid JSON`;

    const response = await callGemini(scenePrompt, false, 4096);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse scene ${sceneId} prompt`);
    }

    const sceneData = JSON.parse(jsonMatch[0]);

    // STAMPING: Merge locked identities with generated performances
    const characterLock: Record<string, CharacterLock> = {};

    for (const charId of presentCharacters) {
      const identity = characterIdentities[charId];
      const performance = sceneData.character_performances?.[charId];

      if (identity && performance) {
        characterLock[charId] = {
          // Stamp the LOCKED identity (byte-identical across all scenes)
          ...identity,
          // Add the VARIABLE performance (unique to this scene)
          position: performance.position || '',
          orientation: performance.orientation || '',
          pose: performance.pose || '',
          expression: performance.expression || '',
          action_flow: {
            pre_action: performance.action_flow?.pre_action || '',
            main_action: performance.action_flow?.main_action || '',
            post_action: performance.action_flow?.post_action || '',
          },
        };
      }
    }

    // Add voice to dialogue entries
    const dialogue: DialogueLine[] = (sceneData.dialogue || []).map((d: any) => ({
      speaker: d.speaker,
      voice: characterIdentities[d.speaker]?.voice_personality || '',
      language: d.language || 'Spanish',
      line: d.line,
    }));

    // Assemble the final scene prompt
    const fullPrompt: FullScenePrompt = {
      scene_id: sceneId,
      duration_sec: sceneSegment.duration_sec,
      visual_style: visualStyleLock,
      character_lock: characterLock,
      background_lock: sceneData.background_lock || { setting: '', scenery: '', lighting: '' },
      camera: sceneData.camera || { framing: '', angle: '', movement: '', focus: '' },
      foley_and_ambience: sceneData.foley_and_ambience || { ambience: [], fx: [], music: '' },
      dialogue,
      lip_sync_director_note: sceneData.lip_sync_director_note || '',
    };

    return fullPrompt;
  }, [callGemini]);

  // ============================================================================
  // MAIN GENERATION FUNCTION
  // ============================================================================

  const generatePromptsV2 = useCallback(async (
    script: string,
    visualStyle: string,
    onProgress: (prompts: FullScenePrompt[]) => void
  ): Promise<FullScenePrompt[]> => {
    setState({
      isGenerating: true,
      currentScene: 0,
      totalScenes: 0,
      phase: 'analyzing',
      error: null
    });

    const prompts: FullScenePrompt[] = [];

    try {
      // PHASE 1: Deep story analysis (one expensive call)
      const analysis = await analyzeStoryDeep(script, visualStyle);
      storyAnalysisLock.current = analysis;

      setState(prev => ({
        ...prev,
        totalScenes: analysis.scenes.length,
        phase: 'generating'
      }));

      // PHASE 2: Generate each scene with stamping
      for (let i = 0; i < analysis.scenes.length; i++) {
        setState(prev => ({ ...prev, currentScene: i + 1 }));

        const scenePrompt = await generateScenePromptFull(
          analysis.scenes[i],
          i,
          analysis.characters,
          analysis.era,
          analysis.visual_style_lock
        );

        prompts.push(scenePrompt);
        onProgress([...prompts]);

        // Dynamic rate limit protection based on number of keys
        const delay = calculateDelay();
        console.log(`Waiting ${delay}ms before next scene (${apiKeys.keys.length} keys)`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setState({
        isGenerating: false,
        currentScene: 0,
        totalScenes: 0,
        phase: 'idle',
        error: null
      });

      return prompts;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [analyzeStoryDeep, generateScenePromptFull, calculateDelay, apiKeys.keys.length]);

  // ============================================================================
  // REGENERATE SINGLE SCENE
  // ============================================================================

  const regenerateSceneV2 = useCallback(async (
    sceneIndex: number,
    currentPrompts: FullScenePrompt[]
  ): Promise<FullScenePrompt> => {
    const analysis = storyAnalysisLock.current;

    if (!analysis) {
      throw new Error('No previous analysis available. Please generate all prompts first.');
    }

    if (sceneIndex < 0 || sceneIndex >= analysis.scenes.length) {
      throw new Error('Invalid scene index');
    }

    setState(prev => ({
      ...prev,
      isGenerating: true,
      currentScene: sceneIndex + 1,
      totalScenes: currentPrompts.length,
      phase: 'generating'
    }));

    try {
      const newPrompt = await generateScenePromptFull(
        analysis.scenes[sceneIndex],
        sceneIndex,
        analysis.characters,
        analysis.era,
        analysis.visual_style_lock
      );

      setState({
        isGenerating: false,
        currentScene: 0,
        totalScenes: 0,
        phase: 'idle',
        error: null
      });

      return newPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Regeneration failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [generateScenePromptFull]);

  // ============================================================================
  // LEGACY FUNCTIONS (for backwards compatibility)
  // ============================================================================

  const analyzeScript = useCallback(async (script: string): Promise<{ characters: Character[]; era: string; scenes: string[] }> => {
    const analysisPrompt = `Analyze this narrative script and extract:
1. Main characters with their physical descriptions and roles
2. Historical era/time period
3. Divide the script into logical scenes of approximately ${Math.round(WORDS_PER_SECOND * DEFAULT_SCENE_DURATION)} words each (about ${DEFAULT_SCENE_DURATION} seconds of narration)

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

  // Store last analysis for legacy regeneration
  const lastAnalysisRef = useRef<{ characters: Character[]; era: string; scenes: string[] } | null>(null);
  const lastVisualStyleRef = useRef<string>('');

  const generatePrompts = useCallback(async (
    script: string,
    visualStyle: string,
    onProgress: (prompts: ScenePrompt[]) => void
  ): Promise<ScenePrompt[]> => {
    setState({ isGenerating: true, currentScene: 0, totalScenes: 0, phase: 'analyzing', error: null });
    const prompts: ScenePrompt[] = [];

    try {
      const analysis = await analyzeScript(script);
      lastAnalysisRef.current = analysis;
      lastVisualStyleRef.current = visualStyle;
      setState(prev => ({ ...prev, totalScenes: analysis.scenes.length, phase: 'generating' }));

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

        // Dynamic rate limit protection based on number of keys
        const delay = calculateDelay();
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: null });
      return prompts;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [analyzeScript, generateScenePrompt, calculateDelay]);

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

    setState(prev => ({ ...prev, isGenerating: true, currentScene: sceneIndex + 1, totalScenes: currentPrompts.length, phase: 'generating' }));

    try {
      const newPrompt = await generateScenePrompt(
        analysis.scenes[sceneIndex],
        sceneIndex + 1,
        analysis.characters,
        analysis.era,
        visualStyle
      );

      setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: null });
      return newPrompt;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Regeneration failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [generateScenePrompt]);

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    state,
    apiKeys,
    saveApiKeys,
    // Key rotation utilities
    calculateDelay,
    keyCount: apiKeys.keys.length,
    // V2 API (new full schema)
    generatePromptsV2,
    regenerateSceneV2,
    storyAnalysis: storyAnalysisLock.current,
    // Legacy API (backwards compatible)
    generatePrompts,
    regenerateScene,
    lastAnalysis: lastAnalysisRef.current,
  };
}
