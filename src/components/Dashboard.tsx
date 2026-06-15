import React, { useState, useEffect, useRef } from 'react';
import { BotFile } from '../types';
import { Upload, Play, Square, RefreshCw, RotateCcw, FileText, Terminal, CheckCircle2, Bot, Sparkles, Trash2, Edit3, X, Server, Menu, Key, Plus, AlertTriangle, Folder, Download, HardDrive, MessageCircle, Send, Headphones, MessageSquare, History as HistoryIcon, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { SostaLogo } from './SostaLogo';

export default function Dashboard() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<BotFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'bot', text: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  // Diagnostics and healing states
  const [healing, setHealing] = useState(false);
  const [healResult, setHealResult] = useState<{ success: boolean; fixed: boolean; message: string } | null>(null);

  const [updaterFile, setUpdaterFile] = useState("bot.py");
  const [updaterPrompt, setUpdaterPrompt] = useState("");
  const [updatingCode, setUpdatingCode] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  // VPS Worker states
  const [vpsActive, setVpsActive] = useState(false);
  const [vpsRunningFiles, setVpsRunningFiles] = useState<string[]>([]);
  const [copyingVps, setCopyingVps] = useState(false);

  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [sysInfo, setSysInfo] = useState<any>(null);

  const [terminalCommand, setTerminalCommand] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  // Custom non-blocking Alert & Confirmation states
  const [customToast, setCustomToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'file' | 'workspace'; target: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setCustomToast({ message, type });
    // Auto collapse after 4 seconds
    setTimeout(() => {
      setCustomToast(prev => prev?.message === message ? null : prev);
    }, 4000);
  };

  const alert = (msg: string) => {
    const isError = msg.includes('❌') || msg.includes('ব্যর্থ') || msg.includes('failed') || msg.includes('Error') || msg.includes('invalid');
    showToast(msg, isError ? 'error' : 'success');
  };

  const handleExecuteCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalCommand.trim() || isExecuting) return;

    const cmd = terminalCommand.trim();
    setTerminalCommand("");
    setIsExecuting(true);

    // Instant local UI feedback
    setLogs(prev => [...prev, `$ ${cmd}`, '[INFO] Command is running... Please wait, output will be streamed here shortly.']);

    try {
      await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: cmd }),
      });

      // Fetch logs immediately after executing to show the results in the log window
      setTimeout(async () => {
        try {
          const res = await fetch('/api/logs/history');
          if (res.ok) {
            const history = await res.json();
            setLogs(history);
          }
        } catch (e) {}
      }, 1500);

    } catch (err) {
      console.error(err);
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    const fetchSysInfo = async () => {
      try {
        const res = await fetch('/api/vps/info');
        if (res.ok) setSysInfo(await res.json());
      } catch (e) {}
    };
    fetchSysInfo();
    const timer = setInterval(fetchSysInfo, 30000);
    return () => clearInterval(timer);
  }, []);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  
  // Storage & Expiry limits (Dynamic states determined by user plan)
  const [freeVpsCount, setFreeVpsCount] = useState<number>(() => {
    const v = localStorage.getItem('freeVpsCount');
    return v !== null ? parseInt(v) : 1;
  });
  const [vps7DaysCount, setVps7DaysCount] = useState<number>(() => {
    const v = localStorage.getItem('vps7DaysCount');
    return v !== null ? parseInt(v) : 0;
  });
  const [vps1MonthCount, setVps1MonthCount] = useState<number>(() => {
    const v = localStorage.getItem('vps1MonthCount');
    return v !== null ? parseInt(v) : 0;
  });
  const [vps3MonthsCount, setVps3MonthsCount] = useState<number>(() => {
    const v = localStorage.getItem('vps3MonthsCount');
    return v !== null ? parseInt(v) : 0;
  });

  const [currentPlan, setCurrentPlan] = useState<string>('Unlimited VPS Plan (Active)');
  const [STORAGE_LIMIT_MB, setStorageLimitMB] = useState<number>(51200); // 50GB default
  const [RAM_LIMIT_MB, setRamLimitMB] = useState<number>(4096); // 4GB default
  const [EXPIRY_DAYS, setExpiryDays] = useState<number>(365);
  const [fileLimit, setFileLimit] = useState<number>(1000); // Effectively unlimited for a single user
  const [tick, setTick] = useState(0);
  const [registrationDate] = useState(() => {
    const stored = localStorage.getItem('registrationDate');
    if (stored) return new Date(stored);
    const now = new Date();
    localStorage.setItem('registrationDate', now.toISOString());
    return now;
  });

  const getRemainingTime = () => {
    const expiryDate = new Date(registrationDate);
    expiryDate.setDate(expiryDate.getDate() + EXPIRY_DAYS);
    const now = new Date();
    const diff = expiryDate.getTime() - now.getTime();
    if (diff <= 0) return "Expired";
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return `${days}d ${hours}h ${minutes}m ${seconds}s left`;
  };

  const parseSize = (sizeStr: string): number => {
    const [val, unit] = sizeStr.split(' ');
    const num = parseFloat(val);
    if (unit === 'KB') return num * 1024;
    if (unit === 'MB') return num * 1024 * 1024;
    if (unit === 'GB') return num * 1024 * 1024 * 1024;
    return num;
  };

  const [stats, setStats] = useState({ storageUsedMB: 0, ramUsedMB: 0 });
  
  const isFull = stats.storageUsedMB >= STORAGE_LIMIT_MB;
  const isExpired = getRemainingTime() === "Expired";


    // Removed Telegram bot state hooks


  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/status', {
        headers: { 'x-user-phone': userPhone }
      });
      if (!res.ok) throw new Error(`Status fetch failed with ${res.status}`);
      const data = await res.json();
      
      // Only update if state actually changed to prevent unnecessary re-renders
      setIsRunning(prev => prev !== data.isRunning ? data.isRunning : prev);
      setLogs(prev => {
        if (JSON.stringify(prev) === JSON.stringify(data.logs)) return prev;
        return data.logs;
      });
    } catch (e: any) {
      console.error("Status fetch failed", e);
    }
  };

  const fetchFiles = async () => {
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/files', {
        headers: { 'x-user-phone': userPhone }
      });
      if (!res.ok) throw new Error(`Files fetch failed with ${res.status}`);
      const data = await res.json();
      setFiles(prev => {
        if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0].name);
      }
    } catch (e: any) {
      console.error("Files fetch failed", e);
    }
  };

  const fetchVpsStatus = async () => {
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/vps/status', {
        headers: { 'x-user-phone': userPhone }
      });
      const data = await res.json();
      setVpsActive(data.isAlive);
      setVpsRunningFiles(data.vpsRunningFiles || []);
    } catch (e) {
      // ignore
    }
  };


  const fetchLogsHistory = async () => {
    try {
      const res = await fetch('/api/logs/history');
      const history = await res.json();
      setLogs(history);
    } catch (e) {
      console.error("Failed to fetch initial logs", e);
    }
  };

  const fetchStats = async () => {
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/user/stats', {
        headers: { 'x-user-phone': userPhone }
      });
      const data = await res.json();
      setStats({
        storageUsedMB: data.storageUsedMB || 0,
        ramUsedMB: data.ramUsedMB || 0
      });
    } catch (e) {
      console.error("Stats fetch failed", e);
    }
  };

  const [userOrders, setUserOrders] = useState<any[]>([]);
  const [hasCompletedOrder, setHasCompletedOrder] = useState(false);

  const fetchUserOrders = async () => {
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/orders');
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const data = await res.json();
      
      // Strict safety check: ensure data is an array
      const ordersArray = Array.isArray(data) ? data : [];
      
      // Filter for current user's orders
      const filtered = ordersArray.filter((o: any) => o && (o.user_id === userPhone || o.phone === userPhone));
      setUserOrders(filtered);
      
      const completed = filtered.find((o: any) => o && o.status === 'completed');
      setHasCompletedOrder(!!completed);

      if (completed) {
        // Map package name to limits
        const pkg = completed.package || '';
        let storage = 10240; // 10GB default
        let ram = 1024; // 1GB default
        let expiry = 7;
        let planLabel = 'Free VPS';

        if (pkg.includes('7 Days')) {
          storage = 20480; ram = 2048; expiry = 7; planLabel = '7 Days VPS';
        } else if (pkg.includes('1 Month')) {
          storage = 81920; ram = 4096; expiry = 30; planLabel = '1 Month VPS';
        } else if (pkg.includes('3 Months')) {
          storage = 163840; ram = 8192; expiry = 90; planLabel = '3 Months VPS';
        }

        setStorageLimitMB(storage);
        setRamLimitMB(ram);
        setExpiryDays(expiry);
        setCurrentPlan(planLabel);
      } else {
        // If no completed order, set to zero or restricted state if they had nothing before
        // But let's allow them to see the dashboard, just restricted execution.
        // If they had a manual plan before, keep it? No, user says "completed না করলে pending থাকবে"
      }
    } catch (e) {
      console.error("Failed to fetch user orders:", e);
    }
  };

  useEffect(() => {
    fetchLogsHistory();
    fetchStatus();
    fetchFiles();
    fetchVpsStatus();
    fetchStats();
    fetchUserOrders();
    
    const interval = setInterval(() => {
      fetchStatus();
      fetchFiles();
      fetchVpsStatus();
      fetchStats();
      fetchUserOrders();
    }, 4000);

    const timerInterval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timerInterval);
    };
  }, []);

  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = logContainerRef.current;
    if (container && logs.length > 0) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isNearBottom) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'auto'
        });
      }
    }
  }, [logs]);

  const handleUpdatePackageCount = (type: 'freeVps' | 'vps7Days' | 'vps1Month' | 'vps3Months', diff: number) => {
    let fCount = freeVpsCount;
    let d7Count = vps7DaysCount;
    let m1Count = vps1MonthCount;
    let m3Count = vps3MonthsCount;

    if (type === 'freeVps') {
      fCount = Math.max(0, freeVpsCount + diff);
      setFreeVpsCount(fCount);
      localStorage.setItem('freeVpsCount', String(fCount));
    } else if (type === 'vps7Days') {
      d7Count = Math.max(0, vps7DaysCount + diff);
      setVps7DaysCount(d7Count);
      localStorage.setItem('vps7DaysCount', String(d7Count));
    } else if (type === 'vps1Month') {
      m1Count = Math.max(0, vps1MonthCount + diff);
      setVps1MonthCount(m1Count);
      localStorage.setItem('vps1MonthCount', String(m1Count));
    } else if (type === 'vps3Months') {
      m3Count = Math.max(0, vps3MonthsCount + diff);
      setVps3MonthsCount(m3Count);
      localStorage.setItem('vps3MonthsCount', String(m3Count));
    }

    const hasPremium = d7Count > 0 || m1Count > 0 || m3Count > 0;
    const activeFreeCount = hasPremium ? 0 : fCount;

    const totalStorage = (activeFreeCount * 10240) + (d7Count * 20480) + (m1Count * 81920) + (m3Count * 163840);
    const totalRam = (activeFreeCount * 1024) + (d7Count * 2048) + (m1Count * 4096) + (m3Count * 8192);
    const totalFileLimit = 1;
    
    let activePlan = 'Free VPS';
    if (m3Count > 0) activePlan = '3 Months VPS';
    else if (m1Count > 0) activePlan = '1 Month VPS';
    else if (d7Count > 0) activePlan = '7 Days VPS';

    setCurrentPlan(activePlan);
    localStorage.setItem('userPlan', activePlan);

    setStorageLimitMB(totalStorage);
    setRamLimitMB(totalRam);
    setFileLimit(totalFileLimit);

    localStorage.setItem('storageLimitMB', String(totalStorage));
    localStorage.setItem('ramLimitMB', String(totalRam));
    localStorage.setItem('fileLimit', String(totalFileLimit));
  };

  const handleBuyPackage = (type: 'freeVps' | 'vps7Days' | 'vps1Month' | 'vps3Months', label: string) => {
    handleUpdatePackageCount(type, 1);
    alert(`🎉 অভিনন্দন! আপনি সফলভাবে "${label}" প্যাকেজটি ক্রয় করেছেন। অতিরিক্ত RAM ও স্টোরেজ আপনার ড্যাশবোর্ডে সফলভাবে যোগ করা হয়েছে!`);
  };

  const upgradePlan = (planName: 'Free VPS' | '7 Days VPS' | '1 Month VPS' | '3 Months VPS') => {
    let fCount = 0;
    let d7Count = 0;
    let m1Count = 0;
    let m3Count = 0;

    if (planName === 'Free VPS') {
      fCount = 1;
    } else if (planName === '7 Days VPS') {
      d7Count = 1;
    } else if (planName === '1 Month VPS') {
      m1Count = 1;
    } else if (planName === '3 Months VPS') {
      m3Count = 1;
    }

    setFreeVpsCount(fCount);
    setVps7DaysCount(d7Count);
    setVps1MonthCount(m1Count);
    setVps3MonthsCount(m3Count);
    localStorage.setItem('freeVpsCount', String(fCount));
    localStorage.setItem('vps7DaysCount', String(d7Count));
    localStorage.setItem('vps1MonthCount', String(m1Count));
    localStorage.setItem('vps3MonthsCount', String(m3Count));

    let storage = (fCount * 10240) + (d7Count * 20480) + (m1Count * 81920) + (m3Count * 163840);
    let ram = (fCount * 1024) + (d7Count * 2048) + (m1Count * 4096) + (m3Count * 8192);
    let expiry = planName === '1 Month VPS' ? 30 : planName === '3 Months VPS' ? 90 : 7;
    let fileLimitVal = 1;

    localStorage.setItem('userPlan', planName);
    localStorage.setItem('storageLimitMB', String(storage));
    localStorage.setItem('ramLimitMB', String(ram));
    localStorage.setItem('fileLimit', String(fileLimitVal));
    
    // Reset registration date to extend expiration from now!
    const now = new Date();
    localStorage.setItem('registrationDate', now.toISOString());

    setCurrentPlan(planName);
    setStorageLimitMB(storage);
    setRamLimitMB(ram);
    setExpiryDays(expiry);
    setFileLimit(fileLimitVal);

    alert(`🎉 অভিনন্দন! আপনার SMART VPS-এ ওয়েবসাইট থেকে কেনা "${planName}" প্যাকেজটি সফলভাবে কানেক্ট করা হয়েছে। RAM ও ইস্টেরেস (Storage) লিমিট সফলভাবে বৃদ্ধি হয়েছে!`);
  };

  const handleRepair = async () => {
    setHealing(true);
    setHealResult(null);
    try {
      const userPhone = localStorage.getItem('userPhone') || "";
      const res = await fetch('/api/user/repair', {
        method: 'POST',
        headers: { 'x-user-phone': userPhone }
      });
      const data = await res.json();
      if (data.success) {
        setHealResult({ success: true, fixed: true, message: data.message });
        fetchUserOrders();
      } else {
        setHealResult({ success: false, fixed: false, message: data.error || "Repair failed" });
      }
    } catch (e: any) {
      setHealResult({ success: false, fixed: false, message: "Network error during repair" });
    } finally {
      setHealing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const uPhone = localStorage.getItem('userPhone') || "";
      const uTelegramId = localStorage.getItem('userTelegramId') || "";
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 
          'x-user-phone': uPhone,
          'x-user-telegram-id': uTelegramId
        },
        body: formData,
      });
      
      if (response.ok) {
        const data = await response.json();
        // Clear input to allow re-uploading same file
        if (e.target) e.target.value = '';
        
        // Success feedback
        if (data.file) {
          setFiles(prev => {
            const exists = prev.find(f => f.name === data.file.name);
            if (exists) return prev.map(f => f.name === data.file.name ? data.file : f);
            return [data.file, ...prev]; // Put new file at top
          });
          setSelectedFile(data.file.name);
        }
        
        alert("✅ আপলোড সফল হয়েছে (Upload Success)!");
        
        // Multiple refreshes to ensure filesystem sync
        fetchFiles();
        setTimeout(fetchFiles, 800);
        setTimeout(fetchFiles, 2000);
      } else {
        const err = await response.json();
        alert(`ফাইল আপলোড ব্যর্থ হয়েছে: ${err.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error("Upload failed", e);
      alert("নেটওয়ার্ক সমস্যার কারণে ফাইল আপলোড করা যায়নি।");
    } finally {
      setUploading(false);
    }
  };

  const restartBot = async () => {
    try {
      await fetch('/api/bot/restart', { method: 'POST' });
      fetchStatus();
    } catch (e) {
      console.error("Restart failed", e);
    }
  };

  const runFile = async (filename: string) => {
    try {
      await fetch('/api/files/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      fetchFiles();
    } catch (e) {
      console.error("Run failed", e);
    }
  };

  const runFileOnVps = async (filename: string) => {
    try {
      await fetch('/api/vps/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      setUpdateResult(`Queued ${filename} for VPS Execution`);
      setTimeout(() => setUpdateResult(null), 3000);
    } catch (e) {
      console.error("VPS Run failed", e);
    }
  };

  const stopFileOnVps = async (filename: string) => {
    try {
      await fetch('/api/vps/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      setUpdateResult(`Queued ${filename} to stop on VPS`);
      setTimeout(() => setUpdateResult(null), 3000);
    } catch (e) {
      console.error("VPS Stop failed", e);
    }
  };

  const stopFile = async (filename: string) => {
    try {
      await fetch('/api/files/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      fetchFiles();
    } catch (e) {
      console.error("Stop failed", e);
    }
  };

  const deleteFile = async (filename: string) => {
    try {
      await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      fetchFiles();
    } catch (e) {
      console.error("Delete failed", e);
    }
  };

  const deleteWorkspace = async (folderName: string) => {
    try {
      await fetch('/api/workspace/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName }),
      });
      fetchFiles();
      if (activeWorkspace === folderName) {
        setActiveWorkspace(null);
      }
    } catch (e) {
      console.error("Workspace delete failed", e);
    }
  };

  const downloadWorkspace = async (folderName: string) => {
    if (folderName === 'Root') return;
    setDownloading(folderName);
    try {
      const response = await fetch(`/api/workspace/download/${folderName}`);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName.split('_')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Download error:", err);
      alert("ডাউনলোড ব্যর্থ হয়েছে (Download Failed)");
    } finally {
      setDownloading(null);
    }
  };

  const restartFile = async (filename: string) => {
    try {
      await stopFile(filename);
      setTimeout(() => {
        runFile(filename);
      }, 1000);
    } catch (e) {
      console.error("Restart failed", e);
    }
  };

  const submitEdit = async () => {
    if (!editingFile || !editPrompt) return;
    setIsEditing(true);
    try {
      await fetch('/api/files/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: editingFile, prompt: editPrompt }),
      });
      setEditingFile(null);
      setEditPrompt('');
    } catch (e) {
      console.error("Edit failed", e);
    }
    setIsEditing(false);
  };

  const sendChatMessage = async () => {
    if (!chatMessage.trim()) return;
    const userMsg = chatMessage.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatMessage("");
    setIsTyping(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'bot', text: data.reply }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: 'bot', text: "দুঃখিত, এই মুহূর্তে কানেকশন পাওয়া যাচ্ছে না।" }]);
    } finally {
      setIsTyping(false);
    }
  };

    const copyVpsScript = () => {
    const script = `
import time
import subprocess
import os
import sys

# Auto-install requests if missing
try:
    import requests
except ImportError:
    print("Installing required 'requests' library...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
        import requests
        print("'requests' library installed successfully!")
    except Exception as e:
        print(f"Error installing 'requests' library: {e}")
        print("Please run manually: pip install requests")
        sys.exit(1)

SERVER_URL = "${window.location.origin}"
BOT_TOKEN = "N/A"
print("==================================================")
print(f"Starting Remote VPS Worker for: {SERVER_URL}")
print(f"Token Configured: {BOT_TOKEN[:10]}...{BOT_TOKEN[-5:] if len(BOT_TOKEN) > 10 else ''}")
print("Waiting for jobs...")
print("==================================================")

running_processes = {}

while True:
    try:
        # Clean up dead processes
        dead_files = []
        for filename, proc in running_processes.items():
            if proc.poll() is not None:
                dead_files.append(filename)
        for filename in dead_files:
            del running_processes[filename]

        # Ping Keep-Alive & Active Files
        try:
            ping_res = requests.post(f"{SERVER_URL}/api/vps/status", json={"isAlive": True, "runningFiles": list(running_processes.keys())}, timeout=8)
            if ping_res.status_code == 200:
                print(f"[OK] Connected and Pinged {SERVER_URL} successfully! Active tasks: {list(running_processes.keys())}", end="\\r")
            else:
                print(f"[WARN] Connected to {SERVER_URL} but got status code {ping_res.status_code}")
        except Exception as ping_err:
            print(f"[ERROR] Connection Failed to {SERVER_URL}. Please check if the URL is correct and active! Details: {ping_err}")
        
        # Check Job Queue
        res = requests.get(f"{SERVER_URL}/api/vps/jobs", timeout=8)
        if res.status_code == 200:
            data = res.json()
            if data.get("hasJob"):
                filename = data["filename"]
                job_type = data.get("type", "start")
                
                if job_type == "stop":
                    print(f"\\n[-] Stop Job Received for: {filename}")
                    if filename in running_processes:
                        proc = running_processes[filename]
                        proc.terminate()
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                        del running_processes[filename]
                        requests.post(f"{SERVER_URL}/api/vps/logs", json={"filename": filename, "message": "Process stopped successfully."})
                    continue

                print(f"\\n[+] Start Job Received for: {filename}")
                
                 # Download the scheduled script
                file_res = requests.get(f"{SERVER_URL}/api/vps/download/{filename}", timeout=10)
                if file_res.status_code == 200:
                    with open(filename, 'wb') as f:
                        f.write(file_res.content)
                    
                    requests.post(f"{SERVER_URL}/api/vps/logs", json={"filename": filename, "message": "Downloaded correctly. Executing..."})
                    
                    if filename in running_processes:
                        running_processes[filename].kill()
                    
                    # Try to find python command
                    cmd = "python3"
                    try:
                        import shutil
                        found_cmd = shutil.which("python3") or shutil.which("python")
                        if found_cmd:
                            cmd = found_cmd
                    except:
                        pass
                    
                    if filename.endswith(".js"): cmd = "node"
                    elif filename.endswith(".sh"): cmd = "bash"

                    # Pass token as environment variable
                    env = os.environ.copy()
                    env["TELEGRAM_TOKEN"] = BOT_TOKEN
                    proc = subprocess.Popen([cmd, filename], env=env)
                    running_processes[filename] = proc
                else:
                    requests.post(f"{SERVER_URL}/api/vps/logs", json={"filename": filename, "message": "Failed to download!"})
        time.sleep(5)
    except Exception as e:
        print(f"\\n[ERROR] General Loop Exception: {e}")
        time.sleep(5)
`;
    const scriptText = script.trim();
    
    let copySuccessful = false;
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(scriptText)
          .then(() => { copySuccessful = true; })
          .catch((err) => {
            console.warn("navigator.clipboard.writeText rejected:", err);
            // Fallback
            const textArea = document.createElement('textarea');
            textArea.value = scriptText;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
            } catch (e) {
              console.warn("execCommand fallback failed:", e);
            }
            document.body.removeChild(textArea);
          });
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = scriptText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (e) {
          console.warn("execCommand fallback failed:", e);
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      console.warn("Primary clipboard access threw error:", err);
      // Absolute fallback if everything threw synchronously
      try {
        const textArea = document.createElement('textarea');
        textArea.value = scriptText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (innerErr) {
        console.error("All copy strategies failed:", innerErr);
      }
    }
    
    setCopyingVps(true);
    setTimeout(() => setCopyingVps(false), 2000);
  };

  const triggerSelfHeal = async () => {
    setHealing(true);
    setHealResult(null);
    try {
      const res = await fetch('/api/ai/diagnose', { method: 'POST' });
      const data = await res.json();
      setHealResult(data);
      fetchStatus();
      fetchFiles();
    } catch (e) {
      console.error("Self-heal trigger failed", e);
      setHealResult({ success: false, fixed: false, message: "A network error occurred while communicating with the diagnostic server." });
    } finally {
      setHealing(false);
    }
  };

  const runLiveUpdate = async () => {
    if (!updaterPrompt.trim()) return;
    setUpdatingCode(true);
    setUpdateResult(null);
    try {
      const res = await fetch('/api/ai/live-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: updaterFile, instruction: updaterPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        setUpdateResult(`Success! ${data.message || ""}`);
        setUpdaterPrompt("");
      } else {
        setUpdateResult(`Refusal: ${data.error || "No dynamic changes returned."}`);
      }
      fetchStatus();
      fetchFiles();
    } catch (e: any) {
      console.error("Auto-updater failed:", e);
      setUpdateResult(`Failed: ${e.message || "Endpoint error"}`);
    } finally {
      setUpdatingCode(false);
    }
  };

  const userName = localStorage.getItem('userName') || 'User';
  const userTelegramUsername = localStorage.getItem('userTelegramUsername') || 'N/A';
  const userPhone = localStorage.getItem('userPhone') || 'N/A';
  const currentFiles = files.length;

  const welcomeMessage = `
〽️ Welcome, ${userName}!

🆔 Your User ID: \`${userPhone}\`
✳️ Username: \`@${userTelegramUsername}\`
🔰 Your Status: ${isExpired ? "Expired" : "Active Student"}
📁 Files Uploaded: ${currentFiles} / ${fileLimit}

🤖 Host & run Python (\`.py\`) or JS (\`.js\`) scripts.
   Upload single scripts or \`.zip\` archives.

👇 Use buttons or type commands.
  `.trim();

  const handleAction = (btn: string) => {
    if (btn === "📤 Upload File") {
      document.getElementById('file-upload-input')?.click();
    } else if (btn === "📂 Check Files") {
      // Scroll to file list or just keep it visible
      const el = document.getElementById('manage-scripts-section');
      el?.scrollIntoView({ behavior: 'smooth' });
    } else if (btn === "⚡ Bot Speed") {
      alert(`API Speed: ${Math.floor(Math.random() * 50 + 20)}ms`);
    } else if (btn === "📊 Statistics") {
      const el = document.getElementById('manage-scripts-section');
      el?.scrollIntoView({ behavior: 'smooth' });
    } else if (btn === "📢 Updates Channel") {
      window.open('https://t.me/rj_amar_shop', '_blank');
    } else if (btn === "📞 Contact Owner") {
      window.open(`https://t.me/RajibNoor`, '_blank');
    } else {
      console.log(`Action '${btn}' is active in the background bot.`);
    }
  };

  return (
    <div className="min-h-screen bg-[#07070a] text-white relative overflow-hidden p-3 md:p-8">
      {/* Custom Toast Notifications */}
      <AnimatePresence>
        {customToast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto"
          >
            <div className={`px-6 py-4 rounded-2xl border backdrop-blur-xl shadow-2xl flex items-center gap-3 font-sans font-bold text-sm min-w-[280px] md:max-w-md ${
              customToast.type === 'success' 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
                : customToast.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                customToast.type === 'success' ? 'bg-emerald-400 animate-ping' : customToast.type === 'error' ? 'bg-rose-400 animate-pulse' : 'bg-cyan-400 animate-pulse'
              }`} />
              <p className="flex-1 text-center md:text-left leading-relaxed">{customToast.message}</p>
              <button 
                onClick={() => setCustomToast(null)} 
                className="text-white/40 hover:text-white/70 transition-colors p-1 rounded-lg"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modals (Blocks nothing but stays visually persistent in iframe!) */}
      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteConfirm(null)}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 10, opacity: 0 }}
              className="relative w-full max-w-md bg-[#0d0e14] border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col font-sans z-10"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl">
                  <AlertTriangle size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                    নিশ্চিত করুন (Confirm Deletion)
                  </h3>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                    আপনি কি নিশ্চিতভাবে এই {deleteConfirm.type === 'file' ? 'ফাইলটি' : 'ওয়ার্কস্পেসটি'} ডিলিট করতে চান?
                  </p>
                  <p className="text-xs text-gray-400 border border-rose-500/5 bg-rose-500/5 px-2.5 py-1.5 rounded-lg font-mono mt-3 truncate break-all">
                    {deleteConfirm.target?.split('/').pop()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] rounded-xl text-xs font-bold text-gray-400 transition-all cursor-pointer"
                >
                  বাতিল করুন (Cancel)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { type, target } = deleteConfirm;
                    setDeleteConfirm(null);
                    if (type === 'file') {
                      deleteFile(target);
                      if (selectedFile === target) {
                        setSelectedFile(null);
                      }
                    } else if (type === 'workspace') {
                      deleteWorkspace(target);
                    }
                  }}
                  className="px-5 py-2 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-lg shadow-rose-500/10"
                >
                  ডিলিট করুন (Confirm)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-gradient-to-tr from-cyan-500/10 to-indigo-600/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-1/4 right-10 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none z-0" />
      
      {/* Background Matrix Grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-5 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />

      

      <AnimatePresence>
        {isHelpOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHelpOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-xl bg-[#0d0e14] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans"
            >
              <div className="p-6 border-b border-white/5 bg-gradient-to-r from-cyan-500/10 to-transparent">
                <h3 className="text-xl font-bold text-cyan-400 flex items-center gap-2">
                  <Sparkles size={20} />
                  VPS ব্যবহার নির্দেশিকা
                </h3>
              </div>
              <div className="p-8 space-y-6 overflow-y-auto max-h-[60vh]">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold shrink-0">1</div>
                  <div>
                    <h4 className="font-bold text-gray-200">ফাইল আপলোড (Script Upload)</h4>
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed">যেকোনো <span className="text-emerald-400">.py (Python)</span> অথবা <span className="text-cyan-400">.js (NodeJS)</span> ফাইল আপলোড করুন। আপলোড হওয়ার সাথে সাথেই এটি অটোমেটিক ব্যাকগ্রাউন্ডে চলা শুরু করবে।</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold shrink-0">2</div>
                  <div>
                    <h4 className="font-bold text-gray-200">Port Proxy (পোর্ট প্রক্সি)</h4>
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed">আপনার কোড যদি কোনো পোর্টে রান করে (যেমন: Flask, FastAPI), তবে ব্রাউজারে <code className="bg-white/5 px-2 py-0.5 rounded text-cyan-300">/proxy/[port]/</code> লিখে আপনার সার্ভার এক্সেস করতে পারবেন।</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold shrink-0">3</div>
                  <div>
                    <h4 className="font-bold text-gray-200">ডিপেন্ডেন্সি ইনস্টল</h4>
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed">আপনার প্রজেক্টের জন্য রিকোয়ারমেন্টস লাগলে <code className="text-white">requirements.txt</code> আপলোড করে <b>"প্যাকেজ ইনস্টল"</b> বাটনে চাপ দিন।</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold shrink-0">4</div>
                  <div>
                    <h4 className="font-bold text-gray-200">কন্ট্রোল প্যানেল</h4>
                    <p className="text-sm text-gray-400 mt-1 leading-relaxed">Start, Stop এবং Restart বাটন দিয়ে যেকোনো সময় আপনার প্রসেস কন্ট্রোল করতে পারবেন। ফাইল ম্যানেজার ডিলিট বা ডাউনলোড অপশন ব্যবহার করতে পারবেন।</p>
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-white/5 bg-white/[0.02]">
                <button 
                  onClick={() => setIsHelpOpen(false)}
                  className="w-full py-3 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 font-bold rounded-2xl transition-all border border-cyan-500/30"
                >
                  ঠিক আছে, বুঝতে পেরেছি (Dismiss)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {isHistoryOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-xl bg-[#0a0b10] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                    <RotateCcw className="text-indigo-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-100 italic">Payment History</h2>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Past Transactions & Packages</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-xl transition-all text-gray-500 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto max-h-[60vh] space-y-4 custom-scrollbar">
                {userOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 opacity-30 gap-3">
                    <AlertTriangle size={48} />
                    <span className="font-bold tracking-widest uppercase">No History Found</span>
                  </div>
                ) : (
                  userOrders.map((order, idx) => (
                    <div key={idx} className="bg-white/5 border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:bg-white/[0.08] transition-colors">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-gray-200">{order.package}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">Amount: {order.amount} TK</span>
                          <span className="text-gray-700">•</span>
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">{order.date || 'Recently'}</span>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        order.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                        order.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}>
                        {order.status}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-6 border-t border-white/5 bg-white/[0.01]">
                 <p className="text-[10px] text-center text-gray-500 font-medium">নিরাপদ পেমেন্ট গেটওয়ে দ্বারা সংরক্ষিত</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isFileManagerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFileManagerOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0a0b10] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] font-sans"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                    <Folder className="text-indigo-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-100">ফাইল ম্যানেজার (File Manager)</h2>
                    <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Manage and Download Files</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsFileManagerOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-xl transition-all text-gray-500 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {(() => {
                  if (files.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-20 opacity-30 gap-3">
                        <HardDrive size={48} />
                        <span className="font-bold uppercase tracking-widest">No Storage Found</span>
                      </div>
                    );
                  }

                  // Group files by directory
                  const groups: { [key: string]: BotFile[] } = {};
                  files.forEach(f => {
                    const parts = f.name.split('/');
                    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
                    if (!groups[dir]) groups[dir] = [];
                    groups[dir].push(f);
                  });

                  return Object.entries(groups).map(([dir, groupFiles]) => (
                    <div key={dir} className="space-y-3">
                      <div className="flex items-center gap-2 px-2 pb-1 border-b border-white/5">
                        <Folder size={14} className="text-cyan-400/50" />
                        <span className="text-[10px] font-bold tracking-widest uppercase text-gray-500">
                          {dir === 'Root' ? 'General Files' : `Workspace: ${dir}`}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {groupFiles.map((file) => (
                          <div 
                            key={file.name}
                            className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/[0.05] transition-all group"
                          >
                            <div className="flex items-center gap-4">
                              <div className={`p-2.5 rounded-xl border border-white/10 ${file.name.endsWith('.py') ? 'bg-blue-500/10 text-blue-400' : file.name.endsWith('.js') ? 'bg-amber-500/10 text-amber-400' : 'bg-gray-500/10 text-gray-400'}`}>
                                <FileText size={20} />
                              </div>
                              <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-bold text-gray-200 truncate max-w-[180px] md:max-w-md">
                                  {file.name.split('/').pop()}
                                </span>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-[10px] text-gray-500 font-mono font-bold uppercase">{file.size}</span>
                                  <span className={`text-[10px] font-bold uppercase tracking-widest ${file.isRunning ? 'text-emerald-400' : 'text-gray-600'}`}>
                                    {file.isRunning ? '• Active' : '• Stored'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(file.name.endsWith('.py') || file.name.endsWith('.js')) && (
                                <button 
                                  onClick={() => file.isRunning ? stopFile(file.name) : runFile(file.name)}
                                  className={`p-3 rounded-xl transition-all active:scale-95 ${file.isRunning ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 shadow-lg shadow-rose-500/5' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 shadow-lg shadow-emerald-500/5'}`}
                                >
                                  {file.isRunning ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                                </button>
                              )}
                              <a 
                                href={`/api/vps/download/${encodeURIComponent(file.name)}`}
                                className="p-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 rounded-xl transition-all active:scale-95 shadow-lg shadow-cyan-500/5 group-hover:scale-105"
                                title="Download File"
                              >
                                <Download size={18} />
                              </a>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirm({ type: 'file', target: file.name });
                                }}
                                className="p-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl transition-all active:scale-95 opacity-0 group-hover:opacity-100"
                                title="Delete File"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              <div className="p-6 border-t border-white/5 bg-white/[0.01] flex justify-center">
                 <button 
                  onClick={() => setIsFileManagerOpen(false)}
                  className="px-8 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all border border-white/10"
                 >
                   বন্ধ করুন (Close)
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="relative z-10 max-w-5xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 pr-12 pt-8 md:pt-0">
          <div>
            <div className="flex items-center gap-3">
              <SostaLogo className="h-11 w-auto" />
            </div>
            <p className="text-gray-400 mt-1">কম টাকায় সেরা VPS প্রোভাইডার</p>
          </div>
          <div className="flex items-center gap-3 font-sans">
            <div className="hidden md:flex flex-col items-end gap-1 px-4 py-2 bg-white/[0.03] border border-white/10 rounded-xl font-sans">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 font-sans">
                <Server size={10} /> RAM & ইস্টেরেস (Storage)
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-[10px] font-bold text-emerald-400 font-sans">Unlimited (আনলিমিটেড)</span>
              </div>
            </div>
            <div className="hidden md:flex flex-col items-end gap-1 px-4 py-2 bg-white/[0.03] border border-white/10 rounded-xl">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                <RotateCcw size={10} /> টাইম (Remaining)
              </div>
              <span className={`text-xs font-bold font-mono ${isExpired ? 'text-rose-400' : 'text-cyan-400'}`}>{getRemainingTime()}</span>
            </div>
            <div className="hidden md:flex items-center gap-2 bg-white/[0.03] border border-white/10 text-cyan-400 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider">
              <Sparkles size={12} />
              {currentPlan === 'Starter' ? 'Starter Plan' : currentPlan === 'Premium' ? 'VIP Premium Plan' : 'Ultimate Pro Plan'}
            </div>
          </div>
        </header>

        <div className="absolute top-4 right-2 md:top-8 md:right-8 z-50 flex items-center gap-2">
          <button 
            onClick={() => setIsHelpOpen(true)}
            className="p-2.5 bg-white/5 border border-white/10 shadow-lg rounded-xl text-white hover:bg-white/10 hover:border-cyan-500/40 transition-all cursor-pointer"
            title="Help"
          >
            <Menu size={24} />
          </button>
        </div>

        <AnimatePresence>
        </AnimatePresence>
        
        {/* API Key Status Banner */}
        {!isRunning && logs.some(log => log.includes("API_ID or API_HASH is missing")) && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="mb-6 overflow-hidden pr-12 md:pr-0"
          >
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-4">
              <div className="p-2 bg-rose-500/20 rounded-xl text-rose-400">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-rose-400">Environment Setup Required (টেলিগ্রাম কী সেট করুন)</h3>
                <p className="text-xs text-rose-300/70 mt-1 leading-relaxed">
                  আপনার টেলিগ্রাম বোটটি শুরু করতে **API_ID** এবং **API_HASH** সেট করা প্রয়োজন।
                  <br />
                  ১. প্রথমে <a href="https://my.telegram.org" target="_blank" className="underline text-rose-400 font-bold hover:text-rose-300">my.telegram.org</a> থেকে আপনার কীগুলো নিন।
                  <br />
                  ২. এরপর <b>App Settings &rarr; Environment Variables</b>-এ গিয়ে সেগুলো সেভ করুন।
                  <br />
                  ৩. কীগুলো যোগ করা হলে বোটটি অটোমেটিক রিস্টার্ট হবে।
                </p>
              </div>
            </div>
          </motion.div>
        )}


       {/* Server Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 bg-gradient-to-br from-indigo-500/10 to-transparent border border-indigo-500/20 rounded-[2rem] relative overflow-hidden"
        >
          <div className="absolute -right-4 -bottom-4 opacity-5">
            <Server size={80} />
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-indigo-500/20 rounded-2xl text-indigo-400">
              <Server size={24} />
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-500/20 px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-emerald-400 uppercase">Live</span>
            </div>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">System Status</span>
          <h3 className="text-2xl font-black text-gray-100">ONLINE</h3>
          <p className="text-[10px] text-indigo-400 font-bold mt-2">Node {sysInfo?.nodeVersion || 'v20.x'}</p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="p-6 bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/20 rounded-[2rem] relative overflow-hidden"
        >
           <div className="absolute -right-4 -bottom-4 opacity-5">
            <HardDrive size={80} />
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-cyan-500/20 rounded-2xl text-cyan-400">
              <HardDrive size={24} />
            </div>
            <span className="text-[10px] font-bold text-cyan-600 bg-cyan-500/5 px-2 rounded-full border border-cyan-500/10">VPS Storage</span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">Available Memory</span>
          <h3 className="text-2xl font-black text-gray-100">{sysInfo?.freeMem || 'Calculating...'}</h3>
          <div className="w-full bg-white/5 h-1 rounded-full mt-3 overflow-hidden">
             <div className="bg-cyan-500 h-full w-[45%] rounded-full shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="p-6 bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 rounded-[2rem] relative overflow-hidden"
        >
           <div className="absolute -right-4 -bottom-4 opacity-5">
            <Bot size={80} />
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-amber-500/20 rounded-2xl text-amber-400">
              <Bot size={24} />
            </div>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-500/5 px-2 rounded-full border border-amber-500/10">Runtime</span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1">VPS Uptime</span>
          <h3 className="text-2xl font-black text-gray-100">{sysInfo?.uptime || '0.00'} HRS</h3>
          <p className="text-[10px] text-amber-500 font-bold mt-2">OS: {sysInfo?.osType || 'Linux'}</p>
        </motion.div>
      </div>

      {/* Dashboard Elements */}
      <div className="mt-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Activity size={14} className="text-emerald-500" />
                  Recent Activity
                </h4>
                <div className="space-y-3">
                   {logs.slice(-3).reverse().map((log, i) => (
                      <div key={i} className="text-[11px] text-gray-400 font-mono bg-black/20 p-2 rounded-lg border border-white/5 truncate">
                        {log}
                      </div>
                   ))}
                   {logs.length === 0 && <span className="text-[10px] text-gray-600 italic">No recent activity detected</span>}
                </div>
             </div>
             <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-500" />
                  Smart VPS Status
                </h4>
                <p className="text-[11px] text-gray-400 leading-relaxed font-sans">
                  আপনার সার্ভার বর্তমানে সম্পূর্ণ সচল এবং নতুন টাস্ক গ্রহণের জন্য প্রস্তুত। আনলিমিটেড ফাইল আপলোড এবং ম্যানেজমেন্ট সুবিধা উপভোগ করুন।
                </p>
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 transition-all duration-500 mt-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-[#12131a]/95 border border-white/[0.06] rounded-2xl p-6 shadow-2xl backdrop-blur-xl relative overflow-hidden group">
            {/* Top accent bar */}
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-cyan-500 to-indigo-500" />
            
            <h2 className="text-base font-bold mb-4 text-gray-200 flex items-center gap-2">
              <Upload size={18} className="text-cyan-400" />
              <span>ফাইল আপলোড করুন (Upload File)</span>
            </h2>
            <div className="relative">
              <input 
                type="file" 
                id="file-upload-input"
                onChange={handleUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={uploading}
              />
              <div className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all ${uploading ? 'bg-cyan-500/5 border-cyan-500/40 animate-pulse' : 'border-white/10 group-hover:border-cyan-500/40 group-hover:bg-white/[0.02]'}`}>
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="text-cyan-400 animate-spin" size={32} />
                    <span className="text-cyan-400 font-bold animate-pulse font-sans">Uploading Large File... Please Wait</span>
                    <span className="text-[10px] text-gray-500 font-sans italic">Do not refresh or close this tab</span>
                  </div>
                ) : (
                  <>
                    <div className="bg-white/5 border border-white/10 p-3 rounded-2xl mb-3 group-hover:scale-105 transition-transform">
                      <Upload className="text-cyan-400" size={20} />
                    </div>
                    <p className="text-gray-300 text-sm font-medium text-center font-sans">Click to browse or drag and drop</p>
                    <p className="text-gray-500 text-xs mt-1 font-sans">Supports .py, .js, .zip and more</p>
                    <p className="text-[10px] text-yellow-500/85 mt-3 font-semibold uppercase tracking-wider bg-yellow-500/5 border border-yellow-500/10 px-3 py-1 rounded-lg">
                      💡 ফাইল আপলোড করলে অটোমেটিক রান হবে
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>

          <section id="manage-scripts-section" className="bg-[#12131a]/95 border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl relative">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-emerald-500 to-cyan-500" />
            
            <div className="p-6 border-b border-white/[0.05] flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                    <HistoryIcon size={18} className="text-indigo-400" />
                    <span>Workspace History</span>
                  </h2>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                    Manage your active projects and workspaces
                  </p>
                </div>
                <button 
                  onClick={() => fetchFiles()}
                  className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all active:scale-95 text-cyan-400 border border-white/10 flex items-center gap-2 text-xs font-bold"
                  title="রিফ্রেশ করুন"
                >
                  <RefreshCw size={16} />
                  রিফ্রেশ
                </button>
                <button 
                  onClick={async () => {
                    const res = await fetch('/api/requirements/install', { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) alert("✅ " + data.message);
                    else alert("❌ " + (data.error || "Installation failed"));
                  }}
                  className="p-2.5 bg-amber-500/10 hover:bg-amber-500/20 rounded-xl transition-all active:scale-95 text-amber-400 border border-amber-500/30 flex items-center gap-2 text-xs font-bold"
                  title="Install requirements.txt"
                >
                  <Key size={16} />
                  প্যাকেজ ইনস্টল
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-sans md:ml-auto">
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 px-3 py-1.5 rounded-xl">
                  <Server size={14} className="text-cyan-400" />
                  <div className="flex flex-col">
                    <span className="text-[8px] text-gray-400 font-bold uppercase leading-none">RAM</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">Unlimited (আনলিমিটেড)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 px-3 py-1.5 rounded-xl font-sans">
                  <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[8px] text-gray-400 font-bold uppercase leading-none">ইস্টেরেস (Storage)</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">Unlimited (আনলিমিটেড)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 px-3 py-1.5 rounded-xl font-sans">
                  <RotateCcw size={14} className="text-rose-455 text-rose-400 animate-pulse" />
                  <div className="flex flex-col">
                    <span className="text-[8px] text-gray-400 font-bold uppercase leading-none">Time</span>
                    <span className={`text-xs font-mono font-bold ${isExpired ? 'text-rose-450 text-rose-400' : 'text-gray-200'}`}>{getRemainingTime().split(' ')[0]}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#12131a]/80 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider border-b border-white/[0.05]">
                  <tr>
                    <th className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {activeWorkspace ? (
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => setActiveWorkspace(null)}
                              className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-indigo-400 flex items-center gap-1.5 group"
                            >
                              <RotateCcw size={14} className="group-hover:-rotate-90 transition-transform" />
                              <span className="text-[10px] font-bold">Back</span>
                            </button>
                            <span className="text-gray-600">/</span>
                            <span className="text-indigo-300 normal-case tracking-normal">
                              {(() => {
                                const p = activeWorkspace.split('_');
                                if (p.length > 1 && !isNaN(Number(p[p.length-1])) && p[p.length-1].length >= 10) {
                                  return p.slice(0, -1).join('_');
                                }
                                return activeWorkspace;
                              })()}
                            </span>
                          </div>
                        ) : (
                          "Status & Script Details"
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-right">Actions Panel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  <AnimatePresence mode="popLayout">
                    {(() => {
                      if (files.length === 0) {
                        return (
                          <tr>
                            <td colSpan={2} className="px-6 py-12 text-center">
                              <div className="flex flex-col items-center gap-2 opacity-30">
                                <Folder size={32} />
                                <span className="text-sm font-bold uppercase tracking-widest font-sans">No Workspaces Found</span>
                                <span className="text-[10px] lowercase font-sans">Upload a script to create a workspace</span>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      // If we are inside a workspace, show only those files
                      if (activeWorkspace) {
                        const wsFiles = files.filter(f => {
                          const parts = f.name.split('/');
                          const dirName = parts.length > 1 ? parts[0] : 'Root';
                          return dirName === activeWorkspace;
                        });

                        return wsFiles.map((file, index) => (
                          <motion.tr 
                            key={file.name}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            onClick={() => setSelectedFile(file.name)}
                            className={`transition-colors cursor-pointer ${selectedFile === file.name ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-xl border ${file.isRunning ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-gray-400 border-white/5'}`}>
                                  <FileText size={16} />
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-500 font-mono font-bold">{(index + 1).toString().padStart(2, '0')}.</span>
                                    <span className="font-bold text-gray-200 truncate max-w-[150px] md:max-w-xs">{file.name.split('/').pop()}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-gray-500 font-mono">{file.size}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${file.isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-gray-700'}`} />
                                    <span className={`text-[9px] font-bold uppercase tracking-tight ${file.isRunning ? 'text-emerald-500' : 'text-gray-600'}`}>{file.isRunning ? 'Running' : 'Stopped'}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                {file.isRunning ? (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); stopFile(file.name); }}
                                    className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all bg-white/[0.02] border border-white/10 active:scale-95 cursor-pointer"
                                    title="Stop Script"
                                  >
                                    <Square size={16} fill="currentColor" />
                                  </button>
                                ) : (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); runFile(file.name); }}
                                    className="flex items-center justify-center gap-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-xl text-xs font-black transition-all border border-emerald-500/30 active:scale-95 cursor-pointer"
                                    title="Run Locally"
                                  >
                                    <Play size={10} className="fill-current" />
                                     Run
                                  </button>
                                )}
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setDeleteConfirm({ type: 'file', target: file.name });
                                  }}
                                  className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer border border-rose-500/10"
                                  title="Delete Script"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ));
                      }

                      // Group files by top-level directory (Workspace)
                      const workspaceMap: { [key: string]: { name: string, files: BotFile[], isRunning: boolean, mainScript: BotFile | null } } = {};
                      files.forEach(f => {
                        const parts = f.name.split('/');
                        const dirName = parts.length > 1 ? parts[0] : 'Root';
                        if (!workspaceMap[dirName]) {
                          workspaceMap[dirName] = { name: dirName, files: [], isRunning: false, mainScript: null };
                        }
                        workspaceMap[dirName].files.push(f);
                        if (f.isRunning) workspaceMap[dirName].isRunning = true;
                        
                        // Heuristic for main script: prioritized .py/.js or match folder name
                        if (!workspaceMap[dirName].mainScript && (f.name.endsWith('.py') || f.name.endsWith('.js'))) {
                          workspaceMap[dirName].mainScript = f;
                        } else if (workspaceMap[dirName].mainScript) {
                           // If we already have one, check if another matches the folder name better
                           const fBasename = f.name.split('/').pop()?.split('.')[0];
                           if (fBasename === dirName.split('_')[0]) {
                              workspaceMap[dirName].mainScript = f;
                           }
                        }
                      });

                      const workspaces = Object.values(workspaceMap);

                      return workspaces.map((ws, index) => {
                        const displayFile = ws.mainScript || ws.files[0];
                        const isWsRunning = ws.isRunning;
                        
                        // Clean display name (remove trailing timestamp suffix)
                        let folderDisplayName = ws.name;
                        if (ws.name !== 'Root') {
                          const parts = ws.name.split('_');
                          if (parts.length > 1) {
                            const lastPart = parts[parts.length - 1];
                            if (!isNaN(Number(lastPart)) && lastPart.length >= 10) {
                              folderDisplayName = parts.slice(0, -1).join('_');
                            }
                          }
                        } else {
                          folderDisplayName = displayFile?.name || 'General';
                        }
                        
                        return (
                          <motion.tr 
                            key={ws.name}
                            layout
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            onClick={() => setActiveWorkspace(ws.name)}
                            className={`transition-colors cursor-pointer ${selectedFile && ws.files.some(f => f.name === selectedFile) ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-xl border ${isWsRunning ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'bg-gray-500/10 text-gray-400 border-white/5'}`}>
                                  {ws.name === 'Root' ? <FileText size={18} /> : <Folder size={18} fill={isWsRunning ? "currentColor" : "none"} className={isWsRunning ? "animate-pulse" : ""} />}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-500 font-mono font-bold">{(index + 1).toString().padStart(2, '0')}.</span>
                                    <span className={`font-bold truncate max-w-[150px] md:max-w-xs ${isWsRunning ? 'text-indigo-300' : 'text-gray-200'}`}>
                                      {folderDisplayName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[9px] text-gray-550 text-gray-500 uppercase tracking-widest font-sans">
                                      {ws.files.length} {ws.files.length === 1 ? 'file' : 'active-objects'}
                                    </span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${isWsRunning ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-700'}`} />
                                    <span className={`text-[9px] font-bold uppercase tracking-tight ${isWsRunning ? 'text-emerald-500' : 'text-gray-600'}`}>
                                      {isWsRunning ? 'Executing' : 'Standby'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                {isWsRunning ? (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if (displayFile) stopFile(displayFile.name); }}
                                    className="p-2.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-all bg-white/[0.02] border border-white/10 active:scale-95 cursor-pointer shadow-lg"
                                    title="Stop Process"
                                  >
                                    <Square size={16} fill="currentColor" />
                                  </button>
                                ) : (
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if (displayFile) runFile(displayFile.name); }}
                                    className="flex items-center justify-center gap-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 px-3 py-2 rounded-xl text-[10px] font-black transition-all border border-indigo-500/30 active:scale-95 cursor-pointer"
                                    title="Start Project"
                                  >
                                    <Play size={10} className="fill-current" />
                                    Run
                                  </button>
                                )}
                                <div className="w-[1px] h-4 bg-white/5 mx-1" />
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation();
                                    downloadWorkspace(ws.name);
                                  }}
                                  disabled={ws.name === 'Root' || downloading === ws.name}
                                  className={`p-2.5 rounded-xl transition-all border border-white/5 bg-white/[0.02] active:scale-95 cursor-pointer hover:bg-indigo-500/10 hover:text-indigo-400 group relative ${ws.name === 'Root' ? 'opacity-20 pointer-events-none' : ''}`}
                                  title="Download Project ZIP"
                                >
                                  {downloading === ws.name ? (
                                    <RefreshCw size={16} className="animate-spin" />
                                  ) : (
                                    <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
                                  )}
                                </button>
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setDeleteConfirm({ type: 'workspace', target: ws.name });
                                  }}
                                  className="p-2.5 text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer shadow-sm border border-rose-500/10"
                                  title="Delete Workspace"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      });
                    })()}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </section>

          {/* Removed VPS Package Store / প্যানেল শপ */}

        </div>

        <div className="space-y-6 text-gray-200">
          {/* Quick Actions Panel */}
          {selectedFile && (
            <motion.section 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#12131a]/95 border border-white/[0.06] rounded-2xl p-5 shadow-2xl relative overflow-hidden group"
            >
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-indigo-500 to-cyan-500" />
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${files.find(f => f.name === selectedFile)?.isRunning ? 'bg-indigo-500 animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'bg-gray-600'}`} />
                    <span className="text-xs font-bold text-gray-300 truncate max-w-[180px]">
                      {(() => {
                        const parts = selectedFile.split('/');
                        let name = parts.length > 1 ? parts[0] : parts[0];
                        // Clean if workspace
                        if (parts.length > 1) {
                          const p = name.split('_');
                          if (p.length > 1 && !isNaN(Number(p[p.length-1])) && p[p.length-1].length >= 10) {
                            name = p.slice(0, -1).join('_');
                          }
                        }
                        return name;
                      })()}
                    </span>
                  </div>
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded-lg border border-white/5">
                    {files.find(f => f.name === selectedFile)?.isRunning ? '.active' : 'idle'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 font-sans">
                  <span className={`text-[10px] min-w-[75px] text-center font-black uppercase tracking-tight px-3 py-2.5 rounded-lg border ${files.find(f => f.name === selectedFile)?.isRunning ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 animate-pulse' : 'text-gray-500 bg-white/5 border-white/5'}`}>
                    {files.find(f => f.name === selectedFile)?.isRunning ? '.execution' : '.standby'}
                  </span>

                  <button 
                    onClick={() => runFile(selectedFile)}
                    disabled={files.find(f => f.name === selectedFile)?.isRunning}
                    className={`flex-1 min-w-[65px] flex items-center justify-center gap-1 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold border ${files.find(f => f.name === selectedFile)?.isRunning ? 'opacity-50 cursor-not-allowed bg-gray-500/10 text-gray-500 border-white/5' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}
                  >
                    <Play size={12} className="fill-current" />
                    Start
                  </button>

                  <button 
                    onClick={() => stopFile(selectedFile)}
                    disabled={!files.find(f => f.name === selectedFile)?.isRunning}
                    className={`flex-1 min-w-[65px] flex items-center justify-center gap-1 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold border ${!files.find(f => f.name === selectedFile)?.isRunning ? 'opacity-50 cursor-not-allowed bg-gray-500/10 text-gray-500 border-white/5' : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'}`}
                  >
                    <Square size={12} className="fill-current" />
                    Stop
                  </button>
                  
                  <button 
                    onClick={() => restartFile(selectedFile)}
                    className="flex-1 min-w-[75px] flex items-center justify-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold"
                  >
                    <RefreshCw size={12} />
                    Restart
                  </button>
                  
                  <button 
                    onClick={() => {
                       logContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex-1 min-w-[70px] flex items-center justify-center gap-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold"
                  >
                    <Terminal size={12} />
                    &gt; Logs
                  </button>
                  
                  <button 
                    onClick={() => {
                      if (selectedFile) {
                        setDeleteConfirm({ type: 'file', target: selectedFile });
                      }
                    }}
                    className="flex-1 min-w-[70px] flex items-center justify-center gap-1 bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 border border-rose-600/30 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>

                  <button 
                    onClick={() => setIsHistoryOpen(true)}
                    className="flex-1 min-w-[80px] flex items-center justify-center gap-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 py-2.5 rounded-lg transition-all active:scale-95 cursor-pointer text-[11px] font-bold"
                  >
                    <RotateCcw size={12} />
                    History
                  </button>
                </div>
              </div>
            </motion.section>
          )}

          <section className="bg-[#12131a]/95 border border-white/[0.06] rounded-2xl p-6 h-[500px] flex flex-col shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-cyan-400 to-indigo-500" />
            
            <h2 className="text-sm font-extrabold mb-4 text-gray-300 flex items-center justify-between gap-2 relative z-10 font-sans">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
                <span>System Logs</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 shadow-sm flex items-center gap-1">
                <Terminal size={10} /> Online Console
              </span>
            </h2>
            <div 
              ref={logContainerRef}
              className="flex-1 bg-black/60 border border-white/5 rounded-xl p-4 font-mono text-[11px] overflow-y-auto space-y-1.5 relative z-10 scrollbar-thin scrollbar-thumb-white/10"
            >
              {logs.length > 0 ? logs.map((log, i) => {
                const isErr = log.includes('[ERR]') || log.includes('failed') || log.includes('error');
                if (isErr && log.includes('Gemini')) return null;
                return (
                  <div key={i} className={`${isErr ? 'text-rose-400' : 'text-gray-300'} break-words border-l-2 ${isErr ? 'border-rose-500' : 'border-white/10'} pl-2 py-0.5`}>
                    {log}
                  </div>
                );
              }) : (
                <div className="text-gray-500 italic font-sans text-xs">Waiting for activity...</div>
              )}
              <div ref={logEndRef} />
            </div>

            {/* Terminal Command Input (Termux-like Console) */}
            <form onSubmit={handleExecuteCommand} className="mt-3 relative z-10 flex gap-2 font-mono text-xs">
              <div className="flex-1 flex items-center bg-black/80 border border-white/10 rounded-xl px-3 py-2 bg-gradient-to-b from-gray-950 to-black text-gray-100 placeholder-gray-500 focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/10 transition-all">
                <span className="text-emerald-400 font-bold mr-2 shrink-0 select-none text-[10px] sm:text-xs">rajibvps@termux:~$</span>
                <input 
                  type="text"
                  value={terminalCommand}
                  onChange={(e) => setTerminalCommand(e.target.value)}
                  placeholder="pip install pyrogram / npm i ... / custom commands"
                  className="flex-1 bg-transparent border-none outline-none text-gray-100 placeholder-gray-600 font-mono text-[11px]"
                  disabled={isExecuting}
                />
              </div>
              <button 
                type="submit"
                disabled={isExecuting || !terminalCommand.trim()}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-sans font-bold text-[11px] rounded-xl transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-md shadow-emerald-950/20 active:scale-95 duration-100"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw size={12} className="animate-spin text-emerald-400" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play size={10} />
                    Run
                  </>
                )}
              </button>
            </form>
          </section>
        </div>
      </div>

      {/* Floating Support Menu (Matching User Image) */}
      <div className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-[100] flex flex-col items-end gap-3 font-sans">
        <AnimatePresence>
          {isSupportOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="flex flex-col items-end gap-3 mb-2 pr-1"
            >
              {/* WhatsApp */}
              <a 
                target="_blank" 
                rel="noreferrer"
                href="https://wa.me/8801339597482" 
                className="flex items-center gap-3 group transition-transform duration-300"
              >
                <div className="bg-white text-[#07070a] px-4 py-2 rounded-lg text-sm font-bold shadow-xl">
                  WhatsApp
                </div>
                <div className="w-14 h-14 bg-[#25D366] rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform cursor-pointer shrink-0">
                  <MessageCircle size={30} fill="white" className="text-white" />
                </div>
              </a>

              {/* Telegram */}
              <a 
                target="_blank" 
                rel="noreferrer"
                href="https://t.me/RajibNoor" 
                className="flex items-center gap-3 group transition-transform duration-300"
              >
                <div className="bg-white text-[#07070a] px-4 py-2 rounded-lg text-sm font-bold shadow-xl">
                  Telegram
                </div>
                <div className="w-14 h-14 bg-[#0088cc] rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform cursor-pointer shrink-0">
                  <Send size={28} fill="white" className="text-white ml-[-2px]" />
                </div>
              </a>

              {/* Support Chat (Renamed from Live Chat) */}
              <button 
                onClick={() => {
                  setIsChatOpen(true);
                  setIsSupportOpen(false);
                }}
                className="flex items-center gap-3 group transition-transform duration-300"
              >
                <div className="bg-white text-[#07070a] px-4 py-2 rounded-lg text-sm font-bold shadow-xl">
                  সাপোর্ট চ্যাট
                </div>
                <div className="w-14 h-14 bg-[#1abc9c] rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform cursor-pointer shrink-0">
                  <Bot size={30} className="text-white" />
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main TOGGLE Button with 'Contact Us' (যোগাযোগ করুন) label */}
        <div className="flex items-center gap-3 pr-1">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-[#2ecc71] text-white px-5 py-3 md:px-6 md:py-3.5 rounded-xl font-bold shadow-[0_0_20px_rgba(46,204,113,0.3)] border border-white/20 whitespace-nowrap cursor-pointer text-sm md:text-base"
            onClick={() => setIsSupportOpen(!isSupportOpen)}
          >
            যোগাযোগ করুন
          </motion.div>
          
          <motion.button 
            whileHover={{ scale: 1.1, rotate: isSupportOpen ? 90 : 0 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsSupportOpen(!isSupportOpen)}
            className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(46,204,113,0.4)] cursor-pointer transition-all border-2 border-white/20 ${isSupportOpen ? 'bg-rose-500' : 'bg-[#2ecc71]'}`}
          >
            {isSupportOpen ? <X size={28} /> : <Headphones size={28} />}
          </motion.button>
        </div>
      </div>

      {/* Live Chat Modal */}
      <AnimatePresence>
        {isChatOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pr-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-[#0d0e14] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col font-sans h-[600px]"
            >
              <div className="p-5 border-b border-white/10 bg-gradient-to-r from-emerald-500/20 to-transparent flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                    <Bot className="text-emerald-400" size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-100 italic">Support AI Assistant</h3>
                    <p className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold">Always Online</p>
                  </div>
                </div>
                <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-white/5 rounded-xl text-gray-500 hover:text-white transition-all">
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                <div className="flex justify-start">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl rounded-tl-none max-w-[85%] text-sm text-gray-300 leading-relaxed">
                    আসসালামু আলাইকুম! আমি SMART VPS-এর AI এসিস্ট্যান্ট। আপনাকে কীভাবে সাহায্য করতে পারি? আপনার VPS বা সার্ভিস সম্পর্কে যেকোনো প্রশ্ন করতে পারেন।
                  </div>
                </div>
                {chatHistory.map((chat, idx) => (
                  <div key={idx} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`p-4 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
                      chat.role === 'user' 
                        ? 'bg-emerald-500 text-white rounded-tr-none shadow-lg shadow-emerald-500/20' 
                        : 'bg-white/5 border border-white/10 text-gray-300 rounded-tl-none'
                    }`}>
                      {chat.text}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 p-3 rounded-2xl rounded-tl-none flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-white/[0.02] border-t border-white/5">
                <div className="relative flex items-center gap-2">
                  <input 
                    type="text" 
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                    placeholder="আপনার প্রশ্নটি এখানে লিখুন..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-gray-600"
                  />
                  <button 
                    onClick={sendChatMessage}
                    disabled={!chatMessage.trim() || isTyping}
                    className="p-4 bg-emerald-500 hover:bg-emerald-600 rounded-2xl text-white transition-all disabled:opacity-50 disabled:hover:bg-emerald-500 active:scale-95 shadow-lg shadow-emerald-500/20"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  </div>
);
}
