import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Wand2, Loader2, Pause, Play, X, RotateCcw, Trash2 } from 'lucide-react';
import { GenerationState, ProjectState } from '@/types/prompt';

interface SidebarProps {
  script: string;
  onScriptChange: (value: string) => void;
  visualStyle: string;
  onVisualStyleChange: (value: string) => void;
  sceneDuration: number;
  onSceneDurationChange: (value: number) => void;
  onGenerate: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  state: GenerationState;
  hasApiKeys: boolean;
  savedProgress?: ProjectState | null;
  onContinueProgress?: () => void;
  onDismissProgress?: () => void;
}

export function Sidebar({
  script,
  onScriptChange,
  visualStyle,
  onVisualStyleChange,
  sceneDuration,
  onSceneDurationChange,
  onGenerate,
  onPause,
  onResume,
  onCancel,
  state,
  hasApiKeys,
  savedProgress,
  onContinueProgress,
  onDismissProgress,
}: SidebarProps) {
  const wordCount = script.trim().split(/\s+/).filter(w => w).length;
  // Estimate based on ~3 words per second of narration
  const wordsPerScene = sceneDuration * 3;
  const estimatedScenes = Math.max(1, Math.ceil(wordCount / wordsPerScene));

  return (
    <aside className="w-80 min-w-80 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-lg font-semibold text-sidebar-foreground flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          Script to Prompts
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          AI Video Prompt Generator
        </p>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-auto">
        <div className="space-y-2">
          <Label htmlFor="script" className="text-sidebar-foreground">
            Narrative Script
          </Label>
          <Textarea
            id="script"
            placeholder="Paste your full narrative script here..."
            value={script}
            onChange={(e) => onScriptChange(e.target.value)}
            className="min-h-[300px] bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-muted-foreground resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {wordCount} words • ~{estimatedScenes} estimated scenes
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="style" className="text-sidebar-foreground">
            Visual Style Directive
          </Label>
          <Textarea
            id="style"
            placeholder="Describe the visual style in detail. Include art style, color palette (with hex codes), mood, lighting, texture details, character design notes, etc.

Example: Hand-drawn illustration style, historical epic feel, with strong outlines and highly detailed character design. Dynamic composition with expressive faces, emphasizing grim and determined moods. Textured clothing and beards. Earthy color palette (#E4C99D, #8C4524, #C6382D, #4A4A4A, #6F8B9C, #D7AA6F) for a somber, gritty tone."
            value={visualStyle}
            onChange={(e) => onVisualStyleChange(e.target.value)}
            className="min-h-[100px] bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-muted-foreground resize-none text-xs"
          />
          <p className="text-xs text-muted-foreground">
            This will be locked and applied identically to every scene.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="duration" className="text-sidebar-foreground">
            Scene Duration
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="duration"
              type="number"
              min={4}
              max={12}
              value={sceneDuration}
              onChange={(e) => onSceneDurationChange(Math.max(4, Math.min(12, parseInt(e.target.value) || 6)))}
              className="w-20 bg-sidebar-accent border-sidebar-border text-sidebar-foreground"
            />
            <span className="text-sm text-muted-foreground">seconds per scene</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Shorter scenes = more dynamic cuts (4-12 sec recommended)
          </p>
        </div>
      </div>

      <div className="p-4 border-t border-sidebar-border space-y-3">
        {state.isGenerating && (
          <div className="bg-primary/10 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-primary">
              {state.phase === 'paused' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {state.phase === 'analyzing' ? (
                'Analyzing script & extracting characters...'
              ) : state.phase === 'paused' ? (
                `Paused at scene ${state.currentScene} of ${state.totalScenes}`
              ) : (
                `Generating scene ${state.currentScene} of ${state.totalScenes}`
              )}
            </div>
            {(state.phase === 'generating' || state.phase === 'paused') && state.totalScenes > 0 && (
              <div className="mt-2 h-1.5 bg-sidebar-accent rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(state.currentScene / state.totalScenes) * 100}%` }}
                />
              </div>
            )}
            {/* Pause/Resume/Cancel controls */}
            {state.phase !== 'analyzing' && (
              <div className="flex gap-2 mt-3">
                {state.phase === 'paused' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={onResume}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={onPause}
                  >
                    <Pause className="h-3 w-3 mr-1" />
                    Pause
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={onCancel}
                >
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {state.error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive">{state.error}</p>
          </div>
        )}

        {/* Saved Progress Banner */}
        {savedProgress && !state.isGenerating && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              Saved Progress Found
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {savedProgress.prompts.length} of {savedProgress.storyAnalysis?.scenes.length || '?'} scenes completed
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={onContinueProgress}
                disabled={!hasApiKeys}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Continue
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismissProgress}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        <Button
          onClick={onGenerate}
          disabled={!script.trim() || !visualStyle.trim() || state.isGenerating || !hasApiKeys}
          className="w-full"
          size="lg"
        >
          {state.isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-2" />
              Generate Prompts
            </>
          )}
        </Button>

        {!hasApiKeys && (
          <p className="text-xs text-center text-muted-foreground">
            Configure API keys in settings to start
          </p>
        )}
      </div>
    </aside>
  );
}
