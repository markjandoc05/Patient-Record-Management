import React from 'react';
import { Users } from 'lucide-react';

interface LoginProps {
  branding: any;
  footer: any;
  onGoogleSignIn: () => Promise<void>;
  isAuthenticating: boolean;
  authError: string | null;
  successMessage: string | null;
  accountMissingProfile: boolean;
  pendingActivation?: boolean;
}

export default function Login({ 
  branding, 
  footer,
  onGoogleSignIn, 
  isAuthenticating, 
  authError,
  successMessage,
  accountMissingProfile,
  pendingActivation = false
}: LoginProps) {
  const versionAsset = (url: string) => {
    if (!url) return '';
    const version = branding.updatedAt || 0;
    return `${url}${url.includes('?') ? '&' : '?'}t=${version}`;
  };
  const loginLogoUrl = branding.loginPageLogoUrl || branding.appLogoUrl || '';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-center font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-md border border-slate-100 max-w-sm w-full space-y-6">
        <div className="flex flex-col items-center gap-4">
          {loginLogoUrl ? (
            <img 
              src={versionAsset(loginLogoUrl)}
              alt={branding.appName || "Logo"} 
              className="max-h-24 w-auto object-contain" 
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-white shrink-0 shadow-lg" style={{ backgroundColor: branding.primaryColor || '#0d9488' }}>
              <Users className="w-10 h-10" />
            </div>
          )}
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tighter">{branding.appName || 'Vine Management App'}</h1>
          {branding.companyName && branding.companyName !== branding.appName && <p className="-mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{branding.companyName}</p>}
          {(branding.supportEmail || branding.contactNumber) && <p className="-mt-2 text-xs text-slate-400">{branding.supportEmail || branding.contactNumber}</p>}
        </div>

        {/* Inline notification for errors or missing profile, but NOT for success (which is now in a modal) */}
        {(authError || accountMissingProfile) && (
          <div role={pendingActivation ? 'status' : 'alert'} className={`p-3 border rounded-xl text-xs text-left leading-relaxed ${pendingActivation ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-red-50 border-red-100 text-red-700'}`}>
            <p className="font-bold">{pendingActivation ? 'Awaiting administrator approval' : 'Notice'}</p>
            <p>{authError || "Your account is not yet configured. Please contact the administrator."}</p>
          </div>
        )}

        {/* Modal for success message */}
        {successMessage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm text-center">
              <h2 className="text-lg font-bold text-slate-900 mb-2">{pendingActivation ? 'Awaiting administrator approval' : 'Registration Successful'}</h2>
              <p className="text-sm text-slate-600 mb-6">{successMessage}</p>
              <button 
                onClick={() => window.location.reload()}
                className="w-full font-semibold px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        )}
        
        <button 
          disabled={isAuthenticating}
          className="w-full font-semibold px-6 py-2 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50" 
          style={{ backgroundColor: branding.primaryColor || '#0d9488' }}
          onClick={onGoogleSignIn}
        >
          {isAuthenticating ? 'Signing In...' : 'Sign In with Google'}
        </button>
        <p className="text-xs leading-relaxed text-slate-400">Use your authorized Google account to access the clinic workspace.</p>
      </div>
      <footer className="mt-5 max-w-md px-4 text-center text-[11px] leading-5 text-slate-400">
        {footer?.footerText && <p>{footer.footerText}</p>}
        {footer?.copyrightNotice && <p>{footer.copyrightNotice}</p>}
        {(footer?.privacyPolicyUrl || footer?.termsConditionsUrl) && (
          <p className="mt-1.5 space-x-3">
            {footer.privacyPolicyUrl && <a href={footer.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-500 hover:text-slate-800 hover:underline">Privacy policy</a>}
            {footer.termsConditionsUrl && <a href={footer.termsConditionsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-500 hover:text-slate-800 hover:underline">Terms &amp; conditions</a>}
          </p>
        )}
        {footer?.showDeveloperCredit && footer?.developerCreditText && (
          <p className="mt-1.5">
            {footer.developerCreditUrl ? <a href={footer.developerCreditUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-500 hover:text-slate-800 hover:underline">{footer.developerCreditText}</a> : footer.developerCreditText}
          </p>
        )}
      </footer>
    </div>
  );
}
