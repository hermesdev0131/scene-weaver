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

export interface GenerationState {
  isGenerating: boolean;
  currentScene: number;
  totalScenes: number;
  error: string | null;
}

export interface ApiKeyConfig {
  keys: string[];
  currentIndex: number;
}
