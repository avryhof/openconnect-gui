import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { Settings } from 'lucide-react';

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Application Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {saving && (
          <p className="text-xs text-muted-foreground">Saving...</p>
        )}

        {!isLinux && (
          <p className="text-xs text-muted-foreground">
            Autostart is only supported on Linux builds.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default SettingsPanel;
