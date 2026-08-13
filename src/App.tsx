/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { auth, db } from './firebase';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithEmailAndPassword, sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './utils';
import Login from './components/Login';
import PatientDashboard from './components/PatientDashboard';
import AdminSettings from './components/AdminSettings';
import UserSettings from './components/UserSettings';
import ProfileView from './components/ProfileView';
import VisitHistoryDashboard from './components/VisitHistoryDashboard';
import InsightsAnalyticsDashboard from './components/InsightsAnalyticsDashboard';
import AppointmentsDashboard from './components/AppointmentsDashboard';
import InventoryDashboard from './components/InventoryDashboard';
import AuditTrailDashboard from './components/AuditTrailDashboard';
import DeveloperDashboard, { DevTab } from './components/DeveloperDashboard';
import { Users, Settings, UserCircle, Calendar, Clock, Menu, X, Shield, PanelLeft, Cpu, Zap, Package } from 'lucide-react';
import { TimezoneProvider } from './contexts/TimezoneContext';

const defaultBranding = {
  // Application Branding
  appName: 'Vine Management App',
  appShortName: 'Vine',
  appLogoUrl: '',
  faviconUrl: '',
  loginPageLogoUrl: '',
  browserTitle: 'Vine Management App',
  // SEO & Metadata
  metaTitle: 'Vine Management App',
  metaDescription: 'Manage clinical records and appointments securely.',
  metaKeywords: 'clinic, records, patient management, HIPAA',
  ogTitle: 'Vine Management App',
  ogDescription: 'Manage clinical records and appointments securely.',
  ogImageUrl: '',
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
  developerCreditText: 'Developed by AIPH Tech',
  developerCreditUrl: 'https://aiph.tech'
};

const defaultTimezone = {
  timezone: 'Asia/Manila',
  displayName: '(UTC+08:00) Philippine Standard Time',
  format: '12h'
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string|null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [activeView, setActiveView] = useState('Records');
  const [devTab, setDevTab] = useState<DevTab>('system_overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [branding, setBranding] = useState<any>(defaultBranding);
  const [footer, setFooter] = useState<any>(null);
  const [timezone, setTimezone] = useState<any>(defaultTimezone);

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
      if (snapshot.exists()) {
        setBranding({ ...defaultBranding, ...snapshot.data() });
      } else {
        setBranding(defaultBranding);
      }
      setBrandingLoaded(true);
    }, (err) => {
      console.error("Failed to load branding:", err);
      setBranding(defaultBranding);
      setBrandingLoaded(true);
      try {
        handleFirestoreError(err, OperationType.GET, 'settings/branding', auth);
      } catch (e) {
        // Log custom error structure to support AI Studio platform detection
      }
    });

    // Footer Settings Subscription
    const unsubFooter = onSnapshot(doc(db, 'settings', 'footer'), (snapshot) => {
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
      setFooter(null);
    });

    // Initial Timezone Subscription
    const unsubTimezone = onSnapshot(doc(db, 'settings', 'timezone'), (snapshot) => {
      if (snapshot.exists()) {
        setTimezone({ ...defaultTimezone, ...snapshot.data() });
      } else {
        setTimezone(defaultTimezone);
      }
    }, (err) => {
      console.error("Failed to load timezone:", err);
      setTimezone(defaultTimezone);
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
    const ts = branding.updatedAt || Date.now();
    return `${url}${url.includes('?') ? '&' : '?'}t=${ts}`;
  };

  const refreshBranding = async () => {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'branding'));
      if (docSnap.exists()) {
        setBranding({ ...defaultBranding, ...docSnap.data() });
      } else {
        setBranding(defaultBranding);
      }
    } catch (err) {
      console.error("Refresh branding failed:", err);
    }
  };

  useEffect(() => {
    if (!branding) return;

    // Set browser tab title
    if (branding.browserTitle) {
      document.title = branding.browserTitle;
    }

    // Set Favicon
    if (branding.faviconUrl) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = getBustedUrl(branding.faviconUrl);
    }

    // Helper to update/create meta tags
    const updateMetaTag = (nm: string, content: string, isProperty = false) => {
      if (!content) return;
      const attr = isProperty ? 'property' : 'name';
      let tag = document.querySelector(`meta[${attr}='${nm}']`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, nm);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    if (branding.metaTitle) updateMetaTag('title', branding.metaTitle);
    if (branding.metaDescription) updateMetaTag('description', branding.metaDescription);
    if (branding.metaKeywords) updateMetaTag('keywords', branding.metaKeywords);
    if (branding.ogTitle) updateMetaTag('og:title', branding.ogTitle, true);
    if (branding.ogDescription) updateMetaTag('og:description', branding.ogDescription, true);
    if (branding.ogImageUrl) updateMetaTag('og:image', branding.ogImageUrl, true);

    // Dynamically set CSS variables to primary, secondary, and accent colors
    const root = document.documentElement;
    root.style.setProperty('--primary-color', branding.primaryColor || '#0d9488');
    root.style.setProperty('--secondary-color', branding.secondaryColor || '#0f766e');
    root.style.setProperty('--accent-color', branding.accentColor || '#14b8a6');
    
    if (branding.darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [branding]);

  const [authError, setAuthError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [accountMissingProfile, setAccountMissingProfile] = useState(false);

  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    setAccountMissingProfile(false);
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
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

  const handleEmailSignIn = async (email: string, password: string) => {
    setIsAuthenticating(true);
    setAuthError(null);
    setAccountMissingProfile(false);
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
        console.error("Email sign-in error:", e);
        setAuthError(e.message || "Invalid email or password.");
    } finally {
        setIsAuthenticating(false);
    }
  };

  const handleEmailSignUp = async (email: string, password: string, fullName: string) => {
    setIsAuthenticating(true);
    setAuthError(null);
    setSuccessMessage(null);
    setAccountMissingProfile(false);
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, 'users', userCredential.user.uid), {
           email,
           fullName,
           role: 'staff',
           active: false,
           assignedBranches: [],
           assignedBranchNames: [],
           defaultBranchId: null,
           defaultBranchName: null
        });
        setSuccessMessage("Account created successfully! Please wait for administrator approval.");
    } catch (e: any) {
        console.error("Email sign-up error:", e);
        setAuthError(e.message || "Failed to sign up.");
    } finally {
        setIsAuthenticating(false);
    }
  };

  const handleForgotPassword = async (email: string) => {
    setAuthError(null);
    try {
        await sendPasswordResetEmail(auth, email);
        alert("Password reset email sent. Please check your inbox.");
    } catch (e: any) {
        console.error("Password reset error:", e);
        setAuthError(e.message || "Failed to send password reset email.");
    }
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        setActiveView('Records');
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
          
          if (userDoc && userDoc.exists()) {
             const data = userDoc.data();
             if (user.email === 'markjandoc@gmail.com') {
                if (data.role !== 'admin' || !data.active) {
                   await setDoc(doc(db, 'users', user.uid), { ...data, role: 'admin', active: true }, { merge: true });
                }
                setUserRole('admin');
                setUserProfile({ ...data, role: 'admin', active: true });
             } else if (user.email === 'hello@aiph.tech') {
                if (data.role !== 'support_developer' || !data.active) {
                   await setDoc(doc(db, 'users', user.uid), { ...data, role: 'support_developer', active: true }, { merge: true });
                }
                setUserRole('support_developer');
                setUserProfile({ ...data, role: 'support_developer', active: true });
             } else if (!data.active) {
                setAuthError("Your account is awaiting approval by an administrator. Please contact the administrator or check back later.");
                await signOut(auth);
                setUser(null);
             } else {
                setUserRole(data.role);
                setUserProfile(data);
             }
          } else {
             // If user document does not exist, create it for special emails
             if (user.email === 'markjandoc@gmail.com') {
                await setDoc(doc(db, 'users', user.uid), {
                   email: user.email,
                   fullName: user.displayName || 'Admin',
                   role: 'admin',
                   active: true
                });
                setUserRole('admin');
                setUserProfile({ email: user.email, fullName: user.displayName || 'Admin', role: 'admin', active: true });
             } else if (user.email === 'hello@aiph.tech') {
                await setDoc(doc(db, 'users', user.uid), {
                   email: user.email,
                   fullName: user.displayName || 'Support',
                   role: 'support_developer',
                   active: true
                });
                setUserRole('support_developer');
                setUserProfile({ email: user.email, fullName: user.displayName || 'Support', role: 'support_developer', active: true });
             } else {
                 // Support auto-registration for regular Google sign-ins, requiring approval in App
                 const newProfile = {
                    email: user.email || '',
                    fullName: user.displayName || (user.email ? user.email.split('@')[0] : 'Google User'),
                    role: 'staff',
                    active: false,
                    assignedBranches: [],
                    assignedBranchNames: [],
                    defaultBranchId: null,
                    defaultBranchName: null
                 };
                 await setDoc(doc(db, 'users', user.uid), newProfile);
                 setSuccessMessage("Account created successfully! Your registration is subject for approval in the App.");
                 await signOut(auth);
                 setUser(null);
             }
          }
        } catch (e) {
          console.error("Error fetching user role", e);
        }
      } else {
        setUserRole(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
  }, []);

  if (loading || !brandingLoaded) return (
    <div className="flex justify-center items-center h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
    </div>
  );

  if (!user) return (
      <Login 
          branding={branding} 
          onGoogleSignIn={handleSignIn} 
          onEmailSignIn={handleEmailSignIn}
          onEmailSignUp={handleEmailSignUp}
          onForgotPassword={handleForgotPassword}
          isAuthenticating={isAuthenticating}
          authError={authError}
          successMessage={successMessage}
          accountMissingProfile={accountMissingProfile}
      />
   );

  if (branding.maintenanceMode && userRole !== 'admin' && userRole !== 'support_developer') {
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
      <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}
      
      <aside 
        className={`${isMobileMenuOpen ? 'fixed w-64' : 'hidden md:flex'} ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} h-full bg-slate-800 text-slate-300 border-r border-slate-700 flex-col shrink-0 z-50 transition-all duration-300 overflow-hidden`}>

        <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-3 h-16 shrink-0">
          <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center w-full' : ''}`}>
            {branding.appLogoUrl ? (
              <img 
                src={getBustedUrl(branding.appLogoUrl)} 
                alt={branding.appShortName || branding.appName} 
                className="w-8 h-8 rounded-lg object-contain shrink-0" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: branding.primaryColor || '#0d9488' }}>
                <Users className="w-5 h-5 text-white" />
              </div>
            )}
            {!isSidebarCollapsed && (
              <span className="font-bold text-white tracking-tight text-lg whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]" title={branding.appShortName || branding.appName}>
                {branding.appShortName || branding.appName || 'Lumina Skin'}
              </span>
            )}
          </div>
          <button className="md:hidden" onClick={() => setIsMobileMenuOpen(false)}>
            <X className='w-6 h-6 text-slate-400' />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden w-full">
            <nav className="p-3 space-y-1">
              <button 
                title="Patient Records" 
                onClick={() => setActiveView('Records')} 
                className={`flex items-center gap-3 px-3 py-2 ${activeView === 'Records' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                style={activeView === 'Records' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
              >
                <Users className="w-5 h-5 shrink-0" />
                {!isSidebarCollapsed && <span className="whitespace-nowrap">Patient Records</span>}
              </button>
              
              <button 
                title="Appointments" 
                onClick={() => setActiveView('Appointments')} 
                className={`flex items-center gap-3 px-3 py-2 ${activeView === 'Appointments' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                style={activeView === 'Appointments' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
              >
                <Clock className="w-5 h-5 shrink-0" />
                {!isSidebarCollapsed && <span className="whitespace-nowrap">Appointments</span>}
              </button>
              
              <button 
                title="Visit History" 
                onClick={() => setActiveView('VisitHistory')} 
                className={`flex items-center gap-3 px-3 py-2 ${activeView === 'VisitHistory' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                style={activeView === 'VisitHistory' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
              >
                <Calendar className="w-5 h-5 shrink-0" />
                {!isSidebarCollapsed && <span className="whitespace-nowrap">Visit History</span>}
              </button>
              
              {(userRole === 'admin' || userRole === 'support_developer') && (
                <button 
                  title="Inventory" 
                  onClick={() => setActiveView('Inventory')} 
                  className={`flex items-center gap-3 px-3 py-2 ${activeView === 'Inventory' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                  style={activeView === 'Inventory' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
                >
                  <Package className="w-5 h-5 shrink-0" />
                  {!isSidebarCollapsed && <span className="whitespace-nowrap">Inventory</span>}
                </button>
              )}
              
              <button 
                title="Insights & Analytics" 
                onClick={() => setActiveView('Insights')} 
                className={`flex items-center gap-3 px-3 py-2 ${activeView === 'Insights' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                style={activeView === 'Insights' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
              >
                <Zap className="w-5 h-5 shrink-0" />
                {!isSidebarCollapsed && <span className="whitespace-nowrap">Insights & Analytics</span>}
              </button>
              
              {(userRole === 'admin' || userRole === 'support_developer' || userRole === 'manager') && (
                <>
                  <button 
                    title="App Setting" 
                    onClick={() => setActiveView('Settings')} 
                    className={`flex items-center gap-3 px-3 py-2 ${activeView === 'Settings' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                    style={activeView === 'Settings' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
                  >
                    <Settings className="w-5 h-5 shrink-0" />
                    {!isSidebarCollapsed && <span className="whitespace-nowrap">App Setting</span>}
                  </button>
                  
                  <button 
                    title="Audit Trail" 
                    onClick={() => setActiveView('AuditTrail')} 
                    className={`flex items-center gap-3 px-3 py-2 ${activeView === 'AuditTrail' ? 'text-white font-semibold' : 'text-slate-400 hover:bg-slate-700 hover:text-white'} rounded-md font-medium w-full`}
                    style={activeView === 'AuditTrail' ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' } : undefined}
                  >
                    <Shield className="w-5 h-5 shrink-0" />
                    {!isSidebarCollapsed && <span className="whitespace-nowrap">Audit Trail</span>}
                  </button>
                </>
              )}

              {userRole === 'support_developer' && (
                <div className="mt-4 pt-4 border-t border-slate-700 space-y-1">
                  {!isSidebarCollapsed && (
                    <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2">
                      Developer Tools
                    </span>
                  )}
                  <div className="space-y-1 max-h-[220px] overflow-y-auto px-1">
                    {[
                      { id: 'system_overview', label: 'System Overview' },
                      { id: 'app_version', label: 'App Version' },
                      { id: 'firebase_status', label: 'Firebase Status' },
                      { id: 'storage_monitor', label: 'Storage Monitor' },
                      { id: 'user_count', label: 'User Count' },
                      { id: 'patient_count', label: 'Patient Count' },
                      { id: 'appointment_count', label: 'Appointment Count' },
                      { id: 'visit_count', label: 'Visit Count' },
                      { id: 'audit_logs', label: 'Audit Logs' },
                      { id: 'error_logs', label: 'Error Logs' },
                      { id: 'refresh_settings', label: 'Refresh Settings' },
                      { id: 'clear_cache', label: 'Clear Cache' },
                      { id: 'maintenance_mode', label: 'Maintenance Mode' },
                    ].map(item => (
                      <button
                        key={item.id}
                        title={item.label}
                        onClick={() => {
                          setActiveView('DeveloperTools');
                          setDevTab(item.id as DevTab);
                        }}
                        className={`flex items-center gap-3 px-3 py-1.5 text-xs rounded-md w-full transition ${
                          activeView === 'DeveloperTools' && devTab === item.id
                            ? 'text-white font-semibold'
                            : 'text-slate-400 hover:bg-slate-700 hover:text-white font-medium'
                        }`}
                        style={
                          activeView === 'DeveloperTools' && devTab === item.id
                            ? { backgroundColor: branding.primaryColor || '#0d9488', color: '#fff' }
                            : undefined
                        }
                      >
                        <Cpu className="w-3.5 h-3.5 shrink-0" />
                        {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </nav>
        </div>

        <div className="border-t border-slate-700">
           {!isSidebarCollapsed && (
             <div className="p-4">
               <div className="flex items-center gap-3 px-3 py-2 bg-slate-700 rounded-lg text-white">
                <button onClick={() => setActiveView('Profile')}><UserCircle className="w-8 h-8" /></button>
                <div className="overflow-hidden space-y-1">
                    <p className="text-xs font-bold truncate">{userProfile?.fullName || user.email}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{userRole}</p>
                    <div className="flex gap-2">
                        <button className="text-[10px] text-slate-400 uppercase hover:text-white" onClick={() => setActiveView('AccountSettings')}>Settings</button>
                        <span className="text-slate-600">|</span>
                        <button className="text-[10px] text-slate-400 uppercase hover:text-white" onClick={() => signOut(auth)}>Sign Out</button>
                    </div>
                </div>
               </div>
             </div>
           )}
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
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
                <button className="md:hidden" onClick={() => setIsMobileMenuOpen(true)}>
                    <Menu className="w-6 h-6 text-slate-600" />
                </button>
                <button className="hidden md:block" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
                    <PanelLeft className="w-6 h-6 text-slate-600" />
                </button>
                <h1 className="text-xl font-bold text-slate-900">{activeView === 'Records' ? 'Patient Dashboard' : activeView === 'AccountSettings' ? 'Account Settings' : activeView === 'AuditTrail' ? 'Security Audit Trail' : activeView}</h1>
            </div>
            
            {/* Header Clinic Identity Branding */}
            <div className="flex items-center gap-3">
              {branding.appLogoUrl && (
                <img 
                  src={getBustedUrl(branding.appLogoUrl)} 
                  alt={branding.companyName || "Logo"} 
                  className="h-8 w-auto object-contain hidden sm:block" 
                  referrerPolicy="no-referrer"
                />
              )}
              {branding.companyName && (
                <span className="text-sm font-semibold text-slate-500 hidden sm:block">{branding.companyName}</span>
              )}
            </div>
        </header>
        
        <div className="flex-grow overflow-auto flex flex-col">
            <div className="flex-1 p-4 md:p-8">
                {activeView === 'Records' && <PatientDashboard db={db} user={user} role={userRole} />}
                {activeView === 'Appointments' && <AppointmentsDashboard role={userRole} />}
                {activeView === 'VisitHistory' && <VisitHistoryDashboard db={db} role={userRole} />}
                {activeView === 'Insights' && <InsightsAnalyticsDashboard />}
                {activeView === 'Inventory' && (userRole === 'admin' || userRole === 'support_developer') && <InventoryDashboard userProfile={userProfile} />}
                {activeView === 'Inventory' && userRole !== 'admin' && userRole !== 'support_developer' && (
                  <div className="p-8 text-center"><p className="text-slate-500 font-medium">Access Denied: Inventory controls are restricted to administrators.</p></div>
                )}
                {activeView === 'Profile' && <ProfileView db={db} />}
                {activeView === 'AccountSettings' && <UserSettings db={db} />}
                {activeView === 'Settings' && (userRole === 'admin' || userRole === 'support_developer') && <AdminSettings db={db} userRole={userRole} branding={branding} timezone={timezone} footer={footer} userProfile={userProfile} />}
                {activeView === 'Settings' && userRole !== 'admin' && userRole !== 'support_developer' && (
                    <div className="p-8"><p>Access Denied: Administrative controls are restricted to administrators.</p></div>
                )}
                {activeView === 'DeveloperTools' && userRole === 'support_developer' && (
                  <DeveloperDashboard 
                    currentTab={devTab} 
                    onTabChange={setDevTab} 
                    branding={branding} 
                    onRefreshBranding={refreshBranding} 
                    userRole={userRole}
                  />
                )}
                {activeView === 'AuditTrail' && <AuditTrailDashboard role={userRole} />}
            </div>

            {/* Dynamic White-Label Footer */}
            <footer className="mt-auto px-4 py-4 bg-white border-t border-slate-200 text-xs text-slate-400 flex flex-col items-center justify-center text-center gap-2">
              <div>
                {footer?.footerText || branding.footerText || "HIPAA Compliant Skin Clinic Patient Records System."}
              </div>
              <div className="flex flex-col items-center gap-2">
                <span>
                  {footer?.copyrightNotice || branding.copyrightNotice || "© 2026 Skin Clinic Patient Records. All rights reserved."}
                  {(footer?.showDeveloperCredit !== false && branding.showDeveloperCredit !== false) && (
                    <>
                      {" Developed by "}
                      { (footer?.developerCreditUrl || branding.developerCreditUrl) ? (
                        <a href={footer?.developerCreditUrl || branding.developerCreditUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-semibold">
                          {footer?.developerCreditText || branding.developerCreditText || "AIPH Tech"}
                        </a>
                      ) : (
                        <span>{footer?.developerCreditText || branding.developerCreditText || "AIPH Tech"}</span>
                      )}
                      {"."}
                    </>
                  )}
                </span>
                <div className="flex gap-2 justify-center items-center">
                  {(footer?.privacyPolicyUrl || branding.privacyPolicyUrl) && (
                    <a href={footer?.privacyPolicyUrl || branding.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-medium">Privacy Policy</a>
                  )}
                  {(footer?.privacyPolicyUrl || branding.privacyPolicyUrl) && (footer?.termsConditionsUrl || branding.termsConditionsUrl) && <span className="text-slate-200">|</span>}
                  {(footer?.termsConditionsUrl || branding.termsConditionsUrl) && (
                    <a href={footer?.termsConditionsUrl || branding.termsConditionsUrl} target="_blank" rel="noopener noreferrer" className="hover:underline text-teal-600 font-medium">Terms & Conditions</a>
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
