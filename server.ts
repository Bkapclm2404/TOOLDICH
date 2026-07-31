import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

// Cấu hình AI Server & Proxy
let currentAiModel = "gemini-flash-latest";
let customApiKey = "";
let aiProxyUrl = "";
let aiProviderType = "gemini"; // 'gemini' | 'openai'

// Hàm gọi AI linh hoạt hỗ trợ Google AI, Proxy trung gian & OpenAI/OpenRouter (Không bắt buộc Key Google AI trực tiếp)
async function callAiModel(systemInstruction: string, userPrompt: string): Promise<string> {
  const apiKey = customApiKey.trim() || process.env.GEMINI_API_KEY || "";
  const proxyUrl = aiProxyUrl.trim();
  const modelToUse = currentAiModel.trim() || "gemini-flash-latest";
  const provider = aiProviderType || "gemini";

  // 1. Dạng OpenAI / OpenRouter / Custom ChatCompletions Proxy (/v1/chat/completions)
  if (provider === "openai" || proxyUrl.includes("/v1") || proxyUrl.includes("openrouter") || proxyUrl.includes("openai")) {
    let baseUrl = proxyUrl ? proxyUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') : "https://api.openai.com/v1";
    const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Lỗi kết nối AI Proxy (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const resultText = data?.choices?.[0]?.message?.content || "";
    return typeof resultText === 'string' ? resultText.trim() : "";
  }

  // 2. Dạng Google Gemini API hoặc Gemini Proxy trung gian
  if (!apiKey && !proxyUrl) {
    throw new Error("Chưa có API Key hoặc Proxy AI. Vui lòng chọn kết nối Proxy/OpenRouter hoặc nhập Key/Token trong Cấu Hình AI.");
  }

  const config: any = { apiKey: apiKey || "dummy_key_for_proxy" };
  if (proxyUrl) {
    config.httpOptions = { baseUrl: proxyUrl };
  }

  const ai = new GoogleGenAI(config);

  const candidateModels = Array.from(new Set([
    modelToUse,
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash",
  ])).filter(Boolean);

  let lastError: any = null;

  for (const modelCandidate of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelCandidate,
          contents: userPrompt,
          config: systemInstruction ? { systemInstruction } : undefined,
        });

        if (response.text) {
          return response.text.trim();
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isQuotaOrBusy = errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("UNAVAILABLE") || errMsg.includes("quota");
        
        if (isQuotaOrBusy && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        } else if (isQuotaOrBusy) {
          break;
        } else {
          throw err;
        }
      }
    }
  }

  const lastMsg = lastError?.message || String(lastError || "Lỗi gọi AI");
  if (lastMsg.includes("429") || lastMsg.includes("RESOURCE_EXHAUSTED") || lastMsg.includes("quota")) {
    throw new Error("Tài khoản Google Gemini API tạm hết Quota lượt gọi (Lỗi 429 Rate Limit). Vui lòng chờ vài giây hoặc nhập API Key / Proxy AI riêng trong Cấu Hình AI.");
  } else if (lastMsg.includes("503") || lastMsg.includes("UNAVAILABLE")) {
    throw new Error("Máy chủ Google Gemini AI đang quá tải (Lỗi 503). Tự động chuyển sang Dịch Từ Điển VietPhrase.");
  }
  throw lastError || new Error("Không nhận được phản hồi từ AI Gemini.");
}

// Hàm tạo ngữ cảnh glossary từ điển cho AI Gemini khi dịch
function getGlossaryForText(text: string, dictMode: 'both' | 'standard' | 'ai' = 'both'): string {
  if (!text || serverDictionary.size === 0) return '';

  const matchedAi: ServerDictEntry[] = [];
  const matchedStd: ServerDictEntry[] = [];

  serverDictionary.forEach((entry) => {
    if (text.includes(entry.zh)) {
      if (AI_CATEGORIES.includes(entry.cat)) {
        matchedAi.push(entry);
      } else if (STANDARD_CATEGORIES.includes(entry.cat)) {
        matchedStd.push(entry);
      }
    }
  });

  // Ưu tiên xếp từ dài hơn lên trước để AI không bị dịch lộn xộn
  matchedAi.sort((a, b) => b.zh.length - a.zh.length);
  matchedStd.sort((a, b) => b.zh.length - a.zh.length);

  let selectedEntries: ServerDictEntry[] = [];
  if (dictMode === 'ai') {
    selectedEntries = matchedAi;
  } else if (dictMode === 'standard') {
    selectedEntries = matchedStd;
  } else {
    // Both: Ưu tiên bộ từ điển AI trước, sau đó bổ sung bộ từ điển Gốc
    selectedEntries = [...matchedAi, ...matchedStd];
  }

  if (selectedEntries.length === 0) return '';

  // Lấy tối đa 100 từ vựng khớp nhất
  const topEntries = selectedEntries.slice(0, 100);

  const lines = topEntries.map((e) => `- "${e.zh}" -> "${e.vi}" (Danh mục: ${e.cat})`);
  return `\n\nBỘ TỪ ĐIỂN THAM KHẢO VÀ BẮT BUỘC ƯU TIÊN SỬ DỤNG CHÍNH XÁC KHI DỊCH:
${lines.join('\n')}
Yêu cầu bắt buộc: Dịch chính xác theo các từ vựng, tên riêng, đại từ xưng hô trong bộ từ điển trên khi xuất hiện trong đoạn văn bản.`;
}

// Hàm dịch văn bản mượt mà bằng Gemini AI / Proxy AI
async function translateWithGemini(text: string, dictMode: 'both' | 'standard' | 'ai' = 'both'): Promise<string> {
  const glossaryInstruction = getGlossaryForText(text, dictMode);

  const systemInstruction = `Bạn là dịch giả chuyên nghiệp xuất sắc dịch thuật truyện, tiểu thuyết, truyện cười và thoại game từ tiếng Trung sang tiếng Việt.
Yêu cầu dịch thuật:
1. Dịch văn bản tiếng Trung sang tiếng Việt cực kỳ mượt mà, thoát ý, tự nhiên, sinh động và chuẩn văn phong câu chuyện/truyện cười tiếng Việt.
2. Xử lý mượt mà lời thoại nhân vật, ngữ cảnh hài hước, thành ngữ, ngữ điệu (ví dụ: "你丫" -> "ngươi", "cậu", "mày"; "吐出来" -> "nhổ ra", "nôn ra"; "重要" khi nói về ly nước -> "coi trọng chiếc cốc").
3. BẮT BUỘC ƯU TIÊN SỬ DỤNG BỘ TỪ ĐIỂN THAM KHẢO (NẾU CÓ). Dịch đúng tên riêng nhân vật, đại từ xưng hô, cụm từ theo danh sách từ điển cung cấp.
4. Giữ nguyên cấu trúc xuống dòng, đoạn văn bản, thẻ định dạng (nếu có).
5. KHÔNG thêm lời giải thích hay chú thích, chỉ trả về nội dung tiếng Việt đã dịch mượt.${glossaryInstruction}`;

  return await callAiModel(systemInstruction, text);
}

// Hàm trích xuất từ điển (cụm từ, tên riêng) từ bản dịch mượt AI
async function extractDictionaryWithGemini(sourceText: string, translatedText: string): Promise<Array<{ zh: string; vi: string; cat: DictCategory }>> {
  const prompt = `Bạn là chuyên gia biên soạn từ điển Hán-Việt, VietPhrase và Tên riêng.
Dưới đây là đoạn văn bản gốc tiếng Trung và bản dịch tiếng Việt tương ứng:

--- VĂN BẢN GỐC (TIẾNG TRUNG) ---
${sourceText.slice(0, 3000)}

--- BẢN DỊCH AI (TIẾNG VIỆT) ---
${translatedText.slice(0, 3000)}

Nhiệm vụ: So sánh 2 văn bản và trích xuất các từ vựng, tên riêng, đại từ, luật nhân xưng hô, phiên âm hoặc cụm từ tương ứng giữa tiếng Trung và tiếng Việt để tạo bộ từ điển AI mới.

BẮT BUỘC phân loại từng từ vựng trích xuất vào chính xác một trong các danh mục (cat) sau:
1. "AiName": Tên riêng nhân vật, quốc gia, dân tộc, địa danh, tên dự án, tác phẩm (Ví dụ: "中国人" -> "Người Trung Quốc", "美国人" -> "Người Mỹ", "犹太人" -> "Người Do Thái", "林枫" -> "Lâm Phong").
2. "AiPronouns": Đại từ xưng hô, nhân xưng (Ví dụ: "你" -> "mày/cậu/ngươi", "我" -> "ta/tôi", "他" -> "hắn/y").
3. "AiLuatNhan": Cụm từ xưng hô, luật nhân xưng hô theo ngữ cảnh.
4. "AiPhienAm": Phiên âm Hán-Việt đơn tự/kép.
5. "AiVietPhrase": Cụm từ chung, danh từ, động từ, thuật ngữ, thành ngữ (Ví dụ: "苍蝇" -> "con ruồi", "可行性报告" -> "báo cáo khả thi", "吐出来" -> "nhổ ra/nôn ra").
6. "AiDict": Từ vựng hỗn hợp khác nếu không phân loại được vào 5 danh mục trên.

Yêu cầu định dạng đầu ra: Trả về duy nhất một mảng JSON các object dạng:
[
  {"zh": "中国人", "vi": "Người Trung Quốc", "cat": "AiName"},
  {"zh": "苍蝇", "vi": "con ruồi", "cat": "AiVietPhrase"},
  {"zh": "吐出来", "vi": "nhổ ra", "cat": "AiVietPhrase"}
]
KHÔNG thêm bất kỳ văn bản giải thích hay thẻ code block nào ngoài mảng JSON hợp lệ.`;

  const responseText = await callAiModel("", prompt);
  let jsonStr = responseText;
  if (jsonStr.includes("```")) {
    jsonStr = jsonStr.replace(/```json/gi, "").replace(/```/g, "").trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: any) => item && typeof item.zh === 'string' && typeof item.vi === 'string' && item.zh.trim() && item.vi.trim())
        .map((item: any) => {
          let cat: DictCategory = 'AiDict';
          if (item.cat && ALL_CATEGORIES.includes(item.cat as DictCategory)) {
            cat = item.cat as DictCategory;
          }
          return { zh: item.zh.trim(), vi: item.vi.trim(), cat };
        });
    }
    return [];
  } catch (err) {
    console.error("Lỗi parse JSON từ Gemini extract:", err, responseText);
    return [];
  }
}

// Định nghĩa cấu trúc từ điển phía máy chủ
type DictCategory = 
  | 'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm'
  | 'AiName' | 'AiPronouns' | 'AiLuatNhan' | 'AiVietPhrase' | 'AiPhienAm' | 'AiDict';

interface ServerDictEntry {
  zh: string;
  vi: string;
  cat: DictCategory;
}

const STANDARD_CATEGORIES: DictCategory[] = ['Name', 'Pronouns', 'LuatNhan', 'VietPhrase', 'PhienAm'];
const AI_CATEGORIES: DictCategory[] = ['AiName', 'AiPronouns', 'AiLuatNhan', 'AiVietPhrase', 'AiPhienAm', 'AiDict'];
const ALL_CATEGORIES: DictCategory[] = [...STANDARD_CATEGORIES, ...AI_CATEGORIES];

// Lưu trữ từ điển trên bộ nhớ/đĩa máy chủ
const serverDictionary: Map<string, ServerDictEntry> = new Map();

// Thư mục lưu trữ từ điển cố định trên máy chủ
const DICT_DIR = path.join(process.cwd(), "dictionaries");

// Tự động khởi tạo thư mục từ điển nếu chưa có
if (!fs.existsSync(DICT_DIR)) {
  fs.mkdirSync(DICT_DIR, { recursive: true });
}

// Mảng được sắp xếp và Map tra cứu nhanh riêng biệt cho từng chế độ dịch (Standard, AI, Both)
let sortedDictList: ServerDictEntry[] = [];
let dictLookupMapBoth = new Map<string, { vi: string; catPriority: number }>();
let dictLookupMapStandard = new Map<string, { vi: string; catPriority: number }>();
let dictLookupMapAi = new Map<string, { vi: string; catPriority: number }>();

let phienAmMapBoth = new Map<string, string>();
let phienAmMapStandard = new Map<string, string>();
let phienAmMapAi = new Map<string, string>();

let maxZhLength = 1;

// Hàm cập nhật cấu trúc tra cứu từ điển
function rebuildSortedDictList() {
  const catPriority: Record<string, number> = {
    Name: 1, AiName: 1,
    Pronouns: 2, AiPronouns: 2,
    LuatNhan: 3, AiLuatNhan: 3,
    VietPhrase: 4, AiVietPhrase: 4,
    PhienAm: 5, AiPhienAm: 5,
    AiDict: 6
  };
  
  dictLookupMapBoth.clear();
  dictLookupMapStandard.clear();
  dictLookupMapAi.clear();

  phienAmMapBoth.clear();
  phienAmMapStandard.clear();
  phienAmMapAi.clear();

  maxZhLength = 1;

  serverDictionary.forEach((entry) => {
    if (!entry.zh) return;
    const prio = catPriority[entry.cat] || 99;
    const isStandard = STANDARD_CATEGORIES.includes(entry.cat);
    const isAi = AI_CATEGORIES.includes(entry.cat);

    // 1. Cụm từ dịch cho chế độ Both
    const existingBoth = dictLookupMapBoth.get(entry.zh);
    if (!existingBoth || prio < existingBoth.catPriority) {
      dictLookupMapBoth.set(entry.zh, { vi: entry.vi, catPriority: prio });
    }

    // 2. Cụm từ dịch cho chế độ Standard (Chỉ từ điển gốc)
    if (isStandard) {
      const existingStandard = dictLookupMapStandard.get(entry.zh);
      if (!existingStandard || prio < existingStandard.catPriority) {
        dictLookupMapStandard.set(entry.zh, { vi: entry.vi, catPriority: prio });
      }
    }

    // 3. Cụm từ dịch cho chế độ AI (Chỉ từ điển AI)
    if (isAi) {
      const existingAi = dictLookupMapAi.get(entry.zh);
      if (!existingAi || prio < existingAi.catPriority) {
        dictLookupMapAi.set(entry.zh, { vi: entry.vi, catPriority: prio });
      }
    }

    // Phiên âm đơn tự
    if (entry.cat === 'PhienAm' || entry.cat === 'AiPhienAm') {
      if (entry.zh.length === 1) {
        const cleanVi = cleanViChoice(entry.vi);
        phienAmMapBoth.set(entry.zh, cleanVi);
        if (entry.cat === 'PhienAm') phienAmMapStandard.set(entry.zh, cleanVi);
        if (entry.cat === 'AiPhienAm') phienAmMapAi.set(entry.zh, cleanVi);
      }
    }

    if (entry.zh.length > maxZhLength) {
      maxZhLength = entry.zh.length;
    }
  });

  sortedDictList = Array.from(serverDictionary.values()).sort((a, b) => {
    if (b.zh.length !== a.zh.length) {
      return b.zh.length - a.zh.length;
    }
    return (catPriority[a.cat] || 99) - (catPriority[b.cat] || 99);
  });
}

// Hàm kiểm tra xem chuỗi có chứa chữ Hán hay không (CJK)
function hasChineseCharacters(str: string): boolean {
  return /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(str);
}

// Hàm kiểm tra xem chuỗi có chứa ký tự tiếng Việt đặc trưng hay không
function hasVietnameseAccents(str: string): boolean {
  const viAccentsRegex = /[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸÝĐ]/;
  return viAccentsRegex.test(str);
}

// Hàm phân tích và làm sạch một dòng trong tệp từ điển
function parseDictLine(
  rawLine: string,
  cat: DictCategory
): { zh: string; vi: string; cat: DictCategory } | null {
  if (!rawLine) return null;
  const trimmed = rawLine.trim();

  // Bỏ qua dòng trống hoặc dòng chú thích bắt đầu bằng #
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  // Tìm vị trí phân tách: ưu tiên dấu '=' trước, sau đó tới phím Tab '\t', và cuối cùng là dấu ':'
  let delimIdx = rawLine.indexOf('=');
  if (delimIdx === -1) delimIdx = rawLine.indexOf('\t');
  if (delimIdx === -1) delimIdx = rawLine.indexOf(':');

  if (delimIdx === -1) return null;

  let part1 = rawLine.substring(0, delimIdx);
  let part2 = rawLine.substring(delimIdx + 1);

  if (part1 === '' && part2 === '') return null;

  let zh = part1.normalize('NFC').trim();
  let vi = part2.normalize('NFC').trim();

  // Tự động hoán đổi nếu dòng bị ngược cấu trúc (người dùng nhập Vietnamese=Chinese)
  const zhHasCn = hasChineseCharacters(part1);
  const viHasCn = hasChineseCharacters(part2);
  const zhHasViAccents = hasVietnameseAccents(part1);
  const viHasViAccents = hasVietnameseAccents(part2);

  if (viHasCn && !zhHasCn) {
    // Trường hợp 1: Phía sau có chữ Hán, phía trước không có chữ Hán -> hoán đổi
    zh = part2.normalize('NFC').trim();
    vi = part1.normalize('NFC').trim();
  } else if (zhHasViAccents && !viHasViAccents && !zhHasCn) {
    // Trường hợp 2: Phía trước có dấu tiếng Việt, phía sau là Pinyin (không có dấu tiếng Việt & không có chữ Hán) -> hoán đổi
    zh = part2.normalize('NFC').trim();
    vi = part1.normalize('NFC').trim();
  }

  if (zh === '') return null;

  return { zh, vi, cat };
}

// Map tên file tương ứng từng danh mục từ điển
function getDictFileName(cat: DictCategory): string {
  switch (cat) {
    case 'Name': return 'Name.txt';
    case 'Pronouns': return 'Pronouns.txt';
    case 'LuatNhan': return 'LuatNhan.txt';
    case 'VietPhrase': return 'VietPhrase.txt';
    case 'PhienAm': return 'PhienAm.txt';
    case 'AiName': return 'AiName.txt';
    case 'AiPronouns': return 'AiPronouns.txt';
    case 'AiLuatNhan': return 'AiLuatNhan.txt';
    case 'AiVietPhrase': return 'AiVietPhrase.txt';
    case 'AiPhienAm': return 'AiPhienAm.txt';
    case 'AiDict': return 'AiExtracted.txt';
    default: return `${cat}.txt`;
  }
}

// Hàm nạp từ điển từ các tệp trong thư mục ./dictionaries/
function loadDictionariesFromDisk() {
  for (const cat of ALL_CATEGORIES) {
    const fileName = getDictFileName(cat);
    const filePath = path.join(DICT_DIR, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const entry = parseDictLine(lines[i], cat);
          if (entry) {
            serverDictionary.set(`${entry.cat}_${entry.zh}`, entry);
          }
        }
      } catch (err) {
        console.error(`Lỗi khi đọc tệp từ điển ${filePath}:`, err);
      }
    }
  }
  rebuildSortedDictList();
  console.log(`[Kho Máy Chủ] Đã tự động nạp ${serverDictionary.size} mục từ từ thư mục ${DICT_DIR}`);
}

// Tự động nạp khi khởi động máy chủ
loadDictionariesFromDisk();

// Hàm lưu từ điển của 1 danh mục xuống tệp txt trong thư mục ./dictionaries/
function saveCategoryToDisk(cat: DictCategory) {
  const fileName = getDictFileName(cat);
  const filePath = path.join(DICT_DIR, fileName);
  try {
    const entries: string[] = [];
    serverDictionary.forEach((entry) => {
      if (entry.cat === cat) {
        entries.push(`${entry.zh}=${entry.vi}`);
      }
    });
    fs.writeFileSync(filePath, entries.join('\n'), 'utf-8');
  } catch (err) {
    console.error(`Lỗi khi lưu tệp từ điển ${fileName}:`, err);
  }
}

// Hàm làm sạch lựa chọn dịch (chỉ lấy phương án đầu tiên trước dấu | hoặc /)
function cleanViChoice(vi: string): string {
  if (!vi) return '';
  return vi.split('|')[0].split('/')[0].trim();
}

// Bản đồ chuẩn hóa dấu câu Trung - Việt
const punctuationMap: Record<string, string> = {
  '，': ',',
  '。': '.',
  '！': '!',
  '？': '?',
  '：': ':',
  '；': ';',
  '“': '“',
  '”': '”',
  '‘': '‘',
  '’': '’',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '《': '«',
  '》': '»',
  '……': '...',
  '—': '-',
};

// Định dạng lại các token sau khi dịch (thêm khoảng trắng hợp lý giữa các từ & dấu câu)
function formatTranslatedTokens(tokens: string[]): string {
  let out = '';
  for (let idx = 0; idx < tokens.length; idx++) {
    const rawCurr = tokens[idx];
    if (!rawCurr) continue;
    const curr = rawCurr.normalize('NFC');

    if (out.length > 0) {
      const outNorm = out.normalize('NFC');
      const lastChar = outNorm[outNorm.length - 1];
      const firstChar = curr[0];

      // Thêm khoảng trắng nếu hai từ đứng cạnh nhau đều là chữ/số/dấu thanh
      const isLastWord = /[\p{L}\p{N}\p{M}]/u.test(lastChar);
      const isFirstWord = /[\p{L}\p{N}\p{M}]/u.test(firstChar);

      // Kiểm tra dấu câu
      const isLastPunctuation = /[,.!?:;”’\)\]}]/.test(lastChar);
      const isFirstOpenPunctuation = /[“’\(\[{]/.test(firstChar);

      if (
        (isLastWord && isFirstWord) ||
        (isLastPunctuation && isFirstWord) ||
        (isLastWord && isFirstOpenPunctuation) ||
        (isLastPunctuation && isFirstOpenPunctuation)
      ) {
        out += ' ';
      }
    }

    out += curr;
  }
  return out;
}

// Thuật toán dịch Forward Maximum Matching hỗ trợ chọn Bộ từ điển (both | standard | ai)
function translateSegment(
  text: string, 
  maxPhraseLength: number = 16,
  dictMode: 'both' | 'standard' | 'ai' = 'both'
): string {
  let i = 0;
  const len = text.length;
  const resultTokens: string[] = [];

  let lookupMap = dictLookupMapBoth;
  let phienAmMap = phienAmMapBoth;

  if (dictMode === 'standard') {
    lookupMap = dictLookupMapStandard;
    phienAmMap = phienAmMapStandard;
  } else if (dictMode === 'ai') {
    lookupMap = dictLookupMapAi;
    phienAmMap = phienAmMapAi;
  }

  const effectiveMaxLen = Math.min(maxZhLength, maxPhraseLength > 0 ? maxPhraseLength : 16);

  while (i < len) {
    const char = text[i];

    // Không phải chữ Hán -> chuẩn hóa dấu câu nếu có, giữ nguyên ký tự
    if (!hasChineseCharacters(char)) {
      const mappedPunct = punctuationMap[char] || char;
      resultTokens.push(mappedPunct);
      i++;
      continue;
    }

    // Tra cứu cụm từ dài nhất bắt đầu tại vị trí i
    let matched = false;
    const maxLookahead = Math.min(len - i, effectiveMaxLen);

    for (let subLen = maxLookahead; subLen >= 1; subLen--) {
      const sub = text.substring(i, i + subLen);
      const entry = lookupMap.get(sub);
      if (entry) {
        const cleanVi = cleanViChoice(entry.vi);
        resultTokens.push(cleanVi);
        i += subLen;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Dịch đơn tự Hán Việt nếu không khớp từ phức
      if (phienAmMap.has(char)) {
        resultTokens.push(phienAmMap.get(char)!);
      } else {
        resultTokens.push(char);
      }
      i++;
    }
  }

  return formatTranslatedTokens(resultTokens);
}

// Hàm dịch văn bản bằng từ điển máy chủ (Bảo vệ thẻ XML/HTML & biến)
function translateTextServer(
  text: string, 
  options: { maxPhraseLength?: number; translateKeywords?: boolean; dictMode?: 'both' | 'standard' | 'ai' } = {}
): string {
  if (!text || typeof text !== 'string') return text;
  if (serverDictionary.size === 0) return text;

  const maxPhraseLength = options.maxPhraseLength || 16;
  const dictMode = options.dictMode || 'both';

  // Tách văn bản thành thẻ bảo vệ (<tag>, {{var}}) và văn bản thường
  const tagRegex = /(<[^>]+>|\{\{[^}]+\}\})/g;
  const tokens: { isTag: boolean; content: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ isTag: false, content: text.substring(lastIndex, match.index) });
    }
    tokens.push({ isTag: true, content: match[0] });
    lastIndex = tagRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ isTag: false, content: text.substring(lastIndex) });
  }

  const translatedTokens = tokens.map((token) => {
    if (token.isTag) return token.content;
    return translateSegment(token.content, maxPhraseLength, dictMode);
  });

  return translatedTokens.join('');
}

// Dịch mảng chuỗi (keys, keysecondary)
function translateArrayServer(arr: any[], options: { maxPhraseLength?: number; dictMode?: 'both' | 'standard' | 'ai' } = {}): any[] {
  if (!Array.isArray(arr)) return arr;
  return arr.map((item) => {
    if (typeof item === 'string') {
      return translateTextServer(item, options);
    }
    return item;
  });
}

// Khởi tạo ứng dụng Express
async function startServer() {
  const app = express();
  
  // Sử dụng CORS để các ứng dụng front-end khác có thể gọi API độc lập
  app.use(cors());

  const PORT = 3000;

  // Cấu hình middleware xử lý JSON & Text dung lượng lớn (lên tới 100MB)
  app.use(express.json({ limit: '100mb' }));
  app.use(express.text({ limit: '100mb' }));

  // Endpoint kiểm tra trạng thái máy chủ
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      message: "Máy chủ đang hoạt động bình thường",
      serverDictCount: serverDictionary.size
    });
  });

  // Endpoint lấy và cập nhật cấu hình AI (Model, Proxy, Custom Key, Provider Type)
  app.get("/api/ai/config", (req, res) => {
    res.json({
      activeModel: currentAiModel,
      providerType: aiProviderType,
      hasApiKey: !!(customApiKey.trim() || process.env.GEMINI_API_KEY),
      proxyUrl: aiProxyUrl,
      availableModels: [
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite",
        "google/gemini-2.5-flash",
        "gpt-4o-mini",
        "deepseek-chat"
      ]
    });
  });

  app.post("/api/ai/config", (req, res) => {
    try {
      const { activeModel, customKey, proxyUrl, providerType } = req.body;
      if (typeof activeModel === 'string' && activeModel.trim()) {
        currentAiModel = activeModel.trim();
      }
      if (typeof providerType === 'string' && providerType.trim()) {
        aiProviderType = providerType.trim();
      }
      if (typeof customKey === 'string') {
        customApiKey = customKey.trim();
      }
      if (typeof proxyUrl === 'string') {
        aiProxyUrl = proxyUrl.trim();
      }

      res.json({
        success: true,
        message: "Cập nhật cấu hình AI máy chủ thành công!",
        activeModel: currentAiModel,
        providerType: aiProviderType,
        hasApiKey: !!(customApiKey.trim() || process.env.GEMINI_API_KEY),
        proxyUrl: aiProxyUrl
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1. Endpoint lấy thống kê từ điển phía máy chủ
  app.get("/api/dictionary/stats", (req, res) => {
    const stats: Record<string, number> = {
      Name: 0,
      Pronouns: 0,
      LuatNhan: 0,
      VietPhrase: 0,
      PhienAm: 0,
      AiName: 0,
      AiPronouns: 0,
      AiLuatNhan: 0,
      AiVietPhrase: 0,
      AiPhienAm: 0,
      AiDict: 0,
      TotalStandard: 0,
      TotalAi: 0,
      Total: serverDictionary.size,
    };

    serverDictionary.forEach((entry) => {
      if (stats[entry.cat] !== undefined) {
        stats[entry.cat]++;
      }
      if (STANDARD_CATEGORIES.includes(entry.cat)) {
        stats.TotalStandard++;
      }
      if (AI_CATEGORIES.includes(entry.cat)) {
        stats.TotalAi++;
      }
    });

    const memoryUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    res.json({
      success: true,
      stats,
      dictDirectoryPath: DICT_DIR,
      memoryUsageMB: `${memoryUsageMB} MB`,
      activeAiModel: currentAiModel,
      hasAiApiKey: !!(customApiKey.trim() || process.env.GEMINI_API_KEY),
      aiProxyUrl: aiProxyUrl,
    });
  });

  // Endpoint tra cứu / duyệt danh sách từ trong máy chủ
  app.get("/api/dictionary/entries", (req, res) => {
    const { category, group, search, limit = 100 } = req.query;
    const result: ServerDictEntry[] = [];
    const max = Number(limit) || 100;

    serverDictionary.forEach((entry) => {
      if (group === 'standard' && !STANDARD_CATEGORIES.includes(entry.cat)) return;
      if (group === 'ai' && !AI_CATEGORIES.includes(entry.cat)) return;
      if (category && entry.cat !== category) return;
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        if (!entry.zh.toLowerCase().includes(q) && !entry.vi.toLowerCase().includes(q)) return;
      }
      if (result.length < max) {
        result.push(entry);
      }
    });

    res.json({ success: true, count: result.length, total: serverDictionary.size, entries: result });
  });

  // Endpoint dịch văn bản qua API máy chủ (Hỗ trợ lựa chọn bộ từ điển & AI Gemini)
  app.post("/api/translate-text", async (req, res) => {
    try {
      const { text, engine, maxPhraseLength, dictMode } = req.body;
      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'Thiếu trường text' });
      }

      const parsedMaxLen = typeof maxPhraseLength === 'number' && maxPhraseLength > 0 ? maxPhraseLength : 16;
      const parsedDictMode = (dictMode === 'standard' || dictMode === 'ai') ? dictMode : 'both';

      if (engine === 'gemini') {
        try {
          const translated = await translateWithGemini(text, parsedDictMode);
          return res.json({ success: true, original: text, translated, engine: 'gemini', dictMode: parsedDictMode });
        } catch (geminiErr: any) {
          console.error("Lỗi dịch Gemini AI:", geminiErr);
          const fallbackTranslated = translateTextServer(text, { maxPhraseLength: parsedMaxLen, dictMode: parsedDictMode });
          return res.json({
            success: true,
            original: text,
            translated: fallbackTranslated,
            engine: 'vietphrase',
            dictMode: parsedDictMode,
            fallbackNotice: `Không thể gọi Gemini AI (${geminiErr.message || 'Lỗi kết nối'}). Đã chuyển sang Dịch Từ Điển VietPhrase.`,
          });
        }
      }

      // Mặc định: Dịch từ điển VietPhrase với lựa chọn bộ từ điển dictMode
      const translated = translateTextServer(text, { maxPhraseLength: parsedMaxLen, dictMode: parsedDictMode });
      res.json({ success: true, original: text, translated, engine: 'vietphrase', dictMode: parsedDictMode });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint trích xuất cặp từ vựng từ bản dịch mượt Gemini AI
  app.post("/api/dictionary/extract-from-ai", async (req, res) => {
    try {
      const { sourceText, translatedText } = req.body;
      if (!sourceText || !translatedText) {
        return res.status(400).json({ error: "Cần cung cấp cả sourceText và translatedText." });
      }

      const pairs = await extractDictionaryWithGemini(sourceText, translatedText);
      res.json({ success: true, pairs, count: pairs.length });
    } catch (err: any) {
      console.error("Lỗi trích xuất từ điển từ AI:", err);
      res.status(500).json({ error: err.message || "Lỗi khi trích xuất từ điển bằng AI." });
    }
  });

  // Endpoint thêm hàng loạt cặp từ mới vào danh mục từ điển máy chủ
  app.post("/api/dictionary/add-entries", (req, res) => {
    try {
      const { category, entries } = req.body;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "Thiếu mảng entries." });
      }

      const defaultCat = (category && ALL_CATEGORIES.includes(category as DictCategory)) ? (category as DictCategory) : 'AiDict';
      let countAdded = 0;
      const affectedCats = new Set<DictCategory>();

      for (const item of entries) {
        if (item && item.zh && item.vi) {
          const zhClean = String(item.zh).trim();
          const viClean = String(item.vi).trim();
          let catToUse: DictCategory = defaultCat;

          if (item.cat && ALL_CATEGORIES.includes(item.cat as DictCategory)) {
            catToUse = item.cat as DictCategory;
          }

          if (zhClean && viClean) {
            const entry: ServerDictEntry = {
              zh: zhClean,
              vi: viClean,
              cat: catToUse,
            };
            serverDictionary.set(`${catToUse}_${entry.zh}`, entry);
            affectedCats.add(catToUse);
            countAdded++;
          }
        }
      }

      rebuildSortedDictList();
      affectedCats.forEach((c) => saveCategoryToDisk(c));

      res.json({
        success: true,
        message: `Đã lưu thành công ${countAdded} từ vựng mới vào bộ từ điển máy chủ`,
        totalDictSize: serverDictionary.size,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Endpoint nạp tệp từ điển TXT dung lượng lớn lên máy chủ (không chiếm RAM trình duyệt)
  app.post("/api/dictionary/upload-txt", (req, res) => {
    try {
      const { category, textContent, overwrite } = req.body;
      if (!category || typeof textContent !== 'string') {
        return res.status(400).json({ error: 'Thiếu tham số category hoặc textContent' });
      }

      const cat = category as DictCategory;

      if (overwrite) {
        // Xóa các từ thuộc danh mục này
        serverDictionary.forEach((val, key) => {
          if (val.cat === cat) {
            serverDictionary.delete(key);
          }
        });
      }

      const lines = textContent.split(/\r?\n/);
      let countAdded = 0;

      for (let i = 0; i < lines.length; i++) {
        const entry = parseDictLine(lines[i], cat);
        if (entry) {
          serverDictionary.set(`${entry.cat}_${entry.zh}`, entry);
          countAdded++;
        }
      }

      rebuildSortedDictList();
      saveCategoryToDisk(cat);

      res.json({
        success: true,
        message: `Đã nạp ${countAdded} mục từ vào kho máy chủ [${cat}]`,
        totalDictSize: serverDictionary.size,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Endpoint xóa từ điển máy chủ
  app.post("/api/dictionary/clear", (req, res) => {
    const { category, group } = req.body || {};

    if (group === 'standard') {
      serverDictionary.forEach((val, key) => {
        if (STANDARD_CATEGORIES.includes(val.cat)) serverDictionary.delete(key);
      });
      for (const cat of STANDARD_CATEGORIES) saveCategoryToDisk(cat);
    } else if (group === 'ai') {
      serverDictionary.forEach((val, key) => {
        if (AI_CATEGORIES.includes(val.cat)) serverDictionary.delete(key);
      });
      for (const cat of AI_CATEGORIES) saveCategoryToDisk(cat);
    } else if (category && ALL_CATEGORIES.includes(category as DictCategory)) {
      serverDictionary.forEach((val, key) => {
        if (val.cat === category) serverDictionary.delete(key);
      });
      saveCategoryToDisk(category as DictCategory);
    } else {
      serverDictionary.clear();
      for (const cat of ALL_CATEGORIES) {
        saveCategoryToDisk(cat);
      }
    }
    rebuildSortedDictList();
    res.json({ success: true, message: 'Đã dọn dẹp kho từ điển máy chủ', totalDictSize: serverDictionary.size });
  });

  // Endpoint xuất/tải tệp TXT từ điển
  app.get("/api/dictionary/export-txt", (req, res) => {
    const { category } = req.query;
    const catStr = (category as DictCategory) || 'VietPhrase';
    const fileName = getDictFileName(catStr);
    const filePath = path.join(DICT_DIR, fileName);

    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.sendFile(filePath);
    }

    // Nếu tệp chưa tồn tại trên đĩa, tạo nội dung từ bộ nhớ
    const lines: string[] = [];
    serverDictionary.forEach((entry) => {
      if (entry.cat === catStr) {
        lines.push(`${entry.zh}=${entry.vi}`);
      }
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(lines.join('\n'));
  });

  // 4. Endpoint dịch tệp JSON ở phía máy chủ (xử lý tệp cực lớn mà không làm treo trình duyệt)
  app.post("/api/translate-file", (req, res) => {
    try {
      const { jsonData, settings } = req.body;
      if (!jsonData) {
        return res.status(400).json({ error: 'Không có dữ liệu JSON' });
      }

      const translatePrimaryKeywords = settings?.translatePrimaryKeywords ?? true;
      const translateComments = settings?.translateComments ?? true;
      const translateContent = settings?.translateContent ?? true;

      const resultData = JSON.parse(JSON.stringify(jsonData));

      if (resultData.entries) {
        const keys = Object.keys(resultData.entries);
        for (let i = 0; i < keys.length; i++) {
          const entry = resultData.entries[keys[i]];

          if (translatePrimaryKeywords) {
            if (Array.isArray(entry.key)) entry.key = translateArrayServer(entry.key);
            if (Array.isArray(entry.keysecondary)) entry.keysecondary = translateArrayServer(entry.keysecondary);
          }

          if (translateComments && entry.comment) {
            entry.comment = translateTextServer(entry.comment);
          }

          if (translateContent && entry.content) {
            entry.content = translateTextServer(entry.content);
          }
        }
      }

      if (resultData.originalData?.entries) {
        for (let i = 0; i < resultData.originalData.entries.length; i++) {
          const entry = resultData.originalData.entries[i];

          if (translatePrimaryKeywords) {
            if (Array.isArray(entry.keys)) entry.keys = translateArrayServer(entry.keys);
            if (Array.isArray(entry.secondary_keys)) entry.secondary_keys = translateArrayServer(entry.secondary_keys);
          }

          if (translateComments && entry.comment) entry.comment = translateTextServer(entry.comment);
          if (translateContent && entry.content) entry.content = translateTextServer(entry.content);
        }
      }

      if (resultData.originalData?.name && translatePrimaryKeywords) {
        resultData.originalData.name = translateTextServer(resultData.originalData.name);
      }

      res.json({
        success: true,
        translatedData: resultData,
        message: 'Dịch thành công ở phía máy chủ!',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Lỗi dịch phía máy chủ: ' + err.message });
    }
  });

  // 5. Endpoint Git Pull & Trạng thái Git (Hỗ trợ cập nhật tự động mã nguồn từ Git)
  app.get("/api/git/status", (req, res) => {
    exec("git status", { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        return res.json({
          isGitRepo: false,
          status: "Chưa khởi tạo kho Git trực tiếp trong thư mục làm việc hiện tại hoặc môi trường sandbox.",
          output: error.message
        });
      }
      res.json({
        isGitRepo: true,
        status: stdout.trim()
      });
    });
  });

  app.post("/api/git/pull", (req, res) => {
    exec("git pull", { cwd: process.cwd() }, (error, stdout, stderr) => {
      // Nạp lại các tệp từ điển từ đĩa sau khi kéo code
      loadDictionariesFromDisk();
      if (error) {
        return res.json({
          success: false,
          output: stdout || stderr || error.message,
          message: "Không thể tự động git pull (máy chủ sandbox AI Studio chưa được liên kết git clone trực tiếp). Hãy dùng tính năng Export to GitHub từ menu AI Studio hoặc chạy git pull ở máy cá nhân."
        });
      }
      res.json({
        success: true,
        output: stdout,
        message: "Cập nhật mã nguồn & từ điển từ Git thành công!"
      });
    });
  });

  // Tích hợp Vite middleware cho môi trường phát triển (Development)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Phục vụ tệp tĩnh trong môi trường sản xuất (Production)
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Khởi chạy máy chủ tại cổng 3000 và host 0.0.0.0
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Máy chủ dịch thuật đang chạy tại http://localhost:${PORT}`);
  });
}

startServer();

