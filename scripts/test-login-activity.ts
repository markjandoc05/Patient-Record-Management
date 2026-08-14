import assert from 'node:assert/strict';
import { describeLoginUserAgent, shouldRecordLoginActivity } from '../src/loginActivityPolicy';

assert.equal(shouldRecordLoginActivity('staff'), true);
assert.equal(shouldRecordLoginActivity('support_developer'), false);
assert.equal(shouldRecordLoginActivity(null), false);
assert.deepEqual(describeLoginUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1'), {
  browser: 'Safari', operatingSystem: 'iOS', deviceType: 'Mobile'
});
assert.deepEqual(describeLoginUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), {
  browser: 'Google Chrome', operatingSystem: 'Windows', deviceType: 'Desktop'
});

console.log('Login activity policy tests passed.');
