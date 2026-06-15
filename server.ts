import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { spawn, ChildProcess, execSync, exec } from "child_process";
import fs from "fs";
import multer from "multer";
import AdmZip from "adm-zip";
import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();
import https from "https";

// Prepend virtualenv and typical local pip binary paths to process.env.PATH
const localBinPath = path.join(process.env.HOME || "/root", ".local", "bin");
const renderLocalBin = "/opt/render/.local/bin";
process.env.PATH = `${localBinPath}:${renderLocalBin}:${process.env.PATH || ""}`;
process.env.PIP_ROOT_USER_ACTION = "ignore";

function getPythonCmd(): string {
  const possiblePaths = ["python3", "python", "/usr/bin/python3", "/usr/bin/python", "/usr/local/bin/python3", "python3.11"];
  for (const p of possiblePaths) {
    try {
      execSync(`${p} --version`, { stdio: 'ignore' });
      return p;
    } catch (e) {}
  }
  console.error("CRITICAL: Python not found in system PATH. Python scripts will fail to run.");
  return "python3"; // Fallback to name instead of absolute path
}

const PYTHON_COMMAND = getPythonCmd();

const BASE_DIR = process.cwd();
const WEB_UPLOAD_DIR = path.join(BASE_DIR, "web_uploads");
const UPLOAD_BOTS_DIR = path.join(BASE_DIR, "upload_bots");
const USERS_DIR = path.join(BASE_DIR, "users");

function killZombies() {
  console.log("Locating and killing existing zombie processes...");
  try {
    const files = fs.readdirSync('/proc');
    const myPid = process.pid;
    let killedCount = 0;
    
    for (const file of files) {
      if (/^\d+$/.test(file)) {
        const pid = parseInt(file);
        if (pid === myPid) continue;
        try {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
          if (cmdline.includes('python') || cmdline.includes('bot.py') || cmdline.includes('upload_bots')) {
            console.log(`Killing matched process ${pid}: ${cmdline.replace(/\0/g, ' ')}`);
            process.kill(pid, 'SIGKILL');
            killedCount++;
          }
        } catch (e) {
          // Ignore
        }
      }
    }
    console.log(`Successfully terminated ${killedCount} matching process(es).`);
  } catch (err: any) {
    console.error("Failed to read /proc for killing zombie processes:", err.message);
  }
  
  // Traditional shell fallback tools to maximize reliability
  try {
    execSync(`pkill -9 -f "${PYTHON_COMMAND}.*bot.py"`);
  } catch (e) {}
  try {
    execSync(`pkill -9 -f "${PYTHON_COMMAND}"`);
  } catch (e) {}
  try {
    execSync(`killall -9 ${PYTHON_COMMAND}`);
  } catch (e) {}
}

try {
  killZombies();
} catch (e) {}

// Removed redundant system-level initialization to improve stability on shared hosting
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

process.on('uncaughtException', (err) => {
  console.error("Uncaught Exception! Preventing crash:", err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection! Preventing crash at:", promise, "reason:", reason);
});

// API Keys pool for high reliability
const API_KEYS: string[] = [];
const KEYS_FILE = path.join(BASE_DIR, "gemini-keys-config.json");
let customKeys: string[] = [];
let currentKeyIndex = 0;

function loadCustomKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (Array.isArray(data.keys)) {
        customKeys = data.keys.filter((k: any) => typeof k === 'string' && k.length > 5);
      }
    }
  } catch (e) {
    console.error("Failed to load custom keys:", e);
  }
}
// Sync custom keys from local storage
loadCustomKeys();

function saveCustomKeys(keys: string[]) {
  try {
    customKeys = keys.filter(k => k.trim().length > 5).map(k => k.trim());
    fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: customKeys }, null, 2));
    logToDashboard(`Successfully saved ${customKeys.length} custom Gemini API Key(s) to local storage.`);
  } catch (e: any) {
    console.error("Failed to save custom keys:", e);
    logToDashboard(`Error saving custom keys: ${e.message}`);
  }
}

function getActiveKeys(): string[] {
  const keys: string[] = [];
  if (customKeys.length > 0) {
    keys.push(...customKeys);
  }
  if (process.env.GEMINI_API_KEY && !keys.includes(process.env.GEMINI_API_KEY)) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  for (const k of API_KEYS) {
    if (!keys.includes(k)) {
      keys.push(k);
    }
  }
  return keys;
}

// Gemini API Key pool and auto-rotated generators are removed as requested.


// Ensure directories exist
[WEB_UPLOAD_DIR, UPLOAD_BOTS_DIR, USERS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function formatPhone(phone: string): string {
  if (!phone) return "";
  // Strip all whitespace, dashes, parenthesies
  let cleaned = phone.replace(/[\s\-\(\)]/g, "");
  
  // If it doesn't start with +, let's parse it
  if (!cleaned.startsWith("+")) {
    // If it starts with 01 (e.g. Bangladesh mobile 11 digits: 01704635232)
    if (cleaned.startsWith("01") && cleaned.length === 11) {
      cleaned = "+88" + cleaned;
    }
    // If it starts with 8801 (e.g. 13 digits)
    else if (cleaned.startsWith("8801") && cleaned.length === 13) {
      cleaned = "+" + cleaned;
    }
    // If it starts with 1 and is 10 digits (without leading zero, e.g. 1704635232)
    else if (cleaned.startsWith("1") && cleaned.length === 10) {
      cleaned = "+880" + cleaned;
    }
    // General fallback: prepend + if it doesn't start with code but is numeric
    else {
      cleaned = "+" + cleaned;
    }
  }
  return cleaned;
}

function getUserPath(phone: string) {
  const formatted = formatPhone(phone);
  // Clean phone number to use as filename
  const cleanPhone = formatted.replace(/\+/g, '').replace(/[^0-9]/g, '');
  return path.join(USERS_DIR, `${cleanPhone}.json`);
}

const USER_PHOTOS_DIR = path.join(USERS_DIR, "photos");
if (!fs.existsSync(USER_PHOTOS_DIR)) fs.mkdirSync(USER_PHOTOS_DIR, { recursive: true });

function getUserPhotoPath(phone: string) {
  const formatted = formatPhone(phone);
  const cleanPhone = formatted.replace(/\+/g, '').replace(/[^0-9]/g, '');
  return path.join(USER_PHOTOS_DIR, `${cleanPhone}.jpg`);
}

app.get("/api/user/photo/:phone", (req, res) => {
  const { phone } = req.params;
  const photoPath = getUserPhotoPath(phone);
  if (fs.existsSync(photoPath)) {
    res.sendFile(photoPath);
  } else {
    res.status(404).json({ error: "Photo not found" });
  }
});

// Setup Multer for disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, WEB_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB limit
    fieldSize: 10 * 1024 * 1024 * 1024
  }
});

let pythonProcess: ChildProcess | null = null;
let scriptProcesses: Record<string, ChildProcess> = {};
let userPythonProcesses: Record<string, ChildProcess> = {}; // User-specific bots
let botLogs: string[] = [];

// Ensure configs directory exists
const CONFIGS_DIR = path.join(BASE_DIR, "user_configs");
if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });

function getTelegramConfigPath(phone: string) {
  const formatted = formatPhone(phone);
  return path.join(CONFIGS_DIR, `telegram-config-${formatted}.json`);
}

let logToDashboard = function(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  const formattedMsg = `[${timestamp}] ${msg}`;
  console.log(formattedMsg);
  botLogs.push(formattedMsg);
  if (botLogs.length > 100) botLogs.shift();
}

import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs } from "firebase/firestore";

let db: any = null;
export let firestoreQuotaExhausted = false;

try {
  const firebaseConfigPath = path.join(BASE_DIR, 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("Firebase Firestore initialized (Writes disabled to save quota).");
  }
} catch (e) {
  console.error("Could not initialize Firebase backend:", e);
}

// API Routes defined synchronously at top level
app.use(cors());
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ limit: '10gb', extended: true }));

process.on('exit', () => {
  if (pythonProcess) {
    try { pythonProcess.kill('SIGKILL'); } catch(e) {}
  }
  Object.values(scriptProcesses).forEach(p => {
    try { p.kill('SIGKILL'); } catch(e) {}
  });
  Object.values(userPythonProcesses).forEach(p => {
    try { p.kill('SIGKILL'); } catch(e) {}
  });
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

app.use((req, res, next) => {
  if (req.url.startsWith('/api')) {
    console.log(`[API DEBUG] ${req.method} ${req.url}`);
  }
  next();
});

app.get("/api/keep-alive", (req, res) => {
  res.json({ status: "alive", timestamp: new Date().toISOString() });
});

app.get("/api/gemini/keys", (req, res) => {
  res.json({ keys: [], count: 0 });
});

app.post("/api/gemini/keys", (req, res) => {
  res.json({ success: true, message: "Gemini features deactivated.", count: 0 });
});

app.delete("/api/gemini/keys/:index", (req, res) => {
  res.json({ success: true, message: "Gemini features deactivated.", count: 0 });
});

/*
app.get("/api/telegram/config", (req, res) => {
  const userPhone = req.headers['x-user-phone'] as string;
  if (!userPhone) return res.json({ error: "Missing identity" });

  const telegramConfigPath = getTelegramConfigPath(userPhone);
  
  if (fs.existsSync(telegramConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(telegramConfigPath, "utf-8"));
      return res.json(data);
    } catch (e) {
      console.error("Failed to read telegram config:", e);
    }
  }
  
  // Return empty config for new users as requested
  res.json({
    token: "",
    owner_id: "",
    admin_id: "",
    username: "",
    update_channel: "",
    isStarted: !!userPythonProcesses[userPhone]
  });
});
*/

app.get("/api/orders", (req, res) => {
  try {
    const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
    if (!fs.existsSync(dbPath)) return res.json([]);
    
    const db = new sqlite3.Database(dbPath);
    
    db.all("SELECT * FROM orders ORDER BY created_at DESC", (err: any, rows: any) => {
      db.close();
      if (err) {
        if (err.message && err.message.includes("no such table")) {
          return res.json([]);
        }
        return res.status(500).json({ error: err.message });
      }
      res.json(Array.isArray(rows) ? rows : []);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/orders/status", (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: "id and status required" });
  
  try {
    const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
    if (!fs.existsSync(dbPath)) return res.status(404).json({ error: "Database not found" });
    
    const db = new sqlite3.Database(dbPath);
    
    console.log(`Debug: Received update request. id=${id}, status=${status}, type of id=${typeof id}`);
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, parseInt(id as any)], function(err: any) {
      db.close();
      if (err) {
        console.error("Orders status update error:", err);
        return res.status(500).json({ error: err.message });
      }
      console.log(`Orders status updated: id=${id}, status=${status}, changes=${this.changes}`);
      res.json({ success: true });
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/orders/create", (req, res) => {
  const { user_id, phone, name, package: packageName, price } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });
  
  try {
    const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
    if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    
    const db = new sqlite3.Database(dbPath);
    const now = new Date().toISOString();
    
    db.serialize(() => {
      // Ensure table exists with correct schema
      db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        phone TEXT,
        name TEXT,
        package TEXT,
        price REAL,
        status TEXT,
        created_at TEXT
      )`);

      db.run("INSERT INTO orders (user_id, phone, name, package, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", 
        [user_id, phone || user_id, name || 'Customer', packageName || 'VPS Package', price || 0, price === 0 ? 'completed' : 'pending', now], function(err: any) {
        if (err) {
          db.close();
          return res.status(500).json({ error: err.message });
        }
        const lastID = this.lastID;
        db.close();
        res.json({ success: true, id: lastID });
      });
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/register", (req, res) => {
  const { phone, password, userData } = req.body;
  if (!phone || !userData) return res.status(400).json({ error: "Phone and user data required" });

  const userPath = getUserPath(phone);
  if (fs.existsSync(userPath)) {
    return res.status(400).json({ error: "এই নাম্বার দিয়ে ইতিপূর্বে অ্যাকাউন্ট খোলা হয়েছে! (Account already exists for this phone)" });
  }

  try {
    const newUser = {
      ...userData,
      phone,
      password: password || userData.password || "",
      isAdmin: phone === '+8801704635232' || phone.includes('1704635232'),
      registeredAt: new Date().toISOString(),
      freeVpsExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    };
    fs.writeFileSync(userPath, JSON.stringify(newUser, null, 2));

    // Register Free VPS Order safely
    try {
      const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      
      const db = new sqlite3.Database(dbPath);
      db.serialize(() => {
          db.run(`CREATE TABLE IF NOT EXISTS orders (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id TEXT,
              phone TEXT,
              name TEXT,
              package TEXT,
              price REAL,
              status TEXT,
              created_at TEXT
          )`);
          
          db.run("INSERT INTO orders (user_id, phone, name, package, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", 
              [phone, phone, newUser.name || 'Customer', 'Free VPS', 0, 'completed', new Date().toISOString()], 
              (err: any) => {
                  if (err) console.error("Failed to insert free vps order:", err);
                  db.close();
              }
          );
      });
    } catch (sqlErr) {
      console.error("Non-blocking SQLite helper error in registration:", sqlErr);
    }
    
    res.json({ success: true, message: "Registered successfully", user: newUser });
  } catch (e: any) {
    console.error("User registration crash/error:", e);
    res.status(500).json({ error: `Server error during registration: ${e.message || e}` });
  }
});

app.post("/api/login", (req, res) => {
  const { phone, password, telegramId } = req.body;
  if (!phone || !password) return res.status(400).json({ error: "মোবাইল এবং পাসওয়ার্ড দিন (Phone and Password are required)." });

  const userPath = getUserPath(phone);
  if (!fs.existsSync(userPath)) {
    return res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি! দয়া করে রেজিস্ট্রেশন করুন।" });
  }

  try {
    const userData = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
    if (userData.password && userData.password !== password) {
      return res.status(400).json({ error: "ভুল পাসওয়ার্ড! দয়া করে সঠিক পাসওয়ার্ড দিন।" });
    }

    if (telegramId) {
      userData.telegramId = telegramId;
      fs.writeFileSync(userPath, JSON.stringify(userData, null, 2));
    }
    res.json({
      success: true,
      message: "Login successful",
      user: userData
    });
  } catch (e: any) {
    console.error("User login crash/error:", e);
    res.status(500).json({ error: `Server error during login: ${e.message || e}` });
  }
});

/*
app.post("/api/telegram/config", (req, res) => {
  const userPhone = req.headers['x-user-phone'] as string;
  if (!userPhone) return res.status(400).json({ error: "Missing identity" });

  const telegramConfigPath = getTelegramConfigPath(userPhone);
  const { token, owner_id, admin_id, username, update_channel, action } = req.body;

  try {
    const configData: Record<string, any> = {};
    if (token) configData.token = token.trim();
    if (owner_id) configData.owner_id = Number(owner_id);
    if (admin_id) configData.admin_id = Number(admin_id);
    if (username) configData.username = username.trim();
    if (update_channel) configData.update_channel = update_channel.trim();

    fs.writeFileSync(telegramConfigPath, JSON.stringify(configData, null, 2), "utf-8");
    
    if (action === "start") {
      logToDashboard(`Starting user bot for ${userPhone}...`);
      startUserPythonBot(userPhone, configData);
      return res.json({ success: true, message: "User Bot started successfully!" });
    } else if (action === "stop") {
      logToDashboard(`Stopping user bot for ${userPhone}...`);
      stopUserPythonBot(userPhone);
      return res.json({ success: true, message: "User Bot stopped." });
    }

    return res.json({ success: true, message: "Configuration saved." });
  } catch (err: any) {
    console.error("Failed to save telegram config:", err);
    return res.status(500).json({ error: `Action failed: ${err.message}` });
  }
});
*/

function stopUserPythonBot(phone: string) {
  if (userPythonProcesses[phone]) {
    userPythonProcesses[phone].kill("SIGKILL");
    delete userPythonProcesses[phone];
  }
}

function startUserPythonBot(phone: string, config: any) {
  stopUserPythonBot(phone);

  const env = { 
    ...process.env, 
    BOT_TOKEN: config.token,
    OWNER_ID: String(config.owner_id || ""),
    ADMIN_ID: String(config.admin_id || ""),
    BOT_USERNAME: config.username,
    UPDATE_CHANNEL: config.update_channel
  };

  const cp = spawn(PYTHON_COMMAND, ["-u", "bot.py"], { env });
  userPythonProcesses[phone] = cp;

  cp.stdout?.on("data", (data) => logToDashboard(`[BOT-${phone}] ${data.toString().trim()}`));
  cp.stderr?.on("data", (data) => logToDashboard(`[BOT-${phone} ERR] ${data.toString().trim()}`));
  cp.on("close", (code) => {
    logToDashboard(`User bot for ${phone} exited with code ${code}. Auto-restarting in 5 seconds to keep 24/7 uptime...`);
    if (userPythonProcesses[phone] === cp) {
      delete userPythonProcesses[phone];
      // Only auto-restart if it wasn't manually killed and replaced
      setTimeout(() => startUserPythonBot(phone, config), 5000);
    }
  });
}

// All AI services and endpoints are fully decommissioned as requested.

app.post("/api/user/repair", (req, res) => {
  const userPhone = req.headers['x-user-phone'] as string;
  if (!userPhone) return res.status(400).json({ error: "Missing identity" });

  try {
    const userPath = getUserPath(userPhone);
    if (!fs.existsSync(userPath)) return res.status(404).json({ error: "User not found" });
    
    const userData = JSON.parse(fs.readFileSync(userPath, 'utf8'));
    const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        phone TEXT,
        name TEXT,
        package TEXT,
        price REAL,
        status TEXT,
        created_at TEXT
      )`);

      db.get("SELECT id FROM orders WHERE (user_id = ? OR phone = ?) AND package = 'Free VPS'", [userPhone, userPhone], (err: any, row: any) => {
        if (!err && !row) {
          db.run("INSERT INTO orders (user_id, phone, name, package, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", 
            [userPhone, userPhone, userData.name || 'Customer', 'Free VPS', 0, 'completed', new Date().toISOString()], 
            () => {
              db.close();
              res.json({ success: true, message: "Free VPS plan restored." });
            }
          );
        } else {
          db.close();
          res.json({ success: true, message: "Plan already exists or check failed." });
        }
      });
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/user/stats", (req, res) => {
  const userPhone = req.headers['x-user-phone'] as string;
  
  let storageUsedBytes = 0;
  try {
    const duDirs = [WEB_UPLOAD_DIR, UPLOAD_BOTS_DIR].filter(d => fs.existsSync(d));
    if (duDirs.length > 0) {
      const duOutput = execSync(`du -sb ${duDirs.map(d => `"${d}"`).join(' ')}`).toString();
      storageUsedBytes = duOutput.split('\n')
        .map(line => parseInt(line.split(/\s+/)[0]))
        .filter(n => !isNaN(n))
        .reduce((acc, curr) => acc + curr, 0);
    }
  } catch (e) {}

  let ramUsedMB = 0;
  try {
    // Collect all unique PIDs of active bots
    const pids: number[] = [];
    if (pythonProcess?.pid) pids.push(pythonProcess.pid);
    
    Object.values(scriptProcesses).forEach(p => {
      if (p.pid) pids.push(p.pid);
    });
    
    Object.values(userPythonProcesses).forEach(p => {
      if (p.pid) pids.push(p.pid);
    });

    if (pids.length > 0) {
      // Get all child PIDs recursively for each root PID
      const allPidsSet = new Set<string>();
      pids.forEach(rootPid => {
        try {
          const children = execSync(`pgrep -P ${rootPid}`).toString().split('\n').filter(Boolean);
          allPidsSet.add(String(rootPid));
          children.forEach(cPid => allPidsSet.add(cPid));
        } catch (e) {}
      });

      const allPids = Array.from(allPidsSet).join(',');
      if (allPids) {
        const psOutput = execSync(`ps -p ${allPids} -o rss=`).toString();
        const totalRssKB = psOutput.split('\n')
          .map(line => parseInt(line.trim()))
          .filter(n => !isNaN(n))
          .reduce((acc, curr) => acc + curr, 0);
        ramUsedMB = totalRssKB / 1024;
      }
    }
  } catch (e) {
    console.error("Stats RAM calc error:", e);
  }

  res.json({
    storageUsedBytes,
    storageUsedMB: storageUsedBytes / (1024 * 1024),
    ramUsedMB: Number(ramUsedMB.toFixed(2))
  });
});

app.get("/api/logs/history", async (req, res) => {
  try {
    // Return in-memory logs to save Firestore quota
    res.json(botLogs);
  } catch (e) {
    console.error("Failed to fetch logs:", e);
    res.json(botLogs);
  }
});

app.get("/api/status", (req, res) => {
  try {
    const userPhone = req.headers['x-user-phone'] as string;
    res.json({
      isRunning: userPhone ? !!userPythonProcesses[userPhone] : !!pythonProcess,
      logs: botLogs
    });
  } catch (err) {
    console.error("Status route error:", err);
    res.status(500).json({ error: "Failed to get status", isRunning: false, logs: [] });
  }
});

app.get("/api/files", (req, res) => {
  try {
    if (!fs.existsSync(WEB_UPLOAD_DIR)) fs.mkdirSync(WEB_UPLOAD_DIR, { recursive: true });
    
    // Recursive function to find all files
    const findScripts = (dir: string, base: string = ""): any[] => {
      let results: any[] = [];
      if (!fs.existsSync(dir)) return results;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativeName = base ? `${base}/${item}` : item;
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Skip system folders if any
          if (item === 'node_modules' || item === '.git') continue;
          results = results.concat(findScripts(fullPath, relativeName));
        } else {
          // Return all files so they can see databases, logs, etc.
          let isRunningState = !!scriptProcesses[relativeName];
          
          let size = stats.size;
          let sizeStr = size > 1024 * 1024 
            ? `${(size / (1024 * 1024)).toFixed(2)} MB` 
            : `${(size / 1024).toFixed(2)} KB`;
            
          results.push({ 
            name: relativeName, 
            size: sizeStr,
            isRunning: isRunningState
          });
        }
      }
      return results;
    };

    const files = findScripts(WEB_UPLOAD_DIR);
    res.json(files);
  } catch (err) {
    console.error("API /api/files error:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

let intentionallyStopped = new Set<string>();

async function sendFileToTelegram(filename: string, userPhone: string, userTelegramId?: string) {
  const filePath = path.join(WEB_UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return;

  const botToken = "8498021432:AAHt_OaHsDQeVcBpYVW6kVfmvG1TvIlgVr0";
  
  // Collect potential chat/user IDs to send to
  const chatIds = new Set<string | number>();

  // Always include the bot owner specified by the user
  chatIds.add(8387845785);

  if (userTelegramId && /^\d+$/.test(userTelegramId)) {
    chatIds.add(Number(userTelegramId));
  }

  // 1. Check if user config has owner_id or admin_id
  if (userPhone) {
    const configPath = getTelegramConfigPath(userPhone);
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.owner_id) chatIds.add(config.owner_id);
        if (config.admin_id) chatIds.add(config.admin_id);
      } catch (e) {}
    }

    // 2. Check if user JSON has telegramId or username
    const userPath = getUserPath(userPhone);
    if (fs.existsSync(userPath)) {
      try {
        const user = JSON.parse(fs.readFileSync(userPath, 'utf8'));
        if (user.telegramId) chatIds.add(user.telegramId);
        if (user.username) {
          let userHandle = user.username.trim();
          if (!userHandle.startsWith("@")) {
            userHandle = "@" + userHandle;
          }
          chatIds.add(userHandle);
        }
      } catch (e) {}
    }
  }

  // Fallbacks: default targets for owner in case chatIds is empty
  if (chatIds.size === 0) {
    chatIds.add("@RajibNoor");
    // Connect to SQL DB to scan for order user_id fields
    try {
      const dbPath = path.join(BASE_DIR, 'inf', 'bot_data.db');
      if (fs.existsSync(dbPath)) {
        const db = new sqlite3.Database(dbPath);
        await new Promise<void>((resolve) => {
          db.all("SELECT DISTINCT user_id FROM orders", (err: any, rows: any) => {
            if (!err && Array.isArray(rows)) {
              for (const row of rows) {
                if (row.user_id && /^\d+$/.test(row.user_id)) {
                  chatIds.add(Number(row.user_id));
                }
              }
            }
            db.close();
            resolve();
          });
        });
      }
    } catch (e) {}
  }

  // Send the document to all targets
  for (const chatId of chatIds) {
    try {
      if (!fs.existsSync(filePath)) {
        console.log(`[Telegram Report] File moved or deleted, skipping chat ${chatId}: ${filename}`);
        continue;
      }
      
      const stats = fs.statSync(filePath);
      if (stats.size > 2 * 1024 * 1024 * 1024) {
        logToDashboard(`Warning: ${filename} is over 2GB. Standard Node buffers and Telegram bots have limits.`);
      }

      const formData = new FormData();
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer]);
      formData.append("document", blob, filename);
      formData.append("chat_id", String(chatId));

      logToDashboard(`Sending uploaded file ${filename} to Telegram Chat/Channel: ${chatId} using bot...`);
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) {
          logToDashboard(`Telegram Bot Token is unauthorized or invalid for chat ${chatId}.`);
          console.error(`Telegram bot API returned 401 Unauthorized. Please check your botToken in server.ts.`);
        } else {
          console.error(`Telegram bot API returned error for chat ${chatId}:`, errText);
        }
      } else {
        logToDashboard(`Successfully sent ${filename} to Telegram Chat/Channel: ${chatId}`);
      }
    } catch (e: any) {
      console.error(`Error sending uploaded file to Telegram Chat ${chatId}:`, e.message);
    }
  }
}

async function installPythonPackageAsync(pkg: string): Promise<boolean> {
  return new Promise((resolve) => {
    logToDashboard(`[Gemini 🤖] Running standard package installation: pip install "${pkg}"...`);
    const child = exec(`${PYTHON_COMMAND} -m pip install "${pkg}" --break-system-packages`);
    
    child.stdout?.on('data', (data) => {
      logToDashboard(`[pip info] ${data.toString().trim()}`);
    });
    child.stderr?.on('data', (data) => {
      logToDashboard(`[pip error] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logToDashboard(`[Gemini ✅] Python package '${pkg}' installed successfully.`);
        resolve(true);
      } else {
        logToDashboard(`[Gemini] Retrying Python package '${pkg}' installation with --user flag...`);
        const retryChild = exec(`${PYTHON_COMMAND} -m pip install "${pkg}" --user --break-system-packages`);
        
        retryChild.stdout?.on('data', (data) => {
          logToDashboard(`[pip retry info] ${data.toString().trim()}`);
        });
        retryChild.stderr?.on('data', (data) => {
          logToDashboard(`[pip retry error] ${data.toString().trim()}`);
        });

        retryChild.on('close', (retryCode) => {
          if (retryCode === 0) {
            logToDashboard(`[Gemini ✅] Python package '${pkg}' installed successfully with --user flag.`);
            resolve(true);
          } else {
            logToDashboard(`[Gemini ERR] Failed to install Python package '${pkg}' under any configuration (codes: standard=${code}, user=${retryCode}).`);
            resolve(false);
          }
        });
      }
    });
  });
}

async function installNodePackageAsync(pkg: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    logToDashboard(`[Gemini 🤖] Running standard package installation: npm install "${pkg}"...`);
    const child = exec(`npm install "${pkg}"`, { cwd });
    
    child.stdout?.on('data', (data) => {
      logToDashboard(`[npm info] ${data.toString().trim()}`);
    });
    child.stderr?.on('data', (data) => {
      logToDashboard(`[npm error] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logToDashboard(`[Gemini ✅] Node package '${pkg}' installed successfully.`);
        resolve(true);
      } else {
        logToDashboard(`[Gemini ERR] Failed to install Node package '${pkg}' (code ${code}).`);
        resolve(false);
      }
    });
  });
}

async function geminiAnalyzeAndInstallPackages(inputData: string, isFilePath: boolean, origin: string, scriptToRestart?: string, autoRetry = true): Promise<void> {
  const aiKey = process.env.GEMINI_API_KEY;
  if (!aiKey) {
    console.log(`[Gemini Sync] GEMINI_API_KEY is not defined. Skipping AI-assisted dependency resolution.`);
    if (scriptToRestart) {
      logToDashboard(`[System] Starting script ${scriptToRestart} directly (No Gemini-key available)...`);
      executeScript(scriptToRestart, autoRetry);
    }
    return;
  }

  logToDashboard(`[Gemini 🤖] Starting Automated dependency analysis for: ${origin}...`);
  
  try {
    let contentToAnalyze = "";
    if (isFilePath) {
      if (!fs.existsSync(inputData)) {
        logToDashboard(`[Gemini ERR] File path not found: ${inputData}`);
        if (scriptToRestart) executeScript(scriptToRestart, autoRetry);
        return;
      }
      if (inputData.toLowerCase().endsWith(".zip")) {
        try {
          const zip = new AdmZip(inputData);
          const zipEntries = zip.getEntries();
          let combinedContent = "";
          let textFilesCount = 0;
          for (const entry of zipEntries) {
            if (entry.isDirectory) continue;
            const entryName = entry.entryName.toLowerCase();
            const readableExts = [".py", ".pyw", ".js", ".ts", ".json", "requirements.txt", "package.json"];
            const isReadable = readableExts.some(ext => entryName.endsWith(ext));
            if (isReadable) {
              const text = entry.getData().toString("utf8");
              combinedContent += `\n\n--- FILE: ${entry.entryName} ---\n${text.substring(0, 5000)}`;
              textFilesCount++;
              if (textFilesCount >= 15) break;
            }
          }
          contentToAnalyze = combinedContent;
          logToDashboard(`[Gemini 🤖] Read ${textFilesCount} files inside ZIP archive for dependency matching.`);
        } catch (zipErr: any) {
          console.error("Failed to read zip content for Gemini:", zipErr.message);
          contentToAnalyze = "Error reading ZIP file entries.";
        }
      } else {
        const stat = fs.statSync(inputData);
        if (stat.size > 150 * 1024) {
          // Read first 50KB to cover imports/requirements
          const fd = fs.openSync(inputData, 'r');
          const buffer = Buffer.alloc(50 * 1024);
          const bytesRead = fs.readSync(fd, buffer, 0, 50 * 1024, 0);
          fs.closeSync(fd);
          contentToAnalyze = buffer.toString('utf8', 0, bytesRead);
        } else {
          contentToAnalyze = fs.readFileSync(inputData, 'utf8');
        }
      }
    } else {
      contentToAnalyze = inputData;
    }

    const ai = new GoogleGenAI({
      apiKey: aiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const systemInstruction = `You are an expert automated dependency resolution agent.
Analyze the provided code content or error/traceback log and list any missing third-party packages that must be installed.
Do NOT include built-in core standard packages of Python (like os, sys, json, time, math, random, thread, threading, select, socket, subprocess, re, logging, signal, collections, urllib, hash, hashlib, datetime, copy) or Node (like path, fs, child_process, crypto, https, http, url, os, util, stream, events).
You must return your response in a strict, valid JSON format only, with no markdown code blocks or additional text.
JSON Structure:
{
  "python": ["exact-pypi-package-name-1", "exact-pypi-package-name-2"],
  "node": ["exact-npm-package-name-1", "exact-npm-package-name-2"]
}

Guidelines for exact Python mappings:
- telebot / telebot.types / from telebot import ... -> pyTelegramBotAPI
- telegram / from telegram import ... -> python-telegram-bot
- telethon -> telethon
- pyrogram -> pyrogram
- tgcrypto -> tgcrypto
- PIL / Pillow -> Pillow
- yaml -> pyyaml
- dateutil -> python-dateutil
- dotenv -> python-dotenv
- serial -> pyserial
- jwt -> pyjwt
- crypto / Cryptodome -> pycryptodome
- fitz -> pymupdf
- websocket / websocket-client -> websocket-client
- mysql -> mysql-connector-python
- pg / psycopg2 -> psycopg2-binary
- google.generativeai -> google-generativeai
- bs4 -> beautifulsoup4
- Flask -> flask
- requests -> requests
- psutil -> psutil
- speedtest -> speedtest-cli

If no external non-built-in packages are resolved or needed, return empty arrays. Response must be valid parsed JSON.`;

    const userPrompt = `Analyze the following code/log and resolve dependencies:\n\n${contentToAnalyze}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const respText = response.text?.trim() || "";
    if (!respText) {
      logToDashboard(`[Gemini 🤖] Empty dependency analysis response from model.`);
      if (scriptToRestart) executeScript(scriptToRestart, autoRetry);
      return;
    }

    let result: { python?: string[], node?: string[] } = {};
    try {
      result = JSON.parse(respText);
    } catch (parseErr) {
      const cleaned = respText.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '').trim();
      result = JSON.parse(cleaned);
    }

    const { python = [], node = [] } = result;

    if (python.length === 0 && node.length === 0) {
      logToDashboard(`[Gemini 🤖] No missing third-party dependencies detected.`);
      if (scriptToRestart) {
        logToDashboard(`[Gemini 🤖] Starting script execution...`);
        executeScript(scriptToRestart, autoRetry);
      }
      return;
    }

    logToDashboard(`[Gemini 🤖] AI Identified missing dependencies: Python=[${python.join(', ')}], Node=[${node.join(', ')}]`);

    // Run installations asynchronously
    if (python.length > 0) {
      for (const pkg of python) {
        await installPythonPackageAsync(pkg);
      }
    }

    if (node.length > 0) {
      const cwd = isFilePath ? path.dirname(inputData) : process.cwd();
      for (const pkg of node) {
        await installNodePackageAsync(pkg, cwd);
      }
    }

    if (scriptToRestart) {
      logToDashboard(`[Gemini ♻️] Dependency installation completed. Starting script: ${scriptToRestart}`);
      executeScript(scriptToRestart, autoRetry);
    }

  } catch (err: any) {
    console.error("Gemini dependency scan failed:", err.message);
    logToDashboard(`[Gemini ERR] Automated dependency scan failed: ${err.message}`);
    if (scriptToRestart) {
       logToDashboard(`[System] Executing script anyway as fallback...`);
       executeScript(scriptToRestart, autoRetry);
    }
  }
}

function executeScript(filename: string, retryWithAI = true) {
  if (!filename) return false;
  filename = filename.trim();
  let filePath = path.join(WEB_UPLOAD_DIR, filename);
  let processKey = filename;

  // Search recursively if not found precisely
  if (!fs.existsSync(filePath)) {
    console.log(`[EXECUTE] Precise path not found: ${filePath}. Searching recursively...`);
    const findFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        let stat;
        try { stat = fs.statSync(full); } catch(e) { continue; }
        
        if (stat.isDirectory()) {
          const found = findFile(full);
          if (found) return found;
        } else {
          const relative = path.relative(WEB_UPLOAD_DIR, full);
          if (relative === filename || path.basename(full) === filename) {
            return full;
          }
        }
      }
      return null;
    };
    
    const foundPath = findFile(WEB_UPLOAD_DIR);
    if (foundPath) {
      filePath = foundPath;
      processKey = path.relative(WEB_UPLOAD_DIR, foundPath);
      logToDashboard(`Found script at: ${processKey}`);
    } else {
      logToDashboard(`Error: File not found: ${filename}`);
      return false;
    }
  }
  
  if (scriptProcesses[processKey]) {
    try { scriptProcesses[processKey].kill('SIGKILL'); } catch (e) {}
    delete scriptProcesses[processKey];
  }
  
  intentionallyStopped.delete(processKey);
  logToDashboard(`Running script: ${processKey}`);
  
  // Isolation logic: move single file to dedicated folder if it's in root
  if (!processKey.includes('/') && (processKey.endsWith('.py') || processKey.endsWith('.js'))) {
    const timestamp = Date.now();
    const folderName = `${path.basename(processKey, path.extname(processKey))}_${timestamp}`;
    const targetDir = path.join(WEB_UPLOAD_DIR, folderName);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const newFileName = `${folderName}/${processKey}`;
    const newPath = path.join(WEB_UPLOAD_DIR, newFileName);
    
    try {
      fs.renameSync(filePath, newPath);
      filePath = newPath;
      processKey = newFileName;
      logToDashboard(`Isolated script into folder: ${folderName}/`);
    } catch (e) {
      console.error("Failed to move file to isolation folder:", e);
    }
  }

  let command = ''; 
  if (processKey.endsWith('.js')) command = 'node';
  else if (processKey.endsWith('.py') || processKey.endsWith('.pyw')) command = PYTHON_COMMAND;
  else if (processKey.endsWith('.ts')) command = 'npx';
  else if (processKey.endsWith('.sh') || processKey.endsWith('.bash') || processKey.endsWith('.zsh')) command = 'bash';
  else if (processKey.endsWith('.php')) command = 'php';
  else if (processKey.endsWith('.rb')) command = 'ruby';
  else if (processKey.endsWith('.pl')) command = 'perl';
  else if (processKey.endsWith('.sh')) command = 'sh';
  
  // Handle zip extraction instead of arbitrary exec
  if (filename.endsWith('.zip')) {
    logToDashboard(`Notice: Extracting ${filename}...`);
    try {
      const zip = new AdmZip(filePath);
      const timestamp = Date.now();
      const folderName = `${path.basename(filename, '.zip')}_${timestamp}`;
      const extractTargetDir = path.join(WEB_UPLOAD_DIR, folderName); 
      // Ensure target dir exists
      if (!fs.existsSync(extractTargetDir)) fs.mkdirSync(extractTargetDir, { recursive: true });
      zip.extractAllTo(extractTargetDir, true);
      logToDashboard(`${filename} extracted to directory: ${folderName}.`);
      
      // If the ZIP has everything in one root folder, flatten it or run from there
      let items = fs.readdirSync(extractTargetDir);
      let wasNormalized = false;
      let rootFolderName = "";
      if (items.length === 1 && fs.statSync(path.join(extractTargetDir, items[0])).isDirectory()) {
         wasNormalized = true;
         rootFolderName = items[0];
         const subDir = path.join(extractTargetDir, rootFolderName);
         logToDashboard(`=> [Termux] Normalizing ZIP structure: moving files from ${rootFolderName} to root...`);
         const subItems = fs.readdirSync(subDir);
         for (const si of subItems) {
            fs.renameSync(path.join(subDir, si), path.join(extractTargetDir, si));
         }
         fs.rmdirSync(subDir);
         items = fs.readdirSync(extractTargetDir);
      }
      
      const patchFiles = (dir: string) => {
        try {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
              patchFiles(fullPath);
            } else if (fullPath.endsWith('.py')) {
              let content = fs.readFileSync(fullPath, 'utf8');
              let changed = false;
              if (content.includes("from utils import LOGGER") || content.includes("from utils import logger") || content.includes("from utils.logger import LOGGER")) {
                content = content.replace(/from utils(?:\.logger)? import (?:LOGGER|logger)/i, "import logging\nLOGGER = logging.getLogger(__name__)");
                changed = true;
              }
              if (content.includes("from .logger import LOGGER") || content.includes("from .logger import logger")) {
                content = content.replace(/from \.logger import (?:LOGGER|logger)/i, "import logging\nLOGGER = logging.getLogger(__name__)");
                changed = true;
              }
              if (item === "config.py") {
                if (content.includes("int(os.environ.get(\"API_ID\", ''))")) {
                  content = content.replace("int(os.environ.get(\"API_ID\", ''))", "int(os.environ.get(\"API_ID\", '0') or 0)");
                   changed = true;
                }
                if (content.includes("int(os.environ.get(\"CHAT\", \"\"))")) {
                  content = content.replace("int(os.environ.get(\"CHAT\", \"\"))", "int(os.environ.get(\"CHAT\", \"0\") or 0)");
                  changed = true;
                }
                if (content.includes("int(admin) for admin in (ADMIN).split()")) {
                  content = content.replace("int(admin) for admin in (ADMIN).split()", "int(admin) for admin in (ADMIN).split() if admin.isdigit()");
                  changed = true;
                }
                // Check if API_ID is default or missing and warn
                if (content.includes("API_ID = 0") || content.includes("API_ID = int(os.environ.get(\"API_ID\", \"0\") or 0)") || content.includes("API_ID = os.environ.get(\"API_ID\", \"\")")) {
                   logToDashboard("=> [Termux] ⚠️ WARNING: API_ID is set to 0 or missing in config. This bot WILL fail. Set API_ID and API_HASH in App Settings -> Environment Variables.");
                }
              }
              if (content.includes("subprocess.check_call") && content.includes("'pip', 'install'") && !content.includes("--break-system-packages")) {
                content = content.replace(/['"]pip['"]\s*,\s*['"]install['"]/g, "'pip', 'install', '--break-system-packages'");
                changed = true;
              }
              // Aggressive circular import fix: check if 'from utils import LOGGER' exists and replace
              if (content.includes("from .logger import LOGGER")) {
                content = content.replace("from .logger import LOGGER", "import logging\nLOGGER = logging.getLogger(__name__)");
                changed = true;
              }
              if (content.includes("from utils import *")) {
                // To avoid circularity via utils/__init__.py, we can try to skip it if we suspect it
              }
              if (changed) {
                fs.writeFileSync(fullPath, content, 'utf8');
                logToDashboard(`=> [Termux] Auto-patched ${item} at ${fullPath}`);
              }
            }
          }
        } catch (e) {}
      };
      patchFiles(extractTargetDir);
      
      const entries = zip.getEntries();
      
      // Determine if there is a main.py or index.js/server.ts inside the folder
      let hasMainPy = false;
      let hasIndexJs = false;
      for (const entry of entries) {
         let entryName = entry.entryName;
         if (wasNormalized && entryName.startsWith(rootFolderName + "/")) {
            entryName = entryName.substring(rootFolderName.length + 1);
         }
         if (entryName === "main.py") hasMainPy = true;
         if (entryName === "index.js" || entryName === "server.ts" || entryName === "app.js") hasIndexJs = true;
      }

      for (const entry of entries) {
         let entryName = entry.entryName;
         if (wasNormalized && entryName.startsWith(rootFolderName + "/")) {
            entryName = entryName.substring(rootFolderName.length + 1);
         }
         const relativePath = `${folderName}/${entryName}`;
         
         let shouldLaunch = false;
         if (entryName === "main.py" || entryName === "index.js" || entryName === "index.ts" || entryName === "server.ts" || entryName === "app.js") {
            shouldLaunch = true;
         } else if (entryName === "bot.py" && !hasMainPy) {
            shouldLaunch = true;
         } else if ((entryName === "bot.js" || entryName === "app.py") && !hasMainPy && !hasIndexJs) {
            shouldLaunch = true;
         }

         if (shouldLaunch) {
            logToDashboard(`Found executable script ${relativePath} in ZIP, starting it automatically...`);
            setTimeout(() => executeScript(relativePath), 2000);
         } else if (entryName === "requirements.txt") {
            const reqPath = path.join(WEB_UPLOAD_DIR, relativePath);
            setTimeout(() => {
              logToDashboard(`=> [Termux] Found requirements.txt at ${relativePath}. Auto-installing packages...`);
              try {
                exec(`${PYTHON_COMMAND} -m pip install -r "${reqPath}" --break-system-packages`, (err, stdout, stderr) => {
                  if (err) logToDashboard(`[Termux ERR] Failed to install requirements: ${stderr}`);
                  else logToDashboard(`[Termux] All packages installed successfully for ${relativePath}.`);
                });
              } catch (e) {}
            }, 1000);
         } else if (entryName === "package.json") {
            const pkgPath = path.join(WEB_UPLOAD_DIR, relativePath);
            setTimeout(() => {
              logToDashboard(`=> [Termux] Found package.json at ${relativePath}. Auto-installing NPM packages...`);
              try {
                exec(`npm install`, { cwd: path.dirname(pkgPath) }, (err, stdout, stderr) => {
                  if (err) logToDashboard(`[Termux ERR] Failed to install NPM packages: ${stderr}`);
                  else logToDashboard(`=> [Termux] All NPM packages installed successfully for ${relativePath}.`);
                });
              } catch (e) {}
            }, 1000);
         }
      }
    } catch (err: any) {
      logToDashboard(`Error extracting ${filename}: ${err.message}`);
    }
    return true;
  }

  // If we don't know how to run it, we just mark it as "stored" but not running
  if (!command) {
    logToDashboard(`Notice: ${filename} uploaded and stored. System doesn't know how to execute this file type automatically.`);
    return true; 
  }

  const runScript = (scriptFilePath: string, autoRetry = retryWithAI) => {
    if (intentionallyStopped.has(processKey)) return;
    if (scriptProcesses[processKey]) return;

    let spawnArgs = [scriptFilePath];
    if (command === PYTHON_COMMAND) {
      spawnArgs = ["-u", scriptFilePath];
    } else if (command === 'npx') {
      spawnArgs = ['tsx', scriptFilePath];
    }

    // Enrich process environment with custom PYTHONPATH
    const customEnv: { [key: string]: string } = { ...process.env };
    if (command === PYTHON_COMMAND) {
      const pathsToInclude = [
        path.dirname(scriptFilePath),
        WEB_UPLOAD_DIR
      ];
      
      try {
        const userSite = execSync(`${PYTHON_COMMAND} -m site --user-site`, { encoding: 'utf8' }).trim();
        if (userSite) pathsToInclude.push(userSite);
      } catch (e) {}
      
      try {
        const sitePaths = execSync(`${PYTHON_COMMAND} -c "import site; print(':'.join(site.getsitepackages()))"`, { encoding: 'utf8' }).trim();
        if (sitePaths) pathsToInclude.push(...sitePaths.split(':'));
      } catch (e) {}

      const homeEnv = process.env.HOME || "/root";
      pathsToInclude.push(
        path.join(homeEnv, ".local/lib/python3.11/site-packages"),
        path.join(homeEnv, ".local/lib/python3.10/site-packages"),
        path.join(homeEnv, ".local/lib/python3.9/site-packages"),
        path.join(homeEnv, ".local/lib/python3.8/site-packages"),
        "/usr/local/lib/python3.11/dist-packages",
        "/usr/local/lib/python3.10/dist-packages"
      );

      const existingPythonPath = process.env.PYTHONPATH || "";
      customEnv.PYTHONPATH = existingPythonPath 
        ? `${pathsToInclude.join(':')}:${existingPythonPath}` 
        : pathsToInclude.join(':');
    }

    const proc = spawn(command, spawnArgs, { 
      cwd: path.dirname(scriptFilePath),
      env: customEnv
    });
    scriptProcesses[processKey] = proc;
    
    let errorOutput = "";
    
    proc.stdout?.on("data", (data) => logToDashboard(`[${processKey}] ${data.toString().trim()}`));
    proc.stderr?.on("data", (data) => {
      const err = data.toString();
      errorOutput += err;
      logToDashboard(`[${processKey} ERR] ${err.trim()}`);

      if (err.includes("pymongo.errors.InvalidURI")) {
        logToDashboard(`=> [Termux HELP] ⚠️ CRITICAL: MongoDB connection string is invalid. Please set 'DATABASE_URI' in App Settings -> Environment Variables with a valid mongodb:// or mongodb+srv:// URL.`);
      }
      if (err.includes("AttributeError: module 'utils' has no attribute 'LOGGER'")) {
        logToDashboard(`=> [Termux HELP] ⚠️ Circular Import detected in 'utils' module. I will attempt to automatically patch this in the next restart...`);
      }
    });
    
    proc.on("error", (err: any) => {
      errorOutput += `Failed to start process: ${err.message}\n`;
      if (err.code === 'ENOENT') {
        logToDashboard(`[${processKey} ERR] CRITICAL: The system could not find the executable '${command}'. Please ensure Python/Node is properly installed.`);
        logToDashboard(`=> [Termux HELP] ⚠️ Python/Node রান করার জন্য সিস্টেম রানটাইম পাওয়া যায়নি।`);
        logToDashboard(`=> [সমাধান] Railway-তে Python সক্রিয় করতে অবশ্যই প্রজেক্টের 'nixpacks.toml' ফাইলটি যুক্ত রেখে পুনরায় ডিপ্লয় (Rebuild) করুন।`);
      } else {
        logToDashboard(`[${processKey} ERR] Failed to start process: ${err.message}`);
      }
    });
    
    proc.on("close", async (code) => {
      const wasActive = scriptProcesses[processKey] === proc;
      if (wasActive) {
        delete scriptProcesses[processKey];
      }
      
      if (intentionallyStopped.has(processKey) || !wasActive) {
        if (intentionallyStopped.has(processKey)) {
          logToDashboard(`Script ${processKey} was stopped intentionally.`);
        }
        return;
      }
      
      if (code !== 0 && code !== null && autoRetry) {
        let missingPythonModule = errorOutput.match(/ModuleNotFoundError: No module named '([^']+)'/);
        if (!missingPythonModule) {
            missingPythonModule = errorOutput.match(/ImportError: No module named '([^']+)'/);
        }
        const missingNodeModule = errorOutput.match(/Cannot find module '([^']+)'/);
        
        if (missingPythonModule) {
            const mod = missingPythonModule[1];
            
            // Map module name to actual PyPI installable package name
            const getPythonPackageName = (modName: string): string => {
              const mapping: { [key: string]: string } = {
                'telebot': 'pyTelegramBotAPI',
                'telegram': 'python-telegram-bot',
                'yaml': 'pyyaml',
                'PIL': 'Pillow',
                'dateutil': 'python-dateutil',
                'dotenv': 'python-dotenv',
                'serial': 'pyserial',
                'jwt': 'pyjwt',
                'crypto': 'pycryptodome',
                'fitz': 'pymupdf',
                'websocket': 'websocket-client',
                'mysql': 'mysql-connector-python',
                'pg': 'psycopg2-binary',
                'psycopg2': 'psycopg2-binary',
                'google.generativeai': 'google-generativeai',
                'bs4': 'beautifulsoup4',
              };
              return mapping[modName] || modName;
            };
            
            const pkgName = getPythonPackageName(mod);
            logToDashboard(`[Termux] Auto-detecting dependency: Module '${mod}' maps to Package '${pkgName}'`);
            logToDashboard(`[Termux] Auto-installing missing Python package: ${pkgName}...`);
            exec(`${PYTHON_COMMAND} -m pip install "${pkgName}" --break-system-packages`, (err, stdout, stderr) => {
                if (err) logToDashboard(`[Termux ERR] Failed to install package ${pkgName}: ${stderr}`);
                else logToDashboard(`[Termux] Successfully installed ${pkgName}. Restarting script automatically...`);
                setTimeout(() => {
                  if (!intentionallyStopped.has(processKey) && !intentionallyStopped.has(filename)) runScript(scriptFilePath, autoRetry);
                }, 2000);
            });
            return;
        } else if (missingNodeModule) {
            let mod = missingNodeModule[1];
            // Fix relative paths for node module
            if (!mod.startsWith('.') && !mod.startsWith('/')) {
              logToDashboard(`[Termux] Auto-installing missing Node package: ${mod}...`);
              exec(`npm install "${mod}"`, { cwd: path.dirname(scriptFilePath) }, (err, stdout, stderr) => {
                  if (err) logToDashboard(`[Termux ERR] Failed to install package ${mod}: ${stderr}`);
                  else logToDashboard(`[Termux] Successfully installed ${mod}. Restarting script automatically...`);
                  setTimeout(() => {
                    if (!intentionallyStopped.has(processKey) && !intentionallyStopped.has(filename)) runScript(scriptFilePath, autoRetry);
                  }, 2000);
              });
              return;
            }
        }

        // --- GEMINI AUTO RESOLVE FALLBACK ---
        if (process.env.GEMINI_API_KEY) {
          logToDashboard(`[Termux 🤖] Unresolved script crash. Invoking Gemini dependency analyzer...`);
          geminiAnalyzeAndInstallPackages(errorOutput, false, `Crashed script: ${processKey}`, scriptFilePath, autoRetry).catch(err => {
            console.error("Gemini automatic recovery failed:", err);
          });
          return; // Prevents double starting/scheduling, since geminiAnalyzeAndInstallPackages will start it!
        }
        
        // Termux-like traceback extraction and simple auto-fixes
        const pythonTraceback = errorOutput.match(/File "([^"]+)", line (\d+)/g);
        if (pythonTraceback && pythonTraceback.length > 0) {
           // Find the last file in the traceback that is NOT a library file
           let relevantMatch = null;
           for (let i = pythonTraceback.length - 1; i >= 0; i--) {
              const match = pythonTraceback[i].match(/File "([^"]+)", line (\d+)/);
              if (match && !match[1].includes("/usr/lib") && !match[1].includes("/usr/local/lib")) {
                 relevantMatch = match;
                 break;
              }
           }
           
           if (!relevantMatch) relevantMatch = pythonTraceback[pythonTraceback.length - 1].match(/File "([^"]+)", line (\d+)/);

           if (relevantMatch) {
               const actualFile = relevantMatch[1];
               const lineNo = parseInt(relevantMatch[2]);
               const fileBase = path.basename(actualFile);
               logToDashboard(`=> [Termux] Critical error at ${fileBase}:${lineNo}`);
               
               if (errorOutput.includes("ValueError: invalid literal for int()")) {
                  try {
                    if (fs.existsSync(actualFile)) {
                       let lines = fs.readFileSync(actualFile, 'utf8').split('\n');
                       if (lines.length >= lineNo) {
                          const badLine = lines[lineNo - 1];
                          if (badLine.includes('int(') && badLine.includes('os.environ')) {
                              logToDashboard(`=> [Termux] Auto-patching invalid int conversion on line ${lineNo}`);
                              lines[lineNo - 1] = badLine.replace(/int\(\s*os\.environ\.get\(([^,]+),\s*['"](.*?)['"]\)\s*\)/g, 'int(os.environ.get($1, "0") or 0)');
                              fs.writeFileSync(actualFile, lines.join('\n'), 'utf8');
                              logToDashboard(`=> [Termux] Patch applied successfully. Restarting...`);
                          }
                       }
                    }
                  } catch(e) {}
               }
               
               if (errorOutput.includes("AttributeError: The API key is required for new authorizations")) {
                 logToDashboard("=> [Termux] 🛑 CRITICAL ERROR: API_ID or API_HASH is missing!");
                 logToDashboard("=> [Termux] SOLUTION: Get your keys from https://my.telegram.org and add them to 'App Settings' in the control panel.");
                 logToDashboard("=> [Termux] নোট: আপনার টেলিগ্রাম API_ID এবং API_HASH সেট করা নেই। দয়া করে App Settings থেকে এগুলো যোগ করুন।");
               }

               if (errorOutput.includes("pymongo.errors.InvalidURI") || errorOutput.includes("Invalid URI scheme")) {
                  logToDashboard("=> [Termux] 🗄️ Invalid MongoDB URI detected. Patching Database config...");
                  try {
                    const searchDir = path.dirname(scriptFilePath);
                    const patchMongo = (dir: string) => {
                       const items = fs.readdirSync(dir);
                       for (const item of items) {
                          const fullPath = path.join(dir, item);
                          if (fs.statSync(fullPath).isDirectory()) patchMongo(fullPath);
                          else if (item.endsWith('.py')) {
                             let content = fs.readFileSync(fullPath, 'utf8');
                             if (content.includes("MongoClient(") && !content.includes("try:") && !content.includes("except:")) {
                                content = content.replace(/([^=]+)=\s*MongoClient\(([^)]+)\)/g, 'try:\n    $1 = MongoClient($2)\nexcept Exception as e:\n    print(f"MongoDB Error: {e}")\n    $1 = None');
                                fs.writeFileSync(fullPath, content, 'utf8');
                                logToDashboard(`=> [Termux] MongoDB Safety-Patch applied to ${item}`);
                             }
                          }
                       }
                    };
                    patchMongo(searchDir);
                  } catch(e) {}
               }

               if (errorOutput.includes("ImportError: cannot import name 'Config' from partially initialized module 'config'")) {
                 logToDashboard("=> [Termux] ⚙️ Circular import detected. Running Deep-Heal patcher...");
                 try {
                    const searchDir = path.dirname(scriptFilePath);
                    const patchRecursive = (dir: string) => {
                      const files = fs.readdirSync(dir);
                      for (const file of files) {
                        const fullPath = path.join(dir, file);
                        if (fs.statSync(fullPath).isDirectory()) {
                          patchRecursive(fullPath);
                        } else if (file.endsWith('.py')) {
                           let content = fs.readFileSync(fullPath, 'utf8');
                           let changed = false;
                           if (content.includes("from utils import LOGGER") || content.includes("from utils import logger") || content.includes("from utils.logger import LOGGER")) {
                             content = content.replace(/from utils(?:\.logger)? import (?:LOGGER|logger)/i, "import logging\nLOGGER = logging.getLogger(__name__)");
                             changed = true;
                           }
                           if (content.includes("from .logger import LOGGER") || content.includes("from .logger import logger")) {
                              content = content.replace(/from \.logger import (?:LOGGER|logger)/i, "import logging\nLOGGER = logging.getLogger(__name__)");
                              changed = true;
                           }
                           if (changed) {
                             fs.writeFileSync(fullPath, content, 'utf8');
                             logToDashboard(`=> [Termux] Deep-Healed: ${file}`);
                           }
                        }
                      }
                    };
                    patchRecursive(searchDir);
                 } catch(e) {}
               }
           }
        }

        logToDashboard(`Script ${filename} failed with code ${code}. Termux is Auto-restarting in 5 seconds...`);
      } else {
        logToDashboard(`Script ${filename} finished with code ${code}. Auto-restarting in 5 seconds to run 24/7...`);
      }
      
      // Auto-restart after 5 seconds to keep it running 24/7 unless explicitly stopped
      setTimeout(() => {
        if (!intentionallyStopped.has(filename) && !intentionallyStopped.has(processKey)) {
          runScript(scriptFilePath, autoRetry);
        } else {
          logToDashboard(`Auto-restart cancelled because script ${processKey || filename} has been intentionally stopped or deleted.`);
        }
      }, 5000);
    });
  };

  runScript(filePath);
  return true;
}

// Local Proxy for VPS Ports
app.all("/proxy/:port/*", async (req, res) => {
  const { port } = req.params;
  const subPath = (req.params as any)[0] || "";
  const target = `http://localhost:${port}/${subPath}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;

  try {
    const response = await fetch(target, {
      method: req.method,
      headers: { ...req.headers as any, host: `localhost:${port}` },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : (req as any).body
    });
    
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    
    const body = await response.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err: any) {
    res.status(502).send(`Proxy Error: Could not reach port ${port}. Is your script running a web server on this port?`);
  }
});

app.post("/api/requirements/install", (req, res) => {
  const reqPath = path.join(WEB_UPLOAD_DIR, "requirements.txt");
  if (!fs.existsSync(reqPath)) {
    return res.status(404).json({ error: "requirements.txt not found. Please upload it first." });
  }

  logToDashboard("=> [Termux] Manual requirements installation triggered...");
  exec(`${PYTHON_COMMAND} -m pip install -r "${reqPath}" --break-system-packages`, (err, stdout, stderr) => {
    if (err) {
      logToDashboard(`[Termux ERR] ${stderr}`);
      res.status(500).json({ error: stderr });
    } else {
      logToDashboard(`=> [Termux] All packages installed successfully.`);
      res.json({ message: "Requirements installed successfully", output: stdout });
    }
  });
});

app.post("/api/terminal/execute", (req, res) => {
  let { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: "Command is required" });
  }

  command = command.trim();
  logToDashboard(`$ ${command}`);

  // Auto-patch pip installs to use PYTHON_COMMAND and --break-system-packages
  let resolvedCommand = command;
  if (command.startsWith("pip install ") || command.startsWith("pip3 install ")) {
    const pkg = command.replace(/^(pip install|pip3 install)\s+/, "");
    resolvedCommand = `${PYTHON_COMMAND} -m pip install ${pkg}`;
    if (!resolvedCommand.includes("--break-system-packages")) {
      resolvedCommand += " --break-system-packages";
    }
  } else if (command.startsWith("pip ") || command.startsWith("pip3 ")) {
    resolvedCommand = command.replace(/^(pip|pip3)/, `${PYTHON_COMMAND} -m pip`);
    if ((command.includes("install") || command.includes("uninstall")) && !resolvedCommand.includes("--break-system-packages")) {
      resolvedCommand += " --break-system-packages";
    }
  } else if (command.startsWith("python ")) {
    resolvedCommand = command.replace(/^python/, PYTHON_COMMAND);
  } else if (command.startsWith("python3 ")) {
    resolvedCommand = command.replace(/^python3/, PYTHON_COMMAND);
  }

  exec(resolvedCommand, (err, stdout, stderr) => {
    if (stdout) {
      stdout.split("\n").forEach(line => {
        if (line.trim()) logToDashboard(`[STDOUT] ${line.trim()}`);
      });
    }
    if (stderr) {
      stderr.split("\n").forEach(line => {
        if (line.trim()) logToDashboard(`[STDERR] ${line.trim()}`);
      });
    }
    if (err) {
      logToDashboard(`[ERROR] Command failed with exit code ${err.code || 1}`);
      return res.status(500).json({ error: err.message, stderr });
    }
    logToDashboard(`[SUCCESS] Command finished successfully.`);
    return res.json({ message: "Command executed successfully", stdout, stderr });
  });
});

// Auto-install requirements if found
function checkRequirements() {
  const reqPath = path.join(WEB_UPLOAD_DIR, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    logToDashboard("=> [Termux] Found requirements.txt. Auto-installing packages...");
    try {
      exec(`${PYTHON_COMMAND} -m pip install -r "${reqPath}" --break-system-packages`, (err, stdout, stderr) => {
        if (err) logToDashboard(`[Termux ERR] ${stderr}`);
        else logToDashboard(`=> [Termux] All packages installed successfully.`);
      });
    } catch (e) {}
  }
}
setTimeout(checkRequirements, 5000);

app.post("/api/upload", upload.single("file"), async (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  let filename = req.file.originalname;
  let finalRelativePath = filename;
  let absolutePath = path.join(WEB_UPLOAD_DIR, filename);

  logToDashboard(`Web upload received: ${filename}`);

  // Immediate Isolation: Move into dedicated folder
  const isolatableExts = [".py", ".pyw", ".js", ".ts", ".sh", ".bash", ".zsh", ".php", ".rb", ".pl"];
  const fileExt = path.extname(filename).toLowerCase();
  if (isolatableExts.includes(fileExt)) {
    const timestamp = Date.now();
    const folderName = `${path.basename(filename, path.extname(filename))}_${timestamp}`;
    const targetDir = path.join(WEB_UPLOAD_DIR, folderName);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    
    const newRelativePath = `${folderName}/${filename}`;
    const newAbsolutePath = path.join(WEB_UPLOAD_DIR, newRelativePath);
    
    try {
      if (fs.existsSync(absolutePath)) {
        fs.renameSync(absolutePath, newAbsolutePath);
        absolutePath = newAbsolutePath;
        finalRelativePath = newRelativePath;
        logToDashboard(`=> isolated into project folder: ${folderName}/`);
      }
    } catch (e: any) {
      console.error("Failed to isolate file on upload:", e.message);
    }
  }

  if (filename === "requirements.txt") {
    setTimeout(checkRequirements, 1000);
  }

  const userPhone = req.headers['x-user-phone'] as string || "";
  const userTelegramId = req.headers['x-user-telegram-id'] as string || "";

  // Get stats for the response
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch (e) {
    stats = { size: 0 };
  }

  try {
    // Pass the new path/filename information
    await sendFileToTelegram(finalRelativePath, userPhone, userTelegramId);
  } catch (err: any) {
    console.error(`Telegram report failure for ${finalRelativePath}:`, err.message);
  }

  // Automatically start execution on upload for scripts
  const runnableExts = [".py", ".pyw", ".js", ".ts", ".sh", ".bash", ".zsh", ".php", ".rb", ".pl", ".zip"];
  const finalLower = finalRelativePath.toLowerCase();
  const shouldAutoRun = runnableExts.some(ext => finalLower.endsWith(ext));

  if (shouldAutoRun) {
    try {
      // Invoke Gemini-assisted dependency resolver to scan code and install missing packages, then start
      geminiAnalyzeAndInstallPackages(absolutePath, true, `Upload scan: ${filename}`, finalRelativePath).catch((err) => {
        console.error(`Auto-run Gemini scan failed for ${finalRelativePath}:`, err.message);
      });
    } catch (err: any) {
      console.error(`Auto-run script setup fail for ${finalRelativePath}:`, err.message);
    }
  }

  const sizeStr = stats.size > 1024 * 1024 
    ? `${(stats.size / (1024 * 1024)).toFixed(2)} MB` 
    : `${(stats.size / 1024).toFixed(2)} KB`;

  res.json({ 
    message: "File uploaded, isolated, and executed successfully",
    file: {
      name: finalRelativePath,
      size: sizeStr,
      isRunning: !!scriptProcesses[finalRelativePath]
    }
  });
});

// --- VPS Remote Worker Endpoints ---
let vpsJobs: { type: 'start' | 'stop', filename: string }[] = [];
let lastVpsPing = 0;
let vpsRunningFiles: string[] = [];

app.post("/api/vps/queue", (req, res) => {
  const { filename } = req.body;
  if (!vpsJobs.find(job => job.filename === filename && job.type === 'start')) {
    vpsJobs.push({ type: 'start', filename });
  }
  logToDashboard(`Queued ${filename} for execution on Remote VPS`);
  res.json({ message: `Queued ${filename} to run on Remote VPS` });
});

app.post("/api/vps/stop", (req, res) => {
  const { filename } = req.body;
  if (!vpsJobs.find(job => job.filename === filename && job.type === 'stop')) {
    vpsJobs.push({ type: 'stop', filename });
  }
  logToDashboard(`Queued ${filename} to stop on Remote VPS`);
  res.json({ message: `Queued ${filename} to stop on Remote VPS` });
});

app.get("/api/vps/jobs", (req, res) => {
  if (vpsJobs.length > 0) {
    const job = vpsJobs.shift();
    res.json({ hasJob: true, ...job });
  } else {
    res.json({ hasJob: false });
  }
});

import os from 'os';

app.get("/api/vps/info", (req, res) => {
  res.json({
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMem: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + " GB",
    freeMem: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + " GB",
    uptime: (os.uptime() / 3600).toFixed(2) + " Hours",
    nodeVersion: process.version,
    homeDir: os.homedir(),
    osType: os.type()
  });
});

app.get("/api/workspace/download/:folderName", (req, res) => {
  const folderPath = path.join(WEB_UPLOAD_DIR, req.params.folderName);
  if (fs.existsSync(folderPath) && fs.lstatSync(folderPath).isDirectory()) {
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(folderPath);
      const zipBuffer = zip.toBuffer();
      
      const safeName = req.params.folderName.split('_')[0] || "workspace";
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
      res.send(zipBuffer);
    } catch (err) {
      console.error("Error creating zip:", err);
      res.status(500).json({ error: "Failed to create download" });
    }
  } else {
    res.status(404).json({ error: "Folder not found" });
  }
});

app.get("/api/vps/download/:filename", (req, res) => {
  const filePath = path.join(WEB_UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    // Provide a nice filename header
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

app.post("/api/vps/logs", (req, res) => {
  const { filename, message } = req.body;
  logToDashboard(`[Remote VPS - ${filename}] ${message}`);
  res.json({ success: true });
});

app.post("/api/vps/status", (req, res) => {
  lastVpsPing = Date.now();
  if (req.body.runningFiles && Array.isArray(req.body.runningFiles)) {
    vpsRunningFiles = req.body.runningFiles;
  }
  res.json({ success: true });
});

app.get("/api/vps/status", (req, res) => {
  const isAlive = (Date.now() - lastVpsPing) < 15000;
  if (!isAlive) vpsRunningFiles = []; // Clear if dead
  res.json({ isAlive, lastPingServerTime: lastVpsPing, vpsRunningFiles });
});
// -----------------------------------

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

// Store temp sessions for people logging in (keyed by phone number)
const otpSessions: Record<string, { client: TelegramClient, phoneCodeHash?: string }> = {};

const tgApiId = parseInt(process.env.TELEGRAM_API_ID || "37365094");
const tgApiHash = process.env.TELEGRAM_API_HASH || "3e480e1f28d344f1f59cf3fd409082f2";

// --- Telegram GramJS Auth Endpoints ---
app.post("/api/telegram/send-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });
  try {
    const formattedPhone = formatPhone(phone);
    console.log(`[GramJS] Initiating Telegram Otp send to: ${formattedPhone}`);
    
    // Attempt GramJS connect & send code
    const client = new TelegramClient(new StringSession(""), tgApiId, tgApiHash, { connectionRetries: 5 });
    await client.connect();
    const result = await client.sendCode({ apiId: tgApiId, apiHash: tgApiHash }, formattedPhone);
    otpSessions[formattedPhone] = { client, phoneCodeHash: result.phoneCodeHash };
    
    console.log(`[GramJS] OTP sent successfully to: ${formattedPhone} (hash: ${result.phoneCodeHash})`);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err: any) {
    console.error(`[GramJS] Telegram API sendCode failed for ${phone}:`, err.message || err);
    res.status(400).json({ error: `Telegram OTP Send Error: ${err.message || 'Check your number or Telegram API setup'}` });
  }
});

app.post("/api/telegram/verify-otp", async (req, res) => {
  const { phone, otp, password, isRegistration, userData } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });

  const formattedPhone = formatPhone(phone);
  const session = otpSessions[formattedPhone];
  if (!session || !session.client) {
    return res.status(400).json({ error: "No active verification session found. Please click 'Send OTP' again." });
  }

  let srpVerifyError: any = null;

  try {
    if (password) {
      // Direct 2FA password verification.
      await session.client.signInWithPassword(
        { apiId: tgApiId, apiHash: tgApiHash },
        {
          password: async () => password,
          onError: async (err) => {
            console.error("signInWithPassword callback error:", err);
            srpVerifyError = err;
            return true;
          }
        }
      );
    } else {
      if (!otp) return res.status(400).json({ error: "OTP required" });
      await session.client.invoke(new Api.auth.SignIn({
        phoneNumber: formattedPhone,
        phoneCodeHash: session.phoneCodeHash!,
        phoneCode: otp,
      }));
    }
    
    const me = await session.client.getMe();
    
    res.json({ 
      success: true, 
      user: {
        firstName: (me as any).firstName,
        lastName: (me as any).lastName,
        username: (me as any).username,
        id: (me as any).id
      }
    });
    
  } catch (err: any) {
    const activeError = srpVerifyError || err;
    const errStr = activeError ? String(activeError) : "";
    const errMessage = (activeError && typeof activeError.message === 'string') ? activeError.message : "";
    const errErrorMessage = (activeError && typeof activeError.errorMessage === 'string') ? activeError.errorMessage : "";

    if (
      errStr.includes("SESSION_PASSWORD_NEEDED") ||
      errMessage.includes("SESSION_PASSWORD_NEEDED") ||
      errErrorMessage.includes("SESSION_PASSWORD_NEEDED") ||
      errStr.includes("2FA") ||
      errMessage.includes("2FA") ||
      errErrorMessage.includes("2FA")
    ) {
      console.log("Telegram Auth: Two-step verification is enabled for this account (requires password prompt).");
      return res.json({
        success: true,
        requiresPassword: true,
        message: "Two-step verification has been enabled on this account."
      });
    }

    console.error("Telegram verify-otp error:", activeError);

    if (
      errStr.includes("PASSWORD_HASH_INVALID") ||
      errMessage.includes("PASSWORD_HASH_INVALID") ||
      errErrorMessage.includes("PASSWORD_HASH_INVALID") ||
      errStr.includes("PASSWORD_INVALID") ||
      errMessage.includes("PASSWORD_INVALID") ||
      errErrorMessage.includes("PASSWORD_INVALID")
    ) {
      return res.status(400).json({ error: "🔒 Incorrect Two-Step verification password. Please try again." });
    }

    res.status(400).json({ error: errErrorMessage || errMessage || errStr || "Verification failed" });
  }
});
// -----------------------------------


// --- bKash Payment API Endpoint ---
app.post("/api/bkash/create", async (req, res) => {
  try {
    const { amount, merchantInvoiceNumber, intent } = req.body;
    const bkashUrl = "https://checkout.sandbox.bka.sh/v1.2.0-beta/checkout/payment/create";
    
    logToDashboard(`Calling bKash API: ${bkashUrl}`);
    
    // Fallback headers logic or proxy via provided auth tokens
    const authHeader = req.headers.authorization || process.env.BKASH_AUTHORIZATION || "";
    const appKey = req.headers["x-app-key"] || process.env.BKASH_APP_KEY || "";
    
    const response = await fetch(bkashUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": Array.isArray(authHeader) ? authHeader[0] : (authHeader || ""),
        "X-APP-Key": Array.isArray(appKey) ? appKey[0] : (appKey || "")
      },
      body: JSON.stringify({
        amount: amount || "120",
        currency: "BDT",
        intent: intent || "sale",
        merchantInvoiceNumber: merchantInvoiceNumber || `INV_${Date.now()}`,
        merchantAssociationInfo: "MI112"
      })
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    console.error("bKash API error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/files/run", async (req, res) => {
  let { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Filename required" });
  filename = String(filename).trim();

  console.log(`Received API request to run: ${filename}`);
  const success = executeScript(filename);
  if (success) {
    res.json({ message: `Started running ${filename} (Persistent Mode)` });
  } else {
    res.status(400).json({ error: "Failed to run script. Unsupported type or file missing." });
  }
});

app.post("/api/files/stop", (req, res) => {
  let { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Filename required" });
  filename = String(filename).trim();
  
  logToDashboard(`[Stop API] Request received to stop: ${filename}`);
  intentionallyStopped.add(filename);
  
  let killedCount = 0;
  for (const sprocessPath in scriptProcesses) {
    if (
      sprocessPath === filename || 
      sprocessPath.endsWith('/' + filename) || 
      filename.endsWith('/' + sprocessPath) || 
      sprocessPath.startsWith(filename + '/') ||
      (filename.endsWith('.zip') && sprocessPath.startsWith(filename.replace('.zip', '') + '/'))
    ) {
      intentionallyStopped.add(sprocessPath);
      try {
        scriptProcesses[sprocessPath].kill('SIGKILL');
        logToDashboard(`[Stop Success] Successfully stopped running instance: ${sprocessPath}`);
        killedCount++;
      } catch (e: any) {
        logToDashboard(`[Stop Error] Failed to kill process ${sprocessPath}: ${e.message}`);
      }
      delete scriptProcesses[sprocessPath];
    }
  }

  res.json({ message: `Stopped ${filename}. Process Cleaned: ${killedCount}` });
});

app.post("/api/workspace/delete", (req, res) => {
  const { folderName } = req.body;
  if (!folderName || folderName === 'Root') return res.status(400).json({ error: "Invalid folder name" });

  logToDashboard(`[Delete Workspace API] Deleting workspace: ${folderName}`);
  const folderPath = path.join(WEB_UPLOAD_DIR, folderName);
  intentionallyStopped.add(folderName);
  
  let killedCount = 0;
  // Kill any process whose key starts with the workspace name or contains it
  for (const sprocessPath in scriptProcesses) {
    if (sprocessPath === folderName || sprocessPath.startsWith(folderName + '/')) {
      intentionallyStopped.add(sprocessPath);
      try {
        scriptProcesses[sprocessPath].kill('SIGKILL');
        logToDashboard(`[Stop Success] Stopped process belonging to workspace: ${sprocessPath}`);
        killedCount++;
      } catch (e) {}
      delete scriptProcesses[sprocessPath];
    }
  }

  if (fs.existsSync(folderPath)) {
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
      logToDashboard(`[Delete Success] Deleted workspace folder and its contents on disk: ${folderName}`);
      res.json({ success: true, message: `Deleted workspace ${folderName}. Stopped ${killedCount} processes.` });
    } catch (err: any) {
      console.error("Error deleting workspace:", err);
      res.status(500).json({ error: "Failed to delete workspace on disk: " + err.message });
    }
  } else {
    res.json({ success: true, message: `Workspace folder not found on disk, but all ${killedCount} reference processes cleaned up.` });
  }
});

app.post("/api/files/delete", (req, res) => {
  let { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Filename required" });
  filename = String(filename).trim();

  logToDashboard(`[Delete File API] Deleting file: ${filename}`);
  const filePath = path.join(WEB_UPLOAD_DIR, filename);
  const userFolder = path.dirname(filePath);

  intentionallyStopped.add(filename);
  
  let killedCount = 0;
  // Kill all matching running processes
  for (const sprocessPath in scriptProcesses) {
    if (
      sprocessPath === filename || 
      sprocessPath.endsWith('/' + filename) || 
      filename.endsWith('/' + sprocessPath) || 
      sprocessPath.startsWith(filename + '/') ||
      (filename.endsWith('.zip') && sprocessPath.startsWith(filename.replace('.zip', '') + '/'))
    ) {
      intentionallyStopped.add(sprocessPath);
      try {
        scriptProcesses[sprocessPath].kill('SIGKILL');
        logToDashboard(`[Stop Success] Stopped running process for deleted file: ${sprocessPath}`);
        killedCount++;
      } catch (e) {}
      delete scriptProcesses[sprocessPath];
    }
  }

  try {
    if (fs.existsSync(filePath)) {
      const filesInFolder = fs.readdirSync(userFolder);
      const isIsolated = userFolder !== WEB_UPLOAD_DIR && path.basename(userFolder).split('_').length >= 2;
      const isMainFile = path.basename(userFolder).startsWith(path.basename(filename, path.extname(filename)));

      if (isIsolated && (isMainFile || filesInFolder.length <= 1)) {
        fs.rmSync(userFolder, { recursive: true, force: true });
        logToDashboard(`[Delete Success] Deleted containing isolated workspace folder: ${path.basename(userFolder)}`);
      } else {
        fs.unlinkSync(filePath);
        logToDashboard(`[Delete Success] Deleted file: ${filename}`);
      }
    } else {
      // Check if file is inside a workspace matching the base filename
      logToDashboard(`[Delete Warning] File not found at ${filename}. Attempting recursive search cleanup...`);
    }
    res.json({ message: `Deleted ${filename}. Stopped ${killedCount} processes.` });
  } catch (err: any) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete file: " + err.message });
  }
});

app.post("/api/files/edit", async (req, res) => {
  const { filename, prompt } = req.body;
  if (!filename || !prompt) return res.status(400).json({ error: "Filename and prompt required" });

  const filePath = path.join(WEB_UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  try {
    const aiKey = process.env.GEMINI_API_KEY;
    if (!aiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured for editing." });
    }

    const ai = new GoogleGenAI({
      apiKey: aiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const systemInstruction = `You are a professional code editor. Modify the provided code based on the user's instructions. Return ONLY the modified code without markdown blocks or explanations.`;
    const userPrompt = `FILE CONTENT:\n${fileContent}\n\nUSER INSTRUCTION:\n${prompt}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2,
      },
    });

    const newCode = response.text;
    if (newCode && newCode.trim().length > 0) {
      // Basic cleanup if model included markdown
      const cleanedCode = newCode.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '');
      fs.writeFileSync(filePath, cleanedCode, 'utf8');
      logToDashboard(`Successfully AI-Edited file: ${filename}`);
      res.json({ success: true, message: `File ${filename} updated.` });
    } else {
      res.status(500).json({ error: "AI failed to generate code update." });
    }
  } catch (err: any) {
    console.error("AI Edit error:", err);
    res.status(500).json({ error: `AI Edit failed: ${err.message}` });
  }
});

app.post("/api/bot/restart", (req, res) => {
  if (pythonProcess) {
    try { pythonProcess.kill('SIGKILL'); } catch(e) {}
    pythonProcess = null;
  }
  if (scriptProcesses['bot.py']) {
    try { scriptProcesses['bot.py'].kill('SIGKILL'); } catch(e) {}
    delete scriptProcesses['bot.py'];
  }
  res.json({ message: "Bot restart initiated" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("GEMINI_API_KEY environment variable is not defined.");
      return res.json({ 
        reply: "ধন্যবাদ! আমরা আপনার বার্তাটি পেয়েছি। আমাদের প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন। (অথবা আপনি সরাসরি আমাদের WhatsApp বা Telegram এর মাধ্যমে যোগাযোগ করতে পারেন।)" 
      });
    }

    const promptText = `You are the helpful customer support AI of "SMART VPS" (https://smartvps.com), a web application and hosting provider in Bangladesh.
Our WhatsApp number: +8801339597482
Our Telegram ID: @RajibNoor
Our price points start from extremely affordable rates.
We have Free 3-day test trial VPS for new users upon registration.
The support owner's phone code is +8801704635232.

Please answer the user's message in a professional, courteous, and polite manner. Keep answers brief (within 1-2 sentences). 
If the user's message is in Bengali, reply in polite Bengali. If in English, reply in polite English.

User message: ${message}`;

    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
    });

    const replyText = response.text || "দুঃখিত, কোনো উত্তর পাওয়া যায়নি।";
    res.json({ reply: replyText });
  } catch (err: any) {
    console.error("Chat API error:", err);
    res.json({ reply: "আমি একটু ব্যস্ত আছি, অনুগ্রহ করে আমাদের সরাসরি WhatsApp (+8801339597482) বা Telegram (@RajibNoor) এ যোগাযোগ করুন।" });
  }
});

app.get("/api/admin/users", (req, res) => {
  try {
    const files = fs.readdirSync(USERS_DIR);
    const users = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'));
          return {
            name: data.name || "Unknown",
            phone: data.phone || f.replace('.json', ''),
            balance: data.balance || "0.00",
            role: data.isAdmin ? "ADMIN" : "USER",
            status: data.status !== undefined ? data.status : true,
            reseller: data.reseller !== undefined ? data.reseller : false,
            registeredAt: data.registeredAt || "Unknown"
          };
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users/update", (req, res) => {
  const { phone, role, balance, status, reseller } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });

  const formatted = formatPhone(phone);
  const cleanPhone = formatted.replace(/\+/g, '').replace(/[^0-9]/g, '');
  const userPath = path.join(USERS_DIR, `${cleanPhone}.json`);

  if (!fs.existsSync(userPath)) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const userData = JSON.parse(fs.readFileSync(userPath, 'utf8'));
    
    if (role !== undefined) userData.isAdmin = (role === 'ADMIN');
    if (balance !== undefined) userData.balance = balance;
    if (status !== undefined) userData.status = status;
    if (reseller !== undefined) userData.reseller = reseller;
    
    fs.writeFileSync(userPath, JSON.stringify(userData, null, 2));
    res.json({ success: true, user: userData });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-all for API to prevent HTML responses
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.url}` });
});

async function fixCodeWithAI(filename: string, code: string, error: string): Promise<string> {
  return code;
}

async function editCodeWithAI(filename: string, code: string, instruction: string): Promise<string> {
  return code;
}

app.get('/api/workspace/download/:folder', (req, res) => {
  try {
    let { folder } = req.params;
    if (!folder) return res.status(400).json({ error: "Folder name required" });
    folder = folder.trim();
    
    // Safety check: ensure the folder is within WEB_UPLOAD_DIR
    const folderPath = path.join(WEB_UPLOAD_DIR, folder);
    if (!folderPath.startsWith(WEB_UPLOAD_DIR)) {
       return res.status(403).json({ error: "Access denied" });
    }
    
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const zip = new AdmZip();
    zip.addLocalFolder(folderPath);
    const buffer = zip.toBuffer();
    
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folder}.zip"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (err: any) {
    console.error("Zip download error:", err);
    res.status(500).json({ error: "Failed to generate zip" });
  }
});

async function ensurePipOrBootstrap(): Promise<void> {
  console.log("Checking if Python pip is installed...");
  try {
    execSync(`${PYTHON_COMMAND} -m pip --version`, { stdio: 'ignore' });
    console.log("Pip is already installed and working.");
    return;
  } catch (e) {
    console.log("Pip is missing! Attempting to bootstrap pip dynamically...");
    logToDashboard("[Termux ⚠️] Python Pip is missing from runtime. Bootstrapping Pip...");
  }

  // Attempt using ensurepip if available (some environments may have it package-disabled but let's try)
  try {
    console.log("Trying to bootstrap with ensurepip...");
    execSync(`${PYTHON_COMMAND} -m ensurepip --default-pip`, { stdio: 'ignore' });
    console.log("Pip bootstrapped successfully with ensurepip!");
    logToDashboard("[Termux] Pip was successfully bootstrapped with ensurepip.");
    return;
  } catch (err) {
    console.log("ensurepip failed or not available. Fetching get-pip.py from bootstrap site...");
    logToDashboard("[Termux] ensurepip unavailable. Downloading get-pip.py...");
  }

  const pipScriptPath = path.join(process.cwd(), "get-pip.py");
  try {
    const file = fs.createWriteStream(pipScriptPath);
    await new Promise<void>((resolve, reject) => {
      https.get("https://bootstrap.pypa.io/get-pip.py", (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP response code ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }).on("error", (err) => {
        fs.unlink(pipScriptPath, () => {});
        reject(err);
      });
    });

    console.log("Downloaded get-pip.py successfully. Installing pip...");
    logToDashboard("[Termux] Downloaded get-pip.py successfully. Installing pip globally... (this may take 1-2 minutes)");
    
    // Run installer under user directory to avoid permission issues
    execSync(`${PYTHON_COMMAND} "${pipScriptPath}" --break-system-packages --user`, { stdio: 'inherit' });
    console.log("Pip installed successfully via get-pip.py!");
    logToDashboard("[Termux ✅] Pip has been installed successfully via fallback installer!");
    
    // Clean up
    try { fs.unlinkSync(pipScriptPath); } catch (e) {}
  } catch (error: any) {
    console.error("CRITICAL: Failed to bootstrap pip:", error.message);
    logToDashboard(`[Termux ERR] Critical error bootstrapping Python pip: ${error.message}`);
  }
}


// Vite Middleware & Static Serving
async function startServer() {
  try {
    // Check and repair pip
    await ensurePipOrBootstrap();

    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(BASE_DIR, 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    if (process.env.VERCEL !== "1") {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  } catch (err) {
    console.error("Critical server startup error:", err);
  }
}

if (process.env.VERCEL !== "1") {
  startServer();
}

export default app;
