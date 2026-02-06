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
  CharacterStatus,
  CharacterStateMap,
  // Legacy types for backwards compatibility
  Character,
  ScenePrompt,
} from '@/types/prompt';

// Free tier models - gemini-2.5-flash (10 RPM, 250 RPD on free tier)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_PRO_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Narration speed: 121 WPM (verified from client's audio: 3193 words = 26m 23s)
const WPM = 121;
const WORDS_PER_SECOND = WPM / 60; // ~2.017 words/sec
const DEFAULT_SCENE_DURATION = 6;

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
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate from old format (keys array) to new format (freeKeys + paidKey)
      if (parsed.keys && !parsed.freeKeys) {
        return { freeKeys: parsed.keys, paidKey: null, currentIndex: 0 };
      }
      return parsed;
    }
    return { freeKeys: [], paidKey: null, currentIndex: 0 };
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

  const saveApiKeys = useCallback((config: ApiKeyConfig) => {
    setApiKeys(config);
    localStorage.setItem('gemini_api_keys', JSON.stringify(config));
    callCountRef.current = 0;
  }, []);

  const getNextFreeKey = useCallback((): { key: string; index: number } | null => {
    if (apiKeys.freeKeys.length === 0) {
      return null;
    }
    const index = callCountRef.current % apiKeys.freeKeys.length;
    callCountRef.current++;
    return { key: apiKeys.freeKeys[index], index };
  }, [apiKeys.freeKeys]);

  const calculateDelay = useCallback((): number => {
    const numKeys = apiKeys.freeKeys.length;
    if (numKeys === 0) return 6500;
    return Math.max(300, Math.ceil(6500 / numKeys));
  }, [apiKeys.freeKeys.length]);

  // Check if we have any usable keys
  const hasAnyKeys = apiKeys.freeKeys.length > 0 || apiKeys.paidKey !== null;

  // Helper: delay only when using free tier (paid tier has much higher rate limits)
  const delayForFreeAPI = useCallback(async (ms: number = 12000) => {
    if (apiKeys.paidKey) {
      // Paid API: minimal delay (50ms just to prevent hammering)
      await new Promise(resolve => setTimeout(resolve, 50));
    } else {
      // Free API: full delay for rate limit compliance
      console.log(`Free tier: waiting ${ms / 1000}s for rate limits...`);
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  }, [apiKeys.paidKey]);

  // Parallel batch size for paid tier (free tier stays sequential)
  const PAID_PARALLEL_BATCH_SIZE = 5;

  // ============================================================================
  // HELPER: Replace CHAR_IDs with real character names in text
  // ============================================================================

  const replaceCharIdsWithNames = (
    text: string,
    characterIdentities: Record<string, CharacterIdentity>
  ): string => {
    let result = text;
    for (const [charId, identity] of Object.entries(characterIdentities)) {
      if (identity.name) {
        // Replace CHAR_A, CHAR_B, etc. with actual names
        result = result.replace(new RegExp(charId, 'g'), identity.name);
      }
    }
    return result;
  };

  // ============================================================================
  // HELPER: Detect if Gemini sanitized/corrupted the scene content
  // ============================================================================

  // Keywords indicating violent/distressing content in narration
  const DISTRESS_NARRATION_KEYWORDS = [
    // Spanish violence/death keywords
    'metieron dentro', 'gritaba', 'gritando', 'gritos', 'alaridos',
    'fuego', 'quemarse', 'quemaba', 'ardía', 'calentarse', 'caliente',
    'morir', 'murió', 'muerte', 'matar', 'mataron',
    'dolor', 'agonía', 'sufrimiento', 'tortura', 'torturado',
    'encendieron', 'llamas', 'bronce caliente',
    'dentro del toro', 'interior del toro', 'metieron',
    'arrastraron', 'arrastrando', 'forzaron',
    'ejecutar', 'ejecutaron', 'ejecución',
    'suplicaba', 'suplicando', 'súplicas',
    // English equivalents (in case of mixed content)
    'screaming', 'burning', 'fire', 'death', 'torture', 'agony',
    'forced inside', 'dragged', 'executed'
  ];

  // Keywords indicating Gemini sanitized to a safe scene
  const SANITIZED_SCENE_KEYWORDS = [
    // Workshop/craft scenes (wrong for torture)
    'workshop', 'taller', 'working', 'trabajando',
    'crafting', 'examining', 'examinando',
    'stands by', 'de pie junto a', 'standing beside',
    'his work', 'su trabajo', 'workbench', 'banco de trabajo',
    // Casual actions (wrong for distress)
    'gesturing intently', 'gesticulando',
    'calmly', 'tranquilamente', 'peacefully',
    'observing', 'observando', 'watching',
    // Wrong locations for confinement scenes
    'late afternoon', 'tarde', 'evening workshop',
    'pauses his work', 'detiene su trabajo'
  ];

  const detectSanitizedScene = (
    narrationText: string,
    generatedSetting: string,
    generatedActionSummary: string,
    _actionHint: string // Reserved for future enhanced validation
  ): { isSanitized: boolean; reason: string } => {
    const narrationLower = narrationText.toLowerCase();
    const settingLower = generatedSetting.toLowerCase();
    const actionLower = generatedActionSummary.toLowerCase();

    // Check if narration contains distressing content
    const hasDistressNarration = DISTRESS_NARRATION_KEYWORDS.some(
      keyword => narrationLower.includes(keyword.toLowerCase())
    );

    if (!hasDistressNarration) {
      return { isSanitized: false, reason: '' };
    }

    // Check if generated scene was sanitized to a safe version
    const hasSanitizedSetting = SANITIZED_SCENE_KEYWORDS.some(
      keyword => settingLower.includes(keyword.toLowerCase())
    );

    const hasSanitizedAction = SANITIZED_SCENE_KEYWORDS.some(
      keyword => actionLower.includes(keyword.toLowerCase())
    );

    if (hasSanitizedSetting || hasSanitizedAction) {
      const reasons: string[] = [];
      if (hasSanitizedSetting) reasons.push('setting mismatch');
      if (hasSanitizedAction) reasons.push('action mismatch');
      return {
        isSanitized: true,
        reason: `Narration suggests distress but scene shows safe context (${reasons.join(', ')})`
      };
    }

    return { isSanitized: false, reason: '' };
  };

  // ============================================================================
  // HELPER: Build local scene when Gemini fails or sanitizes content
  // ============================================================================

  const buildLocalScene = (
    sceneId: string,
    sceneSegment: SceneSegment,
    presentCharacters: string[],
    characterIdentities: Record<string, CharacterIdentity>,
    visualStyleLock: string,
    previousScenePrompt: FullScenePrompt | undefined,
    marker: '[BLOCKED]' | '[SANITIZED]'
  ): FullScenePrompt => {
    console.log(`Scene ${sceneId}: Building locally with ${marker} marker`);

    // Replace CHAR_IDs with real names in action_hint
    const processedActionHint = replaceCharIdsWithNames(
      sceneSegment.action_hint || 'Character performs scene action',
      characterIdentities
    );

    // Build character lock with minimal performance data
    const characterLock: Record<string, CharacterLock> = {};
    for (const charId of presentCharacters) {
      const identity = characterIdentities[charId];
      if (identity) {
        characterLock[charId] = {
          ...identity,
          position: 'Continuation from previous scene',
          orientation: 'Facing toward action',
          pose: 'Dynamic pose matching scene context',
          expression: 'Intense, matching scene emotion',
          action_flow: {
            pre_action: 'Character prepares for action',
            main_action: processedActionHint,
            post_action: 'Character reacts to action outcome',
          },
        };
      }
    }

    // Inherit background from previous scene for visual continuity, or use generic defaults
    const inheritedBackground = previousScenePrompt?.background_lock || {
      setting: 'Interior chamber',
      scenery: 'Dramatic scene environment',
      lighting: 'Dramatic lighting with shadows'
    };

    // Inherit camera framing from previous scene or use default
    const inheritedCamera = previousScenePrompt?.camera || {
      framing: 'Medium shot',
      angle: 'Eye level',
      movement: 'Static',
      focus: 'Subject in focus'
    };

    // Build action summary with marker
    const markedActionSummary = replaceCharIdsWithNames(
      `${marker} ${sceneSegment.action_hint || 'Scene action - requires manual review'}`,
      characterIdentities
    );

    const localPrompt: FullScenePrompt = {
      scene_id: sceneId,
      duration_sec: sceneSegment.duration_sec,
      visual_style: visualStyleLock,
      text_fragment: sceneSegment.text,
      character_lock: characterLock,
      background_lock: inheritedBackground,
      camera: inheritedCamera,
      foley_and_ambience: previousScenePrompt?.foley_and_ambience || {
        ambience: ['ambient environment sounds'],
        fx: ['action sounds'],
        music: 'Tense dramatic score'
      },
      scene_action_summary: markedActionSummary,
    };

    console.log(`Scene ${sceneId}: Built locally. Background: ${inheritedBackground.setting}`);
    return localPrompt;
  };

  // ============================================================================
  // DETERMINISTIC TEXT SPLITTING (Math-based, not AI-decided)
  // ============================================================================

  interface TextFragment {
    text: string;
    wordCount: number;
    durationSec: number;
    startWord: number;
    endWord: number;
  }

  const splitScriptDeterministically = useCallback((
    script: string,
    sceneDuration: number
  ): TextFragment[] => {
    const fragments: TextFragment[] = [];
    const sentences = script.split(/(?<=[.!?])\s+/).filter(s => s.trim());

    let timeBuffer = 0;
    let currentFragment: string[] = [];
    let currentWordCount = 0;
    let fragmentStartWord = 0;
    let totalWordsSoFar = 0;

    for (const sentence of sentences) {
      const sentenceWords = sentence.trim().split(/\s+/).filter(w => w).length;
      const sentenceDuration = sentenceWords / WORDS_PER_SECOND;

      currentFragment.push(sentence);
      currentWordCount += sentenceWords;
      timeBuffer += sentenceDuration;

      // When we accumulate enough time for a scene, flush
      while (timeBuffer >= sceneDuration && currentFragment.length > 0) {
        // Calculate ACTUAL duration based on word count (not fixed sceneDuration)
        // This ensures video duration matches audio duration
        const actualDuration = Math.round(currentWordCount / WORDS_PER_SECOND);

        fragments.push({
          text: currentFragment.join(' '),
          wordCount: currentWordCount,
          durationSec: Math.max(4, actualDuration), // Min 4s, but use actual word-based duration
          startWord: fragmentStartWord,
          endWord: fragmentStartWord + currentWordCount - 1
        });

        timeBuffer -= sceneDuration;
        totalWordsSoFar += currentWordCount;
        fragmentStartWord = totalWordsSoFar;
        currentFragment = [];
        currentWordCount = 0;
      }
    }

    // Handle remaining text
    if (currentFragment.length > 0) {
      const remainingDuration = currentWordCount / WORDS_PER_SECOND;
      fragments.push({
        text: currentFragment.join(' '),
        wordCount: currentWordCount,
        durationSec: Math.max(4, Math.round(remainingDuration)), // Min 4s scene
        startWord: fragmentStartWord,
        endWord: fragmentStartWord + currentWordCount - 1
      });
    }

    console.log(`Deterministic split: ${fragments.length} fragments from ${script.split(/\s+/).length} words`);
    return fragments;
  }, []);

  // ============================================================================
  // GEMINI API CALL
  // ============================================================================

  // Parse retry delay from API error message (e.g., "Please retry in 41.199287294s")
  const parseRetryDelay = (errorMessage: string): number => {
    const match = errorMessage.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (match) {
      const seconds = parseFloat(match[1]);
      // Add 2 seconds buffer, cap at 120 seconds
      return Math.min(Math.ceil(seconds + 2) * 1000, 120000);
    }
    // Default to 60 seconds if can't parse
    return 60000;
  };

  const callGemini = useCallback(async (
    prompt: string,
    usePro: boolean = false,
    maxTokens: number = 4096
  ): Promise<string> => {
    const hasFreeKeys = apiKeys.freeKeys.length > 0;
    const hasPaidKey = apiKeys.paidKey !== null;

    if (!hasFreeKeys && !hasPaidKey) {
      throw new Error('No API keys configured');
    }

    const url = usePro ? GEMINI_PRO_URL : GEMINI_API_URL;
    let lastError: Error | null = null;
    let lastRetryDelay = 60000; // Default 60s

    // Helper to make API call
    const makeApiCall = async (key: string, keyLabel: string): Promise<{ success: boolean; data?: string; retryable: boolean; retryDelay?: number }> => {
      console.log(`Using ${keyLabel} (call #${callCountRef.current})`);

      try {
        const response = await fetch(`${url}?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: maxTokens,
            },
            // Lower safety filter thresholds to allow creative/historical content
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            ],
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (response.status === 429 || response.status === 403) {
            const errorMsg = error.error?.message || 'Rate limited';
            console.warn(`${keyLabel} rate limited: ${errorMsg}`);
            return { success: false, retryable: true, retryDelay: parseRetryDelay(errorMsg) };
          }
          throw new Error(error.error?.message || 'API request failed');
        }

        const data = await response.json();

        // Check for safety/content blocks BEFORE accessing candidates
        const blockReason = data.promptFeedback?.blockReason;
        if (blockReason) {
          const safetyRatings = data.promptFeedback?.safetyRatings || [];
          console.error(`Content blocked by Gemini. Reason: ${blockReason}`);
          console.error('Safety ratings:', JSON.stringify(safetyRatings, null, 2));
          // Log the full prompt for debugging blocked content
          console.error('Full prompt that was blocked (first 2000 chars):');
          console.error(prompt.substring(0, 2000));
          throw new Error(`Content blocked by safety filter: ${blockReason}`);
        }

        // Check for empty candidates (silent block)
        if (!data.candidates || data.candidates.length === 0) {
          console.error('Gemini returned empty candidates array (possible silent safety block)');
          console.error('Full response:', JSON.stringify(data, null, 2));
          throw new Error('API returned empty response - content may be blocked by safety filters');
        }

        const finishReason = data.candidates[0]?.finishReason;
        console.log('Gemini finish reason:', finishReason);

        // Check for safety-related finish reasons
        if (finishReason === 'SAFETY') {
          const safetyRatings = data.candidates[0]?.safetyRatings || [];
          console.error('Generation stopped due to safety filter');
          console.error('Safety ratings:', JSON.stringify(safetyRatings, null, 2));
          throw new Error('Generation blocked by safety filter');
        }

        if (finishReason && finishReason !== 'STOP') {
          console.warn('Gemini response may be incomplete. Finish reason:', finishReason);
        }

        const text = data.candidates[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
          console.error('Gemini returned empty text content');
          console.error('Candidate data:', JSON.stringify(data.candidates[0], null, 2));
          throw new Error('API returned empty text - possible content filter');
        }

        return { success: true, data: text, retryable: false };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Unknown error');
        return { success: false, retryable: false };
      }
    };

    // HYBRID MODE: If paid key exists, try free keys first, then instant fallback to paid
    if (hasPaidKey) {
      // Try all free keys first (if any)
      if (hasFreeKeys) {
        const triedIndices = new Set<number>();
        let currentIndex = callCountRef.current % apiKeys.freeKeys.length;
        callCountRef.current++;

        while (triedIndices.size < apiKeys.freeKeys.length) {
          triedIndices.add(currentIndex);
          const result = await makeApiCall(
            apiKeys.freeKeys[currentIndex],
            `free key ${currentIndex + 1}/${apiKeys.freeKeys.length}`
          );

          if (result.success) {
            return result.data!;
          }

          if (result.retryDelay) {
            lastRetryDelay = result.retryDelay;
          }

          // Move to next free key
          for (let i = 0; i < apiKeys.freeKeys.length; i++) {
            const nextIdx = (currentIndex + 1 + i) % apiKeys.freeKeys.length;
            if (!triedIndices.has(nextIdx)) {
              currentIndex = nextIdx;
              break;
            }
          }
        }

        console.log('All free keys exhausted. Using paid key as fallback (instant, no waiting)...');
      }

      // Instant fallback to paid key - no waiting!
      const paidResult = await makeApiCall(apiKeys.paidKey!, 'paid key (fallback)');
      if (paidResult.success) {
        return paidResult.data!;
      }

      throw new Error(`All keys failed including paid fallback. Last error: ${lastError?.message}`);
    }

    // FREE-ONLY MODE: Use only free keys with delays and retries
    const triedIndices = new Set<number>();
    let currentIndex = callCountRef.current % apiKeys.freeKeys.length;
    callCountRef.current++;

    // First pass: try all free keys without waiting
    while (triedIndices.size < apiKeys.freeKeys.length) {
      triedIndices.add(currentIndex);
      const result = await makeApiCall(
        apiKeys.freeKeys[currentIndex],
        `free key ${currentIndex + 1}/${apiKeys.freeKeys.length}`
      );

      if (result.success) {
        return result.data!;
      }

      if (result.retryDelay) {
        lastRetryDelay = result.retryDelay;
      }

      // Move to next free key
      for (let i = 0; i < apiKeys.freeKeys.length; i++) {
        const nextIdx = (currentIndex + 1 + i) % apiKeys.freeKeys.length;
        if (!triedIndices.has(nextIdx)) {
          currentIndex = nextIdx;
          break;
        }
      }
    }

    // All free keys failed - wait for the suggested retry time and try once more
    console.log(`All free keys rate limited. Waiting ${lastRetryDelay / 1000}s before retry...`);
    await new Promise(resolve => setTimeout(resolve, lastRetryDelay));

    // Retry with next free key
    console.log('Retrying after rate limit cooldown...');
    const retryIndex = callCountRef.current % apiKeys.freeKeys.length;
    callCountRef.current++;
    console.log(`Using free key ${retryIndex + 1}/${apiKeys.freeKeys.length} (retry after cooldown)`);

    const retryResult = await makeApiCall(
      apiKeys.freeKeys[retryIndex],
      `free key ${retryIndex + 1}/${apiKeys.freeKeys.length} (retry)`
    );

    if (retryResult.success) {
      return retryResult.data!;
    }

    throw new Error(`All free API keys failed after retry. Last error: ${lastError?.message}`);
  }, [apiKeys.freeKeys, apiKeys.paidKey]);

  // ============================================================================
  // PHASE 1: DEEP STORY ANALYSIS (with detailed character extraction)
  // ============================================================================

  const analyzeStoryDeep = useCallback(async (
    script: string,
    visualStyle: string,
    sceneDuration: number = DEFAULT_SCENE_DURATION
  ): Promise<StoryAnalysis> => {
    // STEP 0: Deterministic text splitting (math-based, not AI-decided)
    const textFragments = splitScriptDeterministically(script, sceneDuration);
    console.log(`Pre-split into ${textFragments.length} scenes deterministically`);


    // STEP 1A: IDENTIFY character NAMES from full script (lightweight pass)
    // Only extract RECURRING characters who need visual consistency across scenes
    const namePrompt = `Identify RECURRING characters who appear in MULTIPLE scenes throughout this script. We need visual consistency tracking ONLY for characters who appear more than once.

SCRIPT: ${script}

Return JSON with this EXACT structure:
{
  "characters": [
    {"name": "Character Name", "role": "brief role description", "importance": "main/supporting"}
  ],
  "era": "Historical period and setting"
}

RULES:
- ONLY include characters who appear in 2 or more separate scenes
- DO NOT include one-off characters (people who appear briefly and die, anonymous figures, crowds, groups)
- DO NOT include: unnamed priests, anonymous victims, generic guards, collective crowds, embassadors mentioned once
- Focus on characters who need VISUAL CONSISTENCY across the narrative
- "importance" should be: "main" for protagonists/antagonists, "supporting" for recurring secondary characters
- Order by importance (main characters first)
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

    // Delay before Phase 1B (only for free tier)
    await delayForFreeAPI();

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

    // Delay before scene annotation (only for free tier)
    await delayForFreeAPI();

    // STEP 2: Annotate pre-split fragments with characters and action hints
    // Scenes are ALREADY split deterministically - AI only identifies WHO is in each scene and WHAT happens
    const characterIds = Object.keys(charData.characters).join(', ');
    const characterNames = Object.entries(charData.characters)
      .map(([id, char]) => `${id}: ${char.name}`)
      .join(', ');

    // Process fragments in batches to avoid huge prompts
    const BATCH_SIZE = 20; // fragments per batch
    const allScenes: SceneSegment[] = [];

    // Initialize character state tracking - all characters start as "alive"
    const characterStates: CharacterStateMap = {};
    for (const charId of Object.keys(charData.characters)) {
      characterStates[charId] = { status: 'alive', changedAtScene: 0 };
    }

    for (let batchStart = 0; batchStart < textFragments.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, textFragments.length);
      const batch = textFragments.slice(batchStart, batchEnd);

      const fragmentList = batch.map((f, i) =>
        `SCENE ${batchStart + i + 1}:\n"${f.text}"`
      ).join('\n\n');

      const annotatePrompt = `For each pre-split scene below, identify which characters are present, describe the main PHYSICAL ACTION, and note any CHARACTER STATE CHANGES (death, wound, absence).

CHARACTERS: ${characterNames}

${fragmentList}

Return JSON with this EXACT structure:
{
  "annotations": [
    {
      "scene_index": ${batchStart + 1},
      "characters_present": ["CHAR_A"],
      "action_hint": "Brief description of main PHYSICAL ACTION (not dialogue)",
      "state_changes": [
        {
          "character_id": "CHAR_A",
          "new_status": "dead",
          "note": "Killed in battle"
        }
      ]
    }
  ]
}

RULES:
- Return exactly ${batch.length} annotations, one per scene
- characters_present: use CHAR_A, CHAR_B, etc. IDs (not names)
- action_hint: describe what characters DO physically, not what they SAY
- state_changes: ONLY include if a character's status changes IN THIS SCENE
  - Valid statuses: "alive", "dead", "wounded", "absent"
  - Include "note" explaining what happened
  - Leave empty array [] if no state changes
- If no specific character is mentioned, use the most likely based on context
- Return ONLY valid JSON`;

      console.log(`Annotating scenes ${batchStart + 1}-${batchEnd} of ${textFragments.length}...`);
      const annotateResponse = await callGemini(annotatePrompt, false, 8192);

      let annotateJsonStr = annotateResponse;
      const annotateCodeBlock = annotateResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (annotateCodeBlock) annotateJsonStr = annotateCodeBlock[1].trim();
      const annotateMatch = annotateJsonStr.match(/\{[\s\S]*\}/);

      if (!annotateMatch) {
        console.warn(`Failed to parse annotations for batch starting at ${batchStart + 1}, using defaults`);
        // Use defaults if annotation fails
        for (let i = 0; i < batch.length; i++) {
          allScenes.push({
            text: batch[i].text,
            duration_sec: batch[i].durationSec,
            characters_present: [characterIds.split(', ')[0] || 'CHAR_A'],
            action_hint: 'Scene action to be determined'
          });
        }
      } else {
        try {
          const annotateData = JSON.parse(annotateMatch[0]);
          for (let i = 0; i < batch.length; i++) {
            const annotation = annotateData.annotations?.[i] || {};
            const sceneIndex = batchStart + i;

            // Extract state changes and update the character state map
            const stateChanges = annotation.state_changes || [];
            for (const change of stateChanges) {
              if (change.character_id && change.new_status) {
                characterStates[change.character_id] = {
                  status: change.new_status as CharacterStatus,
                  changedAtScene: sceneIndex,
                  note: change.note
                };
                console.log(`Scene ${sceneIndex + 1}: ${change.character_id} is now ${change.new_status} (${change.note || 'no note'})`);
              }
            }

            allScenes.push({
              text: batch[i].text,
              duration_sec: batch[i].durationSec,
              characters_present: annotation.characters_present || [characterIds.split(', ')[0] || 'CHAR_A'],
              action_hint: annotation.action_hint || 'Scene action',
              state_changes: stateChanges.length > 0 ? stateChanges : undefined
            });
          }
        } catch (e) {
          console.error('Annotation JSON parse error:', e);
          // Use defaults on parse error
          for (let i = 0; i < batch.length; i++) {
            allScenes.push({
              text: batch[i].text,
              duration_sec: batch[i].durationSec,
              characters_present: [characterIds.split(', ')[0] || 'CHAR_A'],
              action_hint: 'Scene action to be determined'
            });
          }
        }
      }

      // Delay between batches (only for free tier)
      if (batchEnd < textFragments.length) {
        await delayForFreeAPI();
      }
    }

    const analysis: StoryAnalysis = {
      characters: charData.characters,
      era: charData.era,
      visual_style_lock: visualStyle,
      scenes: allScenes,
      characterStates: characterStates
    };

    // Log character state summary
    const stateChanges = Object.entries(characterStates).filter(([_, state]) => state.status !== 'alive');
    if (stateChanges.length > 0) {
      console.log('Character state changes detected:', stateChanges.map(([id, state]) => `${id}: ${state.status} at scene ${state.changedAtScene + 1}`).join(', '));
    }

    console.log('Analysis complete:', Object.keys(analysis.characters).length, 'characters,', analysis.scenes.length, 'scenes (deterministic)');

    return analysis;
  }, [callGemini, splitScriptDeterministically, delayForFreeAPI]);

  // ============================================================================
  // PHASE 2: GENERATE SINGLE SCENE (ACTION-FOCUSED, NO DIALOGUE)
  // ============================================================================

  const generateScenePromptFull = useCallback(async (
    sceneSegment: SceneSegment,
    sceneIndex: number,
    characterIdentities: Record<string, CharacterIdentity>,
    era: string,
    visualStyleLock: string,
    totalScenes: number = 1,
    previousFraming?: string,
    characterStates?: CharacterStateMap,
    previousScenePrompt?: FullScenePrompt
  ): Promise<FullScenePrompt> => {
    const sceneId = `S${sceneIndex + 1}`;
    const presentCharacters = sceneSegment.characters_present;
    const MAX_RETRIES = 2;

    // Build character context with state awareness
    // NOTE: We intentionally OMIT character names from the prompt to avoid triggering
    // safety filters on historically sensitive figures. The name is preserved in the
    // final output because we merge identity data AFTER getting the AI response.
    const characterContext = presentCharacters.map(charId => {
      const c = characterIdentities[charId];
      if (!c) return '';

      // Check character state at this scene
      const state = characterStates?.[charId];
      let stateWarning = '';
      if (state && state.status !== 'alive' && state.changedAtScene < sceneIndex) {
        stateWarning = ` [WARNING: This character is ${state.status.toUpperCase()} as of scene ${state.changedAtScene + 1}${state.note ? ` - ${state.note}` : ''}. DO NOT show them as alive unless this is a flashback.]`;
      }

      // Use only CHAR_ID + visual descriptors (no name) to avoid historical pattern matching
      return `${charId}: ${c.species}, ${c.age}, ${c.body_build}, ${c.face_shape}, ${c.hair}, ${c.facial_hair}, ${c.skin_or_fur_color} skin, ${c.eye_color}. Wearing: ${c.outfit_top}, ${c.outfit_bottom}, ${c.shoes_or_footwear}. Signature: ${c.signature_feature}${stateWarning}`;
    }).filter(Boolean).join('\n');

    // Determine suggested shot type based on position in story (for variety)
    const storyPosition = sceneIndex / Math.max(totalScenes - 1, 1);
    const shotSuggestions = [
      'WIDE SHOT (establishing)',
      'MEDIUM SHOT (conversational)',
      'CLOSE-UP (emotional)',
      'EXTREME CLOSE-UP (detail/tension)',
      'OVER-THE-SHOULDER',
      'TWO-SHOT',
      'LOW ANGLE (power)',
      'HIGH ANGLE (vulnerability)'
    ];
    // Cycle through shot types to ensure variety
    const suggestedShot = shotSuggestions[sceneIndex % shotSuggestions.length];

    // Build variation context
    const variationContext = previousFraming
      ? `PREVIOUS SCENE FRAMING: "${previousFraming}" - YOU MUST USE A DIFFERENT FRAMING FOR THIS SCENE!`
      : 'This is the first scene - establish with a wide or establishing shot.';

    const scenePrompt = `Generate an ACTION-FOCUSED video scene prompt. This is for AI VIDEO GENERATION - characters must MOVE and DO things.

SCENE POSITION: ${sceneIndex + 1} of ${totalScenes} (${Math.round(storyPosition * 100)}% through story)
SUGGESTED SHOT TYPE: ${suggestedShot} (for variety - adapt to content)
${variationContext}

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
7. SHOT VARIETY: Use the suggested shot type for variety. NEVER repeat the same framing as the previous scene
8. DYNAMIC VERBS: Use active verbs (runs, grabs, turns, lunges) not static (stands, is, has)
9. Return ONLY valid JSON`;

    // Retry loop for transient API failures
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Use higher token limit (16384) to prevent truncation on complex scenes
        const response = await callGemini(scenePrompt, false, 16384);

        // Handle markdown code blocks in response (```json ... ```)
        let jsonStr = response;
        const codeBlock = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
          jsonStr = codeBlock[1].trim();
        }

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          // Log raw response for debugging
          console.error(`Scene ${sceneId} attempt ${attempt + 1}: Failed to find JSON in response`);
          console.error(`Raw response (first 1000 chars): ${response.substring(0, 1000)}`);
          throw new Error(`Failed to parse scene ${sceneId} prompt - no valid JSON found`);
        }

        const sceneData = JSON.parse(jsonMatch[0]);

        // Success - return the parsed data (rest of processing continues below)
        // Build the full prompt object
        const characterLock: Record<string, CharacterLock> = {};

        for (const charId of presentCharacters) {
          const identity = characterIdentities[charId];
          const performance = sceneData.character_performances?.[charId];

          if (identity && performance) {
            // Replace CHAR_IDs with real names in all performance text fields
            characterLock[charId] = {
              ...identity,
              position: replaceCharIdsWithNames(performance.position || '', characterIdentities),
              orientation: replaceCharIdsWithNames(performance.orientation || '', characterIdentities),
              pose: replaceCharIdsWithNames(performance.pose || '', characterIdentities),
              expression: replaceCharIdsWithNames(performance.expression || '', characterIdentities),
              action_flow: {
                pre_action: replaceCharIdsWithNames(performance.action_flow?.pre_action || '', characterIdentities),
                main_action: replaceCharIdsWithNames(performance.action_flow?.main_action || '', characterIdentities),
                post_action: replaceCharIdsWithNames(performance.action_flow?.post_action || '', characterIdentities),
              },
            };
          }
        }

        // Replace CHAR_IDs with real names in text fields
        const actionSummary = replaceCharIdsWithNames(
          sceneData.scene_action_summary || '',
          characterIdentities
        );

        // Also replace in background_lock setting (e.g., "CHAR_B's workshop" → "Perilo's workshop")
        const backgroundLock = sceneData.background_lock || { setting: '', scenery: '', lighting: '' };
        const processedBackground: BackgroundLock = {
          setting: replaceCharIdsWithNames(backgroundLock.setting || '', characterIdentities),
          scenery: replaceCharIdsWithNames(backgroundLock.scenery || '', characterIdentities),
          lighting: backgroundLock.lighting || '',
        };

        // Replace CHAR_IDs in camera fields (e.g., "Focus on CHAR_A" → "Focus on Falaris")
        const cameraData = sceneData.camera || { framing: '', angle: '', movement: '', focus: '' };
        const processedCamera: Camera = {
          framing: cameraData.framing || '',
          angle: cameraData.angle || '',
          movement: replaceCharIdsWithNames(cameraData.movement || '', characterIdentities),
          focus: replaceCharIdsWithNames(cameraData.focus || '', characterIdentities),
        };

        // Check if Gemini sanitized the scene (replaced violent content with safe content)
        const sanitizationCheck = detectSanitizedScene(
          sceneSegment.text,
          processedBackground.setting,
          actionSummary,
          sceneSegment.action_hint || ''
        );

        // If sanitized, DISCARD Gemini's output entirely and use local builder
        if (sanitizationCheck.isSanitized) {
          console.warn(`Scene ${sceneId}: SANITIZED DETECTED - ${sanitizationCheck.reason}`);
          console.warn(`Discarding Gemini output and using local builder with [SANITIZED] marker`);
          return buildLocalScene(
            sceneId,
            sceneSegment,
            presentCharacters,
            characterIdentities,
            visualStyleLock,
            previousScenePrompt,
            '[SANITIZED]'
          );
        }

        const fullPrompt: FullScenePrompt = {
          scene_id: sceneId,
          duration_sec: sceneSegment.duration_sec,
          visual_style: visualStyleLock,
          text_fragment: sceneSegment.text,
          character_lock: characterLock,
          background_lock: processedBackground,
          camera: processedCamera,
          foley_and_ambience: sceneData.foley_and_ambience || { ambience: [], fx: [], music: '' },
          scene_action_summary: actionSummary,
        };

        return fullPrompt;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Unknown error');
        console.error(`Scene ${sceneId} attempt ${attempt + 1} failed:`, lastError.message);

        // Log scene text on first failure to help identify problematic content
        if (attempt === 0) {
          console.error(`Scene ${sceneId} narration text that may have triggered block:`);
          console.error(`"${sceneSegment.text.substring(0, 500)}${sceneSegment.text.length > 500 ? '...' : ''}"`);
          console.error(`Characters in scene: ${presentCharacters.join(', ')}`);
        }

        if (attempt < MAX_RETRIES) {
          // Wait before retry (longer for each attempt)
          const retryDelay = (attempt + 1) * 3000;
          console.log(`Retrying scene ${sceneId} in ${retryDelay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // ALL RETRIES EXHAUSTED - Use local builder with [BLOCKED] marker
    // This handles genuinely blocked content (e.g., violent scenes) that Gemini will never generate
    console.log(`Scene ${sceneId}: All Gemini attempts failed. Using local builder with [BLOCKED] marker.`);
    return buildLocalScene(
      sceneId,
      sceneSegment,
      presentCharacters,
      characterIdentities,
      visualStyleLock,
      previousScenePrompt,
      '[BLOCKED]'
    );
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

      // PHASE 2: Generate scenes - PARALLEL for paid tier, SEQUENTIAL for free tier
      const usePaidParallel = apiKeys.paidKey !== null;

      if (usePaidParallel) {
        // PAID TIER: Process in parallel batches for ~5x speedup
        console.log(`Paid tier: Processing ${finalAnalysis.scenes.length} scenes in parallel batches of ${PAID_PARALLEL_BATCH_SIZE}`);

        for (let batchStart = 0; batchStart < finalAnalysis.scenes.length; batchStart += PAID_PARALLEL_BATCH_SIZE) {
          if (isCancelledRef.current) {
            setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
            return prompts;
          }

          await waitIfPaused();

          const batchEnd = Math.min(batchStart + PAID_PARALLEL_BATCH_SIZE, finalAnalysis.scenes.length);
          const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

          setState(prev => ({ ...prev, currentScene: batchEnd }));
          console.log(`Processing batch: scenes ${batchStart + 1}-${batchEnd} of ${finalAnalysis.scenes.length}`);

          // Get last completed prompt from previous batch for fallback inheritance
          // In parallel mode, all scenes in a batch use the same previous prompt (last from prior batch)
          const previousBatchPrompt = batchStart > 0 ? prompts[batchStart - 1] : undefined;

          // Generate all scenes in this batch in parallel
          const batchPromises = batchIndices.map(async (sceneIndex) => {
            // For variety, use different shot suggestions but can't use previous scene framing in parallel
            const scenePrompt = await generateScenePromptFull(
              finalAnalysis.scenes[sceneIndex],
              sceneIndex,
              finalAnalysis.characters,
              finalAnalysis.era,
              finalAnalysis.visual_style_lock,
              finalAnalysis.scenes.length,
              undefined, // Can't track previous framing in parallel mode
              finalAnalysis.characterStates,
              previousBatchPrompt // Pass last prompt from previous batch for blocked scene fallback
            );
            return { index: sceneIndex, prompt: scenePrompt };
          });

          // Wait for all scenes in batch to complete
          const batchResults = await Promise.all(batchPromises);

          // Sort by index and add to prompts array in order
          batchResults.sort((a, b) => a.index - b.index);
          for (const result of batchResults) {
            prompts[result.index] = result.prompt;
          }

          // Update progress with all completed prompts
          onProgress([...prompts.filter(Boolean)]);

          // Save progress after each batch
          saveProgress(script, visualStyle, sceneDuration, finalAnalysis, prompts.filter(Boolean), batchEnd);

          // Minimal delay between batches (50ms)
          await delayForFreeAPI();
        }
      } else {
        // FREE TIER: Sequential processing with delays
        console.log(`Free tier: Processing ${finalAnalysis.scenes.length} scenes sequentially`);

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

          // Get previous scene for variety enforcement and fallback inheritance
          const previousPrompt = prompts.length > 0 ? prompts[prompts.length - 1] : undefined;
          const previousFraming = previousPrompt?.camera.framing;

          const scenePrompt = await generateScenePromptFull(
            finalAnalysis.scenes[i],
            i,
            finalAnalysis.characters,
            finalAnalysis.era,
            finalAnalysis.visual_style_lock,
            finalAnalysis.scenes.length,
            previousFraming,
            finalAnalysis.characterStates,
            previousPrompt
          );

          prompts.push(scenePrompt);
          onProgress([...prompts]);

          // Save progress after each scene
          saveProgress(script, visualStyle, sceneDuration, finalAnalysis, prompts, i + 1);

          // Delay between scenes for rate limit compliance
          await delayForFreeAPI();
        }
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
  }, [analyzeStoryDeep, generateScenePromptFull, apiKeys.freeKeys.length, apiKeys.paidKey, waitIfPaused, delayForFreeAPI]);

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
      // Use parallel processing for paid tier
      const usePaidParallel = apiKeys.paidKey !== null;
      const totalScenes = project.storyAnalysis.scenes.length;

      if (usePaidParallel) {
        // PAID TIER: Process in parallel batches
        console.log(`Paid tier: Continuing from scene ${startIndex + 1}, processing in parallel batches of ${PAID_PARALLEL_BATCH_SIZE}`);

        for (let batchStart = startIndex; batchStart < totalScenes; batchStart += PAID_PARALLEL_BATCH_SIZE) {
          if (isCancelledRef.current) {
            setState({ isGenerating: false, currentScene: 0, totalScenes: 0, phase: 'idle', error: 'Generation cancelled' });
            return prompts;
          }

          await waitIfPaused();

          const batchEnd = Math.min(batchStart + PAID_PARALLEL_BATCH_SIZE, totalScenes);
          const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);

          setState(prev => ({ ...prev, currentScene: batchEnd }));
          console.log(`Processing batch: scenes ${batchStart + 1}-${batchEnd} of ${totalScenes}`);

          // Get last completed prompt from previous batch for fallback inheritance
          const previousBatchPrompt = batchStart > 0 ? prompts[batchStart - 1] : undefined;

          // Generate all scenes in this batch in parallel
          const batchPromises = batchIndices.map(async (sceneIndex) => {
            const scenePrompt = await generateScenePromptFull(
              project.storyAnalysis!.scenes[sceneIndex],
              sceneIndex,
              project.storyAnalysis!.characters,
              project.storyAnalysis!.era,
              project.storyAnalysis!.visual_style_lock,
              totalScenes,
              undefined,
              project.storyAnalysis!.characterStates,
              previousBatchPrompt
            );
            return { index: sceneIndex, prompt: scenePrompt };
          });

          const batchResults = await Promise.all(batchPromises);

          // Sort by index and add to prompts array in order
          batchResults.sort((a, b) => a.index - b.index);
          for (const result of batchResults) {
            prompts[result.index] = result.prompt;
          }

          onProgress([...prompts.filter(Boolean)]);

          saveProgress(
            project.script,
            project.visualStyle,
            project.sceneDuration,
            project.storyAnalysis!,
            prompts.filter(Boolean),
            batchEnd
          );

          await delayForFreeAPI();
        }
      } else {
        // FREE TIER: Sequential processing
        for (let i = startIndex; i < totalScenes; i++) {
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

          // Get previous scene for variety enforcement and fallback inheritance
          const previousPrompt = prompts.length > 0 ? prompts[prompts.length - 1] : undefined;
          const previousFraming = previousPrompt?.camera.framing;

          const scenePrompt = await generateScenePromptFull(
            project.storyAnalysis!.scenes[i],
            i,
            project.storyAnalysis!.characters,
            project.storyAnalysis!.era,
            project.storyAnalysis!.visual_style_lock,
            totalScenes,
            previousFraming,
            project.storyAnalysis!.characterStates,
            previousPrompt
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

          await delayForFreeAPI();
        }
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
  }, [generateScenePromptFull, waitIfPaused, delayForFreeAPI, apiKeys.paidKey]);

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
      // Get previous scene for variety enforcement and fallback inheritance
      const previousPrompt = sceneIndex > 0 ? currentPrompts[sceneIndex - 1] : undefined;
      const previousFraming = previousPrompt?.camera.framing;

      const newPrompt = await generateScenePromptFull(
        analysis.scenes[sceneIndex],
        sceneIndex,
        analysis.characters,
        analysis.era,
        analysis.visual_style_lock,
        analysis.scenes.length,
        previousFraming,
        analysis.characterStates, // Pass character states for continuity
        previousPrompt // Pass previous scene for blocked scene fallback
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
    keyCount: apiKeys.freeKeys.length + (apiKeys.paidKey ? 1 : 0),
    hasAnyKeys: apiKeys.freeKeys.length > 0 || apiKeys.paidKey !== null,
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
