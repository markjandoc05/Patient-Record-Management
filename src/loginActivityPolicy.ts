export function shouldRecordLoginActivity(role: unknown) {
  return typeof role === 'string' && role !== 'support_developer';
}

export function describeLoginUserAgent(userAgent: string) {
  const ua = userAgent || '';
  const deviceType = /ipad|tablet/i.test(ua)
    ? 'Tablet'
    : /mobi|iphone|android/i.test(ua)
      ? 'Mobile'
      : 'Desktop';
  const browser = /edg\//i.test(ua)
    ? 'Microsoft Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua) || /crios\//i.test(ua)
        ? 'Google Chrome'
        : /firefox\//i.test(ua) || /fxios\//i.test(ua)
          ? 'Mozilla Firefox'
          : /safari\//i.test(ua)
            ? 'Safari'
            : 'Other browser';
  const operatingSystem = /windows nt/i.test(ua)
    ? 'Windows'
    : /android/i.test(ua)
      ? 'Android'
      : /iphone|ipad|ipod/i.test(ua)
        ? 'iOS'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : 'Other OS';

  return { browser, operatingSystem, deviceType };
}
