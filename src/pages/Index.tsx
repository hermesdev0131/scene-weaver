import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { SceneOutputV2 } from '@/components/SceneOutputV2';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import { CharacterPanelV2 } from '@/components/CharacterPanelV2';
import { useGeminiApi } from '@/hooks/useGeminiApi';
import { FullScenePrompt, CharacterIdentity } from '@/types/prompt';
import { toast } from 'sonner';

const Index = () => {
  const [script, setScript] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [prompts, setPrompts] = useState<FullScenePrompt[]>([]);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [characters, setCharacters] = useState<Record<string, CharacterIdentity>>({});
  const [era, setEra] = useState<string | null>(null);

  const { state, apiKeys, saveApiKeys, generatePromptsV2, regenerateSceneV2, storyAnalysis } = useGeminiApi();

  const handleGenerate = async () => {
    if (!script.trim() || !visualStyle.trim()) {
      toast.error('Please provide both a script and visual style');
      return;
    }

    if (apiKeys.keys.length === 0) {
      toast.error('Please configure at least one Gemini API key');
      return;
    }

    try {
      setPrompts([]);
      setCharacters({});
      setEra(null);
      await generatePromptsV2(script, visualStyle, (updatedPrompts) => {
        setPrompts(updatedPrompts);
      });
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

  // Update characters/era after state changes (storyAnalysis updates after generation)
  const updateFromAnalysis = () => {
    if (storyAnalysis && Object.keys(characters).length === 0) {
      setCharacters(storyAnalysis.characters);
      setEra(storyAnalysis.era);
    }
  };

  // Call this when prompts change
  if (prompts.length > 0 && Object.keys(characters).length === 0 && storyAnalysis) {
    updateFromAnalysis();
  }

  const handleUpdatePrompt = (index: number, updatedPrompt: FullScenePrompt) => {
    setPrompts(prev => {
      const newPrompts = [...prev];
      newPrompts[index] = updatedPrompt;
      return newPrompts;
    });
  };

  const handleRegenerateScene = async (index: number) => {
    if (apiKeys.keys.length === 0) {
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
        onGenerate={handleGenerate}
        state={state}
        hasApiKeys={apiKeys.keys.length > 0}
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
          <ApiKeyManager keys={apiKeys.keys} onSave={saveApiKeys} />
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
    </div>
  );
};

export default Index;
