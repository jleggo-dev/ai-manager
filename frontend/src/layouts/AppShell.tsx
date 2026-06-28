import { useState, useEffect, useCallback, ReactNode, ComponentType } from 'react';
import { Tooltip } from '@mantine/core';
import {
  IconBrain,
  IconListCheck,
  IconPlug,
  IconSettings,
  IconChevronRight,
  IconChevronLeft,
  IconMenu2,
  IconX,
  IconCpu,
  IconScale,
  IconLogout,
  IconUsers,
  IconUserShield,
  IconHeartHandshake,
  IconGitMerge,
  IconHeartRateMonitor,
  IconKey,
  IconStethoscope,
  IconWorldWww,
} from '@tabler/icons-react';
import styles from './AppShell.module.css';
import type { SessionUser } from '../lib/auth-session';

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;
type IconComponent = ComponentType<{ size?: string | number; stroke?: string | number }>;

const STORAGE_KEY = 'ai-admin-sidebar-expanded';

interface NavItem {
  key: string;
  label: string;
  icon: IconComponent;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export type AppMode = 'admin' | 'health-checker';

const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    label: 'AI Admin',
    items: [
      { key: 'providers', label: 'Providers', icon: IconPlug },
      { key: 'ai-profiles', label: 'Profiles', icon: IconBrain },
      { key: 'processing-jobs', label: 'Jobs', icon: IconListCheck },
      { key: 'workflows', label: 'Workflows', icon: IconGitMerge },
      { key: 'ai-matcher', label: 'Matcher', icon: IconScale },
      { key: 'team', label: 'Team', icon: IconUsers },
      { key: 'users', label: 'Users', icon: IconUserShield, adminOnly: true },
      { key: 'lovable', label: 'Vibe-Coding Tools', icon: IconHeartHandshake },
      { key: 'settings', label: 'Settings', icon: IconSettings },
    ],
  },
];

const HEALTH_NAV_SECTIONS: NavSection[] = [
  {
    label: 'Health Checker',
    items: [
      { key: 'hc-dashboard', label: 'Dashboard', icon: IconHeartRateMonitor },
      { key: 'hc-providers', label: 'Provider Keys', icon: IconKey },
      { key: 'hc-profiles', label: 'Profiles', icon: IconBrain },
      { key: 'hc-checks', label: 'API Health', icon: IconStethoscope },
      { key: 'hc-widget-checks', label: 'Widget Health', icon: IconWorldWww },
    ],
  },
];

const MOBILE_TABS: NavItem[] = [
  { key: 'providers', label: 'Providers', icon: IconPlug },
  { key: 'ai-profiles', label: 'Profiles', icon: IconBrain },
  { key: 'processing-jobs', label: 'Jobs', icon: IconListCheck },
  { key: 'team', label: 'Team', icon: IconUsers },
  { key: 'lovable', label: 'Vibe-Coding Tools', icon: IconHeartHandshake },
  { key: 'settings', label: 'Settings', icon: IconSettings },
];

function sidebarUserLabel(sessionUser: SessionUser | null): string {
  const name = sessionUser?.display_name?.trim();
  const email = sessionUser?.email?.trim();
  if (name) return name;
  if (email) return email;
  return 'Signed in';
}

function sidebarUserInitial(sessionUser: SessionUser | null): string {
  const name = sessionUser?.display_name?.trim();
  const email = sessionUser?.email?.trim();
  const s = name || email || '';
  if (!s) return '?';
  return s.slice(0, 1).toUpperCase();
}

interface AppShellLayoutProps {
  activePage: string;
  onNavigate: NavigateFn;
  onSignOut?: () => void;
  sessionUser: SessionUser | null;
  appMode?: AppMode;
  onToggleMode?: () => void;
  isAdmin?: boolean;
  children: ReactNode;
}

export default function AppShellLayout({
  activePage,
  onNavigate,
  onSignOut,
  sessionUser,
  appMode = 'admin',
  onToggleMode,
  isAdmin = false,
  children,
}: AppShellLayoutProps) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(expanded));
    } catch {
      /* localStorage unavailable */
    }
  }, [expanded]);

  const navigate = useCallback(
    (key: string, params?: Record<string, unknown>) => {
      onNavigate(key, params);
      setMobileOpen(false);
    },
    [onNavigate],
  );

  const toggleSidebar = () => setExpanded((e) => !e);

  const renderNavItem = (item: NavItem) => {
    const isActive = activePage === item.key;
    const Icon = item.icon;
    const className = [styles.navItem, isActive && styles.navItemActive].filter(Boolean).join(' ');

    const btn = (
      <button
        key={item.key}
        type="button"
        className={className}
        onClick={() => navigate(item.key)}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className={styles.navIcon}>
          <Icon size={20} stroke={1.5} />
        </span>
        <span className={expanded ? styles.navLabel : `${styles.navLabel} ${styles.navLabelHidden}`}>{item.label}</span>
      </button>
    );

    if (!expanded) {
      return (
        <Tooltip key={item.key} label={item.label} position="right" withArrow transitionProps={{ duration: 100 }}>
          {btn}
        </Tooltip>
      );
    }
    return btn;
  };

  const sidebarClass = [
    styles.sidebar,
    expanded ? styles.sidebarExpanded : styles.sidebarCollapsed,
    mobileOpen && styles.sidebarMobileOpen,
  ]
    .filter(Boolean)
    .join(' ');

  const mainClass = [styles.mainContent, expanded ? styles.mainContentExpanded : styles.mainContentCollapsed]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <header className={styles.mobileHeader}>
        <button
          type="button"
          className={styles.burgerBtn}
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <IconX size={22} /> : <IconMenu2 size={22} />}
        </button>
        <span className={styles.mobileTitle}>AI Admin</span>
        <span className={styles.aiPill}>AI</span>
      </header>

      {mobileOpen && <div className={styles.overlay} onClick={() => setMobileOpen(false)} role="presentation" />}

      <nav className={sidebarClass} aria-label="Main navigation">
        <Tooltip
          label={appMode === 'admin' ? 'Switch to Health Checker' : 'Switch to AI Admin'}
          position="right"
          withArrow
          disabled={!isAdmin || expanded}
        >
          <div
            className={styles.logoArea}
            data-testid="mode-toggle"
            role={isAdmin ? 'button' : undefined}
            tabIndex={isAdmin ? 0 : undefined}
            style={isAdmin ? { cursor: 'pointer' } : undefined}
            onClick={isAdmin ? onToggleMode : undefined}
            onKeyDown={
              isAdmin
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') onToggleMode?.();
                  }
                : undefined
            }
          >
            <div
              className={styles.logoIcon}
              style={
                appMode === 'health-checker' ? { background: 'rgba(64, 192, 87, 0.2)', color: '#69db7c' } : undefined
              }
            >
              {appMode === 'health-checker' ? (
                <IconHeartRateMonitor size={20} stroke={1.5} />
              ) : (
                <IconCpu size={20} stroke={1.5} />
              )}
            </div>
            <span className={expanded ? styles.logoText : `${styles.logoText} ${styles.logoTextHidden}`}>
              {appMode === 'health-checker' ? 'Health Checker' : 'AI Admin'}
            </span>
          </div>
        </Tooltip>

        <div className={styles.navList}>
          {(appMode === 'health-checker' ? HEALTH_NAV_SECTIONS : ADMIN_NAV_SECTIONS).map((section, sIdx) => (
            <div key={section.label}>
              {sIdx > 0 && <hr className={styles.sectionDivider} />}
              {expanded && <div className={styles.sectionLabel}>{section.label}</div>}
              {section.items.filter((item) => !item.adminOnly || isAdmin).map(renderNavItem)}
            </div>
          ))}
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.userArea}>
            <div className={styles.userAvatar}>{sidebarUserInitial(sessionUser)}</div>
            {expanded && <span className={styles.userName}>{sidebarUserLabel(sessionUser)}</span>}
            <button
              type="button"
              className={styles.collapseBtn}
              onClick={toggleSidebar}
              aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {expanded ? <IconChevronLeft size={18} /> : <IconChevronRight size={18} />}
            </button>
          </div>
          {onSignOut && (
            <Tooltip label="Sign out" position="right" withArrow disabled={expanded}>
              <button type="button" className={styles.toggleBtn} onClick={() => onSignOut()} aria-label="Sign out">
                <IconLogout size={18} />
              </button>
            </Tooltip>
          )}
        </div>
      </nav>

      <main className={mainClass}>
        <div style={{ padding: 24, maxWidth: 1400 }}>{children}</div>
      </main>

      <nav className={styles.bottomTabs} aria-label="Mobile navigation">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activePage === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={[styles.tabItem, isActive && styles.tabItemActive].filter(Boolean).join(' ')}
              onClick={() => navigate(tab.key)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={22} stroke={isActive ? 2 : 1.5} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
