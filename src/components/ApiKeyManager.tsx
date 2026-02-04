import { useState, useEffect } from 'react';
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
  const [newKey, setNewKey] = useState('');
  const [open, setOpen] = useState(false);

  // Reset new key input when dialog opens
  useEffect(() => {
    if (open) {
      setNewKey('');
    }
  }, [open]);

  const handleAddKey = () => {
    if (newKey.trim()) {
      onSave([...keys, newKey.trim()]);
      setNewKey('');
    }
  };

  const handleDeleteKey = (index: number) => {
    const updatedKeys = keys.filter((_, i) => i !== index);
    onSave(updatedKeys);
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

          {/* Show saved keys with delete option */}
          {keys.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Saved Keys ({keys.length}):</p>
              {keys.map((key, index) => (
                <div key={index} className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-foreground/70">
                    {index + 1}. {maskKey(key)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteKey(index)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add new key input */}
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="Paste new API key here..."
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="flex-1 bg-background border-border font-mono text-xs"
              onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleAddKey}
              disabled={!newKey.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Keys are stored locally in your browser.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
