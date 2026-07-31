import React, { useState, useEffect, useRef } from 'react';
import { Server, Settings, Terminal, RefreshCw, Upload, Check, Copy, Link as LinkIcon, BookOpen, AlertCircle, GitBranch, GitPullRequest, HelpCircle, ExternalLink, X } from 'lucide-react';

export default function App() {
  // --- STATE ---
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('https://muster-okay-unpaired.ngrok-free.dev');
  const [useExternalApi, setUseExternalApi] = useState<boolean>(true);
  const [isConfiguringApi, setIsConfiguringApi] = useState(false);
  const [isGitModalOpen, setIsGitModalOpen] = useState(false);
  const [isGitPulling, setIsGitPulling] = useState(false);
  const [gitPullResult, setGitPullResult] = useState<{ success?: boolean; message?: string; output?: string } | null>(null);
  
  const [stats, setStats] = useState<{
    total: number;
    memory: string;
    dir: string;
    categories: Record<string, number>;
  }>({
    total: 0,
    memory: '0 MB',
    dir: './dictionaries',
    categories: {},
  });

  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [serverStatus, setServerStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState<string>('VietPhrase');

  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

  const [activeTab, setActiveTab] = useState<'translate' | 'dictionary'>('translate');

  // Dictionary Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ zh: string; vi: string; cat: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- API HELPER ---
  const getEndpoint = (path: string) => {
    if (useExternalApi && apiBaseUrl.trim()) {
      const base = apiBaseUrl.trim().replace(/\/$/, '');
      return `${base}${path}`;
    }
    return path;
  };

  // --- EFFECTS ---
  useEffect(() => {
    fetchStats();
  }, [apiBaseUrl, useExternalApi]);

  // --- METHODS ---
  const fetchStats = async () => {
    setIsLoadingStats(true);
    setServerStatus('checking');
    try {
      const res = await fetch(getEndpoint('/api/dictionary/stats'), {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setStats({
          total: data.stats?.Total || 0,
          memory: data.memoryUsageMB || '0 MB',
          dir: data.dictDirectoryPath || './dictionaries',
          categories: data.stats || {},
        });
        setServerStatus('connected');
      } else {
        setServerStatus('disconnected');
      }
    } catch (err) {
      console.error(err);
      setServerStatus('disconnected');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    setIsTranslating(true);
    try {
      const res = await fetch(getEndpoint('/api/translate-text'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ text: sourceText }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranslatedText(data.translated || data.translatedText || '');
      } else {
        setTranslatedText('Lỗi dịch thuật: ' + res.statusText);
      }
    } catch (err) {
      console.error(err);
      setTranslatedText('Lỗi kết nối máy chủ.');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSearchEntries = async () => {
    setIsSearching(true);
    try {
      const url = new URL(getEndpoint('/api/dictionary/entries'), window.location.origin);
      if (searchCategory) url.searchParams.append('category', searchCategory);
      if (searchQuery) url.searchParams.append('search', searchQuery);
      url.searchParams.append('limit', '50');

      const res = await fetch(url.toString(), {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.entries || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadStatus(`Đang nạp tệp vào [${uploadCategory}]...`);
    for (const file of (Array.from(files) as File[])) {
      try {
        const textContent = await file.text();
        await fetch(getEndpoint('/api/dictionary/upload-txt'), {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify({ category: uploadCategory, textContent, overwrite: false }),
        });
      } catch (err) {
        console.error(err);
      }
    }

    setUploadStatus('Đã nạp xong!');
    setTimeout(() => setUploadStatus(null), 3000);
    fetchStats();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGitPull = async () => {
    setIsGitPulling(true);
    setGitPullResult(null);
    try {
      const res = await fetch(getEndpoint('/api/git/pull'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
      });
      const data = await res.json();
      setGitPullResult(data);
      if (data.success) {
        fetchStats();
      }
    } catch (err: any) {
      setGitPullResult({
        success: false,
        message: 'Lỗi kết nối khi gọi API git pull: ' + err.message,
      });
    } finally {
      setIsGitPulling(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans flex flex-col">
      
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
            <BookOpen className="text-emerald-400" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">VietPhrase Web</h1>
            <p className="text-xs text-slate-500 font-medium">Professional Translation Interface</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleGitPull}
            disabled={isGitPulling}
            className="flex items-center gap-1.5 bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 text-indigo-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            title="Kéo mã nguồn và từ điển mới nhất từ Git"
          >
            <GitPullRequest size={15} className={isGitPulling ? 'animate-spin text-indigo-400' : 'text-indigo-400'} />
            <span>{isGitPulling ? 'Đang Git Pull...' : 'Cập nhật từ Git'}</span>
          </button>

          <button
            onClick={() => setIsGitModalOpen(true)}
            className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            title="Hướng dẫn liên kết với GitHub & đồng bộ"
          >
            <GitBranch size={15} className="text-emerald-400" />
            <span>Liên kết Git</span>
          </button>

          <div className="flex items-center gap-2 bg-slate-950/50 px-3 py-1.5 rounded-full border border-slate-800/80">
            <span className={`w-2 h-2 rounded-full ${
              serverStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 
              serverStatus === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
            }`}></span>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {serverStatus}
            </span>
          </div>
          
          <button 
            onClick={() => setIsConfiguringApi(!isConfiguringApi)}
            className={`p-2 rounded-lg border transition-colors ${isConfiguringApi ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* Settings / API Sidebar (Slide-in) */}
        {isConfiguringApi && (
          <div className="w-full lg:w-80 bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto shrink-0 shadow-xl z-20">
            <div className="p-5 border-b border-slate-800/80">
              <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                <LinkIcon size={16} className="text-cyan-400" /> API Connection
              </h2>
              <div className="space-y-3">
                {/* Toggle switch for External API */}
                <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="pr-2">
                    <span className="text-xs font-bold text-slate-200 block">Dùng API Kết nối Ngrok</span>
                    <span className="text-[10px] text-slate-400">
                      {useExternalApi ? 'Đang bật API Ngrok' : 'Đang bật Server nội bộ'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseExternalApi(!useExternalApi)}
                    aria-label="Toggle External API"
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      useExternalApi ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        useExternalApi ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Server URL</label>
                  <input
                    type="text"
                    disabled={!useExternalApi}
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://muster-okay-unpaired.ngrok-free.dev"
                    className={`w-full bg-slate-950 border rounded-md px-3 py-2 text-sm outline-none transition-colors ${
                      useExternalApi ? 'border-slate-700 text-slate-200 focus:border-emerald-500' : 'border-slate-800 text-slate-600 cursor-not-allowed'
                    }`}
                  />
                  <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
                    Mặc định: <code className="text-slate-400">https://muster-okay-unpaired.ngrok-free.dev</code>. Tắt công tắc để dùng Server nội bộ.
                  </p>
                </div>

                <button
                  onClick={fetchStats}
                  className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} className={isLoadingStats ? 'animate-spin' : ''} /> Test Connection
                </button>
              </div>
            </div>

            <div className="p-5 flex-1 space-y-6">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                  <Terminal size={16} className="text-indigo-400" /> Dictionary Stats
                </h2>
                <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/80 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-500">Total Entries</span>
                    <span className="font-bold">{stats.total.toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-300">
                    <span className="text-slate-500">RAM Usage</span>
                    <span className="text-emerald-400 font-bold">{stats.memory}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  {Object.entries(stats.categories)
                    .filter(([k]) => k !== 'Total')
                    .map(([cat, count]) => (
                      <div key={cat} className="flex flex-col justify-center bg-slate-800/30 p-2 rounded-md border border-slate-700/50">
                        <span className="text-slate-500 font-semibold">{cat}</span>
                        <span className="text-slate-200 font-bold text-sm mt-0.5">{Number(count).toLocaleString('vi-VN')}</span>
                      </div>
                    ))}
                </div>
              </div>

              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                  <Upload size={16} className="text-pink-400" /> Upload Data
                </h2>
                <div className="space-y-3">
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 outline-none focus:border-pink-500 transition-colors"
                  >
                    <option value="VietPhrase">VietPhrase</option>
                    <option value="Name">Name</option>
                    <option value="Pronouns">Pronouns</option>
                    <option value="LuatNhan">LuatNhan</option>
                    <option value="PhienAm">PhienAm</option>
                  </select>
                  
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleUpload}
                    multiple
                    accept=".txt"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-pink-600/10 hover:bg-pink-600/20 text-pink-400 border border-pink-500/30 py-2 rounded-md text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload size={16} /> Choose TXT Files
                  </button>
                  
                  {uploadStatus && (
                    <div className="text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 p-2 rounded-md text-center">
                      {uploadStatus}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          
          {/* Tab Navigation */}
          <div className="flex items-center gap-6 px-4 sm:px-6 lg:px-8 border-b border-slate-800 bg-slate-900/50">
            <button
              onClick={() => setActiveTab('translate')}
              className={`py-4 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'translate' 
                  ? 'border-emerald-500 text-emerald-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Dịch thuật
            </button>
            <button
              onClick={() => setActiveTab('dictionary')}
              className={`py-4 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'dictionary' 
                  ? 'border-emerald-500 text-emerald-400' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Quản lý Từ điển
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {activeTab === 'translate' && (
              <div className="h-full flex flex-col">
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 min-h-0">
                  
                  {/* Source Area */}
                  <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-900 shadow-sm overflow-hidden focus-within:border-emerald-500/50 transition-colors">
                    <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Chinese (Source)</span>
                      {sourceText.length > 0 && (
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                          {sourceText.length} chars
                        </span>
                      )}
                    </div>
                    <textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Paste Chinese text here..."
                      className="flex-1 bg-transparent p-4 text-slate-200 outline-none resize-none leading-relaxed text-[15px]"
                    />
                  </div>

                  {/* Target Area */}
                  <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-900 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                      <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Vietnamese (VietPhrase)</span>
                      {translatedText && (
                        <button 
                          onClick={() => navigator.clipboard.writeText(translatedText)}
                          className="text-slate-500 hover:text-emerald-400 transition-colors flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                        >
                          <Copy size={12} /> Copy
                        </button>
                      )}
                    </div>
                    <textarea
                      value={translatedText}
                      readOnly
                      placeholder="Translation will appear here..."
                      className="flex-1 bg-transparent p-4 text-slate-200 outline-none resize-none leading-relaxed text-[15px]"
                    />
                  </div>

                </div>

                {/* Action Bar */}
                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {serverStatus === 'disconnected' && (
                      <span className="text-xs text-rose-400 flex items-center gap-1.5 bg-rose-950/30 px-3 py-1.5 rounded-md border border-rose-900/50">
                        <AlertCircle size={14} /> Server Offline
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleTranslate}
                    disabled={isTranslating || !sourceText.trim() || serverStatus === 'disconnected'}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 transform active:scale-[0.98]"
                  >
                    {isTranslating ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" /> Translating...
                      </>
                    ) : (
                      <>
                        <Terminal size={18} /> Translate Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            
            {activeTab === 'dictionary' && (
              <div className="space-y-6 max-w-4xl">
                {/* Stats cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  {Object.entries(stats.categories).map(([cat, count]) => (
                    <div key={cat} className="bg-slate-900 border border-slate-800 p-3 rounded-xl">
                      <div className="text-xs text-slate-400 font-medium">{cat}</div>
                      <div className="text-lg font-bold text-white mt-1">{Number(count).toLocaleString('vi-VN')}</div>
                    </div>
                  ))}
                </div>

                {/* Dictionary Search */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Tra cứu Từ điển ({stats.total.toLocaleString('vi-VN')} từ)
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <select
                      value={searchCategory}
                      onChange={(e) => setSearchCategory(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                    >
                      <option value="">Tất cả danh mục</option>
                      <option value="VietPhrase">VietPhrase</option>
                      <option value="Name">Name</option>
                      <option value="Pronouns">Pronouns</option>
                      <option value="LuatNhan">LuatNhan</option>
                      <option value="PhienAm">PhienAm</option>
                    </select>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchEntries()}
                      placeholder="Nhập từ tiếng Trung hoặc tiếng Việt..."
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleSearchEntries}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-xs font-bold transition-colors"
                    >
                      {isSearching ? 'Đang tìm...' : 'Tìm kiếm'}
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-4 border border-slate-800/80 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider sticky top-0 border-b border-slate-800">
                          <tr>
                            <th className="p-3">Tiếng Trung (ZH)</th>
                            <th className="p-3">Tiếng Việt (VI)</th>
                            <th className="p-3">Danh mục</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 text-slate-300">
                          {searchResults.map((entry, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="p-3 font-semibold text-emerald-400">{entry.zh}</td>
                              <td className="p-3">{entry.vi}</td>
                              <td className="p-3 text-slate-500">{entry.cat}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Hướng dẫn & Cập nhật Git */}
      {isGitModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                  <GitBranch className="text-indigo-400" size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Liên kết & Cập nhật qua Git</h3>
                  <p className="text-xs text-slate-400">Đồng bộ mã nguồn và từ điển trực tiếp với GitHub</p>
                </div>
              </div>
              <button
                onClick={() => setIsGitModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto text-xs text-slate-300">
              {/* Bước 1 */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-100 text-sm">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center border border-emerald-500/30">1</span>
                  <span>Xuất dự án lên GitHub từ AI Studio:</span>
                </div>
                <p className="text-slate-400 pl-7">
                  Ở góc trên bên phải màn hình AI Studio (thanh công cụ trên cùng), nhấn nút <strong className="text-white font-semibold">Export</strong> hoặc <strong className="text-white font-semibold">Export to GitHub</strong>. AI Studio sẽ tự động push toàn bộ code dự án sang repository GitHub của bạn.
                </p>
              </div>

              {/* Bước 2 */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-100 text-sm">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center border border-emerald-500/30">2</span>
                  <span>Tải mã nguồn về máy tính cá nhân (Lần đầu):</span>
                </div>
                <div className="pl-7 space-y-2">
                  <p className="text-slate-400">Mở Terminal/CMD trên máy tính của bạn và chạy lệnh:</p>
                  <pre className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                    git clone &lt;URL_GitHub_Của_Bạn&gt;{"\n"}
                    cd vietphrase-app{"\n"}
                    npm install
                  </pre>
                </div>
              </div>

              {/* Bước 3 */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-100 text-sm">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center border border-emerald-500/30">3</span>
                  <span>Đồng bộ về máy mỗi khi AI sửa code ở đây:</span>
                </div>
                <div className="pl-7 space-y-2">
                  <p className="text-slate-400">
                    Mỗi khi bạn yêu cầu AI sửa ứng dụng hoặc nạp thêm từ điển mới ở đây, chỉ cần vào terminal trên máy tính gõ:
                  </p>
                  <pre className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-cyan-400 font-mono text-[11px]">
                    git pull origin main
                  </pre>
                  <p className="text-slate-400">
                    Hoặc nhấn nút <strong className="text-indigo-400 font-semibold">Cập nhật từ Git</strong> bên dưới để yêu cầu máy chủ tự động thực thi kéo code mới.
                  </p>
                </div>
              </div>

              {/* Git Pull Action Box */}
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-indigo-200">Chạy Git Pull Ngay</h4>
                    <p className="text-[11px] text-indigo-300/70">Tự động thực thi git pull trên Server hiện tại</p>
                  </div>
                  <button
                    onClick={handleGitPull}
                    disabled={isGitPulling}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    <GitPullRequest size={15} className={isGitPulling ? 'animate-spin' : ''} />
                    <span>{isGitPulling ? 'Đang Git Pull...' : 'Thực Hiện Git Pull'}</span>
                  </button>
                </div>

                {gitPullResult && (
                  <div className={`p-3 rounded-lg text-xs border font-mono whitespace-pre-wrap ${
                    gitPullResult.success 
                      ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-300' 
                      : 'bg-amber-950/50 border-amber-800/80 text-amber-300'
                  }`}>
                    <p className="font-bold mb-1 font-sans">{gitPullResult.message}</p>
                    {gitPullResult.output && (
                      <div className="text-[10px] opacity-80 max-h-32 overflow-y-auto">
                        {gitPullResult.output}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end">
              <button
                onClick={() => setIsGitModalOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

