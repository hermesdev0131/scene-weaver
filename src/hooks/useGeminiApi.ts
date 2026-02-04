import { useState, useCallback, useRef } from 'react';
import {
  CharacterIdentity,
  CharacterLock,
  BackgroundLock,
  Camera,
  FoleyAmbience,
  FullScenePrompt,
  SceneSegment,
  StoryAnalysis,
  GenerationState,
  ApiKeyConfig,
  ProjectState,
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

  // Approval resolver - for character approval flow
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);

  // ============================================================================
  // PAUSE / CANCEL / APPROVAL CONTROLS
  // ============================================================================

  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const pauseResolverRef = useRef<(() => void) | null>(null);

  const pauseGeneration = useCallback(() => {
    isPausedRef.current = true;
    setState(prev => ({ ...prev, phase: 'paused' }));
  }, []);

  const resumeGeneration = useCallback(() => {
    isPausedRef.current = false;
    setState(prev => ({ ...prev, phase: 'generating' }));
    if (pauseResolverRef.current) {
      pauseResolverRef.current();
      pauseResolverRef.current = null;
    }
  }, []);

  const cancelGeneration = useCallback(() => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    if (pauseResolverRef.current) {
      pauseResolverRef.current();
      pauseResolverRef.current = null;
    }
    if (approvalResolverRef.current) {
      approvalResolverRef.current(false);
      approvalResolverRef.current = null;
    }
  }, []);

  const waitIfPaused = useCallback(async () => {
    if (isPausedRef.current) {
      await new Promise<void>(resolve => {
        pauseResolverRef.current = resolve;
      });
    }
  }, []);

  // Approve characters and continue generation
  const approveCharacters = useCallback((updatedCharacters?: Record<string, CharacterIdentity>) => {
    if (updatedCharacters && storyAnalysisLock.current) {
      storyAnalysisLock.current.characters = updatedCharacters;
    }
    if (approvalResolverRef.current) {
      approvalResolverRef.current(true);
      approvalResolverRef.current = null;
    }
  }, []);

  // ============================================================================
  // API KEY MANAGEMENT (Proactive Round-Robin)
  // ============================================================================

  const callCountRef = useRef(0);

  const saveApiKeys = useCallback((keys: string[]) => {
    const config = { keys, currentIndex: 0 };
    setApiKeys(config);
    localStorage.setItem('gemini_api_keys', JSON.stringify(config));
    callCountRef.current = 0;
  }, []);

  const getNextKey = useCallback((): { key: string; index: number } => {
    if (apiKeys.keys.length === 0) {
      throw new Error('No API keys configured');
    }
    const index = callCountRef.current % apiKeys.keys.length;
    callCountRef.current++;
    return { key: apiKeys.keys[index], index };
  }, [apiKeys.keys]);

  const calculateDelay = useCallback((): number => {
    const numKeys = apiKeys.keys.length;
    if (numKeys === 0) return 6500;
    return Math.max(300, Math.ceil(6500 / numKeys));
  }, [apiKeys.keys.length]);

  // ============================================================================
  // GEMINI API CALL
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
        const finishReason = data.candidates?.[0]?.finishReason;
        console.log('Gemini finish reason:', finishReason);
        if (finishReason && finishReason !== 'STOP') {
          console.warn('Gemini response may be incomplete. Finish reason:', finishReason);
        }

        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Unknown error');
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
  // PHASE 1: DEEP STORY ANALYSIS (with detailed character extraction)
  // ============================================================================

  const analyzeStoryDeep = useCallback(async (
    script: string,
    visualStyle: string,
    sceneDuration: number = DEFAULT_SCENE_DURATION
  ): Promise<StoryAnalysis> => {
    const wordsPerScene = Math.round(WORDS_PER_SECOND * sceneDuration);

    // STEP 1A: IDENTIFY character NAMES from full script (lightweight pass)
    const namePrompt = `Identify ALL characters mentioned in this script. List every named character, even if they appear only briefly or are mentioned late in the story.

SCRIPT: ${script}

Return JSON with this EXACT structure:
{
  "characters": [
    {"name": "Character Name", "role": "brief role description", "importance": "main/supporting/minor"}
  ],
  "era": "Historical period and setting"
}

RULES:
- Include EVERY named character, even those appearing only once
- Order by importance (main characters first)
- "importance" should be: "main" for protagonists/antagonists, "supporting" for recurring characters, "minor" for brief appearances
- Return ONLY valid JSON`;

    console.log('Phase 1: Extracting character names...');
    const nameResponse = await callGemini(namePrompt, false, 4096);
    console.log('Name extraction response:', nameResponse.substring(0, 500));

    let nameJsonStr = nameResponse;
    const nameCodeBlock = nameResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (nameCodeBlock) nameJsonStr = nameCodeBlock[1].trim();
    const nameMatch = nameJsonStr.match(/\{[\s\S]*\}/);
    if (!nameMatch) throw new Error('Failed to extract character names');

    let nameData: { characters: Array<{ name: string; role: string; importance: string }>; era: string };
    try {
      nameData = JSON.parse(nameMatch[0]);
    } catch (e) {
      console.error('Name JSON parse error:', e, nameMatch[0]);
      throw new Error('Failed to parse character names');
    }

    console.log(`Found ${nameData.characters.length} characters:`, nameData.characters.map(c => c.name).join(', '));

    // Delay before Phase 1B to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 7000));

    // STEP 1B: CREATE detailed visual descriptions for identified characters
    const characterList = nameData.characters.map((c, i) => `${i + 1}. ${c.name} (${c.role}) - ${c.importance}`).join('\n');

    const charPrompt = `You are a character designer for AI video generation. Create detailed visual descriptions for these characters from the script.

ERA/SETTING: ${nameData.era}

CHARACTERS TO DESIGN:
${characterList}

SCRIPT CONTEXT: ${script.substring(0, 8000)}

Create a complete visual appearance for EACH character listed above. Base your designs on the era/setting, character's role, name origin, and cultural context.

Return JSON with this EXACT structure:
{
  "characters": {
    "CHAR_A": {
      "name": "Character's full name",
      "species": "Human",
      "gender": "Male/Female",
      "age": "45 years old",
      "body_build": "Tall and muscular, broad shoulders, imposing presence",
      "face_shape": "Square jaw, prominent cheekbones, weathered features",
      "hair": "Short dark brown hair with grey at temples, slightly receding",
      "facial_hair": "Full trimmed beard, salt-and-pepper",
      "skin_or_fur_color": "Olive Mediterranean complexion, sun-weathered",
      "eye_color": "Deep brown, intense and calculating",
      "signature_feature": "A prominent scar across left eyebrow",
      "outfit_top": "Bronze breastplate over dark red tunic, leather shoulder guards",
      "outfit_bottom": "Dark leather battle skirt with metal studs, leg greaves",
      "helmet_or_hat": "Crested bronze helmet with red plume (when in battle)",
      "shoes_or_footwear": "Leather sandals with bronze shin guards",
      "accessories": "Gold signet ring, leather sword belt, bronze armband",
      "texture_detail": "Armor is polished but battle-worn, tunic is fine wool",
      "material_reference": "Bronze, leather, wool, gold accents"
    }
  },
  "era": "${nameData.era}"
}

MANDATORY RULES:
- Create an entry for EACH character in the list above (${nameData.characters.length} total)
- CHAR_A = first/most important character, CHAR_B = second, etc.
- NEVER write "not specified", "not mentioned", "unknown", or "implied"
- Every field MUST contain a direct visual description
- INVENT appropriate details based on era, role, and cultural context
- Be SPECIFIC: colors, materials, textures, exact visual details
- NO voice or dialogue fields
- Return ONLY valid JSON`;

    console.log('Phase 2: Generating visual descriptions...');
    const charResponse = await callGemini(charPrompt, false, 16384);
    console.log('Character description response:', charResponse.substring(0, 500));

    let charJsonStr = charResponse;
    const charCodeBlock = charResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (charCodeBlock) charJsonStr = charCodeBlock[1].trim();
    const charMatch = charJsonStr.match(/\{[\s\S]*\}/);
    if (!charMatch) throw new Error('Failed to extract character descriptions');

    let charData: { characters: Record<string, CharacterIdentity>; era: string };
    try {
      charData = JSON.parse(charMatch[0]);
    } catch (e) {
      console.error('Character JSON parse error:', e, charMatch[0]);
      throw new Error('Failed to parse character data');
    }

    console.log(`Generated descriptions for ${Object.keys(charData.characters).length} characters`);

    // Delay before scene extraction to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 7000));

    // STEP 2: Extract scenes with ACTION focus (CHUNKED for long scripts)
    // With short scene durations (4s) and free tier API limits,
    // keep chunks very small to avoid JSON truncation
    const CHUNK_SIZE = 250; // words per chunk (small for free tier)
    const words = script.split(/\s+/);
    const totalWords = words.length;
    const characterIds = Object.keys(charData.characters).join(', ');

    let allScenes: SceneSegment[] = [];

    if (totalWords <= CHUNK_SIZE * 1.5) {
      // Short script - process in one call
      const scenePrompt = `Divide this script into ACTION-focused scenes of ~${wordsPerScene} words each (${sceneDuration} seconds).

SCRIPT: ${script}

Return JSON with scenes focused on PHYSICAL ACTIONS, not dialogue:
{
  "scenes": [
    {
      "text": "Exact narration text from script",
      "duration_sec": ${sceneDuration},
      "characters_present": ["CHAR_A", "CHAR_B"],
      "action_hint": "Brief description of the main PHYSICAL ACTION in this scene"
    }
  ]
}

Character IDs available: ${characterIds}

RULES:
- Each scene should have a clear PHYSICAL ACTION (not just dialogue/talking)
- action_hint should describe what characters DO, not what they SAY
- Return ONLY valid JSON`;

      const sceneResponse = await callGemini(scenePrompt, false, 32768);
      console.log('Scene response:', sceneResponse.substring(0, 500));

      let sceneJsonStr = sceneResponse;
      const sceneCodeBlock = sceneResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (sceneCodeBlock) sceneJsonStr = sceneCodeBlock[1].trim();
      const sceneMatch = sceneJsonStr.match(/\{[\s\S]*\}/);
      if (!sceneMatch) throw new Error('Failed to extract scenes');

      try {
        const sceneData = JSON.parse(sceneMatch[0]);
        allScenes = sceneData.scenes;
      } catch (e) {
        console.error('Scene JSON parse error:', e, sceneMatch[0]);
        throw new Error('Failed to parse scene data');
      }
    } else {
      // Long script - process in chunks
      console.log(`Long script detected (${totalWords} words). Processing in chunks...`);

      const chunks: string[] = [];
      let currentChunk: string[] = [];
      let currentWordCount = 0;

      // Split by sentences to avoid cutting mid-sentence
      const sentences = script.split(/(?<=[.!?])\s+/);

      for (const sentence of sentences) {
        const sentenceWords = sentence.split(/\s+/).length;
        if (currentWordCount + sentenceWords > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push(currentChunk.join(' '));
          currentChunk = [sentence];
          currentWordCount = sentenceWords;
        } else {
          currentChunk.push(sentence);
          currentWordCount += sentenceWords;
        }
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
      }

      console.log(`Split into ${chunks.length} chunks`);

      // Process each chunk with retry logic
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkWordCount = chunk.split(/\s+/).length;
        console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunkWordCount} words)`);

        const chunkPrompt = `Divide this PART ${i + 1} of ${chunks.length} of a script into ACTION-focused scenes of ~${wordsPerScene} words each (${sceneDuration} seconds).

SCRIPT PART ${i + 1}/${chunks.length}:
${chunk}

Return JSON with scenes focused on PHYSICAL ACTIONS, not dialogue:
{
  "scenes": [
    {
      "text": "Exact narration text from this part",
      "duration_sec": ${sceneDuration},
      "characters_present": ["CHAR_A", "CHAR_B"],
      "action_hint": "Brief description of the main PHYSICAL ACTION in this scene"
    }
  ]
}

Character IDs available: ${characterIds}

RULES:
- Each scene should have a clear PHYSICAL ACTION (not just dialogue/talking)
- action_hint should describe what characters DO, not what they SAY
- Return ONLY valid JSON`;

        // Retry logic for failed chunks (1 retry = 2 total attempts)
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;

        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            const chunkResponse = await callGemini(chunkPrompt, false, 32768);

            let chunkJsonStr = chunkResponse;
            const chunkCodeBlock = chunkResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (chunkCodeBlock) chunkJsonStr = chunkCodeBlock[1].trim();
            const chunkMatch = chunkJsonStr.match(/\{[\s\S]*\}/);

            if (!chunkMatch) {
              throw new Error(`Failed to extract JSON from chunk ${i + 1}`);
            }

            const chunkData = JSON.parse(chunkMatch[0]);
            allScenes = allScenes.concat(chunkData.scenes);
            console.log(`Chunk ${i + 1}: ${chunkData.scenes.length} scenes extracted`);
            lastError = null;
            break; // Success, exit retry loop
          } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            console.error(`Chunk ${i + 1} attempt ${retry + 1} failed:`, lastError.message);

            if (retry < MAX_RETRIES - 1) {
              console.log(`Retrying chunk ${i + 1} in 7 seconds...`);
              await new Promise(resolve => setTimeout(resolve, 7000));
            }
          }
        }

        if (lastError) {
          throw new Error(`Failed to parse scene data from chunk ${i + 1} after ${MAX_RETRIES} attempts`);
        }

        // Delay between chunks to avoid rate limiting (7s for free tier - matches API suggestion)
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 7000));
        }
      }

      console.log(`Total scenes from all chunks: ${allScenes.length}`);
    }

    const analysis: StoryAnalysis = {
      characters: charData.characters,
      era: charData.era,
      visual_style_lock: visualStyle,
      scenes: allScenes.map(s => ({
        ...s,
        action_hint: s.action_hint || ''
      }))
    };

    console.log('Analysis complete:', Object.keys(analysis.characters).length, 'characters,', analysis.scenes.length, 'scenes');

    return analysis;
  }, [callGemini]);

  // ============================================================================
  // PHASE 2: GENERATE SINGLE SCENE (ACTION-FOCUSED, NO DIALOGUE)
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

    const characterContext = presentCharacters.map(charId => {
      const c = characterIdentities[charId];
      if (!c) return '';
      return `${charId} (${c.name}): ${c.age}, ${c.body_build}, ${c.face_shape}, ${c.hair}, ${c.facial_hair}, ${c.skin_or_fur_color} skin, ${c.eye_color}. Wearing: ${c.outfit_top}, ${c.outfit_bottom}, ${c.shoes_or_footwear}. Signature: ${c.signature_feature}`;
    }).filter(Boolean).join('\n');

    const scenePrompt = `Generate an ACTION-FOCUSED video scene prompt. This is for AI VIDEO GENERATION - characters must MOVE and DO things.

SCENE ${sceneId} NARRATION:
"${sceneSegment.text}"

ACTION HINT: ${sceneSegment.action_hint || 'Interpret from narration'}

CHARACTERS IN SCENE:
${characterContext}

ERA: ${era}
VISUAL STYLE: ${visualStyleLock}
DURATION: ${sceneSegment.duration_sec} seconds

EXAMPLE OF GOOD action_flow (follow this pattern):
{
  "pre_action": "Her right hand slowly reaches toward the worn leather pouch at her belt, fingers trembling slightly.",
  "main_action": "She withdraws a crumpled letter, unfolds it with both hands, and brings it close to her face. Her eyes scan the text rapidly, widening with each line. Her grip tightens, crinkling the paper's edges.",
  "post_action": "She lowers the letter to her chest, pressing it against her heart. Her free hand rises to cover her mouth as she takes a shaky breath, shoulders dropping."
}

BAD action_flow (DO NOT do this):
{
  "pre_action": "Camera pans left",
  "main_action": "Character reads letter",
  "post_action": "Scene fades"
}

RESPOND WITH EXACT JSON:
{
  "character_performances": {
    "${presentCharacters[0] || 'CHAR_A'}": {
      "position": "Specific position (e.g., 'Standing 2 meters from the doorway, left side of frame')",
      "orientation": "Body direction (e.g., 'Body angled 45° toward camera, head turned right looking at the window')",
      "pose": "Stance (e.g., 'Weight on left leg, right foot slightly forward, arms crossed defensively')",
      "expression": "Face (e.g., 'Brow furrowed, jaw clenched, eyes narrowed with suspicion')",
      "action_flow": {
        "pre_action": "SPECIFIC body movements BEFORE main action - describe what hands, arms, legs, head, torso DO",
        "main_action": "PRIMARY physical action - DETAILED movements, object interactions, gestures. Minimum 2 sentences.",
        "post_action": "SPECIFIC body movements AFTER - how body settles, changes position, facial reaction"
      }
    }
  },
  "background_lock": {
    "setting": "Location and time",
    "scenery": "Environment details",
    "lighting": "Light source, direction, shadows"
  },
  "camera": {
    "framing": "Shot type",
    "angle": "Camera angle",
    "movement": "Camera motion (keep minimal - focus on CHARACTER movement)",
    "focus": "Focus details"
  },
  "foley_and_ambience": {
    "ambience": ["Environmental sounds"],
    "fx": ["Action sounds (footsteps, cloth, objects)"],
    "music": "Score mood"
  },
  "scene_action_summary": "One sentence: WHO does WHAT physical action"
}

MANDATORY RULES:
1. action_flow MUST describe CHARACTER BODY MOVEMENTS, not camera movements
2. Each action field must be 1-3 detailed sentences about PHYSICAL motion
3. Include: hands, arms, legs, head, torso, facial muscles
4. Describe HOW things are done (slowly, quickly, hesitantly, forcefully)
5. NO dialogue, NO speaking, NO voice - ONLY visual physical action
6. The scene should have MOTION that can be animated
7. Return ONLY valid JSON`;

    const response = await callGemini(scenePrompt, false, 8192);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse scene ${sceneId} prompt`);
    }

    const sceneData = JSON.parse(jsonMatch[0]);

    // Stamp locked identities with generated performances
    const characterLock: Record<string, CharacterLock> = {};

    for (const charId of presentCharacters) {
      const identity = characterIdentities[charId];
      const performance = sceneData.character_performances?.[charId];

      if (identity && performance) {
        characterLock[charId] = {
          ...identity,
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

    const fullPrompt: FullScenePrompt = {
      scene_id: sceneId,
      duration_sec: sceneSegment.duration_sec,
      visual_style: visualStyleLock,
      character_lock: characterLock,
      background_lock: sceneData.background_lock || { setting: '', scenery: '', lighting: '' },
      camera: sceneData.camera || { framing: '', angle: '', movement: '', focus: '' },
      foley_and_ambience: sceneData.foley_and_ambience || { ambience: [], fx: [], music: '' },
      scene_action_summary: sceneData.scene_action_summary || '',
    };

    return fullPrompt;
  }, [callGemini]);

  // ============================================================================
  // MAIN GENERATION WITH CHARACTER APPROVAL
  // ============================================================================

  const generatePromptsV2 = useCallback(async (
    script: string,
    visualStyle: string,
    sceneDuration: number,
    onProgress: (prompts: FullScenePrompt[]) => void,
    onCharactersExtracted?: (characters: Record<string, CharacterIdentity>, era: string, scenes: SceneSegment[]) => void
  ): Promise<FullScenePrompt[]> => {
    isPausedRef.current = false;
    isCancelledRef.current = false;

    setState({
      isGenerating: true,
      currentScene: 0,
      totalScenes: 0,
      phase: 'analyzing',
      error: null
    });

    const prompts: FullScenePrompt[] = [];

    try {
      // PHASE 1: Deep story analysis
      const analysis = await analyzeStoryDeep(script, visualStyle, sceneDuration);
      storyAnalysisLock.current = analysis;

      if (isCancelledRef.current) {
        setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
        return prompts;
      }

      // Notify about extracted characters for approval
      if (onCharactersExtracted) {
        onCharactersExtracted(analysis.characters, analysis.era, analysis.scenes);
      }

      // PHASE 1.5: Wait for character approval
      setState(prev => ({ ...prev, phase: 'awaiting_approval' }));

      const approved = await new Promise<boolean>(resolve => {
        approvalResolverRef.current = resolve;
      });

      if (!approved || isCancelledRef.current) {
        setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
        return prompts;
      }

      // Use potentially updated characters from approval
      const finalAnalysis = storyAnalysisLock.current!;

      setState(prev => ({
        ...prev,
        totalScenes: finalAnalysis.scenes.length,
        phase: 'generating'
      }));

      // PHASE 2: Generate each scene
      for (let i = 0; i < finalAnalysis.scenes.length; i++) {
        if (isCancelledRef.current) {
          setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
          return prompts;
        }

        await waitIfPaused();

        if (isCancelledRef.current) {
          setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
          return prompts;
        }

        setState(prev => ({ ...prev, currentScene: i + 1 }));

        const scenePrompt = await generateScenePromptFull(
          finalAnalysis.scenes[i],
          i,
          finalAnalysis.characters,
          finalAnalysis.era,
          finalAnalysis.visual_style_lock
        );

        prompts.push(scenePrompt);
        onProgress([...prompts]);

        // Save progress after each scene
        saveProgress(script, visualStyle, sceneDuration, finalAnalysis, prompts, i + 1);

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

      // Mark project as complete
      saveProgress(script, visualStyle, sceneDuration, finalAnalysis, prompts, prompts.length, true);

      return prompts;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [analyzeStoryDeep, generateScenePromptFull, calculateDelay, apiKeys.keys.length, waitIfPaused]);

  // ============================================================================
  // CONTINUE FROM SAVED PROGRESS
  // ============================================================================

  const continueFromProgress = useCallback(async (
    project: ProjectState,
    onProgress: (prompts: FullScenePrompt[]) => void
  ): Promise<FullScenePrompt[]> => {
    if (!project.storyAnalysis) {
      throw new Error('No analysis in saved project');
    }

    isPausedRef.current = false;
    isCancelledRef.current = false;
    storyAnalysisLock.current = project.storyAnalysis;

    const prompts = [...project.prompts];
    const startIndex = project.currentSceneIndex;

    setState({
      isGenerating: true,
      currentScene: startIndex,
      totalScenes: project.storyAnalysis.scenes.length,
      phase: 'generating',
      error: null
    });

    try {
      for (let i = startIndex; i < project.storyAnalysis.scenes.length; i++) {
        if (isCancelledRef.current) {
          setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
          return prompts;
        }

        await waitIfPaused();

        if (isCancelledRef.current) {
          setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
          return prompts;
        }

        setState(prev => ({ ...prev, currentScene: i + 1 }));

        const scenePrompt = await generateScenePromptFull(
          project.storyAnalysis!.scenes[i],
          i,
          project.storyAnalysis!.characters,
          project.storyAnalysis!.era,
          project.storyAnalysis!.visual_style_lock
        );

        prompts.push(scenePrompt);
        onProgress([...prompts]);

        saveProgress(
          project.script,
          project.visualStyle,
          project.sceneDuration,
          project.storyAnalysis!,
          prompts,
          i + 1
        );

        const delay = calculateDelay();
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      setState({
        isGenerating: false,
        currentScene: 0,
        totalScenes: 0,
        phase: 'idle',
        error: null
      });

      saveProgress(
        project.script,
        project.visualStyle,
        project.sceneDuration,
        project.storyAnalysis!,
        prompts,
        prompts.length,
        true
      );

      return prompts;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      setState(prev => ({ ...prev, isGenerating: false, phase: 'idle', error: errorMessage }));
      throw err;
    }
  }, [generateScenePromptFull, calculateDelay, waitIfPaused]);

  // ============================================================================
  // SAVE / LOAD PROGRESS
  // ============================================================================

  const saveProgress = (
    script: string,
    visualStyle: string,
    sceneDuration: number,
    analysis: StoryAnalysis,
    prompts: FullScenePrompt[],
    currentIndex: number,
    isComplete: boolean = false
  ) => {
    const project: ProjectState = {
      id: 'current',
      name: 'Current Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      script,
      visualStyle,
      sceneDuration,
      storyAnalysis: analysis,
      prompts,
      currentSceneIndex: currentIndex,
      isComplete
    };
    localStorage.setItem('scene_weaver_progress', JSON.stringify(project));
  };

  const loadProgress = useCallback((): ProjectState | null => {
    const saved = localStorage.getItem('scene_weaver_progress');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }, []);

  const clearProgress = useCallback(() => {
    localStorage.removeItem('scene_weaver_progress');
  }, []);

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
  // UPDATE CHARACTERS (for editing after approval)
  // ============================================================================

  const updateCharacters = useCallback((characters: Record<string, CharacterIdentity>) => {
    if (storyAnalysisLock.current) {
      storyAnalysisLock.current.characters = characters;
    }
  }, []);

  // ============================================================================
  // LEGACY FUNCTIONS
  // ============================================================================

  const analyzeScript = useCallback(async (script: string): Promise<{ characters: Character[]; era: string; scenes: string[] }> => {
    const analysisPrompt = `Analyze this narrative script and extract:
1. Main characters with their physical descriptions and roles
2. Historical era/time period
3. Divide the script into logical scenes of approximately ${Math.round(WORDS_PER_SECOND * DEFAULT_SCENE_DURATION)} words each

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
    calculateDelay,
    keyCount: apiKeys.keys.length,
    // Controls
    pauseGeneration,
    resumeGeneration,
    cancelGeneration,
    approveCharacters,
    isPaused: isPausedRef.current,
    // V2 API
    generatePromptsV2,
    regenerateSceneV2,
    continueFromProgress,
    updateCharacters,
    storyAnalysis: storyAnalysisLock.current,
    // Save/Load
    loadProgress,
    clearProgress,
    // Legacy API
    generatePrompts,
    regenerateScene,
    lastAnalysis: lastAnalysisRef.current,
  };
}
