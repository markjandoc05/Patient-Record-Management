import React, { useState } from 'react';
import { Users, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

interface LoginProps {
  branding: any;
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string, fullName: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  isAuthenticating: boolean;
  authError: string | null;
  successMessage: string | null;
  accountMissingProfile: boolean;
}

export default function Login({ 
  branding, 
  onGoogleSignIn, 
  onEmailSignIn, 
  onEmailSignUp,
  onForgotPassword, 
  isAuthenticating, 
  authError,
  successMessage,
  accountMissingProfile
}: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const versionAsset = (url: string) => {
    if (!url) return '';
    const version = branding.updatedAt || 0;
    return `${url}${url.includes('?') ? '&' : '?'}t=${version}`;
  };
  const loginLogoUrl = branding.loginPageLogoUrl || branding.appLogoUrl || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email || !password || (isRegistering && !fullName)) {
      setFormError('Please fill in all fields.');
      return;
    }
    if (isRegistering) {
        await onEmailSignUp(email, password, fullName);
    } else {
        await onEmailSignIn(email, password);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setFormError('Please enter your email address to reset your password.');
      return;
    }
    await onForgotPassword(email);
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen bg-slate-50 p-4 text-center font-sans">
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
        {(authError || formError || accountMissingProfile) && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs text-left leading-relaxed animate-fade-in/70">
            <p className="font-bold">Notice:</p>
            <p>{authError || formError || "Your account is not yet configured. Please contact the administrator."}</p>
          </div>
        )}

        {/* Modal for success message */}
        {successMessage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm text-center">
              <h2 className="text-lg font-bold text-slate-900 mb-2">Registration Successful</h2>
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

        <div className="relative">
             <div className="absolute inset-0 flex items-center">
               <div className="w-full border-t border-slate-200" />
             </div>
             <div className="relative flex justify-center text-xs text-slate-400">
               <span className="bg-white px-2">Or continue with email</span>
             </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          {isRegistering && (
             <div className="space-y-1">
               <label className="text-xs font-semibold text-slate-700">Full Name</label>
               <input 
                 type="text" 
                 value={fullName}
                 onChange={(e) => setFullName(e.target.value)}
                 className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
                 placeholder="John Doe"
               />
             </div>
           )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
                placeholder="name@email.com"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input 
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
                placeholder="••••••••"
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button 
            type="submit"
            disabled={isAuthenticating}
            className="w-full font-semibold px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 text-sm"
          >
            {isAuthenticating ? 'Processing...' : isRegistering ? 'Register' : 'Login'}
          </button>
        </form>

        <button 
            onClick={() => setIsRegistering(!isRegistering)}
            className="text-xs text-slate-600 font-semibold hover:underline w-full"
        >
            {isRegistering ? "Already have an account? Login" : "Need an account? Register"}
        </button>

        {!isRegistering && (
           <button 
             onClick={handleForgotPassword}
             className="text-xs text-teal-600 font-semibold hover:underline w-full"
             style={{ color: branding.primaryColor || '#0d9488' }}
           >
             Forgot Password?
           </button>
        )}
      </div>
    </div>
  );
}
