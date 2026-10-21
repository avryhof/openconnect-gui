import { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { ShieldAlert } from 'lucide-react';

function PasswordPrompt() {
  const [password, setPassword] = useState('');
  const bridge = window.pageBridge;

  // Main process passes prompt text as query parameters; defaults preserve
  // the original sudo prompt wording.
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title') || 'Administrator Password Required';
  const description = params.get('description') ||
    'OpenConnect requires administrator privileges to create VPN connection.';
  const label = params.get('label') || 'Password';
  const placeholder = params.get('placeholder') || 'Enter your password';
  const hint = params.get('hint') || '';

  useEffect(() => {
    document.title = title;
  }, [title]);

  const handleSubmit = (e) => {
    e.preventDefault();
    bridge.send('password-prompt-result', password);
  };

  const handleCancel = () => {
    bridge.send('password-prompt-result', null);
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        bridge.send('password-prompt-result', null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bridge]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-foreground">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <CardTitle className="text-center">{title}</CardTitle>
          <CardDescription className="text-center">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{label}</Label>
              <Input
                type="password"
                id="password"
                placeholder={placeholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handleKeyPress}
                autoFocus
              />
              {hint && (
                <p className="text-xs text-muted-foreground">{hint}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit">
                OK
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default PasswordPrompt;
