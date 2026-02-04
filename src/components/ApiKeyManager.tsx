import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Settings, Plus, Trash2, Key } from 'lucide-react';

interface ApiKeyManagerProps {
  keys: string[];
  onSave: (keys: string[]) => void;
}

// Mask API key: show first 4 and last 4 characters
const maskKey = (key: string): string => {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
};

export function ApiKeyManager({ keys, onSave }: ApiKeyManagerProps) {
  const [localKeys, setLocalKeys] = useState<string[]>(keys.length > 0 ? keys : ['']);
  const [open, setOpen] = useState(false);

  const addKey = () => {
    setLocalKeys([...localKeys, '']);
  };

  const removeKey = (index: number) => {
    setLocalKeys(localKeys.filter((_, i) => i !== index));
  };

  const updateKey = (index: number, value: string) => {
    const updated = [...localKeys];
    updated[index] = value;
    setLocalKeys(updated);
  };

  const handleSave = () => {
    const validKeys = localKeys.filter(k => k.trim().length > 0);
    onSave(validKeys);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Gemini API Keys
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add multiple API keys for automatic rotation when rate limits are hit.
          </p>

          {/* Show saved keys summary */}
          {keys.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Saved Keys ({keys.length}):</p>
              {keys.map((key, index) => (
                <div key={index} className="text-xs font-mono text-foreground/70">
                  {index + 1}. {maskKey(key)}
                </div>
              ))}
            </div>
          )}

          {localKeys.map((key, index) => (
            <div key={index} className="flex gap-2">
              <Input
                type="password"
                placeholder={`API Key ${index + 1}`}
                value={key}
                onChange={(e) => updateKey(index, e.target.value)}
                className="flex-1 bg-background border-border"
              />
              {localKeys.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeKey(index)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" onClick={addKey} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add Another Key
          </Button>
          <Button onClick={handleSave} className="w-full">
            Save Keys
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
