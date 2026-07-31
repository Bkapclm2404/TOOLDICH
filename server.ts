import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";

// Định nghĩa cấu trúc từ điển phía máy chủ
interface ServerDictEntry {
  zh: string;
  vi: string;
  cat: 'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm';
}

// Lưu trữ từ điển trên bộ nhớ/đĩa máy chủ
const serverDictionary: Map<string, ServerDictEntry> = new Map();

// Thư mục lưu trữ từ điển cố định trên máy chủ
const DICT_DIR = path.join(process.cwd(), "dictionaries");

// Tự động khởi tạo thư mục từ điển nếu chưa có
if (!fs.existsSync(DICT_DIR)) {
  fs.mkdirSync(DICT_DIR, { recursive: true });
}

// Mảng được sắp xếp theo độ dài giảm dần và Map tra cứu nhanh cho thuật toán Maximum Matching
let sortedDictList: ServerDictEntry[] = [];
let dictLookupMap = new Map<string, { vi: string; catPriority: number }>();
let maxZhLength = 1;

// Hàm cập nhật cấu trúc tra cứu từ điển
function rebuildSortedDictList() {
  const catPriority: Record<string, number> = { Name: 1, Pronouns: 2, LuatNhan: 3, VietPhrase: 4, PhienAm: 5 };
  
  dictLookupMap.clear();
  maxZhLength = 1;

  serverDictionary.forEach((entry) => {
    if (!entry.zh) return;
    const prio = catPriority[entry.cat] || 99;
    const existing = dictLookupMap.get(entry.zh);
    if (!existing || prio < existing.catPriority) {
      dictLookupMap.set(entry.zh, { vi: entry.vi, catPriority: prio });
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
  cat: 'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm'
): { zh: string; vi: string; cat: typeof cat } | null {
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

  let zh = part1;
  let vi = part2;

  // Tự động hoán đổi nếu dòng bị ngược cấu trúc (người dùng nhập Vietnamese=Chinese)
  const zhHasCn = hasChineseCharacters(part1);
  const viHasCn = hasChineseCharacters(part2);
  const zhHasViAccents = hasVietnameseAccents(part1);
  const viHasViAccents = hasVietnameseAccents(part2);

  if (viHasCn && !zhHasCn) {
    // Trường hợp 1: Phía sau có chữ Hán, phía trước không có chữ Hán -> hoán đổi
    zh = part2;
    vi = part1;
  } else if (zhHasViAccents && !viHasViAccents && !zhHasCn) {
    // Trường hợp 2: Phía trước có dấu tiếng Việt, phía sau là Pinyin (không có dấu tiếng Việt & không có chữ Hán) -> hoán đổi
    zh = part2;
    vi = part1;
  }

  if (zh === '') return null;

  return { zh, vi, cat };
}

// Hàm nạp từ điển từ các tệp trong thư mục ./dictionaries/
function loadDictionariesFromDisk() {
  const categories: Array<'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm'> = [
    'Name', 'Pronouns', 'LuatNhan', 'VietPhrase', 'PhienAm'
  ];

  for (const cat of categories) {
    const filePath = path.join(DICT_DIR, `${cat}.txt`);
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
function saveCategoryToDisk(cat: 'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm') {
  try {
    const filePath = path.join(DICT_DIR, `${cat}.txt`);
    const entries: string[] = [];
    serverDictionary.forEach((entry) => {
      if (entry.cat === cat) {
        entries.push(`${entry.zh}=${entry.vi}`);
      }
    });
    fs.writeFileSync(filePath, entries.join('\n'), 'utf-8');
  } catch (err) {
    console.error(`Lỗi khi lưu tệp từ điển ${cat}.txt:`, err);
  }
}

// Hàm làm sạch lựa chọn dịch (chỉ lấy phương án đầu tiên trước dấu | hoặc /)
function cleanViChoice(vi: string): string {
  if (!vi) return '';
  return vi.split('|')[0].split('/')[0].trim();
}

// Định dạng lại các token sau khi dịch (thêm khoảng trắng hợp lý giữa các từ)
function formatTranslatedTokens(tokens: string[]): string {
  let out = '';
  for (let idx = 0; idx < tokens.length; idx++) {
    const curr = tokens[idx];
    if (!curr) continue;

    if (out.length > 0) {
      const lastChar = out[out.length - 1];
      const firstChar = curr[0];

      // Thêm khoảng trắng nếu hai từ đứng cạnh nhau đều là chữ/số
      const isLastWord = /[\p{L}\p{N}]/u.test(lastChar);
      const isFirstWord = /[\p{L}\p{N}]/u.test(firstChar);

      if (isLastWord && isFirstWord) {
        out += ' ';
      }
    }

    out += curr;
  }
  return out;
}

// Thuật toán dịch Forward Maximum Matching
function translateSegment(text: string): string {
  let i = 0;
  const len = text.length;
  const resultTokens: string[] = [];

  // Tra nhanh PhienAm
  const phienAmMap = new Map<string, string>();
  serverDictionary.forEach((entry) => {
    if (entry.cat === 'PhienAm' && entry.zh.length === 1) {
      phienAmMap.set(entry.zh, cleanViChoice(entry.vi));
    }
  });

  while (i < len) {
    const char = text[i];

    // Không phải chữ Hán -> giữ nguyên
    if (!hasChineseCharacters(char)) {
      resultTokens.push(char);
      i++;
      continue;
    }

    // Tra cứu cụm từ dài nhất bắt đầu tại vị trí i
    let matched = false;
    const maxLookahead = Math.min(len - i, maxZhLength);

    for (let subLen = maxLookahead; subLen >= 1; subLen--) {
      const sub = text.substring(i, i + subLen);
      const entry = dictLookupMap.get(sub);
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
function translateTextServer(text: string, options: { translateKeywords?: boolean } = {}): string {
  if (!text || typeof text !== 'string') return text;
  if (serverDictionary.size === 0) return text;

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
    return translateSegment(token.content);
  });

  return translatedTokens.join('');
}

// Dịch mảng chuỗi (keys, keysecondary)
function translateArrayServer(arr: any[]): any[] {
  if (!Array.isArray(arr)) return arr;
  return arr.map((item) => {
    if (typeof item === 'string') {
      return translateTextServer(item);
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

  // 1. Endpoint lấy thống kê từ điển phía máy chủ
  app.get("/api/dictionary/stats", (req, res) => {
    const stats: Record<string, number> = {
      Name: 0,
      Pronouns: 0,
      LuatNhan: 0,
      VietPhrase: 0,
      PhienAm: 0,
      Total: serverDictionary.size,
    };

    serverDictionary.forEach((entry) => {
      if (stats[entry.cat] !== undefined) {
        stats[entry.cat]++;
      }
    });

    const memoryUsageMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    res.json({
      success: true,
      stats,
      dictDirectoryPath: DICT_DIR,
      memoryUsageMB: `${memoryUsageMB} MB`,
    });
  });

  // Endpoint tra cứu / duyệt danh sách từ trong máy chủ
  app.get("/api/dictionary/entries", (req, res) => {
    const { category, search, limit = 100 } = req.query;
    const result: ServerDictEntry[] = [];
    const max = Number(limit) || 100;

    serverDictionary.forEach((entry) => {
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

  // Endpoint dịch văn bản đơn thuần trực tiếp qua API máy chủ
  app.post("/api/translate-text", (req, res) => {
    try {
      const { text } = req.body;
      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'Thiếu trường text' });
      }
      const translated = translateTextServer(text);
      res.json({ success: true, original: text, translated });
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

      if (overwrite) {
        // Xóa các từ thuộc danh mục này
        serverDictionary.forEach((val, key) => {
          if (val.cat === category) {
            serverDictionary.delete(key);
          }
        });
      }

      const lines = textContent.split(/\r?\n/);
      let countAdded = 0;

      for (let i = 0; i < lines.length; i++) {
        const entry = parseDictLine(lines[i], category);
        if (entry) {
          serverDictionary.set(`${entry.cat}_${entry.zh}`, entry);
          countAdded++;
        }
      }

      rebuildSortedDictList();
      saveCategoryToDisk(category);

      res.json({
        success: true,
        message: `Đã nạp ${countAdded} mục từ vào kho máy chủ [${category}]`,
        totalDictSize: serverDictionary.size,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Endpoint xóa từ điển máy chủ
  app.post("/api/dictionary/clear", (req, res) => {
    const { category } = req.body || {};
    const categories: Array<'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm'> = [
      'Name', 'Pronouns', 'LuatNhan', 'VietPhrase', 'PhienAm'
    ];

    if (category) {
      serverDictionary.forEach((val, key) => {
        if (val.cat === category) serverDictionary.delete(key);
      });
      saveCategoryToDisk(category);
    } else {
      serverDictionary.clear();
      for (const cat of categories) {
        saveCategoryToDisk(cat);
      }
    }
    rebuildSortedDictList();
    res.json({ success: true, message: 'Đã dọn dẹp kho từ điển máy chủ', totalDictSize: serverDictionary.size });
  });

  // Endpoint xuất/tải tệp TXT từ điển
  app.get("/api/dictionary/export-txt", (req, res) => {
    const { category } = req.query;
    const catStr = (category as string) || 'VietPhrase';
    const filePath = path.join(DICT_DIR, `${catStr}.txt`);

    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${catStr}.txt"`);
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
    res.setHeader('Content-Disposition', `attachment; filename="${catStr}.txt"`);
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

