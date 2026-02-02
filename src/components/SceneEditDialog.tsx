import { useState, useEffect } from 'react';
import { ScenePrompt } from '@/types/prompt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface SceneEditDialogProps {
  scene: ScenePrompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (scene: ScenePrompt) => void;
}

export function SceneEditDialog({ scene, open, onOpenChange, onSave }: SceneEditDialogProps) {
  const [editedScene, setEditedScene] = useState<ScenePrompt | null>(null);

  useEffect(() => {
    if (scene) {
      setEditedScene({ ...scene });
    }
  }, [scene]);

  if (!editedScene) return null;

  const handleSave = () => {
    onSave(editedScene);
    onOpenChange(false);
  };

  const updateField = (field: keyof ScenePrompt, value: string | number | string[]) => {
    setEditedScene(prev => prev ? { ...prev, [field]: value } : null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Scene {editedScene.sceneNumber}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="narrationText">Narration Text</Label>
            <Textarea
              id="narrationText"
              value={editedScene.narrationText}
              onChange={(e) => updateField('narrationText', e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="visualDescription">Visual Description</Label>
            <Textarea
              id="visualDescription"
              value={editedScene.visualDescription}
              onChange={(e) => updateField('visualDescription', e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="environment">Environment</Label>
              <Input
                id="environment"
                value={editedScene.environment}
                onChange={(e) => updateField('environment', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mood">Mood</Label>
              <Input
                id="mood"
                value={editedScene.mood}
                onChange={(e) => updateField('mood', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cameraMovement">Camera Movement</Label>
              <Input
                id="cameraMovement"
                value={editedScene.cameraMovement}
                onChange={(e) => updateField('cameraMovement', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (seconds)</Label>
              <Input
                id="duration"
                type="number"
                value={editedScene.duration}
                onChange={(e) => updateField('duration', parseInt(e.target.value) || 8)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="actions">Actions</Label>
            <Textarea
              id="actions"
              value={editedScene.actions}
              onChange={(e) => updateField('actions', e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="characters">Characters (comma-separated)</Label>
            <Input
              id="characters"
              value={editedScene.characters.join(', ')}
              onChange={(e) => updateField('characters', e.target.value.split(',').map(c => c.trim()).filter(Boolean))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
