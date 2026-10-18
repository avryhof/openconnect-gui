import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Trash2, Settings } from 'lucide-react';

function ConnectionForm({
  profiles,
  setProfiles,
  currentStatus,
  openConnectInstalled,
  showAlert,
  addLog,
  saveProfiles,
  loadProfiles,
  onServerChange,
  passwordEncryption = false
}) {
  const [formData, setFormData] = useState({
    profileName: '',
    serverUrl: '',
    username: '',
    password: '',
    authgroup: '',
    protocol: 'anyconnect',
    serverCert: '',
    autoConnect: false,
    promptForPassword: false
  });
  const [selectedProfile, setSelectedProfile] = useState('__new__');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Notify parent when server URL changes
    if (name === 'serverUrl' && onServerChange) {
      onServerChange(value);
    }
  };

  const handleProfileSelect = (profileName) => {
    setSelectedProfile(profileName);

    if (!profileName || profileName === '__new__') {
      // Clear form
      setFormData({
        profileName: '',
        serverUrl: '',
        username: '',
        password: '',
        authgroup: '',
        protocol: 'anyconnect',
        serverCert: '',
        autoConnect: false,
        promptForPassword: false
      });
      setSelectedProfile('__new__');
      if (onServerChange) {
        onServerChange('');
      }
      return;
    }

    const profile = profiles.find(p => p.name === profileName);
    if (profile) {
      setFormData({
        profileName: profile.name,
        serverUrl: profile.server,
        username: profile.username,
        password: profile.password,
        authgroup: profile.authgroup || '',
        protocol: profile.protocol || 'anyconnect',
        serverCert: profile.serverCert || '',
        autoConnect: !!profile.autoConnect,
        promptForPassword: !!profile.promptForPassword
      });
      if (onServerChange) {
        onServerChange(profile.server);
      }
    }
  };

  const handleConnect = async () => {
    if (!formData.serverUrl || !formData.username ||
        (!formData.promptForPassword && !formData.password)) {
      showAlert('Please fill in all required fields', 'error');
      return;
    }

    addLog('Attempting to connect...', 'info');

    const config = {
      name: formData.profileName.trim() || undefined,
      server: formData.serverUrl.trim(),
      username: formData.username.trim(),
      password: formData.password.trim(),
      promptForPassword: formData.promptForPassword,
      authgroup: formData.authgroup?.trim() || undefined,
      protocol: formData.protocol || 'anyconnect',
      serverCert: formData.serverCert?.trim() || undefined
    };

    const result = await window.electronAPI.connectVPN(config);

    if (!result.success) {
      showAlert(`Connection failed: ${result.error}`, 'error');
      addLog(`Connection failed: ${result.error}`, 'error');
    } else {
      addLog('Connection initiated...', 'info');
    }
  };

  const handleDisconnect = async () => {
    addLog('Disconnecting...', 'info');
    const result = await window.electronAPI.disconnectVPN();

    if (!result.success) {
      showAlert(`Disconnect failed: ${result.error}`, 'error');
    }
  };

  const handleSaveProfile = async () => {
    if (!formData.profileName) {
      showAlert('Please enter a profile name', 'error');
      return;
    }

    if (!formData.serverUrl || !formData.username) {
      showAlert('Please fill in server and username', 'error');
      return;
    }

    const profile = {
      name: formData.profileName,
      server: formData.serverUrl,
      username: formData.username,
      // Never store the password for profiles that prompt on connect
      password: formData.promptForPassword ? '' : formData.password,
      promptForPassword: !!formData.promptForPassword,
      authgroup: formData.authgroup || '',
      protocol: formData.protocol || 'anyconnect',
      serverCert: formData.serverCert || '',
      autoConnect: !!formData.autoConnect
    };

    // Only one profile can auto-connect: clear the flag on all others
    let newProfiles = profiles.map(p =>
      p.name === formData.profileName || !formData.autoConnect ? p : { ...p, autoConnect: false }
    );

    const existingIndex = newProfiles.findIndex(p => p.name === formData.profileName);

    if (existingIndex >= 0) {
      // Update existing
      newProfiles[existingIndex] = profile;
      showAlert(`Profile "${formData.profileName}" updated`, 'success');
    } else {
      // Add new
      newProfiles = [...newProfiles, profile];
      showAlert(`Profile "${formData.profileName}" saved`, 'success');
    }

    setProfiles(newProfiles);
    await saveProfiles(newProfiles);
    addLog(`Profile "${formData.profileName}" saved`, 'info');
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfile) return;

    if (window.confirm(`Delete profile "${selectedProfile}"?`)) {
      const newProfiles = profiles.filter(p => p.name !== selectedProfile);
      setProfiles(newProfiles);
      await saveProfiles(newProfiles);

      // Clear form and selection
      setSelectedProfile('__new__');
      setFormData({
        profileName: '',
        serverUrl: '',
        username: '',
        password: '',
        authgroup: '',
        protocol: 'anyconnect',
        serverCert: '',
        autoConnect: false,
        promptForPassword: false
      });

      showAlert(`Profile "${selectedProfile}" deleted`, 'success');
      addLog(`Profile "${selectedProfile}" deleted`, 'info');
    }
  };

  const isConnecting = currentStatus === 'connecting';
  const isConnected = currentStatus === 'connected';
  const isDisconnected = currentStatus === 'disconnected';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Connection Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Profile Selection */}
        <div className="space-y-2">
          <Label htmlFor="profileSelect">Saved Profiles</Label>
          <div className="flex gap-2">
            <Select value={selectedProfile} onValueChange={handleProfileSelect}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="-- New Connection --" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">-- New Connection --</SelectItem>
                {profiles.map(profile => (
                  <SelectItem key={profile.name} value={profile.name}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              title="Delete Profile"
              disabled={!selectedProfile || selectedProfile === '__new__'}
              onClick={handleDeleteProfile}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Connection Form */}
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profileName">Profile Name (optional)</Label>
            <Input
              type="text"
              id="profileName"
              name="profileName"
              placeholder="My VPN Connection"
              value={formData.profileName}
              onChange={handleInputChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl">VPN Server URL *</Label>
            <Input
              type="text"
              id="serverUrl"
              name="serverUrl"
              placeholder="vpn.example.com"
              required
              value={formData.serverUrl}
              onChange={handleInputChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username *</Label>
            <Input
              type="text"
              id="username"
              name="username"
              placeholder="username"
              required
              value={formData.username}
              onChange={handleInputChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password {!formData.promptForPassword && '*'}</Label>
            <Input
              type="password"
              id="password"
              name="password"
              placeholder={formData.promptForPassword ? 'Not stored — entered on each connect' : 'password'}
              required={!formData.promptForPassword}
              disabled={formData.promptForPassword}
              value={formData.password}
              onChange={handleInputChange}
            />
            {!formData.promptForPassword && (
              passwordEncryption ? (
                <p className="text-xs text-muted-foreground">
                  Stored encrypted at rest via your system keyring (libsecret/KWallet).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ⚠️ Warning: no system keyring available — password is stored unencrypted locally
                </p>
              )
            )}
            <div className="flex items-start gap-3 pt-1">
              <input
                type="checkbox"
                id="promptForPassword"
                checked={formData.promptForPassword}
                onChange={(e) => setFormData(prev => ({ ...prev, promptForPassword: e.target.checked }))}
                className="mt-1 h-4 w-4 accent-primary cursor-pointer"
              />
              <div className="space-y-0.5">
                <Label htmlFor="promptForPassword" className="cursor-pointer">
                  Prompt for password on connect
                </Label>
                <p className="text-xs text-muted-foreground">
                  Ask each time you connect instead of storing it. Use this when your
                  password contains a one-time MFA code that changes every time.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="authgroup">Group/Authgroup (optional)</Label>
            <Input
              type="text"
              id="authgroup"
              name="authgroup"
              placeholder="group-name"
              value={formData.authgroup}
              onChange={handleInputChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="protocol">Protocol</Label>
            <Select value={formData.protocol} onValueChange={(value) => setFormData(prev => ({ ...prev, protocol: value }))}>
              <SelectTrigger id="protocol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anyconnect">AnyConnect (Cisco)</SelectItem>
                <SelectItem value="nc">Juniper Network Connect</SelectItem>
                <SelectItem value="gp">GlobalProtect (Palo Alto)</SelectItem>
                <SelectItem value="pulse">Pulse Connect Secure</SelectItem>
                <SelectItem value="f5">F5 Big-IP</SelectItem>
                <SelectItem value="fortinet">Fortinet</SelectItem>
                <SelectItem value="array">Array Networks</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Select the VPN protocol your server uses</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverCert">Server Certificate (optional)</Label>
            <Input
              type="text"
              id="serverCert"
              name="serverCert"
              placeholder="pin-sha256:xxxxx..."
              value={formData.serverCert}
              onChange={handleInputChange}
            />
            <p className="text-xs text-muted-foreground">Example: pin-sha256:AAAA1111BBB2222CCC3333DDD4444EEE5555FFF6666=</p>
          </div>

          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="autoConnect"
              checked={formData.autoConnect}
              onChange={(e) => setFormData(prev => ({ ...prev, autoConnect: e.target.checked }))}
              className="mt-1 h-4 w-4 accent-primary cursor-pointer"
            />
            <div className="space-y-0.5">
              <Label htmlFor="autoConnect" className="cursor-pointer">Auto-connect at startup</Label>
              <p className="text-xs text-muted-foreground">
                Connect automatically when the app starts (save the profile first). Only one profile can do this.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!openConnectInstalled || !isDisconnected}
              onClick={handleConnect}
            >
              Connect
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDisconnected}
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveProfile}
            >
              Save Profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default ConnectionForm;
