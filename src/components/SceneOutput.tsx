import { useState } from 'react';
import { ScenePrompt } from '@/types/prompt';
import { Button } from '@/components/ui/button';
import { Copy, Check, Download, Film } from 'lucide-react';
import { toast } from 'sonner';

interface SceneOutputProps {
  prompts: ScenePrompt[];
}

export function SceneOutput({ prompts }: SceneOutputProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = async (prompt: ScenePrompt, index: number) => {
    const json = JSON.stringify(prompt);
    await navigator.clipboard.writeText(json);
    setCopiedIndex(index);
    toast.success(`Scene ${index + 1} copied to clipboard`);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAllForExcel = async () => {
    const lines = prompts.map(p => JSON.stringify(p));
    await navigator.clipboard.writeText(lines.join('\n'));
    toast.success('All prompts copied (one per line for Excel)');
  };

  const downloadAsJson = () => {
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scene-prompts.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Downloaded scene-prompts.json');
  };

  if (prompts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Film className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No Prompts Generated</h2>
          <p className="text-muted-foreground">
            Paste your narrative script in the sidebar and click "Generate Prompts" to create AI video prompts for each scene.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Generated Prompts</h2>
          <p className="text-sm text-muted-foreground">{prompts.length} scenes • Ready for export</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyAllForExcel}>
            <Copy className="h-4 w-4 mr-2" />
            Copy All (Excel)
          </Button>
          <Button variant="outline" size="sm" onClick={downloadAsJson}>
            <Download className="h-4 w-4 mr-2" />
            Download JSON
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {prompts.map((prompt, index) => (
            <div
              key={index}
              className="group bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-medium">
                      {prompt.sceneNumber}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {prompt.mood} • {prompt.environment}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {prompt.duration}s • {prompt.characters.join(', ') || 'No characters'}
                      </p>
                    </div>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground bg-muted/50 rounded p-3 overflow-x-auto">
                    <code className="whitespace-nowrap">
                      {JSON.stringify(prompt)}
                    </code>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyToClipboard(prompt, index)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
