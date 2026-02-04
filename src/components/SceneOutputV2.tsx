import { useState } from 'react';
import { FullScenePrompt } from '@/types/prompt';
import { Button } from '@/components/ui/button';
import { Copy, Check, Download, Film, Pencil, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { SceneEditDialogV2 } from './SceneEditDialogV2';

interface SceneOutputV2Props {
  prompts: FullScenePrompt[];
  onUpdatePrompt: (index: number, prompt: FullScenePrompt) => void;
  onRegenerateScene: (index: number) => void;
  isRegenerating: boolean;
  regeneratingIndex: number | null;
}

export function SceneOutputV2({ prompts, onUpdatePrompt, onRegenerateScene, isRegenerating, regeneratingIndex }: SceneOutputV2Props) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedType, setCopiedType] = useState<'json' | 'visual' | null>(null);
  const [editingScene, setEditingScene] = useState<FullScenePrompt | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  const copyToClipboard = async (prompt: FullScenePrompt, index: number) => {
    const json = JSON.stringify(prompt, null, 2);
    await navigator.clipboard.writeText(json);
    setCopiedIndex(index);
    setCopiedType('json');
    toast.success(`Scene ${prompt.scene_id} JSON copied`);
    setTimeout(() => { setCopiedIndex(null); setCopiedType(null); }, 2000);
  };

  const copyVisualStyle = async (prompt: FullScenePrompt, index: number) => {
    await navigator.clipboard.writeText(prompt.visual_style);
    setCopiedIndex(index);
    setCopiedType('visual');
    toast.success(`Scene ${prompt.scene_id} visual style copied`);
    setTimeout(() => { setCopiedIndex(null); setCopiedType(null); }, 2000);
  };

  const copyAllForExcel = async () => {
    const lines = prompts.map(p => JSON.stringify(p));
    await navigator.clipboard.writeText(lines.join('\n'));
    toast.success('All prompts copied (one per line for Excel)');
  };

  const copyAllVisualStyles = async () => {
    const descriptions = prompts.map((p) => `${p.scene_id}: ${p.visual_style}`);
    await navigator.clipboard.writeText(descriptions.join('\n\n'));
    toast.success('All visual styles copied');
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

  const handleEdit = (prompt: FullScenePrompt, index: number) => {
    setEditingScene(prompt);
    setEditingIndex(index);
  };

  const handleSaveEdit = (updatedScene: FullScenePrompt) => {
    if (editingIndex !== null) {
      onUpdatePrompt(editingIndex, updatedScene);
      toast.success(`Scene ${updatedScene.scene_id} updated`);
    }
    setEditingScene(null);
    setEditingIndex(null);
  };

  const toggleExpand = (index: number) => {
    setExpandedScene(expandedScene === index ? null : index);
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
          <p className="text-sm text-muted-foreground">{prompts.length} scenes • Full schema with character locks</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyAllVisualStyles}>
            <Film className="h-4 w-4 mr-2" />
            Copy Visuals
          </Button>
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
          {prompts.map((prompt, index) => {
            const isExpanded = expandedScene === index;
            const characterIds = Object.keys(prompt.character_lock);

            return (
              <div
                key={index}
                className="group bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-colors"
              >
                {/* Header */}
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-bold">
                        {prompt.scene_id}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {prompt.background_lock.setting}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {prompt.duration_sec}s • {characterIds.length} character{characterIds.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {/* Character badges */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {characterIds.map(charId => (
                        <span
                          key={charId}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
                        >
                          {charId}: {prompt.character_lock[charId].name}
                        </span>
                      ))}
                    </div>

                    {/* Action summary preview */}
                    {prompt.scene_action_summary && (
                      <div className="text-xs text-foreground/80 bg-muted/30 rounded px-2 py-1 mb-2">
                        {prompt.scene_action_summary}
                      </div>
                    )}

                    {/* Expand/Collapse button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => toggleExpand(index)}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3 w-3 mr-1" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3 mr-1" />
                          Show Full JSON
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(prompt, index)}
                      title="Edit scene"
                      disabled={isRegenerating}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRegenerateScene(index)}
                      title="Regenerate scene"
                      disabled={isRegenerating}
                    >
                      {regeneratingIndex === index ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyVisualStyle(prompt, index)}
                      title="Copy visual style"
                    >
                      {copiedIndex === index && copiedType === 'visual' ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Film className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(prompt, index)}
                      title="Copy full JSON"
                    >
                      {copiedIndex === index && copiedType === 'json' ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Expanded JSON view */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 p-4">
                    <pre className="font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(prompt, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <SceneEditDialogV2
        scene={editingScene}
        open={editingScene !== null}
        onOpenChange={(open) => !open && setEditingScene(null)}
        onSave={handleSaveEdit}
      />
    </div>
  );
}
