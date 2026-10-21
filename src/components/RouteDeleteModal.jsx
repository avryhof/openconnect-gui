import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';

function RouteDeleteModal({ route, onConfirm, onCancel }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPassword('');
        setError('');
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  if (!route) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      setError('Password is required');
      return;
    }

    setIsDeleting(true);
    setError('');

    const result = await onConfirm(password);

    setIsDeleting(false);

    if (result && result.success) {
      // Success - modal will be closed by parent
      setPassword('');
      setError('');
    } else if (result && result.error) {
      // Error - keep modal open and show error
      setError(result.error);
    }
  };

  const handleCancel = () => {
    setPassword('');
    setError('');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-modal-title"
        className="w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 id="route-modal-title" className="text-lg font-semibold">Delete Route</h2>
            <p className="text-sm text-muted-foreground mt-1">
              This will delete the following route from your system
            </p>
          </div>
        </div>

        <div className="bg-muted p-3 rounded font-mono text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{route.destination}</span>
            <span className="text-muted-foreground">→</span>
            <span>{route.gateway}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            via {route.interface}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="sudo-password">Administrator Password</Label>
            </div>
            <Input
              type="password"
              id="sudo-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              autoFocus
              aria-invalid={!!error}
              className={error ? 'border-destructive' : ''}
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Administrator privileges are required to modify network routes
            </p>
          </div>

          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={isDeleting}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Route'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default RouteDeleteModal;
