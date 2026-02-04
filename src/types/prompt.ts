// ============================================================================
// CHARACTER TYPES
// ============================================================================

// Locked identity fields - NEVER change across scenes (no voice/dialogue)
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
}

// Variable per scene - changes with each scene (ACTION FOCUSED)
export interface CharacterPerformance {
  position: string;
  orientation: string;
  pose: string;
  expression: string;
  action_flow: {
    pre_action: string;   // What character does before main action
    main_action: string;  // Primary physical action during scene
    post_action: string;  // What character does after main action
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

// Audio is environmental/action sounds only - NO dialogue/voice
export interface FoleyAmbience {
  ambience: string[];   // Background environmental sounds
  fx: string[];         // Action/object sound effects
  music: string;        // Score/soundtrack description
}

// ============================================================================
// FULL SCENE PROMPT (final output per scene) - ACTION FOCUSED, NO DIALOGUE
// ============================================================================

export interface FullScenePrompt {
  scene_id: string;
  duration_sec: number;
  visual_style: string;
  character_lock: Record<string, CharacterLock>;
  background_lock: BackgroundLock;
  camera: Camera;
  foley_and_ambience: FoleyAmbience;
  // Scene action summary for continuity
  scene_action_summary: string;
}

// ============================================================================
// STORY ANALYSIS TYPES (from initial deep analysis)
// ============================================================================

export interface SceneSegment {
  text: string;
  duration_sec: number;
  characters_present: string[];  // CHAR_A, CHAR_B, etc.
  action_hint: string;           // Brief action description for this segment
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
  phase: 'idle' | 'analyzing' | 'awaiting_approval' | 'generating' | 'paused';
  error: string | null;
}

export interface ApiKeyConfig {
  keys: string[];
  currentIndex: number;
}

// ============================================================================
// PROJECT STATE (for save/restore functionality)
// ============================================================================

export interface ProjectState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  script: string;
  visualStyle: string;
  sceneDuration: number;
  storyAnalysis: StoryAnalysis | null;
  prompts: FullScenePrompt[];
  currentSceneIndex: number;  // Where generation stopped
  isComplete: boolean;
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
