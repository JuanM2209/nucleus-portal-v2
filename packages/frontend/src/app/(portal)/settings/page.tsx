'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import { usePortFilterStore, DEFAULT_HIDDEN_PORTS } from '@/stores/port-filter-store';
import {
  Sun,
  Moon,
  Bell,
  Clock,
  User,
  Settings,
  Building2,
  Users,
  Shield,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
  Ban,
  UserPlus,
  X,
  Loader2,
  AlertTriangle,
  EyeOff,
  Trash2,
  RotateCcw,
  Radar,
} from 'lucide-react';
import {
  useOrganizations,
  useCreateOrg,
  useUpdateOrg,
  useDeactivateOrg,
  useOrgMembers,
  useOrgDevices,
  useAssignDeviceToOrg,
  useRemoveDeviceFromOrg,
  useAddOrgMember,
  useRemoveOrgMember,
} from '@/hooks/use-admin';
import { useDevices } from '@/hooks/use-device';
import { usePreferences, useUpdatePreferences } from '@/hooks/use-settings';

/* ─── Types ─── */

type SettingsTab = 'general' | 'organizations' | 'users' | 'roles' | 'devices';

interface Org {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly devicesCount: number;
  readonly usersCount: number;
  readonly status: 'active' | 'inactive';
  readonly createdAt: string;
  readonly defaultSessionDurationHours: number;
}

interface OrgUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly orgs: readonly string[];
  readonly role: string;
  readonly lastLogin: string | null;
  readonly status: 'active' | 'inactive';
}

/* ─── Constants ─── */

const SESSION_DURATION_OPTIONS = ['1h', '2h', '4h', '8h', '12h', '24h', 'Custom'] as const;

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
] as const;

const TABS: readonly {
  readonly key: SettingsTab;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'devices', label: 'Devices', icon: Radar },
  { key: 'organizations', label: 'Organizations', icon: Building2 },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'roles', label: 'Roles', icon: Shield },
];

/* ─── Main Page ─── */

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showInviteUser, setShowInviteUser] = useState(false);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  return (
    <div className="min-h-full pb-12">
      <div className="pt-8 pb-6 px-2">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
          Settings
        </h1>
        <p className="text-on-surface-variant mt-1">
          Manage your preferences, organizations, users, and access control.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="px-2 mb-6">
        <div className="flex gap-1 bg-surface-container-low rounded-xl p-1 w-fit">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                setActiveTab(key);
                setSearchQuery('');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'bg-primary/20 text-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2">
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'devices' && <DevicesSettingsTab />}
        {activeTab === 'organizations' && (
          <OrganizationsTab
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            showCreate={showCreateOrg}
            onToggleCreate={() => setShowCreateOrg((p) => !p)}
            expandedOrgId={expandedOrgId}
            onToggleExpand={(id) => setExpandedOrgId((prev) => (prev === id ? null : id))}
          />
        )}
        {activeTab === 'users' && (
          <UsersTab
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            showInvite={showInviteUser}
            onToggleInvite={() => setShowInviteUser((p) => !p)}
          />
        )}
        {activeTab === 'roles' && <RolesTab />}
      </div>
    </div>
  );
}

/* ─── General Tab (existing settings) ─── */

function GeneralTab() {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useThemeStore();
  const { data: prefsData } = usePreferences();
  const updatePrefsMutation = useUpdatePreferences();
  const prefs = prefsData?.data ?? {};

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [sessionDuration, setSessionDuration] = useState<string>(() => {
    const h = prefs.sessionDurationHours;
    return h ? `${h}h` : '4h';
  });
  const [customDuration, setCustomDuration] = useState('');
  const [maxConcurrentSessions, setMaxConcurrentSessions] = useState(() => prefs.maxConcurrentSessions ?? 3);
  const [autoDisconnect, setAutoDisconnect] = useState(() => prefs.autoDisconnect ?? true);
  const [idleMinutes, setIdleMinutes] = useState(() => prefs.idleMinutes ?? 30);
  const [emailNotifications, setEmailNotifications] = useState(() => prefs.notificationsEnabled ?? true);
  const [sessionExpiryAlerts, setSessionExpiryAlerts] = useState(true);
  const [timezone, setTimezone] = useState(() => prefs.timezone ?? 'UTC');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync state when prefs load from backend
  useEffect(() => {
    if (prefs.sessionDurationHours) {
      setSessionDuration(`${prefs.sessionDurationHours}h`);
    }
    if (prefs.timezone) setTimezone(prefs.timezone);
    if (prefs.notificationsEnabled !== undefined) setEmailNotifications(prefs.notificationsEnabled);
    if (prefs.maxConcurrentSessions !== undefined) setMaxConcurrentSessions(prefs.maxConcurrentSessions);
  }, [prefs.sessionDurationHours, prefs.timezone, prefs.notificationsEnabled, prefs.maxConcurrentSessions]);

  function handleSave() {
    const durationMatch = sessionDuration.match(/^(\d+)h$/);
    const hours = durationMatch ? Number(durationMatch[1]) : 4;
    updatePrefsMutation.mutate(
      {
        theme,
        timezone,
        sessionDurationHours: hours,
        notificationsEnabled: emailNotifications,
      },
      {
        onSuccess: () => {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2000);
        },
      },
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Appearance */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Sun className="w-5 h-5 text-primary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Appearance</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-3 block">
              Theme
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
              <button
                disabled
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
              >
                <Sun className="w-4 h-4" />
                Light
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b] ml-1">
                  SOON
                </span>
              </button>
            </div>
          </div>

          <div className="bg-surface-container-highest rounded-xl p-4">
            <p className="text-xs text-on-surface-variant font-technical uppercase tracking-wider mb-2">
              Preview
            </p>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${theme === 'dark' ? 'bg-surface-dim' : 'bg-white'}`} />
              <div className={`w-8 h-8 rounded-lg ${theme === 'dark' ? 'bg-surface-container-high' : 'bg-gray-100'}`} />
              <div className="w-8 h-8 rounded-lg bg-primary/30" />
              <span className="text-sm text-on-surface-variant ml-2">
                Currently: <span className="font-technical text-on-surface">{theme}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Session Defaults */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-tertiary/10 rounded-lg">
            <Clock className="w-5 h-5 text-tertiary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Session Defaults</h2>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-2 block">
              Default Session Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {SESSION_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSessionDuration(opt)}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                    sessionDuration === opt
                      ? 'bg-tertiary/20 text-tertiary'
                      : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {sessionDuration === 'Custom' && (
              <input
                type="text"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                placeholder="e.g. 6h, 90m"
                className="mt-2 bg-surface-container-highest rounded-xl px-4 py-2 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-tertiary/40 placeholder:text-outline-variant w-40"
              />
            )}
          </div>

          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-2 block">
              Max Concurrent Sessions
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxConcurrentSessions}
              onChange={(e) => setMaxConcurrentSessions(Number(e.target.value))}
              className="bg-surface-container-highest rounded-xl px-4 py-2 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-tertiary/40 w-24"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Auto-disconnect on idle</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Automatically close sessions after inactivity
              </p>
            </div>
            <div className="flex items-center gap-3">
              {autoDisconnect && (
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={idleMinutes}
                  onChange={(e) => setIdleMinutes(Number(e.target.value))}
                  className="bg-surface-container-highest rounded-xl px-3 py-1.5 text-sm text-on-surface font-technical focus:outline-none focus:ring-2 focus:ring-tertiary/40 w-16 text-center"
                />
              )}
              {autoDisconnect && (
                <span className="text-xs text-on-surface-variant">min</span>
              )}
              <ToggleSwitch
                checked={autoDisconnect}
                onChange={setAutoDisconnect}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-[#f59e0b]/10 rounded-lg">
            <Bell className="w-5 h-5 text-[#f59e0b]" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Notifications</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Email notifications</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Receive email alerts for important events
              </p>
            </div>
            <ToggleSwitch
              checked={emailNotifications}
              onChange={setEmailNotifications}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Session expiry alerts</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Get notified before sessions expire
              </p>
            </div>
            <ToggleSwitch
              checked={sessionExpiryAlerts}
              onChange={setSessionExpiryAlerts}
            />
          </div>
        </div>
      </section>

      {/* Port Filtering */}
      <PortFilterSection />

      {/* Account */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-[#8b5cf6]/10 rounded-lg">
            <User className="w-5 h-5 text-[#8b5cf6]" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Account</h2>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-2 block">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 w-full max-w-sm"
            />
          </div>

          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-2 block">
              Email
            </label>
            <div className="bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface-variant font-body w-full max-w-sm opacity-60">
              {user?.email ?? 'Not available'}
            </div>
            <p className="text-xs text-on-surface-variant/60 mt-1">
              Contact an administrator to change your email.
            </p>
          </div>

          <div>
            <label className="text-sm text-on-surface-variant font-medium mb-2 block">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 w-full max-w-sm appearance-none"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        {saveSuccess && (
          <span className="text-xs text-tertiary font-technical">Settings saved!</span>
        )}
        {updatePrefsMutation.isError && (
          <span className="text-xs text-error font-technical">
            {(updatePrefsMutation.error as Error)?.message ?? 'Failed to save'}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={updatePrefsMutation.isPending}
          className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-8 py-3 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm disabled:opacity-50"
        >
          {updatePrefsMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

/* ─── Port Filter Section ─── */

function PortFilterSection() {
  const {
    hideSystemPorts,
    toggleHideSystemPorts,
    hiddenPorts,
    addHiddenPort,
    removeHiddenPort,
    resetHiddenPorts,
  } = usePortFilterStore();
  const [newPort, setNewPort] = useState('');

  const handleAddPort = () => {
    const port = parseInt(newPort, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      addHiddenPort(port);
      setNewPort('');
    }
  };

  return (
    <section className="bg-surface-container-low rounded-xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-error/10 rounded-lg">
            <EyeOff className="w-5 h-5 text-error" />
          </div>
          <div>
            <h2 className="font-headline font-bold text-on-surface text-lg">Port Filtering</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Hide system and ephemeral ports from device detail views
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-variant font-technical">
            {hideSystemPorts ? 'FILTERING ON' : 'SHOWING ALL'}
          </span>
          <ToggleSwitch checked={hideSystemPorts} onChange={toggleHideSystemPorts} />
        </div>
      </div>

      {hideSystemPorts && (
        <div className="space-y-4">
          {/* Hidden ports list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-on-surface-variant font-medium">
                Hidden Ports ({hiddenPorts.length})
              </label>
              <button
                onClick={resetHiddenPorts}
                className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-primary transition font-medium"
                title="Reset to default hidden ports"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Defaults
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {hiddenPorts.map((port) => (
                <span
                  key={port}
                  className="inline-flex items-center gap-1.5 bg-surface-container-highest px-2.5 py-1 rounded-lg text-xs font-technical text-on-surface-variant group"
                >
                  {port}
                  <button
                    onClick={() => removeHiddenPort(port)}
                    className="text-on-surface-variant/40 hover:text-error transition"
                    title={`Show port ${port}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {hiddenPorts.length === 0 && (
                <span className="text-xs text-on-surface-variant/50 italic">
                  No ports hidden — all ports visible
                </span>
              )}
            </div>
          </div>

          {/* Add port */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddPort()}
              placeholder="Add port number..."
              className="bg-surface-container-highest rounded-xl px-4 py-2 text-sm text-on-surface font-technical focus:outline-none focus:ring-2 focus:ring-primary/40 w-36"
            />
            <button
              onClick={handleAddPort}
              disabled={!newPort}
              className="px-3 py-2 rounded-xl bg-error/10 text-error text-sm font-medium hover:bg-error/20 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Hide Port
            </button>
          </div>

          <p className="text-[10px] text-on-surface-variant/50 font-technical">
            Hidden ports will not appear in WEB PORTS or SERVICE PORTS on device detail pages.
            This setting is saved locally and persists across sessions.
          </p>
        </div>
      )}
    </section>
  );
}

/* ─── Organizations Tab ─── */

function OrganizationsTab({
  searchQuery,
  onSearchChange,
  showCreate,
  onToggleCreate,
  expandedOrgId,
  onToggleExpand,
}: {
  readonly searchQuery: string;
  readonly onSearchChange: (q: string) => void;
  readonly showCreate: boolean;
  readonly onToggleCreate: () => void;
  readonly expandedOrgId: string | null;
  readonly onToggleExpand: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = useOrganizations();
  const orgs: readonly Org[] = data?.data ?? [];

  const filtered = orgs.filter(
    (o) =>
      o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.slug.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search organizations..."
            className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
          />
        </div>
        <button
          onClick={onToggleCreate}
          className="flex items-center gap-2 bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-5 py-2.5 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Organization
        </button>
      </div>

      {/* Create Org Form */}
      {showCreate && <CreateOrgForm onClose={onToggleCreate} />}

      {/* Loading State */}
      {isLoading && (
        <div className="bg-surface-container-low rounded-xl p-12 flex items-center justify-center gap-3 text-on-surface-variant">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading organizations...</span>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="bg-error/5 border border-error/20 rounded-xl p-6 flex items-center gap-3 text-error">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">Failed to load organizations: {(error as Error)?.message ?? 'Unknown error'}</span>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && (
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_100px_100px_100px_140px] gap-4 px-6 py-3 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
            <span>Name</span>
            <span>Slug</span>
            <span className="text-center">Devices</span>
            <span className="text-center">Users</span>
            <span className="text-center">Status</span>
            <span>Created</span>
          </div>

          {filtered.map((org) => (
            <OrgRow
              key={org.id}
              org={org}
              isExpanded={expandedOrgId === org.id}
              onToggleExpand={() => onToggleExpand(org.id)}
            />
          ))}

          {filtered.length === 0 && (
            <div className="px-6 py-12 text-center text-on-surface-variant">
              {orgs.length === 0 ? 'No organizations yet. Create one to get started.' : 'No organizations match your search.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Org Row with expand + deactivate ─── */

function OrgRow({
  org,
  isExpanded,
  onToggleExpand,
}: {
  readonly org: Org;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
}) {
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(org.name);
  const [editDescription, setEditDescription] = useState(org.description ?? '');
  const [editDuration, setEditDuration] = useState(org.defaultSessionDurationHours ?? 4);
  const deactivateMutation = useDeactivateOrg();
  const updateMutation = useUpdateOrg();
  const { data: membersData } = useOrgMembers(isExpanded ? org.id : '');
  const members: readonly OrgUser[] = membersData?.data ?? [];

  function handleDeactivate() {
    deactivateMutation.mutate(org.id, {
      onSuccess: () => setShowDeactivateConfirm(false),
    });
  }

  function handleSaveEdit() {
    updateMutation.mutate(
      { orgId: org.id, data: { name: editName, description: editDescription || undefined } },
      {
        onSuccess: () => setIsEditing(false),
      },
    );
  }

  return (
    <div>
      <button
        onClick={onToggleExpand}
        className="grid grid-cols-[1fr_120px_100px_100px_100px_140px] gap-4 px-6 py-4 w-full text-left text-sm hover:bg-surface-container-high transition-colors items-center"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-on-surface-variant/40 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-on-surface-variant/40 flex-shrink-0" />
          )}
          <span className="text-on-surface font-medium">{org.name}</span>
        </div>
        <span className="font-technical text-on-surface-variant text-xs">{org.slug}</span>
        <span className="text-center text-on-surface font-technical">{org.devicesCount ?? 0}</span>
        <span className="text-center text-on-surface font-technical">{org.usersCount ?? 0}</span>
        <span className="flex justify-center">
          <StatusBadge status={org.status} />
        </span>
        <span className="font-technical text-on-surface-variant text-xs">
          {new Date(org.createdAt).toLocaleDateString()}
        </span>
      </button>

      {isExpanded && (
        <div className="px-10 pb-4 space-y-3">
          <div className="bg-surface-container-high rounded-xl p-4">
            <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider mb-2">
              Details
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-on-surface-variant">Description:</span>{' '}
                <span className="text-on-surface">{org.description ?? 'None'}</span>
              </div>
              <div>
                <span className="text-on-surface-variant">Default Duration:</span>{' '}
                <span className="text-on-surface font-technical">{org.defaultSessionDurationHours ?? 4}h</span>
              </div>
            </div>

            {/* Members list */}
            {members.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider mb-2">
                  Members ({members.length})
                </p>
                <div className="space-y-1">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary">
                        {(m.displayName ?? m.email)[0].toUpperCase()}
                      </div>
                      <span className="text-on-surface">{m.displayName ?? m.email}</span>
                      <RoleBadge role={m.role} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline Edit Form */}
            {isEditing && (
              <div className="mt-4 bg-surface-container-lowest rounded-xl p-4 space-y-3 border border-primary/20">
                <p className="text-xs font-technical text-primary uppercase tracking-wider">Edit Organization</p>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">Name</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-surface-container-highest rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">Description</label>
                  <input
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Organization description..."
                    className="w-full bg-surface-container-highest rounded-xl px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSaveEdit}
                    disabled={updateMutation.isPending || !editName.trim()}
                    className="px-4 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(org.name);
                      setEditDescription(org.description ?? '');
                      setEditDuration(org.defaultSessionDurationHours ?? 4);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-surface-container-highest text-on-surface-variant text-xs hover:bg-surface-bright transition-colors"
                  >
                    Cancel
                  </button>
                  {updateMutation.isError && (
                    <span className="text-xs text-error self-center">
                      {(updateMutation.error as Error)?.message ?? 'Failed to update'}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setIsEditing((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-colors ${
                  isEditing
                    ? 'bg-primary/20 text-primary'
                    : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-bright'
                }`}
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              {!showDeactivateConfirm ? (
                <button
                  onClick={() => setShowDeactivateConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-error/10 text-error text-xs hover:bg-error/20 transition-colors"
                >
                  <Ban className="w-3 h-3" /> Deactivate
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-error">Confirm deactivation?</span>
                  <button
                    onClick={handleDeactivate}
                    disabled={deactivateMutation.isPending}
                    className="px-3 py-1.5 rounded-xl bg-error text-on-error text-xs font-bold hover:bg-error/90 transition-colors disabled:opacity-50"
                  >
                    {deactivateMutation.isPending ? 'Deactivating...' : 'Yes, Deactivate'}
                  </button>
                  <button
                    onClick={() => setShowDeactivateConfirm(false)}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-highest text-on-surface-variant text-xs hover:bg-surface-bright transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Create Org Form ─── */

function CreateOrgForm({ onClose }: { readonly onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultDuration, setDefaultDuration] = useState(8);
  const createMutation = useCreateOrg();

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  function handleSubmit() {
    if (!name.trim()) return;
    createMutation.mutate(
      { name: name.trim(), slug, description: description.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <div className="bg-surface-container-low rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-headline font-bold text-on-surface">New Organization</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <X className="w-4 h-4 text-on-surface-variant" />
        </button>
      </div>

      {createMutation.isError && (
        <div className="bg-error/5 border border-error/20 rounded-xl p-3 text-sm text-error">
          {(createMutation.error as Error)?.message ?? `Failed to create organization. The slug "${slug}" may already exist.`}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organization name"
            className="w-full bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
          />
        </div>
        <div>
          <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">Slug</label>
          <div className="bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface-variant font-technical opacity-60">
            {slug || 'auto-generated'}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
        />
      </div>

      <div>
        <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">
          Default Session Duration (hours)
        </label>
        <input
          type="number"
          min={1}
          max={24}
          value={defaultDuration}
          onChange={(e) => setDefaultDuration(Number(e.target.value))}
          className="bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 w-24"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || createMutation.isPending}
          className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-6 py-2 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}

/* ─── Users Tab ─── */

function UsersTab({
  searchQuery,
  onSearchChange,
  showInvite,
  onToggleInvite,
}: {
  readonly searchQuery: string;
  readonly onSearchChange: (q: string) => void;
  readonly showInvite: boolean;
  readonly onToggleInvite: () => void;
}) {
  const { data: orgsData, isLoading: orgsLoading } = useOrganizations();
  const orgs: readonly Org[] = orgsData?.data ?? [];
  const userOrgMap = useUserOrgMap(orgs);
  const allUsers = useMemo(() => Array.from(userOrgMap.values()), [userOrgMap]);

  const filtered = allUsers.filter(
    (u) =>
      (u.displayName ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search users..."
            className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
          />
        </div>
        <button
          onClick={onToggleInvite}
          className="flex items-center gap-2 bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-5 py-2.5 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm"
        >
          <UserPlus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      {/* Invite Form */}
      {showInvite && <InviteUserForm onClose={onToggleInvite} />}

      {/* Loading State */}
      {orgsLoading && (
        <div className="bg-surface-container-low rounded-xl p-12 flex items-center justify-center gap-3 text-on-surface-variant">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading users...</span>
        </div>
      )}

      {/* Table */}
      {!orgsLoading && (
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_1.2fr_1.3fr_140px_80px] gap-4 px-6 py-3 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
            <span>Name</span>
            <span>Email</span>
            <span>Organizations</span>
            <span>Last Login</span>
            <span className="text-center">Status</span>
          </div>

          {filtered.map((user) => (
            <UserOrgRow key={user.id} user={user} orgs={orgs} />
          ))}

          {filtered.length === 0 && (
            <div className="px-6 py-12 text-center text-on-surface-variant">
              {allUsers.length === 0 ? 'No users found. Users appear here once they belong to an organization.' : 'No users match your search.'}
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      {!orgsLoading && allUsers.length > 0 && (
        <div className="text-xs text-on-surface-variant font-technical">
          {allUsers.length} user{allUsers.length !== 1 ? 's' : ''} across {orgs.length} organization{orgs.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

/* ─── User Org Row ─── */

function UserOrgRow({
  user,
  orgs,
}: {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly isActive: boolean;
    readonly lastLoginAt: string | null;
    readonly orgs: ReadonlyArray<{ orgId: string; orgName: string; role: string }>;
  };
  readonly orgs: readonly Org[];
}) {
  const [showManage, setShowManage] = useState(false);
  const addMutation = useAddOrgMember();
  const removeMutation = useRemoveOrgMember();

  const assignedOrgIds = new Set(user.orgs.map((o) => o.orgId));
  const availableOrgs = orgs.filter((o) => !assignedOrgIds.has(o.id));
  const isPending = addMutation.isPending || removeMutation.isPending;

  function handleAddOrg(orgId: string, role: string) {
    addMutation.mutate({ orgId, data: { userId: user.id, role } });
  }

  function handleRemoveOrg(orgId: string) {
    removeMutation.mutate({ orgId, userId: user.id });
  }

  return (
    <div>
      <div className="grid grid-cols-[1fr_1.2fr_1.3fr_140px_80px] gap-4 px-6 py-4 text-sm hover:bg-surface-container-high transition-colors items-center">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {(user.displayName ?? user.email)[0].toUpperCase()}
          </div>
          <span className="text-on-surface font-medium">{user.displayName ?? user.email.split('@')[0]}</span>
        </div>
        <span className="text-on-surface-variant font-technical text-xs">{user.email}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {user.orgs.map((o) => (
            <span
              key={o.orgId}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full"
            >
              {o.orgName}
              <span className="text-primary/50">({o.role})</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveOrg(o.orgId); }}
                disabled={isPending}
                className="hover:bg-error/20 hover:text-error rounded-full p-0.5 transition-colors disabled:opacity-50"
                title={`Remove from ${o.orgName}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowManage((p) => !p)}
            className={`text-[10px] px-2.5 py-1 rounded-full transition-colors font-medium ${
              showManage
                ? 'bg-primary/20 text-primary'
                : 'bg-surface-container-highest text-on-surface-variant hover:bg-primary/10 hover:text-primary'
            }`}
          >
            {showManage ? 'Close' : 'Manage Orgs'}
          </button>
        </div>
        <span className="font-technical text-on-surface-variant text-xs">
          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
        </span>
        <span className="flex justify-center">
          <StatusBadge status={user.isActive ? 'active' : 'inactive'} />
        </span>
      </div>
      {showManage && (
        <div className="px-6 pb-3">
          <div className="bg-surface-container-lowest rounded-xl p-4 ml-9 border border-primary/20 space-y-4">
            {/* Current org assignments */}
            {user.orgs.length > 0 && (
              <div>
                <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider mb-2">Current Organizations</p>
                <div className="space-y-2">
                  {user.orgs.map((o) => (
                    <div key={o.orgId} className="flex items-center justify-between bg-surface-container-high rounded-xl px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-primary/60" />
                        <span className="text-sm text-on-surface font-medium">{o.orgName}</span>
                        <RoleBadge role={o.role} />
                      </div>
                      <button
                        onClick={() => handleRemoveOrg(o.orgId)}
                        disabled={isPending}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-error/10 text-error text-[10px] font-medium hover:bg-error/20 transition-colors disabled:opacity-50"
                      >
                        <X className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add to new org */}
            <div>
              <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider mb-2">Add to Organization</p>
              {availableOrgs.length > 0 ? (
                <div className="space-y-2">
                  {availableOrgs.map((o) => (
                    <AddOrgToUserRow key={o.id} org={o} userId={user.id} isPending={isPending} onAdd={handleAddOrg} />
                  ))}
                </div>
              ) : (
                <div className="bg-surface-container-high rounded-xl px-4 py-3 text-xs text-on-surface-variant/60">
                  This user is already in all available organizations. Create a new organization in the Organizations tab to assign more.
                </div>
              )}
            </div>

            {isPending && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating...
              </div>
            )}
            {(addMutation.isError || removeMutation.isError) && (
              <p className="text-xs text-error">
                {((addMutation.error || removeMutation.error) as Error)?.message ?? 'Failed to update'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddOrgToUserRow({
  org,
  userId,
  isPending,
  onAdd,
}: {
  readonly org: Org;
  readonly userId: string;
  readonly isPending: boolean;
  readonly onAdd: (orgId: string, role: string) => void;
}) {
  const [role, setRole] = useState('member');

  return (
    <div className="flex items-center justify-between bg-surface-container-high rounded-xl px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Building2 className="w-3.5 h-3.5 text-on-surface-variant/40" />
        <span className="text-sm text-on-surface">{org.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="bg-surface-container-highest rounded-lg px-2 py-1 text-[10px] text-on-surface font-medium focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none"
        >
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          onClick={() => onAdd(org.id, role)}
          disabled={isPending}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  );
}

/* ─── Invite User Form ─── */

function InviteUserForm({ onClose }: { readonly onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');

  return (
    <div className="bg-surface-container-low rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-headline font-bold text-on-surface">Invite User</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <X className="w-4 h-4 text-on-surface-variant" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
          />
        </div>
        <div>
          <label className="text-sm text-on-surface-variant font-medium mb-1.5 block">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full bg-surface-container-highest rounded-xl px-4 py-2.5 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
          >
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          className="px-5 py-2 rounded-xl text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors"
        >
          Cancel
        </button>
        <button className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-6 py-2 rounded-xl hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 text-sm">
          Send Invite
        </button>
      </div>
    </div>
  );
}

/* ─── Roles Tab ─── */

function RolesTab() {
  const ROLE_DEFINITIONS = [
    {
      name: 'admin',
      description: 'Full access to all resources',
      permissions: [
        'Manage organizations',
        'Manage users and roles',
        'Manage devices',
        'Create and manage sessions',
        'View dashboards and reports',
        'Access audit logs',
        'Configure system settings',
      ],
    },
    {
      name: 'operator',
      description: 'Can manage devices and sessions',
      permissions: [
        'Manage devices',
        'Create and manage sessions',
        'View dashboards and reports',
        'View audit logs',
      ],
    },
    {
      name: 'viewer',
      description: 'Read-only access to dashboards and reports',
      permissions: [
        'View dashboards and reports',
        'View device status',
        'View session history',
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-surface-container-low rounded-xl p-4">
        <p className="text-sm text-on-surface-variant">
          Roles are system-defined and cannot be modified. Each role grants a specific set of permissions.
        </p>
      </div>

      <div className="space-y-4">
        {ROLE_DEFINITIONS.map((role) => (
          <div key={role.name} className="bg-surface-container-low rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <RoleBadge role={role.name} />
              <span className="text-sm text-on-surface-variant">{role.description}</span>
            </div>
            <div className="bg-surface-container-high rounded-xl p-4">
              <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider mb-3">
                Permissions
              </p>
              <div className="grid grid-cols-2 gap-2">
                {role.permissions.map((perm) => (
                  <div key={perm} className="flex items-center gap-2 text-sm text-on-surface">
                    <div className="w-1.5 h-1.5 rounded-full bg-tertiary flex-shrink-0" />
                    {perm}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */

function ToggleSwitch({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-surface-container-highest'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-on-primary transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function StatusBadge({ status }: { readonly status: 'active' | 'inactive' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
        status === 'active'
          ? 'bg-tertiary/10 text-tertiary'
          : 'bg-surface-container-highest text-on-surface-variant/60'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === 'active' ? 'bg-tertiary' : 'bg-on-surface-variant/40'
        }`}
      />
      {status}
    </span>
  );
}

function RoleBadge({ role }: { readonly role: string }) {
  const colorMap: Record<string, string> = {
    admin: 'bg-error/10 text-error',
    operator: 'bg-primary/10 text-primary',
    viewer: 'bg-surface-container-highest text-on-surface-variant',
  };
  const colors = colorMap[role] ?? colorMap.viewer;

  return (
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${colors}`}>
      {role}
    </span>
  );
}

/* ─── Devices Settings Tab ─── */

function useDeviceOrgMap(orgs: readonly Org[]) {
  // Fetch devices for each org — we call hooks at top level with fixed-length array
  const org0 = useOrgDevices(orgs[0]?.id ?? '');
  const org1 = useOrgDevices(orgs[1]?.id ?? '');
  const org2 = useOrgDevices(orgs[2]?.id ?? '');
  const org3 = useOrgDevices(orgs[3]?.id ?? '');
  const org4 = useOrgDevices(orgs[4]?.id ?? '');

  return useMemo(() => {
    const map = new Map<string, Array<{ orgId: string; orgName: string }>>();
    const queries = [org0, org1, org2, org3, org4];
    for (let i = 0; i < Math.min(orgs.length, 5); i++) {
      const orgDevs = queries[i].data?.data ?? [];
      if (Array.isArray(orgDevs)) {
        orgDevs.forEach((d: any) => {
          const existing = map.get(d.id) ?? [];
          map.set(d.id, [...existing, { orgId: orgs[i].id, orgName: orgs[i].name }]);
        });
      }
    }
    return map;
  }, [orgs, org0.data, org1.data, org2.data, org3.data, org4.data]);
}

function useUserOrgMap(orgs: readonly Org[]) {
  // Fetch users for each org — fixed hook count (max 5)
  const org0 = useOrgMembers(orgs[0]?.id ?? '');
  const org1 = useOrgMembers(orgs[1]?.id ?? '');
  const org2 = useOrgMembers(orgs[2]?.id ?? '');
  const org3 = useOrgMembers(orgs[3]?.id ?? '');
  const org4 = useOrgMembers(orgs[4]?.id ?? '');

  return useMemo(() => {
    const userMap = new Map<string, {
      id: string;
      email: string;
      displayName: string | null;
      isActive: boolean;
      lastLoginAt: string | null;
      orgs: Array<{ orgId: string; orgName: string; role: string }>;
    }>();
    const queries = [org0, org1, org2, org3, org4];
    for (let i = 0; i < Math.min(orgs.length, 5); i++) {
      const members = queries[i].data?.data ?? [];
      if (Array.isArray(members)) {
        members.forEach((m: any) => {
          const existing = userMap.get(m.id);
          const orgEntry = { orgId: orgs[i].id, orgName: orgs[i].name, role: m.role ?? 'member' };
          if (existing) {
            userMap.set(m.id, { ...existing, orgs: [...existing.orgs, orgEntry] });
          } else {
            userMap.set(m.id, {
              id: m.id,
              email: m.email,
              displayName: m.displayName ?? null,
              isActive: m.isActive ?? true,
              lastLoginAt: m.lastLoginAt ?? null,
              orgs: [orgEntry],
            });
          }
        });
      }
    }
    return userMap;
  }, [orgs, org0.data, org1.data, org2.data, org3.data, org4.data]);
}

function DevicesSettingsTab() {
  const { data: devicesData, isLoading } = useDevices({ limit: 100 });
  const { data: orgsData } = useOrganizations();
  const devices: readonly any[] = devicesData?.data ?? [];
  const orgs: readonly Org[] = orgsData?.data ?? [];
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const deviceOrgMap = useDeviceOrgMap(orgs);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Notifications — BETA */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-tertiary/10 rounded-lg">
            <Bell className="w-5 h-5 text-tertiary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Device Notifications</h2>
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f59e0b]/15 text-[#f59e0b]">
            BETA
          </span>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Device offline alerts</p>
              <p className="text-xs text-on-surface-variant">Get notified when a device goes offline</p>
            </div>
            <div className="opacity-50 cursor-not-allowed"><ToggleSwitch checked={false} onChange={() => {}} /></div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Health check failures</p>
              <p className="text-xs text-on-surface-variant">Alert when health checks fail repeatedly</p>
            </div>
            <div className="opacity-50 cursor-not-allowed"><ToggleSwitch checked={false} onChange={() => {}} /></div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-on-surface font-medium">Agent update available</p>
              <p className="text-xs text-on-surface-variant">Notify when a new agent version is released</p>
            </div>
            <div className="opacity-50 cursor-not-allowed"><ToggleSwitch checked={false} onChange={() => {}} /></div>
          </div>
          <p className="text-[10px] text-on-surface-variant/50 font-technical">
            Notification delivery is currently in beta. Email and in-app notifications coming soon.
          </p>
        </div>
      </section>

      {/* Device Organization Assignment */}
      <section className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Building2 className="w-5 h-5 text-primary" />
          </div>
          <h2 className="font-headline font-bold text-on-surface text-lg">Device Organization</h2>
        </div>
        <p className="text-xs text-on-surface-variant mb-4">
          Assign devices to one or multiple organizations. Each org sees only its assigned devices.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-on-surface-variant text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading devices...
          </div>
        ) : devices.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-4">No devices found.</p>
        ) : (
          <div className="bg-surface-container-high rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_1.5fr_120px_120px] gap-4 px-5 py-2.5 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
              <span>Device</span>
              <span>Organizations</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {devices.map((device: any) => (
              <DeviceOrgRow
                key={device.id}
                device={device}
                orgs={orgs}
                assignedOrgs={deviceOrgMap.get(device.id) ?? []}
                isSelected={selectedDeviceId === device.id}
                onToggleSelect={() => setSelectedDeviceId((p) => (p === device.id ? null : device.id))}
                onAssigned={() => setSelectedDeviceId(null)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─── Device Org Row ─── */

function DeviceOrgRow({
  device,
  orgs,
  assignedOrgs,
  isSelected,
  onToggleSelect,
  onAssigned,
}: {
  readonly device: any;
  readonly orgs: readonly Org[];
  readonly assignedOrgs: ReadonlyArray<{ orgId: string; orgName: string }>;
  readonly isSelected: boolean;
  readonly onToggleSelect: () => void;
  readonly onAssigned: () => void;
}) {
  const assignMutation = useAssignDeviceToOrg();
  const removeMutation = useRemoveDeviceFromOrg();
  const deviceName = (device.name || device.serialNumber || device.id).replace(/^Nucleus\s+/i, '');

  const assignedOrgIds = new Set(assignedOrgs.map((o) => o.orgId));
  const availableOrgs = orgs.filter((o) => !assignedOrgIds.has(o.id));

  function handleAddOrg(targetOrgId: string) {
    assignMutation.mutate(
      { orgId: targetOrgId, deviceId: device.id },
      { onSuccess: onAssigned },
    );
  }

  function handleRemoveOrg(orgId: string) {
    removeMutation.mutate({ orgId, deviceId: device.id });
  }

  const isPending = assignMutation.isPending || removeMutation.isPending;

  return (
    <div>
      <div className="grid grid-cols-[1fr_1.5fr_120px_120px] gap-4 px-5 py-3 text-sm hover:bg-surface-container-highest/50 transition-colors items-center">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-on-surface-variant/40" />
          <span className="text-on-surface font-medium">{deviceName}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {assignedOrgs.length === 0 && (
            <span className="text-on-surface-variant/50 text-xs font-technical">Unassigned</span>
          )}
          {assignedOrgs.map((o) => (
            <span
              key={o.orgId}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full"
            >
              {o.orgName}
              <button
                onClick={(e) => { e.stopPropagation(); handleRemoveOrg(o.orgId); }}
                disabled={isPending}
                className="hover:bg-primary/20 rounded-full p-0.5 transition-colors disabled:opacity-50"
                title={`Remove from ${o.orgName}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
        <span className="flex">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            device.status === 'online' ? 'bg-tertiary/10 text-tertiary' : 'bg-surface-container-highest text-on-surface-variant/60'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-tertiary animate-pulse' : 'bg-on-surface-variant/40'}`} />
            {device.status ?? 'unknown'}
          </span>
        </span>
        <button
          onClick={onToggleSelect}
          disabled={availableOrgs.length === 0 && !isSelected}
          className={`text-xs px-3 py-1.5 rounded-xl transition-colors ${
            isSelected ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-bright'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          {isSelected ? 'Cancel' : '+ Add Org'}
        </button>
      </div>
      {isSelected && (
        <div className="px-5 pb-3">
          <div className="bg-surface-container-lowest rounded-xl p-4 ml-6 border border-primary/20">
            <p className="text-xs text-on-surface-variant mb-2">Add to organization:</p>
            <div className="flex flex-wrap gap-2">
              {availableOrgs.map((o) => (
                <button
                  key={o.id}
                  onClick={() => handleAddOrg(o.id)}
                  disabled={isPending}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium transition-colors bg-surface-container-highest text-on-surface-variant hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                >
                  + {o.name}
                </button>
              ))}
              {availableOrgs.length === 0 && (
                <span className="text-xs text-on-surface-variant/50">Already assigned to all organizations</span>
              )}
            </div>
            {isPending && (
              <div className="flex items-center gap-2 mt-2 text-xs text-primary">
                <Loader2 className="w-3 h-3 animate-spin" /> Updating...
              </div>
            )}
            {(assignMutation.isError || removeMutation.isError) && (
              <p className="text-xs text-error mt-2">
                {((assignMutation.error || removeMutation.error) as Error)?.message ?? 'Failed to update'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

