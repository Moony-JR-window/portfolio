// lib/online.ts
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours (instead of 2 minutes)
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes - how often client sends heartbeat

// Use global to persist across API routes
declare global {
  // eslint-disable-next-line no-var
  var __onlineUsers: Map<string, { 
    timestamp: number;
    ip: string;
    browser: string;
    browserVersion: string;
    userAgent: string;
    firstSeen: number; // Track when user first appeared
    lastHeartbeat: number; // Track last heartbeat
  }> | undefined;
}

const onlineUsers = global.__onlineUsers || new Map();
if (!global.__onlineUsers) {
  global.__onlineUsers = onlineUsers;
  console.log('🆕 Created new onlineUsers Map');
}

let lastCleanupTime = 0;

interface UserInfo {
  timestamp: number;
  ip: string;
  browser: string;
  browserVersion: string;
  userAgent: string;
  firstSeen: number;
  lastHeartbeat: number;
}

export function generateUserKey(ip: string, browser: string, browserVersion: string) {
  return `${ip}|${browser}|${browserVersion}`;
}

export function heartbeat(sessionId: string, ip: string, userAgent: string) {
  if (!sessionId) {
    console.error("❌ Invalid sessionId");
    return 0;
  }
  
  // Parse browser info from user agent
  const browserInfo = parseUserAgent(userAgent);
  const userKey = generateUserKey(ip, browserInfo.name, browserInfo.version);
  
  const now = Date.now();
  const existingUser = onlineUsers.get(userKey);
  
  // If user exists, update timestamp
  if (existingUser) {
    console.log(`♻️ Updating existing user: ${userKey}`);
    existingUser.timestamp = now;
    existingUser.lastHeartbeat = now;
    onlineUsers.set(userKey, existingUser);
  } else {
    // New user
    console.log(`🆕 New user: ${userKey}`);
    onlineUsers.set(userKey, {
      timestamp: now,
      ip,
      browser: browserInfo.name,
      browserVersion: browserInfo.version,
      userAgent,
      firstSeen: now,
      lastHeartbeat: now
    });
  }
  
  console.log(`💓 Heartbeat from ${userKey}`);
  console.log(`   IP: ${ip}, Browser: ${browserInfo.name} ${browserInfo.version}`);
  console.log(`👥 Current unique users: ${onlineUsers.size}`);
  console.log(`📋 Users: ${Array.from(onlineUsers.keys()).join(', ')}`);
  
  return onlineUsers.size;
}

function parseUserAgent(userAgent: string) {
  let browser = 'Unknown';
  let version = 'Unknown';
  
  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg') && !userAgent.includes('OPR') && !userAgent.includes('Brave')) {
    browser = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome') && !userAgent.includes('Brave')) {
    browser = 'Safari';
    const match = userAgent.match(/Version\/(\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
    const match = userAgent.match(/Edg\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('OPR') || userAgent.includes('Opera')) {
    browser = 'Opera';
    const match = userAgent.match(/OPR\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  } else if (userAgent.includes('Brave')) {
    browser = 'Brave';
    const match = userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    version = match ? match[1] : 'Unknown';
  }
  
  return { name: browser, version };
}

export function getOnlineCount(shouldCleanup: boolean = true) {
  const now = Date.now();
  
  console.log(`📊 Getting online count...`);
  console.log(`Before cleanup: ${onlineUsers.size} users`);
  
  // Log all users with their ages
  if (onlineUsers.size > 0) {
    for (const [key, info] of onlineUsers.entries()) {
      const ageSeconds = Math.round((now - info.timestamp) / 1000);
      const ageHours = (ageSeconds / 3600).toFixed(1);
      const firstSeenHours = ((now - info.firstSeen) / 3600000).toFixed(1);
      console.log(`  User: ${key}`);
      console.log(`    Last seen: ${ageHours}h ago`);
      console.log(`    First seen: ${firstSeenHours}h ago`);
      console.log(`    Browser: ${info.browser} ${info.browserVersion}`);
    }
  } else {
    console.log('⚠️ No users found in Map');
  }
  
  // Only cleanup if requested AND at least 1 hour has passed since last cleanup
  if (shouldCleanup && onlineUsers.size > 0 && (now - lastCleanupTime > 3600000)) { // Cleanup every hour
    lastCleanupTime = now;
    let cleanedCount = 0;
    
    for (const [key, info] of onlineUsers.entries()) {
      const age = now - info.timestamp;
      if (age > CLEANUP_INTERVAL) {
        const ageHours = (age / 3600000).toFixed(1);
        console.log(`🗑️ Removing stale user: ${key} (inactive for ${ageHours}h)`);
        onlineUsers.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} stale users`);
    }
  } else if (shouldCleanup) {
    const timeSinceCleanup = Math.round((now - lastCleanupTime) / 60000);
    console.log(`⏭️ Skipping cleanup (last cleanup ${timeSinceCleanup} min ago, need 60 min)`);
  }
  
  console.log(`After cleanup: ${onlineUsers.size} users`);
  console.log(`✅ Returning: ${onlineUsers.size}`);
  return onlineUsers.size;
}

export function getUsersDebug() {
  const now = Date.now();
  return Array.from(onlineUsers.entries()).map(([key, info]) => ({
    key,
    ip: info.ip,
    browser: info.browser,
    browserVersion: info.browserVersion,
    firstSeen: new Date(info.firstSeen).toISOString(),
    lastSeen: new Date(info.timestamp).toISOString(),
    lastHeartbeat: new Date(info.lastHeartbeat).toISOString(),
    age: Math.round((now - info.timestamp) / 1000) + 's',
    ageHours: ((now - info.timestamp) / 3600000).toFixed(1) + 'h'
  }));
}

// For testing - add a test user
export function addTestUser(ip: string = '127.0.0.1', browser: string = 'Chrome', version: string = '120.0.0.0') {
  const userKey = generateUserKey(ip, browser, version);
  const now = Date.now();
  onlineUsers.set(userKey, {
    timestamp: now,
    ip,
    browser,
    browserVersion: version,
    userAgent: `${browser}/${version}`,
    firstSeen: now,
    lastHeartbeat: now
  });
  console.log(`🧪 Added test user: ${userKey}`);
  return userKey;
}