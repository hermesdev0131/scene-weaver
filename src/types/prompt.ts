// ============================================================================
// CHARACTER TYPES
// ============================================================================

// Locked identity fields - NEVER change across scenes
export interface CharacterIdentity {
  name: string;
  species: string;
  gender: string;
  age: string;
  body_build: string;
  face_shape: string;
  hair: string;
  facial_hair: string;
  skin_or_fur_color: string;
  eye_color: string;
  signature_feature: string;
  outfit_top: string;
  outfit_bottom: string;
  helmet_or_hat: string;
  shoes_or_footwear: string;
  accessories: string;
  texture_detail: string;
  material_reference: string;
  voice_personality: string;
}

// Variable per scene - changes with each scene
export interface CharacterPerformance {
  position: string;
  orientation: string;
  pose: string;
  expression: string;
  action_flow: {
    pre_action: string;
    main_action: string;
    post_action: string;
  };
}

// Combined in final output (identity + performance)
export type CharacterLock = CharacterIdentity & CharacterPerformance;

// ============================================================================
// SCENE STRUCTURE TYPES
// ============================================================================

export interface BackgroundLock {
  setting: string;
  scenery: string;
  lighting: string;
}

export interface Camera {
  framing: string;
  angle: string;
  movement: string;
  focus: string;
}

export interface FoleyAmbience {
  ambience: string[];
  fx: string[];
  music: string;
}

export interface DialogueLine {
  speaker: string;        // CHAR_A, CHAR_B, etc.
  voice: string;          // copied from character's voice_personality
  language: string;
  line: string;
}

// ============================================================================
// FULL SCENE PROMPT (final output per scene)
// ============================================================================

export interface FullScenePrompt {
  scene_id: string;
  duration_sec: number;
  visual_style: string;
  character_lock: Record<string, CharacterLock>;
  background_lock: BackgroundLock;
  camera: Camera;
  foley_and_ambience: FoleyAmbience;
  dialogue: DialogueLine[];
  lip_sync_director_note: string;
}

// ============================================================================
// STORY ANALYSIS TYPES (from initial deep analysis)
// ============================================================================

export interface SceneSegment {
  text: string;
  duration_sec: number;
  characters_present: string[];  // CHAR_A, CHAR_B, etc.
}

export interface StoryAnalysis {
  characters: Record<string, CharacterIdentity>;  // keyed by CHAR_A, CHAR_B, etc.
  era: string;
  visual_style_lock: string;
  scenes: SceneSegment[];
}

// ============================================================================
// GENERATION STATE
// ============================================================================

export interface GenerationState {
  isGenerating: boolean;
  currentScene: number;
  totalScenes: number;
  phase: 'idle' | 'analyzing' | 'generating';
  error: string | null;
}

export interface ApiKeyConfig {
  keys: string[];
  currentIndex: number;
}

// ============================================================================
// LEGACY TYPES (kept for backwards compatibility during transition)
// ============================================================================

export interface Character {
  id: string;
  name: string;
  description: string;
  appearance: string;
  role: string;
}

export interface ScenePrompt {
  sceneNumber: number;
  duration: number;
  narrationText: string;
  visualDescription: string;
  characters: string[];
  environment: string;
  era: string;
  mood: string;
  cameraMovement: string;
  visualStyle: string;
  actions: string;
}
