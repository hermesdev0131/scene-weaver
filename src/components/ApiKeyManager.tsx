import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Settings, Plus, Trash2, Key, Zap, DollarSign } from 'lucide-react';
import { ApiKeyConfig } from '@/types/prompt';

interface ApiKeyManagerProps {
  apiKeys: ApiKeyConfig;
  onSave: (config: ApiKeyConfig) => void;
}

// Mask API key: show first 4 and last 4 characters
const maskKey = (key: string): string => {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
};

export function ApiKeyManager({ apiKeys, onSave }: ApiKeyManagerProps) {
  const [newFreeKey, setNewFreeKey] = useState('');
  const [newPaidKey, setNewPaidKey] = useState('');
  const [open, setOpen] = useState(false);

  // Reset inputs when dialog opens
  useEffect(() => {
    if (open) {
      setNewFreeKey('');
      setNewPaidKey('');
    }
  }, [open]);

  const handleAddFreeKey = () => {
    if (newFreeKey.trim()) {
      onSave({
        ...apiKeys,
        freeKeys: [...apiKeys.freeKeys, newFreeKey.trim()]
      });
      setNewFreeKey('');
    }
  };

  const handleDeleteFreeKey = (index: number) => {
    const updatedKeys = apiKeys.freeKeys.filter((_, i) => i !== index);
    onSave({
      ...apiKeys,
      freeKeys: updatedKeys
    });
  };

  const handleSetPaidKey = () => {
    if (newPaidKey.trim()) {
      onSave({
        ...apiKeys,
        paidKey: newPaidKey.trim()
      });
      setNewPaidKey('');
    }
  };

  const handleRemovePaidKey = () => {
    onSave({
      ...apiKeys,
      paidKey: null
    });
  };

  const hasPaidKey = apiKeys.paidKey !== null;
  const totalKeys = apiKeys.freeKeys.length + (hasPaidKey ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Settings className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Gemini API Keys
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add free tier keys for rotation. Optionally add a paid key for instant fallback when free quota is exhausted.
          </p>

          {/* FREE KEYS SECTION */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Free Tier Keys</span>
              <span className="text-xs text-muted-foreground">({apiKeys.freeKeys.length})</span>
            </div>

            {apiKeys.freeKeys.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                {apiKeys.freeKeys.map((key, index) => (
                  <div key={index} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-foreground/70">
                      {index + 1}. {maskKey(key)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteFreeKey(index)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Paste free tier API key..."
                value={newFreeKey}
                onChange={(e) => setNewFreeKey(e.target.value)}
                className="flex-1 bg-background border-border font-mono text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleAddFreeKey()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddFreeKey}
                disabled={!newFreeKey.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* PAID KEY SECTION */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium">Paid Tier Key</span>
              <span className="text-xs text-muted-foreground">(optional)</span>
            </div>

            {hasPaidKey ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-foreground/70">
                    {maskKey(apiKeys.paidKey!)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={handleRemovePaidKey}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  Hybrid mode active: Free keys first, paid fallback
                </p>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Paste paid tier API key..."
                  value={newPaidKey}
                  onChange={(e) => setNewPaidKey(e.target.value)}
                  className="flex-1 bg-background border-border font-mono text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && handleSetPaidKey()}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleSetPaidKey}
                  disabled={!newPaidKey.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* INFO */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p>• Keys are stored locally in your browser.</p>
            <p>• Free tier: 10 RPM/key, 20 RPM project limit, 250 RPD/key</p>
            {hasPaidKey && (
              <p className="text-green-600 dark:text-green-400">
                • Paid key enables instant fallback (no waiting on rate limits)
              </p>
            )}
            {totalKeys === 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                • Add at least one API key to start generating
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
