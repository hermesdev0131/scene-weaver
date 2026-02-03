import { CharacterIdentity } from '@/types/prompt';
import { User, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface CharacterPanelV2Props {
  characters: Record<string, CharacterIdentity>;
  era: string | null;
}

export function CharacterPanelV2({ characters, era }: CharacterPanelV2Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedChar, setExpandedChar] = useState<string | null>(null);

  const characterIds = Object.keys(characters);

  if (characterIds.length === 0) {
    return null;
  }

  const toggleCharacter = (charId: string) => {
    setExpandedChar(expandedChar === charId ? null : charId);
  };

  return (
    <div className="border-b border-border">
      <Button
        variant="ghost"
        className="w-full flex items-center justify-between p-3 h-auto hover:bg-muted/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Characters ({characterIds.length})
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {era && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              Era: <span className="text-foreground">{era}</span>
            </div>
          )}

          {characterIds.map((charId) => {
            const character = characters[charId];
            const isCharExpanded = expandedChar === charId;

            return (
              <div
                key={charId}
                className="bg-card border border-border rounded-lg overflow-hidden"
              >
                <button
                  className="w-full p-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => toggleCharacter(charId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono">
                        {charId}
                      </span>
                      <h4 className="text-sm font-medium text-foreground">
                        {character.name}
                      </h4>
                    </div>
                    {isCharExpanded ? (
                      <ChevronUp className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {character.gender}, {character.age} • {character.species}
                  </p>
                </button>

                {isCharExpanded && (
                  <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border bg-muted/20">
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <DetailItem label="Build" value={character.body_build} />
                      <DetailItem label="Face" value={character.face_shape} />
                      <DetailItem label="Hair" value={character.hair} />
                      <DetailItem label="Facial Hair" value={character.facial_hair} />
                      <DetailItem label="Skin" value={character.skin_or_fur_color} />
                      <DetailItem label="Eyes" value={character.eye_color} />
                    </div>

                    <div className="pt-1">
                      <DetailItem label="Signature" value={character.signature_feature} full />
                    </div>

                    <div className="pt-1 border-t border-border">
                      <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Outfit</p>
                      <div className="grid grid-cols-2 gap-2">
                        <DetailItem label="Top" value={character.outfit_top} />
                        <DetailItem label="Bottom" value={character.outfit_bottom} />
                        <DetailItem label="Head" value={character.helmet_or_hat} />
                        <DetailItem label="Feet" value={character.shoes_or_footwear} />
                      </div>
                      <DetailItem label="Accessories" value={character.accessories} full />
                    </div>

                    <div className="pt-1 border-t border-border">
                      <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Materials</p>
                      <DetailItem label="Textures" value={character.texture_detail} full />
                      <DetailItem label="Materials" value={character.material_reference} full />
                    </div>

                    <div className="pt-1 border-t border-border">
                      <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Voice</p>
                      <p className="text-xs text-foreground/80 italic">
                        {character.voice_personality}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  if (!value || value === 'None') return null;

  return (
    <div className={full ? 'col-span-2' : ''}>
      <span className="text-[10px] text-muted-foreground">{label}: </span>
      <span className="text-xs text-foreground/90">{value}</span>
    </div>
  );
}
