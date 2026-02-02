import { Character } from '@/types/prompt';
import { User, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface CharacterPanelProps {
  characters: Character[];
  era: string | null;
}

export function CharacterPanel({ characters, era }: CharacterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (characters.length === 0) {
    return null;
  }

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
            Characters ({characters.length})
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
          
          {characters.map((character) => (
            <div
              key={character.id}
              className="bg-card border border-border rounded-lg p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground">
                  {character.name}
                </h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">
                  {character.role}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {character.description}
              </p>
              {character.appearance && (
                <p className="text-xs text-muted-foreground/80 italic">
                  {character.appearance}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
