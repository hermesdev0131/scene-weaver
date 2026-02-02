import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { SceneOutput } from '@/components/SceneOutput';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import { useGeminiApi } from '@/hooks/useGeminiApi';
import { ScenePrompt } from '@/types/prompt';
import { toast } from 'sonner';

const Index = () => {
  const [script, setScript] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [prompts, setPrompts] = useState<ScenePrompt[]>([]);
  
  const { state, apiKeys, saveApiKeys, generatePrompts } = useGeminiApi();

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
      await generatePrompts(script, visualStyle, (updatedPrompts) => {
        setPrompts(updatedPrompts);
      });
      toast.success('All prompts generated successfully!');
    } catch (error) {
      // Error is already handled in the hook
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
        
        <SceneOutput prompts={prompts} />
      </main>
    </div>
  );
};

export default Index;
