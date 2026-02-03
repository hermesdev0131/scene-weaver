import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Wand2, Loader2 } from 'lucide-react';
import { GenerationState } from '@/types/prompt';

interface SidebarProps {
  script: string;
  onScriptChange: (value: string) => void;
  visualStyle: string;
  onVisualStyleChange: (value: string) => void;
  onGenerate: () => void;
  state: GenerationState;
  hasApiKeys: boolean;
}

export function Sidebar({
  script,
  onScriptChange,
  visualStyle,
  onVisualStyleChange,
  onGenerate,
  state,
  hasApiKeys,
}: SidebarProps) {
  const wordCount = script.trim().split(/\s+/).filter(w => w).length;
  const estimatedScenes = Math.max(1, Math.ceil(wordCount / 20));

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
      </div>

      <div className="p-4 border-t border-sidebar-border space-y-3">
        {state.isGenerating && (
          <div className="bg-primary/10 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              {state.phase === 'analyzing' ? (
                'Analyzing script & extracting characters...'
              ) : (
                `Generating scene ${state.currentScene} of ${state.totalScenes}`
              )}
            </div>
            {state.phase === 'generating' && state.totalScenes > 0 && (
              <div className="mt-2 h-1.5 bg-sidebar-accent rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(state.currentScene / state.totalScenes) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {state.error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
            <p className="text-sm text-destructive">{state.error}</p>
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
