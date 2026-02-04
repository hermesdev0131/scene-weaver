import { useState, useEffect } from 'react';
import { FullScenePrompt, BackgroundLock, Camera, FoleyAmbience } from '@/types/prompt';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

interface SceneEditDialogV2Props {
  scene: FullScenePrompt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (scene: FullScenePrompt) => void;
}

export function SceneEditDialogV2({ scene, open, onOpenChange, onSave }: SceneEditDialogV2Props) {
  const [editedScene, setEditedScene] = useState<FullScenePrompt | null>(null);

  useEffect(() => {
    if (scene) {
      setEditedScene(JSON.parse(JSON.stringify(scene))); // Deep clone
    }
  }, [scene]);

  if (!editedScene) return null;

  const handleSave = () => {
    onSave(editedScene);
    onOpenChange(false);
  };

  const updateField = <K extends keyof FullScenePrompt>(field: K, value: FullScenePrompt[K]) => {
    setEditedScene(prev => prev ? { ...prev, [field]: value } : null);
  };

  const updateBackgroundLock = <K extends keyof BackgroundLock>(field: K, value: string) => {
    setEditedScene(prev => prev ? {
      ...prev,
      background_lock: { ...prev.background_lock, [field]: value }
    } : null);
  };

  const updateCamera = <K extends keyof Camera>(field: K, value: string) => {
    setEditedScene(prev => prev ? {
      ...prev,
      camera: { ...prev.camera, [field]: value }
    } : null);
  };

  const updateFoley = <K extends keyof FoleyAmbience>(field: K, value: string | string[]) => {
    setEditedScene(prev => prev ? {
      ...prev,
      foley_and_ambience: { ...prev.foley_and_ambience, [field]: value }
    } : null);
  };

  const characterIds = Object.keys(editedScene.character_lock);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Scene {editedScene.scene_id}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="background">Background</TabsTrigger>
            <TabsTrigger value="camera">Camera</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="scene_id">Scene ID</Label>
                <Input
                  id="scene_id"
                  value={editedScene.scene_id}
                  onChange={(e) => updateField('scene_id', e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="duration_sec">Duration (seconds)</Label>
                <Input
                  id="duration_sec"
                  type="number"
                  value={editedScene.duration_sec}
                  onChange={(e) => updateField('duration_sec', parseInt(e.target.value) || 8)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="visual_style">Visual Style</Label>
              <Textarea
                id="visual_style"
                value={editedScene.visual_style}
                onChange={(e) => updateField('visual_style', e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="action_summary">Scene Action Summary</Label>
              <Textarea
                id="action_summary"
                value={editedScene.scene_action_summary}
                onChange={(e) => updateField('scene_action_summary', e.target.value)}
                rows={3}
                placeholder="Describe what happens in this scene..."
              />
            </div>

            <div className="border-t pt-4">
              <Label className="text-sm font-medium">Characters in Scene</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {characterIds.map(charId => (
                  <span
                    key={charId}
                    className="text-xs px-2 py-1 rounded bg-primary/10 text-primary"
                  >
                    {charId}: {editedScene.character_lock[charId].name}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Character identities are locked and cannot be edited here.
              </p>
            </div>
          </TabsContent>

          {/* Background Tab */}
          <TabsContent value="background" className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="setting">Setting</Label>
              <Input
                id="setting"
                value={editedScene.background_lock.setting}
                onChange={(e) => updateBackgroundLock('setting', e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scenery">Scenery</Label>
              <Textarea
                id="scenery"
                value={editedScene.background_lock.scenery}
                onChange={(e) => updateBackgroundLock('scenery', e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lighting">Lighting</Label>
              <Textarea
                id="lighting"
                value={editedScene.background_lock.lighting}
                onChange={(e) => updateBackgroundLock('lighting', e.target.value)}
                rows={3}
              />
            </div>
          </TabsContent>

          {/* Camera Tab */}
          <TabsContent value="camera" className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="framing">Framing</Label>
              <Input
                id="framing"
                value={editedScene.camera.framing}
                onChange={(e) => updateCamera('framing', e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="angle">Angle</Label>
              <Input
                id="angle"
                value={editedScene.camera.angle}
                onChange={(e) => updateCamera('angle', e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="movement">Movement</Label>
              <Textarea
                id="movement"
                value={editedScene.camera.movement}
                onChange={(e) => updateCamera('movement', e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="focus">Focus</Label>
              <Textarea
                id="focus"
                value={editedScene.camera.focus}
                onChange={(e) => updateCamera('focus', e.target.value)}
                rows={2}
              />
            </div>
          </TabsContent>

          {/* Audio Tab */}
          <TabsContent value="audio" className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="ambience">Ambience (one per line)</Label>
              <Textarea
                id="ambience"
                value={editedScene.foley_and_ambience.ambience.join('\n')}
                onChange={(e) => updateFoley('ambience', e.target.value.split('\n').filter(Boolean))}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fx">Sound Effects (one per line)</Label>
              <Textarea
                id="fx"
                value={editedScene.foley_and_ambience.fx.join('\n')}
                onChange={(e) => updateFoley('fx', e.target.value.split('\n').filter(Boolean))}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="music">Music</Label>
              <Textarea
                id="music"
                value={editedScene.foley_and_ambience.music}
                onChange={(e) => updateFoley('music', e.target.value)}
                rows={2}
              />
            </div>
          </TabsContent>

        </Tabs>

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
