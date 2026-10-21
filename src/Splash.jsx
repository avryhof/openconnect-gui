import { useState, useEffect } from 'react';
import { Badge } from './components/ui/badge';
import { Separator } from './components/ui/separator';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Shield } from 'lucide-react';
import { Button } from './components/ui/button';

function Splash() {
  const [statusText, setStatusText] = useState('Initializing...');
  const [progress, setProgress] = useState(0);
  const [checks, setChecks] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const bridge = window.pageBridge;

    // Listen for system check updates
    bridge.on('system-check-start', (checkName) => {
      setChecks(prev => [...prev, { name: checkName, status: 'checking', message: '' }]);
    });

    bridge.on('system-check-complete', (checkName, success, message) => {
      setChecks(prev =>
        prev.map(check =>
          check.name === checkName
            ? { ...check, status: success ? 'success' : 'error', message }
            : check
        )
      );
    });

    bridge.on('system-check-warning', (checkName, message) => {
      setChecks(prev =>
        prev.map(check =>
          check.name === checkName
            ? { ...check, status: 'warning', message }
            : check
        )
      );
    });

    bridge.on('splash-progress', (percent, message) => {
      setProgress(percent);
      if (message) {
        setStatusText(message);
      }
    });

    bridge.on('splash-error', (errorData) => {
      setStatusText('Setup Required');
      setError(errorData);
    });

    bridge.on('splash-complete', () => {
      setStatusText('System checks completed successfully!');
      setProgress(100);
    });

    // Notify main process that splash is loaded
    bridge.send('splash-loaded');

    return () => {
      bridge.removeAllListeners('system-check-start');
      bridge.removeAllListeners('system-check-complete');
      bridge.removeAllListeners('system-check-warning');
      bridge.removeAllListeners('splash-progress');
      bridge.removeAllListeners('splash-error');
      bridge.removeAllListeners('splash-complete');
    };
  }, []);

  const handleInstallClick = () => {
    window.pageBridge.send('open-installer');
  };

  const handleLoginClick = () => {
    window.pageBridge.send('splash-ready');
  };

  const getIconForStatus = (status) => {
    switch (status) {
      case 'checking':
        return <Loader2 className="h-5 w-5 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="h-5 w-5" />;
      case 'error':
        return <XCircle className="h-5 w-5" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="space-y-4">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-foreground">
            <Shield className="h-12 w-12" />
          </div>
          <h1 className="text-4xl font-bold">OpenConnect VPN</h1>
          <Badge variant="outline">Version 1.3.1</Badge>
        </div>

        <Separator />

        <div className="space-y-6">
          <div className="text-lg font-medium">{statusText}</div>

          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="text-sm text-muted-foreground">{progress}%</div>
          </div>

          <div className="space-y-3">
            {checks.map((check, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-md border bg-card p-3 text-left"
              >
                <div
                  className={
                    check.status === 'checking'
                      ? 'text-muted-foreground'
                      : check.status === 'success'
                      ? 'text-foreground'
                      : check.status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {getIconForStatus(check.status)}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{check.name}</div>
                  {check.message && (
                    <div className="text-xs text-muted-foreground">{check.message}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="space-y-3 rounded-md border-2 border-destructive bg-destructive/10 p-4">
              <div className="font-semibold">Setup Required</div>
              <div className="text-sm">{error.message}</div>
              {error.action === 'install-openconnect' && (
                <Button onClick={handleInstallClick} className="w-full">
                  Install OpenConnect
                </Button>
              )}
            </div>
          )}

          {progress === 100 && !error && (
            <Button onClick={handleLoginClick} size="lg" className="w-full">
              Continue to OpenConnect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Splash;
