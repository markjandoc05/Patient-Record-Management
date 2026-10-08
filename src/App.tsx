import { publishPermissionProfile } from './permissionState';
import { canOpenView, permissionScopeKey } from './permissions';
import ServicesDashboard from './components/ServicesDashboard';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, type ComponentType } from 'react';
import { auth, db } from './platform';
import { signInWithGoogle, onAuthStateChanged, signOut } from './session';
import { collection, doc, getDoc, onSnapshot, invalidateProtectedData } from './dataClient';
import { handleDataError, OperationType } from './utils';
import Login from './components/Login';
import PatientDashboard from './components/PatientDashboard';
import BranchDashboard from './components/BranchDashboard';
import AdminSettings from './components/AdminSettings';
import UserSettings from './components/UserSettings';
import ProfileView from './components/ProfileView';
import VisitHistoryDashboard from './components/VisitHistoryDashboard';
import InsightsAnalyticsDashboard from './components/InsightsAnalyticsDashboard';
import AppointmentsDashboard from './components/AppointmentsDashboard';
import InventoryDashboard from './components/InventoryDashboard';
import AuditTrailDashboard from './components/AuditTrailDashboard';
import DeveloperDashboard, { DevTab } from './components/DeveloperDashboard';
import { RBAC, canAccessView, roleLabel, isSupportDeveloper, hasAdministrativeAccess } from './rbac';
import { recordLoginActivity } from './utils/loginActivityApi';
import { registerPendingGoogleAccount } from './utils/pendingActivationApi';
import { accountAccessMessage, PENDING_APPROVAL_MESSAGE } from './utils/userActivation';
import { Users, Settings, UserCircle, Calendar, Clock, Menu, X, Shield, PanelLeftClose, PanelLeftOpen, Cpu, Zap, Package, LayoutDashboard, MapPin, LogOut } from 'lucide-react';
import { TimezoneProvider } from './contexts/TimezoneContext';
import { setActiveTimezoneSettings } from './utils/timezone';
import { useWorkspaceOverview } from './hooks/useWorkspaceOverview';
import { workspaceAccessScope } from './utils/workspaceOverview';

const defaultBranding = {
  // Application Branding
  appName: 'Vine Management App',
  appShortName: 'Vine',
  appLogoUrl: '',
  faviconUrl: '',
  loginPageLogoUrl: '',
  browserTitle: 'Vine Management App',
  // Company Information
  companyName: 'Skin Clinic',
  companyAddress: '',
  contactNumber: '',
  supportEmail: '',
  websiteUrl: '',
  // Theme & Appearance
  primaryColor: '#0d9488', // default teal-600
  secondaryColor: '#0f766e', // default teal-700
  accentColor: '#14b8a6', // default teal-500
  darkMode: false,
  // Footer
  footerText: 'HIPAA Compliant Skin Clinic Patient Records System.',
  copyrightNotice: '© 2026 Skin Clinic Patient Records. All rights reserved.',
  privacyPolicyUrl: '',
  termsConditionsUrl: '',
  showDeveloperCredit: true,
  developerCreditText: 'Developed by AIPH.TECH',
  developerCreditUrl: 'https://aiph.tech'
};

const defaultTimezone = {
  timezone: 'Asia/Manila',
  displayName: '(UTC+08:00) Philippine Standard Time',
  format: '12h'
};

const normalizeBranding = (value: Record<string, any> | null | undefined) => {
  const raw = value || {};
  const appName = String(raw.appName || defaultBranding.appName).trim();
  return {
    ...defaultBranding,
    ...raw,
    appName,
    appShortName: String(raw.appShortName || appName || defaultBranding.appShortName).trim(),
    browserTitle: String(raw.browserTitle || appName).trim(),
    primaryColor: /^#[0-9a-f]{6}$/i.test(String(raw.primaryColor || '')) ? raw.primaryColor : defaultBranding.primaryColor,
    secondaryColor: /^#[0-9a-f]{6}$/i.test(String(raw.secondaryColor || '')) ? raw.secondaryColor : defaultBranding.secondaryColor,
    accentColor: /^#[0-9a-f]{6}$/i.test(String(raw.accentColor || '')) ? raw.accentColor : defaultBranding.accentColor,
  };
};

const approvedRoles = new Set(Object.keys(RBAC));

const pageTitles: Record<string, string> = {
  BranchDashboard: 'Overview',
  Records: 'Patients',
  Appointments: 'Appointments',
  VisitHistory: 'Visits',
  Inventory: 'Inventory',
  Services: 'Services',
  Insights: 'Insights',
  Settings: 'Settings',
  AuditTrail: 'Audit log',
  Profile: 'My profile',
  AccountSettings: 'Account settings',
  DeveloperTools: 'Developer tools',
};

type SidebarNavButtonProps = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  compact?: boolean;
};

function SidebarNavButton({ label, icon: Icon, active, collapsed, onClick, compact = false }: SidebarNavButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={`group/nav flex w-full items-center rounded-xl text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${
        compact ? 'min-h-9 text-xs' : 'min-h-11 text-sm'
      } ${
        collapsed ? 'gap-3 px-3 md:gap-0 md:justify-center md:px-0' : 'gap-3 px-3'
      } ${
        active
          ? 'bg-white/10 text-white font-semibold'
          : 'text-slate-400 hover:bg-white/[0.07] hover:text-white font-medium'
      }`}
    >
      <Icon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} shrink-0`} />
      <span className={`min-w-0 truncate ${collapsed ? 'md:hidden' : ''}`}>{label}</span>
    </button>
  );
}

export default function App() {
  const [protectedScopeGeneration, setProtectedScopeGeneration] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string|null>(null);
  const [userProfile, setUserProfileState] = useState<any>(null);
  const setUserProfile = (value: any) => { publishPermissionProfile(value); setUserProfileState(value); };
  const [loading, setLoading] = useState(true);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [activeView, setActiveView] = useState('Records');
  const [devTab, setDevTab] = useState<DevTab>('system_overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('vine-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [branding, setBranding] = useState<any>(() => normalizeBranding(defaultBranding));
  const [footer, setFooter] = useState<any>(null);
  const [timezone, setTimezone] = useState<any>(defaultTimezone);
  const [branches, setBranches] = useState<any[]>([]);
  const [branchRefreshError, setBranchRefreshError] = useState(false);
  const [settingsRefreshErrors, setSettingsRefreshErrors] = useState<Record<string, boolean>>({});
  const [activeBranchId, setActiveBranchId] = useState('');
  const recordedLoginActivityRef = useRef<string | null>(null);
  const accessScope = workspaceAccessScope(user?.uid, userProfile);
  const overview = useWorkspaceOverview(user?.uid, userProfile);

  useEffect(() => {
    try {
      window.localStorage.setItem('vine-sidebar-collapsed', String(isSidebarCollapsed));
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    // Suppress ResizeObserver loop errors
    const resizeObserverLoopErr = /^ResizeObserver loop completed with undelivered notifications.$/;
    const handler = (e: any) => {
      if (resizeObserverLoopErr.test(e.message || e.reason?.message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', handler);
    window.addEventListener('unhandledrejection', handler);

    // Initial Branding Subscription
    const unsubBranding = onSnapshot(doc(db, 'settings', 'branding'), (snapshot) => {
      setSettingsRefreshErrors(current => ({ ...current, branding: false }));
      if (snapshot.exists()) {
        setBranding(normalizeBranding(snapshot.data()));
      } else {
        setBranding(normalizeBranding(defaultBranding));
      }
      setBrandingLoaded(true);
    }, (err) => {
      console.error("Failed to load branding:", err);
      // Initial defaults already exist; a failed poll must not replace a
      // previously validated theme or maintenance setting.
      setSettingsRefreshErrors(current => ({ ...current, branding: true }));
      setBrandingLoaded(true);
      try {
        handleDataError(err, OperationType.GET, 'settings/branding', auth);
      } catch (e) {
        // Log custom error structure to support AI Studio platform detection
      }
    });

    // Footer Settings Subscription
    const unsubFooter = onSnapshot(doc(db, 'settings', 'footer'), (snapshot) => {
      setSettingsRefreshErrors(current => ({ ...current, footer: false }));
      if (snapshot.exists()) {
        setFooter(snapshot.data());
      } else {
        setFooter(null);
      }
    }, (err) => {
      // Permission denied is expected for non-support users
      if (err.code !== 'permission-denied') {
        console.error("Failed to load footer:", err);
      }
      setSettingsRefreshErrors(current => ({ ...current, footer: true }));
      if (err.code === 'permission-denied' || err.status === 401 || err.status === 403) setFooter(null);
    });

    // Initial Timezone Subscription
    const unsubTimezone = onSnapshot(doc(db, 'settings', 'timezone'), (snapshot) => {
      setSettingsRefreshErrors(current => ({ ...current, timezone: false }));
      if (snapshot.exists()) {
        const nextTimezone = { ...defaultTimezone, ...snapshot.data() };
        setActiveTimezoneSettings(nextTimezone);
        setTimezone(nextTimezone);
      } else {
        setActiveTimezoneSettings(defaultTimezone);
        setTimezone(defaultTimezone);
      }
    }, (err) => {
      console.error("Failed to load timezone:", err);
      setSettingsRefreshErrors(current => ({ ...current, timezone: true }));
    });

    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', handler);
      unsubBranding();
      unsubFooter();
      unsubTimezone();
    };
  }, []);

  const getBustedUrl = (url: string) => {
    if (!url) return '';
    const ts = branding.updatedAt || 0;
    return `${url}${url.includes('?') ? '&' : '?'}t=${ts}`;
  };

  const refreshBranding = async () => {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'branding'));
      if (docSnap.exists()) {
        setBranding(normalizeBranding(docSnap.data()));
      } else {
        setBranding(normalizeBranding(defaultBranding));
      }
    } catch (err) {
      console.error("Refresh branding failed:", err);
    }
  };

  useEffect(() => {
    if (!branding) return;

    const appName = String(branding.appName || defaultBranding.appName).trim();
    const shortName = String(branding.appShortName || appName).trim();
    document.title = String(branding.browserTitle || appName).trim();
    document.documentElement.dataset.appName = appName;

    // Update or remove the dynamic favicon so clearing the setting takes effect.
    let favicon: HTMLLinkElement | null = document.querySelector("link[data-dynamic-branding-favicon='true']") || document.querySelector("link[rel~='icon']");
    if (branding.faviconUrl) {
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.dataset.dynamicBrandingFavicon = 'true';
      favicon.href = getBustedUrl(branding.faviconUrl);
    } else if (favicon) {
      favicon.remove();
    }

    // Empty settings remove stale metadata rather than leaving old values behind.
    const updateMetaTag = (nm: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let tag = document.querySelector(`meta[${attr}='${nm}']`);
      if (!content?.trim()) {
        tag?.remove();
        return;
      }
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, nm);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    updateMetaTag('application-name', appName);
    updateMetaTag('apple-mobile-web-app-title', shortName);
    updateMetaTag('robots', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    updateMetaTag('googlebot', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    updateMetaTag('theme-color', String(branding.primaryColor || defaultBranding.primaryColor));

    // This is a private clinic tool. Remove any legacy search/social metadata
    // that may still be present from an older saved configuration or hot reload.
    [
      "meta[name='title']",
      "meta[name='description']",
      "meta[name='keywords']",
      "meta[property='og:title']",
      "meta[property='og:description']",
      "meta[property='og:image']",
    ].forEach(selector => document.querySelectorAll(selector).forEach(node => node.remove()));

    // Dynamically set CSS variables to primary, secondary, and accent colors
    const root = document.documentElement;
    root.style.setProperty('--primary-color', branding.primaryColor || '#0d9488');
    root.style.setProperty('--secondary-color', branding.secondaryColor || '#0f766e');
    root.style.setProperty('--accent-color', branding.accentColor || '#14b8a6');
    
  }, [branding]);

  const [authError, setAuthError] = useState<string | null>(() => new URLSearchParams(window.location.search).has('auth_error') ? 'Google sign-in failed. Please try again or contact an administrator.' : null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [accountMissingProfile, setAccountMissingProfile] = useState(false);
  const [pendingActivation, setPendingActivation] = useState(false);

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    setAccountMissingProfile(false);
    setPendingActivation(false);
    try {
        await signInWithGoogle();
    } catch (e: any) {
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
           console.log("Sign-in popup was closed or cancelled by the user.");
        } else {
           console.error("Authentication error:", e);
           setAuthError(e.message || "An error occurred during authentication.");
        }
    } finally {
        setIsAuthenticating(false);
    }
  };

  const registerSuccessfulLogin = async (userId: string) => {
    const sessionKey = `vine-login-activity:${userId}`;
    let alreadyRecorded = false;
    try {
      alreadyRecorded = window.sessionStorage.getItem(sessionKey) === 'recorded';
    } catch {
      // Activity recording remains available when browser storage is disabled.
    }
    if (recordedLoginActivityRef.current === userId || alreadyRecorded) return;
    recordedLoginActivityRef.current = userId;
    try {
      await recordLoginActivity();
      try {
        window.sessionStorage.setItem(sessionKey, 'recorded');
      } catch {
        // The in-memory guard still prevents duplicate records in this page.
      }
    } catch (error) {
      recordedLoginActivityRef.current = null;
      console.warn('Login activity could not be recorded', error);
    }
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      // This callback runs on session identity transitions, not module clicks or
      // same-user session polling. Do not expose a previous identity's profile.
      if (user) {
        setLoading(true);
        invalidateProtectedData();
        setUserRole(null);
        setUserProfile(null);
      }
      setUser(user);
      if (user) {
        const signedInWithGoogle = user.providerData.some(provider => provider.providerId === 'google.com');
        if (!signedInWithGoogle) {
          setAuthError('Google sign-in is required to access this application.');
          await signOut(auth);
          setUser(null);
          setLoading(false);
          return;
        }
        setActiveView('BranchDashboard');
        try {
          let retryCount = 0;
          let userDoc = null;
          
          while (retryCount < 3) {
            try {
              userDoc = await getDoc(doc(db, 'users', user.uid));
              break;
            } catch (e: any) {
              if (e.message?.includes('offline') && retryCount < 2) {
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                continue;
              }
              throw e;
            }
          }
          
          // A session may expire/change while the bootstrap read is in flight.
          if (auth.currentUser?.uid !== user.uid) return;
          if (userDoc && userDoc.exists()) {
             const data = userDoc.data();
             if (!data.active) {
                setPendingActivation(data.accountStatus === 'pending_activation' && !data.isArchived);
                setAuthError(accountAccessMessage(data));
                await signOut(auth);
                setUser(null);
             } else if (!approvedRoles.has(data.role)) {
                setAuthError("Your account has an invalid role configuration. Please contact the administrator.");
                await signOut(auth);
                setUser(null);
             } else {
                setUserRole(data.role);
                setUserProfile(data);
                void registerSuccessfulLogin(user.uid);
             }
          } else {
             // Every new account starts as a disabled Staff profile. Privileged
             // roles are assigned only by an approved administrator or trusted
             // Admin SDK tooling, never by browser-side email checks.
             await registerPendingGoogleAccount();
             setAccountMissingProfile(true);
             setPendingActivation(true);
             setSuccessMessage(PENDING_APPROVAL_MESSAGE);
             await signOut(auth);
             setUser(null);
          }
        } catch (e) {
          if (auth.currentUser?.uid !== user.uid) return;
          console.error("Error fetching user role", e);
          setAuthError('Could not restore workspace access. Please refresh to try again.');
        }
      } else {
        recordedLoginActivityRef.current = null;
        invalidateProtectedData();
        setUserRole(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
  }, []);

  const profileScopeRef = useRef('');
  const viewScope = JSON.stringify([user?.uid, userProfile?.role, userProfile?.active, userProfile?.assignedBranches || [], permissionScopeKey(userProfile), activeBranchId]);

  // Keep the signed-in user's role, approval status, name, and clinic access in
  // sync. Administrative changes now take effect without asking the user to
  // sign out or reload the app.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), snapshot => {
      if (!snapshot.exists()) { invalidateProtectedData(); setUserRole(null); setUserProfile(null); void signOut(auth); return; }
      const nextProfile = snapshot.data();
      if (!nextProfile.active) {
        invalidateProtectedData(); setUserRole(null); setUserProfile(null);
        setPendingActivation(nextProfile.accountStatus === 'pending_activation' && !nextProfile.isArchived);
        setAuthError(accountAccessMessage(nextProfile));
        void signOut(auth);
        return;
      }
      if (!approvedRoles.has(nextProfile.role)) {
        invalidateProtectedData(); setUserRole(null); setUserProfile(null);
        setAuthError('Your account has an invalid role configuration. Please contact an administrator.');
        void signOut(auth);
        return;
      }
      const scope = JSON.stringify([user.uid, nextProfile.role, nextProfile.active, nextProfile.assignedBranches || [], permissionScopeKey(nextProfile)]);
      publishPermissionProfile(nextProfile);
      if (profileScopeRef.current && profileScopeRef.current !== scope) invalidateProtectedData();
      profileScopeRef.current = scope;
      setUserProfile(nextProfile);
      setUserRole(nextProfile.role);
    }, profileError => {
      console.error('Failed to synchronize the active user profile:', profileError);
      if ((profileError as any).status === 401 || (profileError as any).status === 403) { invalidateProtectedData(); setUserProfile(null); setUserRole(null); void signOut(auth); }
    });
  }, [user]);

  useEffect(() => {
    if (!user || !userProfile) {
      setBranches([]);
      setBranchRefreshError(false);
      setActiveBranchId('');
      return;
    }

    return onSnapshot(collection(db, 'branches'), snapshot => {
      if (snapshot.invalidated) setProtectedScopeGeneration(snapshot.invalidationGeneration);
      setBranchRefreshError(false);
      setBranches(snapshot.docs.map(branch => ({ id: branch.id, ...branch.data() })));
    }, error => {
      console.error('Failed to load clinic branches:', error);
      setBranchRefreshError(true);
    });
  }, [user?.uid, accessScope]);

  const hasGlobalBranchAccess = hasAdministrativeAccess(userRole);
  const assignedBranchIds = new Set(Array.isArray(userProfile?.assignedBranches) ? userProfile.assignedBranches : []);
  const availableBranches = branches.filter(branch =>
    branch.status === 'Active' && (hasGlobalBranchAccess || assignedBranchIds.has(branch.id))
  );

  useEffect(() => {
    if (!user || !userProfile || branches.length === 0) return;
    const storageKey = `vine-active-branch:${user.uid}`;
    const savedBranchId = window.localStorage.getItem(storageKey) || '';
    const validBranchIds = new Set(availableBranches.map(branch => branch.id));
    const nextBranchId = savedBranchId === 'All' && hasGlobalBranchAccess
      ? 'All'
      : validBranchIds.has(savedBranchId)
        ? savedBranchId
        : validBranchIds.has(userProfile.defaultBranchId)
          ? userProfile.defaultBranchId
          : hasGlobalBranchAccess
            ? 'All'
            : availableBranches[0]?.id || '';

    setActiveBranchId(current => current && (current === 'All' ? hasGlobalBranchAccess : validBranchIds.has(current))
      ? current
      : nextBranchId);
  }, [branches, hasGlobalBranchAccess, user, userProfile]);

  const handleActiveBranchChange = (branchId: string) => {
    if (!user) return;
    const isAllowed = branchId === 'All'
      ? hasGlobalBranchAccess
      : availableBranches.some(branch => branch.id === branchId);
    if (!isAllowed) return;
    setActiveBranchId(branchId);
    window.localStorage.setItem(`vine-active-branch:${user.uid}`, branchId);
  };

  const navigateTo = (view: string) => {
    if (!canOpenView(userProfile, view)) return;
    setActiveView(view);
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    if (userProfile && !canOpenView(userProfile, activeView)) setActiveView(['BranchDashboard', 'Records', 'Appointments', 'VisitHistory', 'Services', 'Insights', 'Inventory', 'Settings', 'AuditTrail', 'DeveloperTools', 'Profile'].find(view => canOpenView(userProfile, view)) || 'NoAccess');
  }, [userProfile, activeView]);

  const currentPageTitle = pageTitles[activeView] || activeView;
  const effectiveFooter = {
    footerText: footer?.footerText ?? branding.footerText ?? defaultBranding.footerText,
    copyrightNotice: footer?.copyrightNotice ?? branding.copyrightNotice ?? defaultBranding.copyrightNotice,
    privacyPolicyUrl: footer?.privacyPolicyUrl ?? branding.privacyPolicyUrl ?? '',
    termsConditionsUrl: footer?.termsConditionsUrl ?? branding.termsConditionsUrl ?? '',
    showDeveloperCredit: footer?.showDeveloperCredit ?? branding.showDeveloperCredit ?? true,
    developerCreditText: footer?.developerCreditText ?? branding.developerCreditText ?? defaultBranding.developerCreditText,
    developerCreditUrl: footer?.developerCreditUrl ?? branding.developerCreditUrl ?? '',
  };

  if (loading || !brandingLoaded) return (
    <div role="status" className="flex flex-col gap-3 justify-center items-center h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
        <p className="text-sm text-slate-500">Loading workspace...</p>
    </div>
  );

  if (!user) return (
      <Login 
          branding={branding} 
          footer={effectiveFooter}
          onGoogleSignIn={handleSignIn} 
          isAuthenticating={isAuthenticating}
          authError={authError}
          successMessage={successMessage}
          accountMissingProfile={accountMissingProfile}
          pendingActivation={pendingActivation}
      />
   );

  if (!userRole || !userProfile) return (
    <div role="status" className="flex flex-col gap-3 justify-center items-center h-screen bg-white">
      <p className="text-sm text-slate-500">{authError || 'Loading workspace...'}</p>
      {authError && <button type="button" onClick={() => window.location.reload()} className="text-sm font-semibold text-teal-700">Retry workspace access</button>}
    </div>
  );

  if (branding.maintenanceMode && !hasAdministrativeAccess(userRole)) {
    return (
      <div className="flex flex-col justify-center items-center h-screen bg-slate-50 p-6 text-center select-none font-sans">
        <div className="w-16 h-16 bg-amber-50 border border-amber-100 rounded-full flex items-center justify-center mb-4 text-amber-600">
          <Shield className="w-8 h-8 animate-pulse" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">System Maintenance</h1>
        <p className="text-slate-500 max-w-md mt-2 text-sm leading-relaxed">
          {branding.appShortName || branding.appName} is undergoing technical systems upgrades. 
          Normal clinic administrative access is currently offline. Please check back shortly.
        </p>
        <button 
          onClick={() => signOut(auth)} 
          className="mt-6 px-5 py-2 bg-slate-800 text-white rounded-xl text-xs font-semibold hover:bg-slate-700 transition"
        >
          Sign Out of Account
        </button>
      </div>
    );
  }

  if (userProfile && !userProfile.active) return (
    <div className="flex flex-col justify-center items-center h-screen bg-slate-50 p-4 text-center">
      <h1 className="text-2xl font-bold mb-2 text-slate-900">Account Pending</h1>
      <p className="text-slate-600">Your account is awaiting approval by an administrator.</p>
    </div>
  );

  return (
    <TimezoneProvider timezone={timezone}>
      <div className="flex h-screen bg-[#f7f7f8] text-slate-900 overflow-hidden font-sans">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}
      
      <aside
        id="app-sidebar"
        aria-hidden={isSidebarCollapsed && !isMobileMenuOpen}
        inert={isSidebarCollapsed && !isMobileMenuOpen ? true : undefined}
        className={`group/sidebar ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 flex w-[280px]' : 'hidden md:flex'} ${isSidebarCollapsed ? 'md:w-0 md:border-r-0' : 'md:w-[272px]'} h-full flex-col shrink-0 z-50 bg-[#171717] text-slate-300 border-r border-white/[0.06] transition-[width,transform] duration-200 ease-out overflow-hidden`}
      >
        <div className="h-16 shrink-0 px-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
            {branding.appLogoUrl ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-white/10">
                <img
                  src={getBustedUrl(branding.appLogoUrl)}
                  alt=""
                  className="h-full w-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: branding.primaryColor || '#0d9488' }}>
                {(branding.appName || branding.appShortName || 'V').trim().charAt(0).toUpperCase()}
              </div>
            )}
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-white" title={branding.appName || branding.appShortName}>
              {branding.appName || branding.appShortName || 'Vine Management App'}
            </span>
          </div>

          <button
            type="button"
            aria-label="Close navigation"
            className="md:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-3">
          <nav aria-label="Main navigation" className="space-y-1">
            {canOpenView(userProfile, 'BranchDashboard') && (<SidebarNavButton label="Overview" icon={LayoutDashboard} active={activeView === 'BranchDashboard'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('BranchDashboard')} />)}
            {canOpenView(userProfile, 'Records') && (<SidebarNavButton label="Patients" icon={Users} active={activeView === 'Records'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Records')} />)}
            {canOpenView(userProfile, 'Appointments') && (<SidebarNavButton label="Appointments" icon={Clock} active={activeView === 'Appointments'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Appointments')} />)}
            {canOpenView(userProfile, 'VisitHistory') && (<SidebarNavButton label="Visits" icon={Calendar} active={activeView === 'VisitHistory'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('VisitHistory')} />)}

            {canOpenView(userProfile, 'Services') && (<SidebarNavButton label="Services" icon={Package} active={activeView === 'Services'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Services')} />)}

            {canOpenView(userProfile, 'Inventory') && (
              <SidebarNavButton label="Inventory" icon={Package} active={activeView === 'Inventory'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Inventory')} />
            )}

            {canOpenView(userProfile, 'Insights') && (<SidebarNavButton label="Insights" icon={Zap} active={activeView === 'Insights'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Insights')} />)}

            {(canOpenView(userProfile, 'Settings') || canOpenView(userProfile, 'AuditTrail')) && (
              <>
                {canOpenView(userProfile, 'Settings') && (<SidebarNavButton label="Settings" icon={Settings} active={activeView === 'Settings'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('Settings')} />)}
                {canOpenView(userProfile, 'AuditTrail') && (<SidebarNavButton label="Audit log" icon={Shield} active={activeView === 'AuditTrail'} collapsed={isSidebarCollapsed} onClick={() => navigateTo('AuditTrail')} />)}
              </>
            )}

            {canOpenView(userProfile, 'DeveloperTools') && (
              <div className="mt-4 pt-4 border-t border-white/[0.08] space-y-1">
                <span className={`px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.14em] block mb-2 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
                  Developer tools
                </span>
                <div className="space-y-1">
                  {[
                    { id: 'system_overview', label: 'System overview' },
                    { id: 'app_version', label: 'App version' },
                    { id: 'database_status', label: 'Database status' },
                    { id: 'storage_monitor', label: 'Storage monitor' },
                    { id: 'user_count', label: 'User count' },
                    { id: 'patient_count', label: 'Patient count' },
                    { id: 'appointment_count', label: 'Appointment count' },
                    { id: 'visit_count', label: 'Visit count' },
                    { id: 'audit_logs', label: 'Audit logs' },
                    { id: 'error_logs', label: 'Error logs' },
                    { id: 'refresh_settings', label: 'Refresh settings' },
                    { id: 'clear_cache', label: 'Clear cache' },
                    { id: 'maintenance_mode', label: 'Maintenance mode' },
                  ].map(item => (
                    <SidebarNavButton
                      key={item.id}
                      label={item.label}
                      icon={Cpu}
                      active={activeView === 'DeveloperTools' && devTab === item.id}
                      collapsed={isSidebarCollapsed}
                      compact
                      onClick={() => {
                        navigateTo('DeveloperTools');
                        setDevTab(item.id as DevTab);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </nav>
        </div>

        <div className="shrink-0 border-t border-white/[0.08] p-2">
          <button
            type="button"
            aria-label="Open my profile"
            title={isSidebarCollapsed ? 'My profile' : undefined}
            onClick={() => navigateTo('Profile')}
            className={`flex w-full items-center rounded-xl text-left text-white transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${isSidebarCollapsed ? 'gap-3 px-2 py-2 md:gap-0 md:justify-center md:px-0' : 'gap-3 px-3 py-2'}`}
          >
            <UserCircle className="w-8 h-8 shrink-0 text-slate-300" />
            <div className={`min-w-0 flex-1 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
              <p className="truncate text-xs font-semibold">{userProfile?.fullName || user.email}</p>
              <p className="mt-0.5 truncate text-[10px] capitalize text-slate-500">{roleLabel(userRole || '')}</p>
            </div>
          </button>
          <div className={`mt-1 grid grid-cols-2 gap-1 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            <button type="button" onClick={() => navigateTo('AccountSettings')} className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium text-slate-400 hover:bg-white/[0.07] hover:text-white">
              <Settings className="h-3.5 w-3.5" /> Settings
            </button>
            <button type="button" onClick={() => signOut(auth)} className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium text-slate-400 hover:bg-white/[0.07] hover:text-white">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {branding.maintenanceMode && (
          <div className="bg-amber-500 text-white text-[10px] sm:text-xs font-semibold px-4 py-2 flex items-center justify-between shadow-inner select-none shrink-0 border-b border-amber-600">
            <span className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 animate-pulse shrink-0" />
              <span>STATION DIAGNOSTICS: SYSTEMS MAINTENANCE IS CURRENTLY TRIGGERED PORT-WIDE</span>
            </span>
            <span className="bg-amber-600 px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider">BYPASS ACCESS ACTIVE</span>
          </div>
        )}
        <header className="h-16 bg-white/90 backdrop-blur-xl border-b border-slate-200/80 px-3 sm:px-5 lg:px-7 flex items-center justify-between gap-3 shrink-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-label="Open navigation"
              aria-controls="app-sidebar"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden h-10 w-10 shrink-0 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-controls="app-sidebar"
              title={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              onClick={() => setIsSidebarCollapsed(value => !value)}
              className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
            </button>
            <h1 className="truncate text-[17px] sm:text-lg font-semibold tracking-[-0.015em] text-slate-950">{currentPageTitle}</h1>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="relative flex min-w-0 items-center">
              <MapPin className="pointer-events-none absolute left-3 hidden h-4 w-4 text-slate-400 sm:block" />
              <select
                aria-label="Active clinic branch"
                value={activeBranchId}
                onChange={event => handleActiveBranchChange(event.target.value)}
                disabled={availableBranches.length === 0 && !hasGlobalBranchAccess}
                className="min-w-0 max-w-[150px] sm:max-w-[220px] rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-slate-700 outline-none transition hover:bg-slate-100 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 disabled:text-slate-400 sm:pl-9 sm:text-sm"
              >
                {!activeBranchId && <option value="">No branch assigned</option>}
                {hasGlobalBranchAccess && <option value="All">All branches</option>}
                {availableBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}
              </select>
            </div>
            {(branding.appLogoUrl || branding.companyName) && (
              <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
                {branding.appLogoUrl && <img src={getBustedUrl(branding.appLogoUrl)} alt="" className="h-8 w-auto max-w-20 object-contain" referrerPolicy="no-referrer" />}
                {branding.companyName && <span className="max-w-40 truncate text-xs font-semibold text-slate-500" title={branding.companyName}>{branding.companyName}</span>}
              </div>
            )}
          </div>
        </header>
        
        <div className="flex-grow overflow-auto flex flex-col">
            {Object.values(settingsRefreshErrors).some(Boolean) && <p role="status" className="px-4 pt-3 text-sm text-amber-700">Workspace settings could not refresh. Retrying automatically.</p>}
            {branchRefreshError && <p role="status" className="px-4 pt-3 text-sm text-amber-700">Clinic branches could not refresh. Retrying automatically.</p>}
            <div key={`${viewScope}:${protectedScopeGeneration}`} className="flex-1 p-4 sm:p-6 lg:p-8">
                {activeView === 'BranchDashboard' && canOpenView(userProfile, 'BranchDashboard') && <BranchDashboard userProfile={userProfile} activeBranchId={activeBranchId} branches={availableBranches} onNavigate={navigateTo} overview={overview} />}
                {activeView === 'Records' && canOpenView(userProfile, 'Records') && <PatientDashboard db={db} user={user} role={userRole} userProfile={userProfile} activeBranchId={activeBranchId} />}
                {activeView === 'Appointments' && canOpenView(userProfile, 'Appointments') && <AppointmentsDashboard role={userRole} userProfile={userProfile} activeBranchId={activeBranchId} />}
                {activeView === 'VisitHistory' && canOpenView(userProfile, 'VisitHistory') && <VisitHistoryDashboard db={db} role={userRole} userProfile={userProfile} activeBranchId={activeBranchId} />}
                {activeView === 'Services' && canOpenView(userProfile, 'Services') && <ServicesDashboard userProfile={userProfile} activeBranchId={activeBranchId} />}
                {activeView === 'Insights' && canOpenView(userProfile, 'Insights') && <InsightsAnalyticsDashboard userProfile={userProfile} activeBranchId={activeBranchId} />}
                {activeView === 'Inventory' && canOpenView(userProfile, 'Inventory') && <InventoryDashboard userProfile={userProfile} />}
                {activeView === 'Inventory' && !canOpenView(userProfile, 'Inventory') && (
                  <div className="p-8 text-center"><p className="text-slate-500 font-medium">Access Denied: Inventory controls are restricted to administrators.</p></div>
                )}
                {activeView === 'Profile' && <ProfileView db={db} />}
                {activeView === 'AccountSettings' && <UserSettings db={db} />}
                {activeView === 'Settings' && canOpenView(userProfile, 'Settings') && <AdminSettings db={db} userRole={userRole} branding={branding} timezone={timezone} footer={footer} userProfile={userProfile} />}
                {activeView === 'Settings' && !canOpenView(userProfile, 'Settings') && (
                    <div className="p-8"><p>Access Denied: Administrative controls are restricted to administrators.</p></div>
                )}
                {activeView === 'DeveloperTools' && canOpenView(userProfile, 'DeveloperTools') && (
                  <DeveloperDashboard 
                    currentTab={devTab} 
                    onTabChange={setDevTab} 
                    branding={branding} 
                    onRefreshBranding={refreshBranding}
                  />
                )}
                {activeView === 'AuditTrail' && canOpenView(userProfile, 'AuditTrail') && <AuditTrailDashboard role={userRole} />}
            </div>

            {/* Dynamic White-Label Footer */}
            <footer className="mt-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-slate-200 bg-white px-4 py-2.5 text-[11px] text-slate-400">
              <div className="font-medium text-slate-500">
                {effectiveFooter.footerText}
              </div>
              {(branding.companyName || branding.companyAddress || branding.contactNumber || branding.supportEmail || branding.websiteUrl) && (
                <address className="flex max-w-4xl flex-wrap items-center justify-center gap-x-2 not-italic text-[10px] text-slate-400">
                  {branding.companyName && <span className="font-semibold text-slate-500">{branding.companyName}</span>}
                  {branding.companyAddress && <span>{branding.companyAddress}</span>}
                  {branding.contactNumber && <a href={`tel:${String(branding.contactNumber).replace(/[^+\d]/g, '')}`} className="hover:text-teal-700 hover:underline">{branding.contactNumber}</a>}
                  {branding.supportEmail && <a href={`mailto:${branding.supportEmail}`} className="hover:text-teal-700 hover:underline">{branding.supportEmail}</a>}
                  {branding.websiteUrl && <a href={branding.websiteUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-600 hover:underline">Website</a>}
                </address>
              )}
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <span>
                  {effectiveFooter.copyrightNotice}
                  {effectiveFooter.showDeveloperCredit !== false && (
                    <>
                      {" · by "}
                      {effectiveFooter.developerCreditUrl ? (
                        <a href={effectiveFooter.developerCreditUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-semibold">
                          {String(effectiveFooter.developerCreditText || '').replace(/^developed by\s+/i, '')}
                        </a>
                      ) : (
                        <span>{String(effectiveFooter.developerCreditText || '').replace(/^developed by\s+/i, '')}</span>
                      )}
                    </>
                  )}
                </span>
                <div className="flex gap-2 items-center">
                  {effectiveFooter.privacyPolicyUrl && (
                    <a href={effectiveFooter.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-medium">Privacy Policy</a>
                  )}
                  {effectiveFooter.privacyPolicyUrl && effectiveFooter.termsConditionsUrl && <span className="text-slate-200">|</span>}
                  {effectiveFooter.termsConditionsUrl && (
                    <a href={effectiveFooter.termsConditionsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-medium">Terms & Conditions</a>
                  )}
                </div>
              </div>
            </footer>
        </div>
      </main>
    </div>
  </TimezoneProvider>
);
}
