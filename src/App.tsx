import React, { useState, useEffect, useRef } from 'react';
import { Server, Settings, Terminal, RefreshCw, Upload, Check, Copy, Link as LinkIcon, BookOpen, AlertCircle, GitBranch, GitPullRequest, HelpCircle, ExternalLink, X, Pause, Play, Square, Zap, Trash2, Sparkles, Sliders, Layers, Type, Hash, Plus, Loader2 } from 'lucide-react';

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
  const [appVersion, setAppVersion] = useState<number>(0.2);

  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState<boolean>(true);
  const [translationEngine, setTranslationEngine] = useState<'gemini' | 'vietphrase'>('gemini');
  const [segmentationMode, setSegmentationMode] = useState<'paragraph' | 'sentence'>('paragraph');
  const [maxPhraseLength, setMaxPhraseLength] = useState<number>(16);
  const [dictMode, setDictMode] = useState<'standard' | 'ai'>('standard');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [translateProgress, setTranslateProgress] = useState<{ current: number; total: number } | null>(null);
  const [translationStatus, setTranslationStatus] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'translate' | 'dictionary'>('translate');

  // Dictionary Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ zh: string; vi: string; cat: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);

  // AI Dictionary Extraction Modal State
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedCategory, setExtractedCategory] = useState<string>('AiDict');
  const [extractedPairs, setExtractedPairs] = useState<Array<{ zh: string; vi: string; cat?: string; checked: boolean }>>([]);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  // AI Server & Proxy Configuration State
  const [activeAiModel, setActiveAiModel] = useState<string>('gemini-flash-latest');
  const [hasAiApiKey, setHasAiApiKey] = useState<boolean>(false);
  const [aiProxyUrl, setAiProxyUrl] = useState<string>('');
  const [customApiKeyInput, setCustomApiKeyInput] = useState<string>('');
  const [selectedModelInput, setSelectedModelInput] = useState<string>('gemini-flash-latest');
  const [providerTypeInput, setProviderTypeInput] = useState<string>('gemini');
  const [proxyUrlInput, setProxyUrlInput] = useState<string>('');
  const [isSavingAiConfig, setIsSavingAiConfig] = useState(false);
  const [aiConfigMessage, setAiConfigMessage] = useState<string | null>(null);

  // Dictionary Group Filter
  const [dictGroupFilter, setDictGroupFilter] = useState<'all' | 'standard' | 'ai'>('all');

  // --- API HELPER WITH AUTOMATIC FALLBACK ---
  const getEndpoint = (path: string, forceInternal = false) => {
    if (!forceInternal && useExternalApi && apiBaseUrl.trim()) {
      const base = apiBaseUrl.trim().replace(/\/$/, '');
      return `${base}${path}`;
    }
    return path;
  };

  const fetchWithFallback = async (path: string, options?: RequestInit, forceInternalOnly = false): Promise<Response> => {
    // Nếu bật API kết nối ngoài, thử gọi máy chủ ngoài trước
    if (!forceInternalOnly && useExternalApi && apiBaseUrl.trim()) {
      const extUrl = getEndpoint(path, false);
      try {
        const res = await fetch(extUrl, options);
        if (res.ok) {
          return res;
        }
        console.warn(`Máy chủ ngoài trả về mã ${res.status} cho API [${path}]. Tự động chuyển sang gọi Máy chủ AI/Nội bộ...`);
      } catch (err) {
        console.warn(`Lỗi mạng khi kết nối máy chủ ngoài cho API [${path}]. Tự động chuyển sang Máy chủ AI/Nội bộ...`, err);
      }
    }
    // Tự động dùng máy chủ nội bộ nếu máy chủ ngoài bị lỗi, không có, hoặc bắt buộc dùng nội bộ
    const intUrl = getEndpoint(path, true);
    return await fetch(intUrl, options);
  };

  // --- EFFECTS ---
  useEffect(() => {
    fetchStats();
    fetchAiConfig();
  }, [apiBaseUrl, useExternalApi]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Tự động dịch khi nhập hoặc dán văn bản (nếu bật Auto Translate)
  useEffect(() => {
    if (!autoTranslate) return;

    if (!sourceText.trim()) {
      setTranslatedText('');
      setTranslateProgress(null);
      setTranslationStatus(null);
      return;
    }

    const timer = setTimeout(() => {
      handleTranslate();
    }, 500);

    return () => clearTimeout(timer);
  }, [sourceText, autoTranslate, translationEngine, segmentationMode, maxPhraseLength, dictMode, apiBaseUrl, useExternalApi]);

  // --- METHODS ---
  const fetchStats = async () => {
    setIsLoadingStats(true);
    setServerStatus('checking');
    try {
      const res = await fetchWithFallback('/api/dictionary/stats', {
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
        if (data.activeAiModel) setActiveAiModel(data.activeAiModel);
        if (typeof data.hasAiApiKey === 'boolean') setHasAiApiKey(data.hasAiApiKey);
        if (typeof data.aiProxyUrl === 'string') setAiProxyUrl(data.aiProxyUrl);
        if (typeof data.appVersion === 'number') setAppVersion(data.appVersion);
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

  const fetchAiConfig = async () => {
    try {
      const res = await fetchWithFallback('/api/ai/config', {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      }, true); // Bắt buộc dùng máy chủ nội bộ cho cấu hình AI
      if (res.ok) {
        const data = await res.json();
        setActiveAiModel(data.activeModel || 'gemini-flash-latest');
        setHasAiApiKey(!!data.hasApiKey);
        setAiProxyUrl(data.proxyUrl || '');
        setSelectedModelInput(data.activeModel || 'gemini-flash-latest');
        if (data.providerType) setProviderTypeInput(data.providerType);
        setProxyUrlInput(data.proxyUrl || '');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveAiConfig = async () => {
    setIsSavingAiConfig(true);
    setAiConfigMessage(null);
    try {
      const res = await fetchWithFallback('/api/ai/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          activeModel: selectedModelInput,
          providerType: providerTypeInput,
          customKey: customApiKeyInput,
          proxyUrl: proxyUrlInput,
        }),
      }, true); // Bắt buộc dùng máy chủ nội bộ cho cấu hình AI

      if (res.ok) {
        const data = await res.json();
        setActiveAiModel(data.activeModel);
        setHasAiApiKey(data.hasApiKey);
        setAiProxyUrl(data.proxyUrl);
        if (typeof data.appVersion === 'number') setAppVersion(data.appVersion);
        setAiConfigMessage("Đã lưu cấu hình AI máy chủ thành công!");
        fetchStats();
      } else {
        const err = await res.json().catch(() => ({}));
        setAiConfigMessage(`Lỗi: ${err.error || res.statusText}`);
      }
    } catch (err: any) {
      setAiConfigMessage("Không thể kết nối máy chủ để lưu cấu hình AI.");
    } finally {
      setIsSavingAiConfig(false);
    }
  };

  const handleTranslate = async (overrideEngine?: 'gemini' | 'vietphrase') => {
    if (!sourceText.trim()) return;

    const engineToUse = overrideEngine || translationEngine;
    if (overrideEngine) {
      setTranslationEngine(overrideEngine);
    }

    // Hủy yêu cầu đang chạy nếu có
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsTranslating(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setTranslationStatus(engineToUse === 'gemini' ? 'Đang gọi AI Gemini dịch mượt...' : 'Đang dịch nhanh bằng bộ từ điển...');

    // Chia nhỏ văn bản theo cài đặt phân đoạn (đoạn văn hoặc theo câu)
    let units: string[] = [];
    if (segmentationMode === 'sentence') {
      const matches = sourceText.match(/[^。！？.!?\r\n]+[。！？.!?\r\n]*|\r?\n+/g);
      units = matches ? matches : [sourceText];
    } else {
      units = sourceText.split(/\r?\n/);
    }

    const CHUNK_SIZE = segmentationMode === 'sentence' ? 20 : 15;
    const chunks: string[] = [];

    for (let i = 0; i < units.length; i += CHUNK_SIZE) {
      const joinDelim = segmentationMode === 'sentence' ? '' : '\n';
      chunks.push(units.slice(i, i + CHUNK_SIZE).join(joinDelim));
    }

    let fullTranslated = '';
    setTranslateProgress({ current: 0, total: chunks.length });

    try {
      for (let index = 0; index < chunks.length; index++) {
        if (controller.signal.aborted) break;

        const unitLabel = segmentationMode === 'sentence' ? 'câu' : 'đoạn';

        // Xử lý trạng thái tạm dừng: chờ nếu người dùng nhấn Tạm dừng
        while (isPausedRef.current && !controller.signal.aborted) {
          setTranslationStatus(`Đã tạm dừng (Đã dịch ${index}/${chunks.length} ${unitLabel})`);
          await new Promise((res) => setTimeout(res, 250));
        }

        if (controller.signal.aborted) break;

        setTranslationStatus(`Đang dịch ${unitLabel} ${index + 1}/${chunks.length} (${engineToUse === 'gemini' ? 'AI Gemini' : 'Từ điển'})...`);
        const chunk = chunks[index];

        if (!chunk.trim()) {
          const joinDelim = segmentationMode === 'sentence' ? '' : '\n';
          fullTranslated += (index > 0 ? joinDelim : '') + chunk;
          setTranslatedText(fullTranslated);
          setTranslateProgress({ current: index + 1, total: chunks.length });
          continue;
        }

        const isGeminiEngine = engineToUse === 'gemini';
        const res = await fetchWithFallback('/api/translate-text', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify({ 
            text: chunk, 
            engine: engineToUse,
            maxPhraseLength: maxPhraseLength,
            dictMode: dictMode,
          }),
          signal: controller.signal,
        }, isGeminiEngine); // Bắt buộc dùng máy chủ nội bộ nếu là dịch bằng AI Gemini

        if (res.ok) {
          const data = await res.json();
          const chunkResult = data.translated || data.translatedText || '';
          const joinDelim = segmentationMode === 'sentence' ? '' : '\n';
          fullTranslated += (index > 0 ? joinDelim : '') + chunkResult;
          setTranslatedText(fullTranslated);
          setTranslateProgress({ current: index + 1, total: chunks.length });
          if (data.fallbackNotice) {
            setTranslationStatus(`⚠️ ${data.fallbackNotice}`);
          }
        } else {
          const joinDelim = segmentationMode === 'sentence' ? '' : '\n';
          fullTranslated += (index > 0 ? joinDelim : '') + `[Lỗi dịch ${unitLabel} ${index + 1}: ${res.statusText}]`;
          setTranslatedText(fullTranslated);
        }
      }

      if (!controller.signal.aborted) {
        setTranslationStatus('Dịch hoàn tất!');
        setTimeout(() => setTranslationStatus(null), 3000);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setTranslationStatus('Đã dừng dịch thuật.');
      } else {
        console.error(err);
        setTranslationStatus('Lỗi kết nối máy chủ.');
        setTranslatedText((prev) => prev ? prev + '\n[Lỗi kết nối máy chủ]' : 'Lỗi kết nối máy chủ.');
      }
    } finally {
      setIsTranslating(false);
      setIsPaused(false);
      isPausedRef.current = false;
      abortControllerRef.current = null;
    }
  };

  const handleStartExtractFromAi = async () => {
    if (!sourceText.trim() || !translatedText.trim()) {
      alert("Vui lòng dán văn bản gốc và thực hiện dịch mượt AI trước khi trích xuất từ điển.");
      return;
    }
    setIsExtractModalOpen(true);
    setIsExtracting(true);
    setExtractStatus("Gemini AI đang so sánh văn bản gốc tiếng Trung và bản dịch mượt tiếng Việt để trích xuất từ vựng, tên nhân vật, cụm từ...");
    setExtractedPairs([]);

    try {
      const res = await fetchWithFallback('/api/dictionary/extract-from-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          sourceText,
          translatedText,
        }),
      }, true); // Bắt buộc dùng máy chủ nội bộ vì tính năng này dùng AI Gemini

      if (res.ok) {
        const data = await res.json();
        if (data.pairs && Array.isArray(data.pairs) && data.pairs.length > 0) {
          setExtractedPairs(data.pairs.map((p: any) => ({
            zh: p.zh,
            vi: p.vi,
            cat: p.cat || extractedCategory || 'AiDict',
            checked: true
          })));
          setExtractStatus(`Đã trích xuất & tự động phân loại ${data.pairs.length} từ vựng/tên riêng từ bản dịch AI!`);
        } else {
          setExtractStatus("Không tìm thấy cụm từ/tên riêng mới nào trong đoạn văn bản này.");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setExtractStatus(`Lỗi trích xuất: ${errData.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      setExtractStatus("Lỗi kết nối máy chủ khi trích xuất từ điển.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStartExtractFast = async () => {
    if (!sourceText.trim()) {
      alert("Vui lòng nhập văn bản gốc tiếng Trung.");
      return;
    }
    setIsExtractModalOpen(true);
    setIsExtracting(true);
    setExtractStatus("Đang trích xuất nhanh bằng thuật toán từ điển (tức thì)...");
    setExtractedPairs([]);

    try {
      const res = await fetchWithFallback('/api/dictionary/extract-fast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          sourceText,
        }),
      }, true);

      if (res.ok) {
        const data = await res.json();
        if (data.pairs && Array.isArray(data.pairs) && data.pairs.length > 0) {
          setExtractedPairs(data.pairs.map((p: any) => ({
            zh: p.zh,
            vi: p.vi,
            cat: p.cat || extractedCategory || 'AiDict',
            checked: true
          })));
          setExtractStatus(`Đã trích xuất nhanh ${data.pairs.length} từ vựng từ bộ từ điển máy chủ!`);
        } else {
          setExtractStatus("Không tìm thấy cụm từ nào khớp với từ điển trong đoạn văn bản này.");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setExtractStatus(`Lỗi trích xuất nhanh: ${errData.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      setExtractStatus("Lỗi kết nối máy chủ khi trích xuất nhanh.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveExtractedPairs = async () => {
    const selectedEntries = extractedPairs
      .filter(p => p.checked && p.zh.trim() && p.vi.trim())
      .map(p => ({ zh: p.zh.trim(), vi: p.vi.trim(), cat: p.cat || extractedCategory || 'AiDict' }));

    if (selectedEntries.length === 0) {
      alert("Vui lòng chọn ít nhất 1 cặp từ vựng để lưu.");
      return;
    }

    try {
      setExtractStatus("Đang lưu các từ vựng vào các danh mục từ điển máy chủ...");
      const res = await fetchWithFallback('/api/dictionary/add-entries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          category: extractedCategory,
          entries: selectedEntries,
          forceAiPrefix: true,
        }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.appVersion === 'number') setAppVersion(data.appVersion);
        alert(`Đã lưu thành công ${selectedEntries.length} từ vựng vào các tệp bộ từ điển tương ứng!`);
        setIsExtractModalOpen(false);
        fetchStats();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Lỗi lưu từ điển: ${err.error || res.statusText}`);
      }
    } catch (err: any) {
      console.error(err);
      alert("Lỗi kết nối máy chủ khi lưu từ điển.");
    }
  };

  const handlePauseToggle = () => {
    setIsPaused((prev) => !prev);
  };

  const handleStopTranslate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setIsPaused(false);
    isPausedRef.current = false;
    setTranslationStatus('Đã dừng dịch.');
  };

  const handleSearchEntries = async () => {
    setIsSearching(true);
    try {
      let path = `/api/dictionary/entries?limit=50`;
      if (searchCategory) path += `&category=${encodeURIComponent(searchCategory)}`;
      if (searchQuery) path += `&search=${encodeURIComponent(searchQuery)}`;

      const res = await fetchWithFallback(path, {
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

  const handleExportTxt = (category: string) => {
    const url = getEndpoint(`/api/dictionary/export-txt?category=${encodeURIComponent(category)}`);
    window.open(url, '_blank');
  };

  const handleClearCategory = async (category?: string, catName?: string, group?: 'standard' | 'ai') => {
    const label = catName || (group === 'standard' ? 'Toàn bộ từ điển Gốc' : group === 'ai' ? 'Toàn bộ từ điển AI' : 'Toàn bộ từ điển');
    if (!confirm(`Bạn có chắc chắn muốn xóa dữ liệu [${label}] trên máy chủ?`)) return;
    try {
      const res = await fetchWithFallback('/api/dictionary/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ category, group }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.appVersion === 'number') setAppVersion(data.appVersion);
        fetchStats();
        setSearchResults([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadStatus(`Đang nạp tệp vào [${uploadCategory}]...`);
    for (const file of (Array.from(files) as File[])) {
      try {
        const textContent = await file.text();
        const resUpload = await fetchWithFallback('/api/dictionary/upload-txt', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify({ category: uploadCategory, textContent, overwrite: false }),
        });
        if (resUpload.ok) {
          const dataUpload = await resUpload.json().catch(() => ({}));
          if (typeof dataUpload.appVersion === 'number') setAppVersion(dataUpload.appVersion);
        }
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
      const res = await fetchWithFallback('/api/git/pull', {
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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">VietPhrase Web</h1>
              <span className="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono shadow-sm">
                v{appVersion.toFixed(1)} beta
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">VietPhrase & Gemini AI Translator System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Badge Loại AI Model */}
          <div className="hidden sm:flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full text-xs font-bold text-amber-300" title="Model AI hiện tại trên máy chủ">
            <Sparkles size={13} className="text-amber-400 fill-amber-400/30" />
            <span>AI Model: {activeAiModel}</span>
          </div>

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

            {/* AI Model & Proxy Settings Block */}
            <div className="p-5 border-b border-slate-800/80 bg-slate-950/40 space-y-4">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles size={16} className="text-amber-400" /> Cấu Hình Máy Chủ AI & Proxy Trung Gian
              </h2>

              <div className="space-y-3 text-xs">
                {/* Chọn Chuẩn AI / Provider */}
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Định Dạng Kết Nối AI (Provider):</label>
                  <select
                    value={providerTypeInput}
                    onChange={(e) => setProviderTypeInput(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-amber-300 font-bold outline-none focus:border-amber-500"
                  >
                    <option value="gemini">⚡ Google Gemini API / Gemini Proxy (Định dạng Google)</option>
                    <option value="openai">🌐 OpenAI / OpenRouter / Third-Party Proxy (v1/chat/completions)</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Cho phép kết nối bất kỳ máy chủ AI trung gian, OpenRouter hoặc Proxy tùy chọn mà <b>không bắt buộc dùng Key Google AI trực tiếp</b>.
                  </p>
                </div>

                {/* Chọn / Nhập Model AI */}
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Tên Model AI:</label>
                  <input
                    type="text"
                    list="ai-model-list"
                    value={selectedModelInput}
                    onChange={(e) => setSelectedModelInput(e.target.value)}
                    placeholder="Ví dụ: gemini-flash-latest, google/gemini-2.5-flash, deepseek-chat..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none focus:border-amber-500"
                  />
                  <datalist id="ai-model-list">
                    <option value="gemini-flash-latest" />
                    <option value="gemini-2.5-flash" />
                    <option value="gemini-3.1-pro-preview" />
                    <option value="gemini-3.1-flash-lite" />
                    <option value="google/gemini-2.5-flash" />
                    <option value="gpt-4o-mini" />
                    <option value="deepseek-chat" />
                  </datalist>
                </div>

                {/* Máy Chủ Proxy AI Trung Gian */}
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Địa Chỉ Proxy Trung Gian (Proxy Base URL):</label>
                  <input
                    type="text"
                    value={proxyUrlInput}
                    onChange={(e) => setProxyUrlInput(e.target.value)}
                    placeholder={providerTypeInput === 'openai' ? "Ví dụ: https://openrouter.ai/api/v1" : "Ví dụ: https://my-ai-proxy.com/v1beta"}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-slate-200 text-xs outline-none focus:border-amber-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    {providerTypeInput === 'openai' 
                      ? "Nhập Base URL của OpenRouter hoặc OpenAI proxy (VD: https://openrouter.ai/api/v1)." 
                      : "Nhập Base URL của Gemini proxy nếu gọi AI qua cổng trung gian."}
                  </p>
                </div>

                {/* API Key / Token */}
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">API Key / Access Token (Không bắt buộc key Google):</label>
                  <input
                    type="password"
                    value={customApiKeyInput}
                    onChange={(e) => setCustomApiKeyInput(e.target.value)}
                    placeholder="Nhập Key OpenRouter (sk-or-v1-...), Key Proxy hoặc Gemini API Key..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-slate-200 text-xs outline-none focus:border-amber-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Trạng thái key: {hasAiApiKey ? <span className="text-emerald-400 font-bold">Đã có Key/Token</span> : <span className="text-amber-400 font-bold">Chưa thiết lập Key</span>}
                  </p>
                </div>

                {/* Button Save AI Config */}
                <button
                  onClick={handleSaveAiConfig}
                  disabled={isSavingAiConfig}
                  className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold py-2 rounded-md transition-all shadow flex items-center justify-center gap-2"
                >
                  {isSavingAiConfig ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>Lưu Cấu Hình AI</span>
                </button>

                {aiConfigMessage && (
                  <div className={`p-2 rounded text-[11px] font-medium text-center border ${
                    aiConfigMessage.includes('Lỗi') ? 'bg-rose-950/60 border-rose-800 text-rose-300' : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  }`}>
                    {aiConfigMessage}
                  </div>
                )}
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
                    <option value="AiDict">✨ Từ điển AI (AiExtracted.txt)</option>
                    <option value="VietPhrase">VietPhrase (VietPhrase.txt)</option>
                    <option value="Name">Name (Name.txt)</option>
                    <option value="Pronouns">Pronouns (Pronouns.txt)</option>
                    <option value="LuatNhan">LuatNhan (LuatNhan.txt)</option>
                    <option value="PhienAm">PhienAm (PhienAm.txt)</option>
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
              onClick={() => { setActiveTab('dictionary'); fetchStats(); }}
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

                {/* Engine Selector Bar */}
                <div className="mb-3 bg-slate-900 border border-slate-800 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chế độ dịch:</span>
                    <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => setTranslationEngine('gemini')}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                          translationEngine === 'gemini'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Sparkles size={14} className={translationEngine === 'gemini' ? 'text-amber-300 fill-amber-300/30' : 'text-slate-500'} />
                        AI Gemini (Văn phong mượt)
                      </button>
                      <button
                        onClick={() => setTranslationEngine('vietphrase')}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                          translationEngine === 'vietphrase'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <BookOpen size={14} />
                        Từ điển VietPhrase (Hán Việt thô)
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    {translationEngine === 'gemini' ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        ✨ Dịch AI hiểu ngữ cảnh, thoát ý, câu thoại sinh động mượt mà như tác phẩm thật.
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        📚 Dịch từ điển ghép từ Hán-Việt thô, phù hợp cho file dữ liệu/thông số game.
                      </span>
                    )}
                  </div>
                </div>

                {/* Advanced Settings Bar: Phân đoạn dịch & Cụm từ dài nhất */}
                <div className="mb-4 bg-slate-900/80 border border-slate-800/80 p-3 rounded-xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
                  {/* Phân đoạn dịch */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Layers size={13} className="text-emerald-400" />
                      Phân đoạn dịch:
                    </span>
                    <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => setSegmentationMode('paragraph')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                          segmentationMode === 'paragraph'
                            ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Type size={12} />
                        Theo đoạn văn
                      </button>
                      <button
                        onClick={() => setSegmentationMode('sentence')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                          segmentationMode === 'sentence'
                            ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Sliders size={12} />
                        Theo câu
                      </button>
                    </div>
                  </div>

                  {/* Cụm từ dịch dài nhất */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1" title="Độ dài cụm từ tối đa khi tra từ điển VietPhrase">
                      <Hash size={13} className="text-indigo-400" />
                      Cụm từ dịch dài nhất:
                    </span>
                    <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                      {[8, 12, 16, 20].map((len) => (
                        <button
                          key={len}
                          onClick={() => setMaxPhraseLength(len)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                            maxPhraseLength === len
                              ? 'bg-indigo-600 text-white shadow'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          {len}
                        </button>
                      ))}
                      <div className="h-3 w-px bg-slate-800 mx-1"></div>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={maxPhraseLength}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val > 0) {
                            setMaxPhraseLength(val);
                          } else if (e.target.value === '') {
                            setMaxPhraseLength(16);
                          }
                        }}
                        className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-center font-bold text-indigo-300 outline-none focus:border-indigo-500"
                        title="Tùy chỉnh số ký tự cụm từ dài nhất"
                      />
                      <span className="text-[10px] text-slate-500 font-medium">ký tự</span>
                    </div>
                  </div>

                  {/* Lựa chọn sử dụng bộ từ điển nào cho dịch từ điển */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1" title="Lựa chọn bộ từ điển sử dụng cho Dịch Từ Điển (Dịch AI không ảnh hưởng)">
                      <BookOpen size={13} className="text-amber-400" />
                      Bộ TĐ khi dịch từ điển:
                    </span>
                    <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => setDictMode('standard')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                          dictMode === 'standard'
                            ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Chỉ dùng Bộ Từ Điển Gốc (VietPhrase.txt, Name.txt...)"
                      >
                        TĐ Gốc (Standard)
                      </button>
                      <button
                        onClick={() => setDictMode('ai')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                          dictMode === 'ai'
                            ? 'bg-slate-800 text-amber-400 font-bold border border-slate-700 shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Chỉ dùng Bộ Từ Điển AI (AiVietPhrase, AiName, AiExtracted...)"
                      >
                        <Sparkles size={12} className="text-amber-400" />
                        TĐ AI
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 min-h-0">
                  
                  {/* Source Area */}
                  <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-900 shadow-sm overflow-hidden focus-within:border-emerald-500/50 transition-colors">
                    <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Chinese (Source)</span>
                        {sourceText.length > 0 && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                            {sourceText.length} ký tự
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Toggle Auto Translate */}
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-slate-300 hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={autoTranslate}
                            onChange={(e) => setAutoTranslate(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500 relative"></div>
                          <span className="flex items-center gap-1 text-[11px] font-semibold">
                            <Zap size={12} className={autoTranslate ? 'text-emerald-400 fill-emerald-400/20' : 'text-slate-500'} />
                            Tự động dịch
                          </span>
                        </label>

                        {sourceText && (
                          <button
                            onClick={() => {
                              setSourceText('');
                              setTranslatedText('');
                              handleStopTranslate();
                            }}
                            className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded"
                            title="Xóa văn bản gốc"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Dán hoặc nhập văn bản tiếng Trung vào đây..."
                      className="flex-1 bg-transparent p-4 text-slate-200 outline-none resize-none leading-relaxed text-[15px]"
                    />
                  </div>

                  {/* Target Area */}
                  <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-900 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                        {translationEngine === 'gemini' ? (
                          <>
                            <Sparkles size={13} className="text-amber-300" />
                            Vietnamese (AI Gemini - Dịch Mượt)
                          </>
                        ) : (
                          <>
                            <BookOpen size={13} />
                            Vietnamese (VietPhrase - Từ Điển)
                          </>
                        )}
                      </span>
                      {translatedText && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleStartExtractFromAi}
                            className="text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1.5 text-[11px] font-bold bg-amber-950/40 border border-amber-800/60 px-2.5 py-1 rounded-md shadow-sm"
                            title="Tạo bộ từ điển mới từ bản dịch mượt AI"
                          >
                            <Sparkles size={13} className="text-amber-300" />
                            Tạo từ điển từ AI
                          </button>
                          <button 
                            onClick={() => navigator.clipboard.writeText(translatedText)}
                            className="text-slate-500 hover:text-emerald-400 transition-colors flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider pl-1"
                          >
                            <Copy size={12} /> Sao chép
                          </button>
                        </div>
                      )}
                    </div>
                    <textarea
                      value={translatedText}
                      readOnly
                      placeholder="Bản dịch tiếng Việt sẽ xuất hiện ở đây..."
                      className="flex-1 bg-transparent p-4 text-slate-200 outline-none resize-none leading-relaxed text-[15px]"
                    />
                  </div>

                </div>

                {/* Action Bar */}
                <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    {serverStatus === 'disconnected' && (
                      <span className="text-xs text-rose-400 flex items-center gap-1.5 bg-rose-950/30 px-3 py-1.5 rounded-md border border-rose-900/50">
                        <AlertCircle size={14} /> Máy chủ ngắt kết nối
                      </span>
                    )}

                    {translationStatus && (
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold">
                        {isTranslating ? (
                          isPaused ? (
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                          )
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        )}
                        <span className={isPaused ? 'text-amber-300' : isTranslating ? 'text-emerald-300' : 'text-slate-300'}>
                          {translationStatus}
                        </span>
                      </div>
                    )}

                    {translateProgress && isTranslating && (
                      <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                        <div className="w-20 sm:w-28 bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700">
                          <div 
                            className={`h-full transition-all duration-300 ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.round((translateProgress.current / translateProgress.total) * 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {Math.round((translateProgress.current / translateProgress.total) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap justify-end">
                    {isTranslating ? (
                      <>
                        {/* Nút Tạm dừng / Tiếp tục */}
                        <button
                          onClick={handlePauseToggle}
                          className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border shadow-lg ${
                            isPaused
                              ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-amber-950/30'
                              : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {isPaused ? (
                            <>
                              <Play size={16} className="fill-current" /> Tiếp tục dịch
                            </>
                          ) : (
                            <>
                              <Pause size={16} className="fill-current" /> Tạm dừng
                            </>
                          )}
                        </button>

                        {/* Nút Dừng dịch */}
                        <button
                          onClick={handleStopTranslate}
                          className="bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-rose-950/30"
                        >
                          <Square size={16} className="fill-current" /> Dừng dịch
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Nút Dịch mượt bằng AI Gemini */}
                        <button
                          onClick={() => handleTranslate('gemini')}
                          disabled={!sourceText.trim() || serverStatus === 'disconnected'}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-2 transform active:scale-[0.98]"
                          title="Dịch thông minh, mượt mà và thoát ý bằng AI Gemini"
                        >
                          <Sparkles size={16} className="text-amber-300" /> ✨ Dịch mượt (AI)
                        </button>

                        {/* Nút Dịch nhanh bằng Từ điển (Không dùng AI) */}
                        <button
                          onClick={() => handleTranslate('vietphrase')}
                          disabled={!sourceText.trim() || serverStatus === 'disconnected'}
                          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2 transform active:scale-[0.98]"
                          title="Dịch cực nhanh trực tiếp bằng kho từ điển máy chủ (Không tốn AI)"
                        >
                          <BookOpen size={16} /> ⚡ Dịch nhanh (Bộ Từ Điển)
                        </button>

                        {/* Nút Trích xuất từ điển từ AI */}
                        {sourceText.trim() && translatedText.trim() && (
                          <button
                            onClick={handleStartExtractFromAi}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-amber-950/30 transition-all flex items-center gap-2 transform active:scale-[0.98]"
                            title="Tự động trích xuất các tên riêng và cụm từ mới từ bản dịch AI vào bộ từ điển"
                          >
                            <Plus size={16} /> 📖 Trích xuất Từ điển từ AI
                          </button>
                        )}

                        {/* Nút Trích xuất nhanh bằng thuật toán (Tức thì) */}
                        {sourceText.trim() && (
                          <button
                            onClick={handleStartExtractFast}
                            className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-purple-950/30 transition-all flex items-center gap-2 transform active:scale-[0.98]"
                            title="Trích xuất nhanh tức thì từ văn bản gốc bằng thuật toán từ điển (Không dùng AI, không chờ đợi)"
                          >
                            <Zap size={16} /> ⚡ Trích xuất nhanh (Tức thì)
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'dictionary' && (
              <div className="space-y-6 max-w-4xl">
                
                {/* Stats cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl border bg-slate-900 border-slate-800">
                    <div className="text-xs font-semibold text-slate-400">TỔNG TỪ VỰNG TRONG KHO</div>
                    <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.total.toLocaleString('vi-VN')}</div>
                  </div>
                  <div className="p-4 rounded-xl border bg-slate-900 border-slate-800">
                    <div className="text-xs font-semibold text-slate-400">BỘ TỪ ĐIỂN GỐC (STANDARD)</div>
                    <div className="text-2xl font-bold text-slate-200 mt-1">{(stats.categories['TotalStandard'] || 0).toLocaleString('vi-VN')}</div>
                  </div>
                  <div className="p-4 rounded-xl border bg-amber-950/20 border-amber-500/30">
                    <div className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                      <Sparkles size={12} /> BỘ TỪ ĐIỂN AI (AI SET)
                    </div>
                    <div className="text-2xl font-bold text-amber-300 mt-1">{(stats.categories['TotalAi'] || 0).toLocaleString('vi-VN')}</div>
                  </div>
                </div>

                {/* Khối nạp tệp TXT vào máy chủ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Upload size={16} className="text-emerald-400" /> Nạp tệp TXT vào Bộ Từ Điển Máy Chủ
                  </h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <select
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none font-medium"
                    >
                      <optgroup label="✨ Bộ Từ Điển AI">
                        <option value="AiDict">✨ AI Extracted (AiExtracted.txt)</option>
                        <option value="AiVietPhrase">✨ AI VietPhrase (AiVietPhrase.txt)</option>
                        <option value="AiName">✨ AI Name (AiName.txt)</option>
                        <option value="AiPronouns">✨ AI Pronouns (AiPronouns.txt)</option>
                        <option value="AiLuatNhan">✨ AI LuatNhan (AiLuatNhan.txt)</option>
                        <option value="AiPhienAm">✨ AI PhienAm (AiPhienAm.txt)</option>
                      </optgroup>
                      <optgroup label="📚 Bộ Từ Điển Gốc">
                        <option value="VietPhrase">VietPhrase (VietPhrase.txt)</option>
                        <option value="Name">Name (Name.txt)</option>
                        <option value="Pronouns">Pronouns (Pronouns.txt)</option>
                        <option value="LuatNhan">LuatNhan (LuatNhan.txt)</option>
                        <option value="PhienAm">PhienAm (PhienAm.txt)</option>
                      </optgroup>
                    </select>

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleUpload}
                      accept=".txt"
                      multiple
                      className="hidden"
                    />

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={14} /> Chọn tệp TXT để nạp
                    </button>

                    {uploadStatus && (
                      <span className="text-xs text-amber-400 font-semibold self-center">{uploadStatus}</span>
                    )}
                  </div>
                </div>

                {/* Khối BỘ TỪ ĐIỂN AI (Phân chia như từ điển gốc) */}
                <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                      <Sparkles className="text-amber-300" size={16} />
                      Bộ Từ Điển AI (Cấu trúc & Phân chia tương đương bộ gốc)
                    </h3>
                    <button
                      onClick={() => handleClearCategory(undefined, 'Toàn bộ từ điển AI', 'ai')}
                      className="text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5"
                    >
                      <Trash2 size={13} /> Dọn dẹp toàn bộ bộ từ điển AI
                    </button>
                  </div>
                  <p className="text-xs text-amber-300/70">
                    Bộ từ điển do AI khởi tạo, học tập hoặc trích xuất từ văn phong mượt. Được chia thành các file riêng độc lập, không ảnh hưởng đến bộ từ điển gốc.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    {[
                      { id: 'AiVietPhrase', name: 'AiVietPhrase.txt', label: 'AI VietPhrase' },
                      { id: 'AiName', name: 'AiName.txt', label: 'AI Tên riêng (AiName)' },
                      { id: 'AiPronouns', name: 'AiPronouns.txt', label: 'AI Đại từ (AiPronouns)' },
                      { id: 'AiLuatNhan', name: 'AiLuatNhan.txt', label: 'AI Luật nhân (AiLuatNhan)' },
                      { id: 'AiPhienAm', name: 'AiPhienAm.txt', label: 'AI Phiên âm (AiPhienAm)' },
                      { id: 'AiDict', name: 'AiExtracted.txt', label: 'AI Extracted' },
                    ].map((item) => (
                      <div key={item.id} className="bg-slate-950/80 border border-amber-500/20 p-3 rounded-xl flex items-center justify-between">
                        <div>
                          <div className="font-bold text-amber-200 flex items-center gap-1">
                            <Sparkles size={11} className="text-amber-400" />
                            {item.label}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{item.name}</div>
                          <div className="text-[10px] text-amber-400/80 font-semibold mt-0.5">
                            {Number(stats.categories[item.id] || 0).toLocaleString('vi-VN')} từ
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleExportTxt(item.id)}
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 rounded border border-slate-700"
                            title={`Tải tệp ${item.name}`}
                          >
                            <Upload size={13} className="rotate-180 text-amber-400" />
                          </button>
                          <button
                            onClick={() => handleClearCategory(item.id, item.label)}
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded border border-slate-700"
                            title={`Xóa dữ liệu ${item.label}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quản lý các tệp từ điển gốc (VietPhrase, Name, Pronouns...) */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <BookOpen size={16} className="text-emerald-400" /> Bộ Từ Điển Gốc (Standard)
                    </h3>
                    <button
                      onClick={() => handleClearCategory(undefined, 'Toàn bộ từ điển Gốc', 'standard')}
                      className="text-xs bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-300 border border-slate-700 px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5"
                    >
                      <Trash2 size={13} /> Dọn dẹp toàn bộ bộ từ điển gốc
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    {[
                      { id: 'VietPhrase', name: 'VietPhrase.txt', label: 'VietPhrase' },
                      { id: 'Name', name: 'Name.txt', label: 'Tên riêng (Name)' },
                      { id: 'Pronouns', name: 'Pronouns.txt', label: 'Đại từ (Pronouns)' },
                      { id: 'LuatNhan', name: 'LuatNhan.txt', label: 'Luật nhân (LuatNhan)' },
                      { id: 'PhienAm', name: 'PhienAm.txt', label: 'Phiên âm (PhienAm)' },
                    ].map((item) => (
                      <div key={item.id} className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-200">{item.label}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{item.name}</div>
                          <div className="text-[10px] text-emerald-400/80 font-semibold mt-0.5">
                            {Number(stats.categories[item.id] || 0).toLocaleString('vi-VN')} từ
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleExportTxt(item.id)}
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-700"
                            title={`Tải tệp ${item.name}`}
                          >
                            <Upload size={13} className="rotate-180 text-emerald-400" />
                          </button>
                          <button
                            onClick={() => handleClearCategory(item.id, item.label)}
                            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded border border-slate-700"
                            title={`Xóa dữ liệu ${item.label}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dictionary Search */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Tra cứu Từ điển ({stats.total.toLocaleString('vi-VN')} từ trong kho)
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <select
                      value={searchCategory}
                      onChange={(e) => setSearchCategory(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
                    >
                      <option value="">Tất cả danh mục</option>
                      <optgroup label="✨ Bộ Từ Điển AI">
                        <option value="AiDict">✨ AI Extracted (AiExtracted.txt)</option>
                        <option value="AiVietPhrase">✨ AI VietPhrase (AiVietPhrase.txt)</option>
                        <option value="AiName">✨ AI Name (AiName.txt)</option>
                        <option value="AiPronouns">✨ AI Pronouns (AiPronouns.txt)</option>
                        <option value="AiLuatNhan">✨ AI LuatNhan (AiLuatNhan.txt)</option>
                        <option value="AiPhienAm">✨ AI PhienAm (AiPhienAm.txt)</option>
                      </optgroup>
                      <optgroup label="📚 Bộ Từ Điển Gốc">
                        <option value="VietPhrase">VietPhrase</option>
                        <option value="Name">Name</option>
                        <option value="Pronouns">Pronouns</option>
                        <option value="LuatNhan">LuatNhan</option>
                        <option value="PhienAm">PhienAm</option>
                      </optgroup>
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
                              <td className="p-3 font-mono text-[11px] text-amber-400/90">{entry.cat}</td>
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

      {/* Modal Trích xuất Từ điển từ bản dịch AI */}
      {isExtractModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <Sparkles className="text-amber-400" size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Trích xuất Từ điển từ Bản Dịch AI</h3>
                  <p className="text-xs text-slate-400">Gemini AI tự động phát hiện tên riêng & cụm từ mượt để lưu vào bộ từ điển</p>
                </div>
              </div>
              <button
                onClick={() => setIsExtractModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Danh mục cần lưu */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                <label className="font-bold text-slate-200 text-xs flex items-center gap-2">
                  <span>Danh mục lưu từ điển:</span>
                </label>
                <select
                  value={extractedCategory}
                  onChange={(e) => setExtractedCategory(e.target.value as any)}
                  className="bg-slate-900 border border-slate-700 text-amber-300 font-bold px-3 py-1.5 rounded-lg text-xs outline-none focus:border-amber-500"
                >
                  <optgroup label="✨ Bộ Từ Điển AI">
                    <option value="AiDict">✨ AI Extracted (Lưu riêng tệp AiExtracted.txt)</option>
                    <option value="AiName">✨ AI Name (Tên riêng AI - AiName.txt)</option>
                    <option value="AiPronouns">✨ AI Pronouns (Đại từ AI - AiPronouns.txt)</option>
                    <option value="AiLuatNhan">✨ AI LuatNhan (Luật nhân AI - AiLuatNhan.txt)</option>
                    <option value="AiVietPhrase">✨ AI VietPhrase (Cụm từ AI - AiVietPhrase.txt)</option>
                    <option value="AiPhienAm">✨ AI PhienAm (Phiên âm AI - AiPhienAm.txt)</option>
                  </optgroup>
                  <optgroup label="📚 Bộ Từ Điển Gốc">
                    <option value="VietPhrase">VietPhrase Gốc (VietPhrase.txt)</option>
                    <option value="Name">Name Gốc (Name.txt)</option>
                    <option value="Pronouns">Pronouns Gốc (Pronouns.txt)</option>
                    <option value="LuatNhan">LuatNhan Gốc (LuatNhan.txt)</option>
                    <option value="PhienAm">PhienAm Gốc (PhienAm.txt)</option>
                  </optgroup>
                </select>
              </div>

              {/* Trạng thái / Lời nhắn */}
              {extractStatus && (
                <div className={`p-3 rounded-lg text-xs font-medium border flex items-center gap-2 ${
                  isExtracting 
                    ? 'bg-amber-950/30 border-amber-800/50 text-amber-300' 
                    : 'bg-slate-950 border-slate-800 text-emerald-400'
                }`}>
                  {isExtracting && <Loader2 size={16} className="animate-spin text-amber-400 shrink-0" />}
                  <span>{extractStatus}</span>
                </div>
              )}

              {/* Bảng danh sách từ vựng trích xuất */}
              {!isExtracting && extractedPairs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold px-1">
                    <span>Danh sách {extractedPairs.length} từ vựng đề xuất:</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          setExtractedPairs(prev => prev.map(p => p.checked ? { ...p, cat: extractedCategory } : p));
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                        title="Gán danh mục mặc định ở trên cho toàn bộ mục được tích chọn"
                      >
                        Áp dụng danh mục chính cho các mục chọn
                      </button>
                      <button
                        onClick={() => setExtractedPairs(prev => prev.map(p => ({ ...p, checked: true })))}
                        className="text-amber-400 hover:underline text-[11px]"
                      >
                        Chọn tất cả
                      </button>
                      <span className="text-slate-600">|</span>
                      <button
                        onClick={() => setExtractedPairs(prev => prev.map(p => ({ ...p, checked: false })))}
                        className="text-slate-400 hover:underline text-[11px]"
                      >
                        Bỏ chọn tất cả
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider sticky top-0 border-b border-slate-800">
                        <tr>
                          <th className="p-3 w-10 text-center">Lưu</th>
                          <th className="p-3">Từ tiếng Trung (ZH)</th>
                          <th className="p-3">Bản dịch tiếng Việt (VI)</th>
                          <th className="p-3 w-40">Phân loại danh mục</th>
                          <th className="p-3 w-12 text-center">Xóa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-slate-300 bg-slate-900/40">
                        {extractedPairs.map((pair, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={pair.checked}
                                onChange={(e) => {
                                  const updated = [...extractedPairs];
                                  updated[idx].checked = e.target.checked;
                                  setExtractedPairs(updated);
                                }}
                                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={pair.zh}
                                onChange={(e) => {
                                  const updated = [...extractedPairs];
                                  updated[idx].zh = e.target.value;
                                  setExtractedPairs(updated);
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-emerald-400 font-semibold text-xs outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={pair.vi}
                                onChange={(e) => {
                                  const updated = [...extractedPairs];
                                  updated[idx].vi = e.target.value;
                                  setExtractedPairs(updated);
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 font-medium text-xs outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="p-2">
                              <select
                                value={pair.cat || 'AiDict'}
                                onChange={(e) => {
                                  const updated = [...extractedPairs];
                                  updated[idx].cat = e.target.value;
                                  setExtractedPairs(updated);
                                }}
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-amber-300 font-semibold text-[11px] outline-none focus:border-amber-500"
                              >
                                <optgroup label="✨ Bộ Từ Điển AI">
                                  <option value="AiName">✨ AI Name (Tên riêng)</option>
                                  <option value="AiPronouns">✨ AI Pronouns (Đại từ)</option>
                                  <option value="AiLuatNhan">✨ AI LuatNhan (Luật nhân)</option>
                                  <option value="AiVietPhrase">✨ AI VietPhrase (Cụm từ AI)</option>
                                  <option value="AiPhienAm">✨ AI PhienAm (Phiên âm)</option>
                                  <option value="AiDict">✨ AI Extracted (Tổng hợp)</option>
                                </optgroup>
                                <optgroup label="📚 Bộ Từ Điển Gốc">
                                  <option value="VietPhrase">VietPhrase Gốc</option>
                                  <option value="Name">Name Gốc</option>
                                  <option value="Pronouns">Pronouns Gốc</option>
                                  <option value="LuatNhan">LuatNhan Gốc</option>
                                  <option value="PhienAm">PhienAm Gốc</option>
                                </optgroup>
                              </select>
                            </td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => {
                                  setExtractedPairs(prev => prev.filter((_, i) => i !== idx));
                                }}
                                className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    onClick={() => setExtractedPairs(prev => [...prev, { zh: '', vi: '', checked: true }])}
                    className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1.5 py-1"
                  >
                    <Plus size={14} /> Thêm cặp từ thủ công
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsExtractModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveExtractedPairs}
                disabled={isExtracting || extractedPairs.filter(p => p.checked).length === 0}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-amber-950/30 flex items-center gap-2"
              >
                <Check size={16} /> Lưu vào Bộ Từ Điển ({extractedPairs.filter(p => p.checked).length})
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-800/80 px-6 py-2.5 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-400">VietPhrase & Gemini AI Translator</span>
          <span className="text-[10px] bg-slate-900 text-amber-400 px-2 py-0.5 rounded font-mono font-bold border border-slate-800">Phiên bản 0.1 beta</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span>Tự động trích xuất từ điển AI</span>
          <span>•</span>
          <span>Dịch mượt Gemini</span>
          <span>•</span>
          <span>Hỗ trợ API Ngrok & Máy chủ nội bộ</span>
        </div>
      </footer>
    </div>
  );
}

