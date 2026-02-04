import { useState, useEffect } from 'react';
import { CharacterIdentity, SceneSegment } from '@/types/prompt';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Check, X, User, Film } from 'lucide-react';

interface CharacterApprovalDialogProps {
  open: boolean;
  characters: Record<string, CharacterIdentity>;
  era: string;
  scenes: SceneSegment[];
  onApprove: (characters: Record<string, CharacterIdentity>) => void;
  onCancel: () => void;
}

export function CharacterApprovalDialog({
  open,
  characters,
  era,
  scenes,
  onApprove,
  onCancel,
}: CharacterApprovalDialogProps) {
  const [editedCharacters, setEditedCharacters] = useState<Record<string, CharacterIdentity>>({});
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    if (characters && Object.keys(characters).length > 0) {
      setEditedCharacters(JSON.parse(JSON.stringify(characters)));
      setActiveTab(Object.keys(characters)[0]);
    }
  }, [characters]);

  const characterIds = Object.keys(editedCharacters);

  const updateCharacterField = (
    charId: string,
    field: keyof CharacterIdentity,
    value: string
  ) => {
    setEditedCharacters(prev => ({
      ...prev,
      [charId]: {
        ...prev[charId],
        [field]: value,
      },
    }));
  };

  const handleApprove = () => {
    onApprove(editedCharacters);
  };

  if (characterIds.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Review & Approve Characters
          </DialogTitle>
          <DialogDescription>
            {characterIds.length} characters extracted • Era: {era} • {scenes.length} scenes detected
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="flex-shrink-0">
            {characterIds.map(charId => (
              <TabsTrigger key={charId} value={charId} className="text-xs">
                {charId}: {editedCharacters[charId]?.name?.split(' ')[0] || 'Unknown'}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-auto mt-4">
            {characterIds.map(charId => (
              <TabsContent key={charId} value={charId} className="mt-0 h-full">
                <CharacterEditor
                  character={editedCharacters[charId]}
                  onChange={(field, value) => updateCharacterField(charId, field, value)}
                />
              </TabsContent>
            ))}
          </div>
        </Tabs>

        {/* Scene Preview */}
        <div className="border-t pt-4 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <Film className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Scene Preview ({scenes.length} scenes)</span>
          </div>
          <div className="max-h-24 overflow-auto text-xs text-muted-foreground space-y-1">
            {scenes.slice(0, 5).map((scene, i) => (
              <div key={i} className="flex gap-2">
                <span className="font-mono text-primary">S{i + 1}</span>
                <span className="truncate">{scene.action_hint || scene.text.substring(0, 60)}...</span>
              </div>
            ))}
            {scenes.length > 5 && (
              <div className="text-muted-foreground">...and {scenes.length - 5} more scenes</div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2">
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={handleApprove}>
            <Check className="h-4 w-4 mr-2" />
            Approve & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CharacterEditorProps {
  character: CharacterIdentity;
  onChange: (field: keyof CharacterIdentity, value: string) => void;
}

function CharacterEditor({ character, onChange }: CharacterEditorProps) {
  if (!character) return null;

  return (
    <Accordion type="multiple" defaultValue={['identity', 'appearance', 'outfit']} className="space-y-2">
      {/* Identity */}
      <AccordionItem value="identity">
        <AccordionTrigger className="text-sm font-medium">Identity</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                value={character.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Species</Label>
              <Input
                value={character.species}
                onChange={(e) => onChange('species', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Gender</Label>
              <Input
                value={character.gender}
                onChange={(e) => onChange('gender', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Age</Label>
              <Input
                value={character.age}
                onChange={(e) => onChange('age', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Physical Appearance */}
      <AccordionItem value="appearance">
        <AccordionTrigger className="text-sm font-medium">Physical Appearance</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Body Build</Label>
              <Textarea
                value={character.body_build}
                onChange={(e) => onChange('body_build', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Face Shape</Label>
              <Textarea
                value={character.face_shape}
                onChange={(e) => onChange('face_shape', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Hair</Label>
              <Textarea
                value={character.hair}
                onChange={(e) => onChange('hair', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Facial Hair</Label>
              <Input
                value={character.facial_hair}
                onChange={(e) => onChange('facial_hair', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Skin/Fur Color</Label>
              <Input
                value={character.skin_or_fur_color}
                onChange={(e) => onChange('skin_or_fur_color', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Eye Color</Label>
              <Input
                value={character.eye_color}
                onChange={(e) => onChange('eye_color', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Signature Feature</Label>
              <Textarea
                value={character.signature_feature}
                onChange={(e) => onChange('signature_feature', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Outfit */}
      <AccordionItem value="outfit">
        <AccordionTrigger className="text-sm font-medium">Outfit & Accessories</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Outfit Top</Label>
              <Textarea
                value={character.outfit_top}
                onChange={(e) => onChange('outfit_top', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Outfit Bottom</Label>
              <Textarea
                value={character.outfit_bottom}
                onChange={(e) => onChange('outfit_bottom', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Helmet/Hat</Label>
              <Input
                value={character.helmet_or_hat}
                onChange={(e) => onChange('helmet_or_hat', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Shoes/Footwear</Label>
              <Textarea
                value={character.shoes_or_footwear}
                onChange={(e) => onChange('shoes_or_footwear', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Accessories</Label>
              <Textarea
                value={character.accessories}
                onChange={(e) => onChange('accessories', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Materials */}
      <AccordionItem value="materials">
        <AccordionTrigger className="text-sm font-medium">Textures & Materials</AccordionTrigger>
        <AccordionContent>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label className="text-xs">Texture Detail</Label>
              <Textarea
                value={character.texture_detail}
                onChange={(e) => onChange('texture_detail', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs">Material Reference</Label>
              <Textarea
                value={character.material_reference}
                onChange={(e) => onChange('material_reference', e.target.value)}
                className="text-sm min-h-[60px]"
              />
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
