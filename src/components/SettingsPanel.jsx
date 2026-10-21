import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Settings } from 'lucide-react';
import CustomBinaryWarning from './CustomBinaryWarning';

function Toggle({ id, checked, onChange, label, description, disabled = false }) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className={disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}>{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onSettingsChange, showAlert, addLog }) {
  const [saving, setSaving] = useState(false);
  const [customPath, setCustomPath] = useState(settings.customOpenConnectPath || '');
  const [pendingPath, setPendingPath] = useState(null);
  const [pathError, setPathError] = useState('');
  const isLinux = window.electronAPI?.platform === 'linux';

  const updateSetting = async (key, value) => {
    setSaving(true);
    const result = await window.electronAPI.saveSettings({ [key]: value });
    setSaving(false);

    if (!result.success) {
      showAlert(`Failed to save setting: ${result.error}`, 'error');
      return;
    }

    if (onSettingsChange) {
      onSettingsChange(result.settings);
    }
    addLog(`Setting "${key}" set to ${value}`, 'info');
  };

  const enableCustomBinary = async () => {
    const candidate = customPath.trim();
    setPathError('');
    if (!candidate) {
      setPathError('Enter the full path to an OpenConnect binary first');
      return;
    }
    const check = await window.electronAPI.validateOpenConnectPath(candidate);
    if (!check.valid) {
      setPathError(`That path cannot be used (${check.reason}). Provide an executable file.`);
      return;
    }
    // Open the double opt-in warning; only confirm enables the setting.
    setPendingPath(check.path);
  };

  const confirmCustomBinary = async (validatedPath) => {
    setPendingPath(null);
    setSaving(true);
    const result = await window.electronAPI.saveSettings({
      allowCustomOpenConnect: true,
      customOpenConnectPath: validatedPath
    });
    setSaving(false);
    if (!result.success) {
      showAlert(`Failed to save setting: ${result.error}`, 'error');
      return;
    }
    if (onSettingsChange) {
      onSettingsChange(result.settings);
    }
    addLog('Custom OpenConnect binary enabled (runs as root)', 'warning');
    showAlert('Custom OpenConnect binary enabled. It will run as root.', 'error');
  };

  const disableCustomBinary = async () => {
    setPathError('');
    await updateSetting('allowCustomOpenConnect', false);
    await updateSetting('customOpenConnectPath', '');
    setCustomPath('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Application Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={settings.theme || 'system'}
            onValueChange={(value) => updateSetting('theme', value)}
          >
            <SelectTrigger id="theme" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Follow system</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Follow system uses your desktop's light/dark setting and changes with it.
          </p>
        </div>

        <Separator />

        <Toggle
          id="minimizeToTray"
          checked={settings.minimizeToTray}
          onChange={(value) => updateSetting('minimizeToTray', value)}
          label="Keep running in system tray"
          description="Closing or minimizing the window hides it in the tray instead of quitting. The app keeps the VPN running in the background."
        />

        <Separator />

        <Toggle
          id="startHiddenToTray"
          checked={settings.startHiddenToTray}
          onChange={(value) => updateSetting('startHiddenToTray', value)}
          label="Start hidden in tray"
          description="Launch the app minimized to the tray instead of showing the main window. Applies the next time the app starts."
        />

        <Separator />

        <Toggle
          id="startWithSystem"
          checked={settings.startWithSystem}
          disabled={!isLinux}
          onChange={(value) => updateSetting('startWithSystem', value)}
          label="Start with the system"
          description="Start automatically when you log in, hidden in the tray (Linux: adds an entry to ~/.config/autostart/)."
        />

        <Separator />

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Advanced: custom OpenConnect binary</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              By default the app runs OpenConnect from your system packages. Point it at a
              custom build (for example one with Okta support) only if you trust it — it runs
              as root.
            </p>
          </div>

          {settings.allowCustomOpenConnect && settings.customOpenConnectPath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <span className="text-sm text-destructive font-medium">Active custom binary:</span>
                <code className="text-xs break-all">{settings.customOpenConnectPath}</code>
              </div>
              <Button variant="outline" onClick={disableCustomBinary} disabled={saving}>
                Disable and use system binary
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="customOpenConnectPath">Binary path</Label>
              <div className="flex gap-2">
                <Input
                  id="customOpenConnectPath"
                  placeholder="/usr/local/bin/openconnect-okta"
                  value={customPath}
                  onChange={(e) => {
                    setCustomPath(e.target.value);
                    setPathError('');
                  }}
                  className="font-mono text-sm"
                />
                <Button variant="outline" onClick={enableCustomBinary} disabled={saving}>
                  Enable…
                </Button>
              </div>
              {pathError && <p className="text-sm text-destructive" role="alert">{pathError}</p>}
            </div>
          )}
        </div>

        {saving && (
          <p className="text-xs text-muted-foreground">Saving...</p>
        )}

        {!isLinux && (
          <p className="text-xs text-muted-foreground">
            Autostart is only supported on Linux builds.
          </p>
        )}
      </CardContent>

      {pendingPath && (
        <CustomBinaryWarning
          path={pendingPath}
          onConfirm={confirmCustomBinary}
          onCancel={() => setPendingPath(null)}
        />
      )}
    </Card>
  );
}

export default SettingsPanel;
