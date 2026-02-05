import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { SceneOutputV2 } from '@/components/SceneOutputV2';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import { CharacterPanelV2 } from '@/components/CharacterPanelV2';
import { CharacterApprovalDialog } from '@/components/CharacterApprovalDialog';
import { useGeminiApi } from '@/hooks/useGeminiApi';
import { FullScenePrompt, CharacterIdentity, SceneSegment, ProjectState } from '@/types/prompt';
import { toast } from 'sonner';

const Index = () => {
  const [script, setScript] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [sceneDuration, setSceneDuration] = useState(6);
  const [prompts, setPrompts] = useState<FullScenePrompt[]>([]);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [characters, setCharacters] = useState<Record<string, CharacterIdentity>>({});
  const [era, setEra] = useState<string | null>(null);

  // Character approval flow state
  const [pendingApproval, setPendingApproval] = useState<{
    characters: Record<string, CharacterIdentity>;
    era: string;
    scenes: SceneSegment[];
  } | null>(null);

  const {
    state,
    apiKeys,
    saveApiKeys,
    generatePromptsV2,
    regenerateSceneV2,
    storyAnalysis,
    pauseGeneration,
    resumeGeneration,
    cancelGeneration,
    approveCharacters,
    loadProgress,
    clearProgress,
    continueFromProgress,
    hasAnyKeys
  } = useGeminiApi();

  // Saved progress state
  const [savedProgress, setSavedProgress] = useState<ProjectState | null>(null);

  // Check for saved progress on mount
  useEffect(() => {
    const saved = loadProgress();
    if (saved && !saved.isComplete) {
      setSavedProgress(saved);
    }
  }, [loadProgress]);

  const handleGenerate = async () => {
    if (!script.trim() || !visualStyle.trim()) {
      toast.error('Please provide both a script and visual style');
      return;
    }

    if (!hasAnyKeys) {
      toast.error('Please configure at least one Gemini API key');
      return;
    }

    try {
      setPrompts([]);
      setCharacters({});
      setEra(null);
      setPendingApproval(null);

      await generatePromptsV2(
        script,
        visualStyle,
        sceneDuration,
        (updatedPrompts) => {
          setPrompts(updatedPrompts);
        },
        (extractedCharacters, extractedEra, scenes) => {
          // Show character approval dialog
          setPendingApproval({
            characters: extractedCharacters,
            era: extractedEra,
            scenes
          });
        }
      );

      // Update characters and era after generation
      if (storyAnalysis) {
        setCharacters(storyAnalysis.characters);
        setEra(storyAnalysis.era);
      }
      toast.success('All prompts generated successfully!');
    } catch (error) {
      // Error is already handled in the hook
    }
  };

  const handleApproveCharacters = (approvedCharacters: Record<string, CharacterIdentity>) => {
    setCharacters(approvedCharacters);
    if (pendingApproval) {
      setEra(pendingApproval.era);
    }
    setPendingApproval(null);
    approveCharacters(approvedCharacters);
  };

  const handleCancelApproval = () => {
    setPendingApproval(null);
    cancelGeneration();
  };

  const handleContinueProgress = async () => {
    if (!savedProgress) return;

    if (!hasAnyKeys) {
      toast.error('Please configure at least one Gemini API key');
      return;
    }

    try {
      // Restore state from saved progress
      setScript(savedProgress.script);
      setVisualStyle(savedProgress.visualStyle);
      setSceneDuration(savedProgress.sceneDuration);
      setPrompts(savedProgress.prompts);
      if (savedProgress.storyAnalysis) {
        setCharacters(savedProgress.storyAnalysis.characters);
        setEra(savedProgress.storyAnalysis.era);
      }
      setSavedProgress(null);

      toast.info(`Continuing from scene ${savedProgress.currentSceneIndex + 1}...`);

      await continueFromProgress(savedProgress, (updatedPrompts) => {
        setPrompts(updatedPrompts);
      });

      toast.success('All prompts generated successfully!');
    } catch (error) {
      // Error is already handled in the hook
    }
  };

  const handleDismissProgress = () => {
    clearProgress();
    setSavedProgress(null);
    toast.info('Saved progress cleared');
  };

  const handleUpdatePrompt = (index: number, updatedPrompt: FullScenePrompt) => {
    setPrompts(prev => {
      const newPrompts = [...prev];
      newPrompts[index] = updatedPrompt;
      return newPrompts;
    });
  };

  const handleRegenerateScene = async (index: number) => {
    if (!hasAnyKeys) {
      toast.error('Please configure at least one Gemini API key');
      return;
    }

    try {
      setRegeneratingIndex(index);
      const newPrompt = await regenerateSceneV2(index, prompts);
      handleUpdatePrompt(index, newPrompt);
      toast.success(`Scene ${index + 1} regenerated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to regenerate scene');
    } finally {
      setRegeneratingIndex(null);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        script={script}
        onScriptChange={setScript}
        visualStyle={visualStyle}
        onVisualStyleChange={setVisualStyle}
        sceneDuration={sceneDuration}
        onSceneDurationChange={setSceneDuration}
        onGenerate={handleGenerate}
        onPause={pauseGeneration}
        onResume={resumeGeneration}
        onCancel={cancelGeneration}
        state={state}
        hasApiKeys={hasAnyKeys}
        savedProgress={savedProgress}
        onContinueProgress={handleContinueProgress}
        onDismissProgress={handleDismissProgress}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-border flex items-center justify-between px-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Scene Prompts</h2>
            <p className="text-xs text-muted-foreground">
              {prompts.length > 0
                ? `${prompts.length} prompts ready for AI video generation`
                : 'Generate prompts from your narrative script'
              }
            </p>
          </div>
          <ApiKeyManager apiKeys={apiKeys} onSave={saveApiKeys} />
        </header>

        <div className="flex flex-1 overflow-hidden">
          {Object.keys(characters).length > 0 && (
            <div className="w-72 border-r border-border overflow-y-auto">
              <CharacterPanelV2 characters={characters} era={era} />
            </div>
          )}

          <SceneOutputV2
            prompts={prompts}
            onUpdatePrompt={handleUpdatePrompt}
            onRegenerateScene={handleRegenerateScene}
            isRegenerating={regeneratingIndex !== null}
            regeneratingIndex={regeneratingIndex}
          />
        </div>
      </main>

      {/* Character Approval Dialog */}
      <CharacterApprovalDialog
        open={pendingApproval !== null}
        characters={pendingApproval?.characters ?? {}}
        era={pendingApproval?.era ?? ''}
        scenes={pendingApproval?.scenes ?? []}
        onApprove={handleApproveCharacters}
        onCancel={handleCancelApproval}
      />
    </div>
  );
};

export default Index;
