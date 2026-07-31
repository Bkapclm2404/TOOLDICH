// Định nghĩa cấu trúc mở rộng của các mục nhập
export interface EntryExtension {
  position?: number;
  exclude_recursion?: boolean;
  display_index?: number;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  selectiveLogic?: number;
  group?: string;
  group_override?: boolean;
  group_weight?: number;
  prevent_recursion?: boolean;
  delay_until_recursion?: boolean;
  scan_depth?: number | null;
  match_whole_words?: boolean | null;
  use_group_scoring?: boolean;
  case_sensitive?: boolean | null;
  automation_id?: string;
  role?: number | null;
  vectorized?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  match_persona_description?: boolean;
  match_character_description?: boolean;
  match_character_personality?: boolean;
  match_character_depth_prompt?: boolean;
  match_scenario?: boolean;
  match_creator_notes?: boolean;
}

// Định nghĩa cấu trúc mục nhập nội dung
export interface Entry {
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  constant: boolean;
  vectorized?: boolean;
  selective: boolean;
  selectiveLogic: number;
  addMemo: boolean;
  order: number;
  position: number;
  disable: boolean;
  ignoreBudget: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  delayUntilRecursion: boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  outletName: string;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean;
  automationId: string;
  role: number;
  sticky: number;
  cooldown: number;
  delay: number;
  triggers: any[];
  uid: number;
  displayIndex: number;
  extensions: EntryExtension;
  characterFilter: {
    isExclude: boolean;
    names: string[];
    tags: string[];
  };
}

// Định nghĩa cấu trúc danh sách mục gốc
export interface OriginalDataEntry {
  id: number;
  keys: string[];
  secondary_keys: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  insertion_order: number;
  enabled: boolean;
  position: string;
  use_regex: boolean;
  extensions: EntryExtension;
}

// Định nghĩa cấu trúc dữ liệu JSON chính cần dịch
export interface TranslationData {
  entries: Record<string, Entry>;
  originalData: {
    entries: OriginalDataEntry[];
    name: string;
  };
}

// Định nghĩa danh mục từ điển chuẩn QuickTranslator / VietPhrase
export type DictCategory = 'Name' | 'Pronouns' | 'LuatNhan' | 'VietPhrase' | 'PhienAm';

// Định nghĩa một thuật ngữ trong từ điển
export interface DictionaryEntry {
  id: string;
  original: string;    // Tiếng Trung (gốc)
  translated: string;  // Tiếng Việt (dịch)
  category: DictCategory; // Danh mục: Name, Pronouns, LuatNhan, VietPhrase, PhienAm
}

// Cấu hình quy tắc dịch từ điển
export interface TranslationSettings {
  caseSensitive: boolean;          // Phân biệt hoa thường
  matchWholeWords: boolean;        // Khớp nguyên từ
  translatePrimaryKeywords: boolean; // Dịch cả Primary Keywords (keys, keysecondary)
  translateComments: boolean;       // Dịch phần bình luận (comment)
  translateContent: boolean;        // Dịch phần nội dung (content)
}
