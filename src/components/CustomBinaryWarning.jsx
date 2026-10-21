import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';

// Double opt-in warning shown before a user-supplied OpenConnect binary is
// allowed. The Apply button stays disabled until the acknowledgement checkbox
// is ticked, so a single mis-click cannot point the app at a writable binary
// that will run as root.
function CustomBinaryWarning({ path: binaryPath, onConfirm, onCancel }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleConfirm = () => {
    if (!acknowledged) {
      setError('You must tick the checkbox to continue');
      return;
    }
    onConfirm(binaryPath);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-binary-title"
        className="w-full max-w-lg p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 id="custom-binary-title" className="text-lg font-semibold">
              Run a custom OpenConnect binary as root?
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              This is an advanced option with serious security implications.
            </p>
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3 space-y-2">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            OpenConnect runs with <strong>administrator (root) privileges</strong> to set up the
            VPN. The binary below will be executed as root every time you connect.
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            If the file is in a location you or another user can write to, anyone who can replace
            it gets <strong>full control of this computer</strong>. Only use a binary you built
            yourself from a trusted source, stored where others cannot modify it.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-binary-path">Binary path</Label>
          <Input
            id="custom-binary-path"
            readOnly
            value={binaryPath}
            className="font-mono text-sm"
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => {
              setAcknowledged(e.target.checked);
              setError('');
            }}
            className="mt-1 h-4 w-4 accent-primary cursor-pointer"
            aria-describedby="custom-binary-ack-label"
          />
          <span id="custom-binary-ack-label" className="text-sm">
            I understand this binary will run as root, and I trust its source and location.
          </span>
        </label>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!acknowledged}
          >
            Enable custom binary
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default CustomBinaryWarning;
