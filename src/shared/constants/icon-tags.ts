import type { CuratedIconName } from "./curated-icons";

/**
 * Semantic search tags for curated icons.
 * Each icon maps to common aliases, categories, and related terms so users
 * can find icons without knowing the exact name (e.g. "money" → piggy-bank, wallet, coins).
 */
export const ICON_TAGS: Record<CuratedIconName, readonly string[]> = {
  // Basic / General
  rocket: ["launch", "startup", "deploy", "ship", "release", "space"],
  target: ["goal", "objective", "aim", "focus", "bullseye", "okr"],
  folder: ["directory", "files", "organize", "project"],
  briefcase: ["work", "business", "job", "career", "office", "professional"],
  code: ["development", "programming", "engineering", "dev", "software", "tech"],
  bug: ["issue", "error", "debug", "fix", "defect", "testing", "qa"],
  zap: ["fast", "quick", "lightning", "power", "energy", "speed", "performance"],
  star: ["favorite", "important", "featured", "rating", "top", "best"],
  heart: ["love", "like", "health", "wellness", "favorite", "care"],
  flag: ["milestone", "priority", "mark", "report", "important", "deadline"],
  bookmark: ["save", "favorite", "reference", "later", "read"],
  clipboard: ["copy", "paste", "tasks", "checklist", "notes", "todo"],
  layers: ["stack", "design", "levels", "structure", "architecture", "tiers"],
  database: ["data", "storage", "backend", "sql", "records", "tech"],
  globe: ["world", "web", "international", "global", "internet", "website"],
  shield: ["security", "protection", "safety", "guard", "privacy", "compliance"],
  lock: ["security", "private", "protected", "access", "auth", "password"],
  key: ["access", "auth", "login", "unlock", "secret", "api", "credentials"],
  settings: ["config", "preferences", "options", "gear", "admin", "setup"],
  wrench: ["tools", "fix", "repair", "maintain", "configure", "utility"],
  lightbulb: ["idea", "innovation", "creative", "insight", "inspiration", "brainstorm"],
  megaphone: ["announce", "marketing", "campaign", "promotion", "broadcast", "comms"],
  calendar: ["date", "schedule", "event", "plan", "meeting", "deadline", "timeline"],
  clock: ["time", "deadline", "schedule", "hours", "timer", "duration", "tracking"],
  users: ["team", "group", "people", "members", "community", "collaboration"],
  mail: ["email", "message", "inbox", "send", "communication", "letter", "comms"],
  "message-circle": ["chat", "comment", "discussion", "conversation", "talk", "feedback", "comms"],
  "file-text": ["document", "text", "doc", "report", "content", "writing", "notes"],
  image: ["photo", "picture", "media", "visual", "graphic", "asset"],
  palette: ["design", "color", "art", "creative", "theme", "style", "ui"],
  truck: ["delivery", "shipping", "logistics", "transport", "supply"],
  "shopping-cart": ["ecommerce", "store", "buy", "purchase", "retail", "shop", "commerce"],
  "trending-up": ["growth", "analytics", "increase", "progress", "metrics", "stats", "kpi"],
  music: ["audio", "sound", "media", "podcast", "song", "entertainment"],
  "gamepad-2": ["game", "gaming", "play", "entertainment", "fun"],

  // Communication
  phone: ["call", "contact", "support", "mobile", "comms", "telephone"],
  video: ["meeting", "call", "stream", "record", "camera", "conference", "zoom"],
  "at-sign": ["email", "mention", "contact", "handle", "social"],
  send: ["submit", "share", "deliver", "dispatch", "message", "publish"],

  // Development
  terminal: ["cli", "command", "shell", "console", "dev", "ops", "tech"],
  "git-branch": ["version", "branch", "source", "dev", "vcs", "feature"],
  "git-merge": ["merge", "pull request", "pr", "combine", "dev", "integration"],
  cpu: ["processor", "compute", "hardware", "performance", "tech", "chip"],
  server: ["hosting", "backend", "infrastructure", "devops", "deploy", "tech"],
  cloud: ["hosting", "saas", "storage", "online", "aws", "azure", "infrastructure"],
  wifi: ["network", "internet", "connection", "wireless", "online"],
  "hard-drive": ["storage", "disk", "backup", "data", "hardware"],

  // Documents
  file: ["document", "attachment", "upload", "resource"],
  "folder-open": ["directory", "browse", "open", "explore", "files"],
  archive: ["storage", "backup", "old", "history", "compress", "vault"],
  notebook: ["notes", "journal", "writing", "documentation", "log", "diary"],
  "book-open": ["reading", "documentation", "guide", "manual", "learn", "wiki"],
  scroll: ["document", "history", "ancient", "log", "legal", "terms"],
  newspaper: ["news", "article", "blog", "press", "content", "media", "publishing"],

  // Nature / Weather
  sun: ["day", "light", "bright", "summer", "energy", "solar"],
  moon: ["night", "dark", "sleep", "mode", "theme"],
  "cloud-rain": ["weather", "rain", "storm", "downtime"],
  flame: ["fire", "hot", "trending", "popular", "urgent", "burn"],
  leaf: ["nature", "eco", "green", "organic", "environment", "sustainability"],
  "tree-pine": ["nature", "forest", "outdoor", "environment", "growth"],

  // Navigation
  compass: ["direction", "explore", "navigate", "guide", "discovery"],
  map: ["location", "navigate", "geography", "territory", "area", "region"],
  "map-pin": ["location", "place", "address", "gps", "marker", "local"],
  navigation: ["direction", "gps", "route", "navigate", "arrow"],
  signpost: ["direction", "guide", "path", "wayfinding", "choice"],

  // Objects
  gift: ["present", "reward", "bonus", "surprise", "birthday", "celebration"],
  package: ["delivery", "box", "shipping", "product", "bundle", "npm"],
  scissors: ["cut", "edit", "trim", "craft"],
  tag: ["label", "category", "price", "meta", "classify", "organize"],
  paperclip: ["attach", "attachment", "clip", "file"],
  pin: ["pinned", "location", "important", "sticky", "save"],

  // People / Social
  "user-check": ["approved", "verified", "assigned", "complete", "onboard"],
  "user-plus": ["invite", "add", "register", "signup", "onboard", "recruit"],
  "thumbs-up": ["approve", "like", "agree", "good", "positive", "feedback"],

  // Finance
  wallet: ["money", "payment", "finance", "budget", "cash", "funds"],
  "credit-card": ["payment", "money", "billing", "purchase", "finance", "subscription"],
  coins: ["money", "currency", "payment", "finance", "cash", "revenue"],
  "piggy-bank": ["savings", "money", "budget", "finance", "invest", "fund"],

  // Science
  "flask-conical": ["experiment", "science", "lab", "research", "test", "chemistry"],
  microscope: ["research", "science", "analyze", "inspect", "detail", "lab"],
  atom: ["science", "physics", "research", "nuclear", "core"],
  dna: ["biology", "science", "genetics", "health", "medical", "biotech"],
  brain: ["thinking", "ai", "intelligence", "smart", "ml", "cognitive", "strategy"],

  // Misc
  sparkles: ["new", "magic", "ai", "feature", "highlight", "special", "clean"],
  bell: ["notification", "alert", "reminder", "alarm", "update"],

  // Status / Progress
  "check-circle": ["done", "complete", "success", "approved", "verified", "pass"],
  "alert-triangle": ["warning", "danger", "caution", "error", "blocker", "urgent", "risk"],
  "circle-dot": ["active", "current", "in progress", "status", "radio", "selected"],
  hourglass: ["waiting", "pending", "time", "loading", "patience", "delay"],

  // Analytics / Charts
  "bar-chart-2": ["analytics", "data", "metrics", "stats", "report", "dashboard", "graph"],
  "pie-chart": ["analytics", "data", "metrics", "stats", "report", "breakdown", "graph"],
  activity: ["monitoring", "health", "pulse", "metrics", "uptime", "status"],
  gauge: ["performance", "speed", "metrics", "dashboard", "measure", "kpi"],

  // Business / Work
  trophy: ["achievement", "award", "winner", "success", "goal", "competition", "milestone"],
  crown: ["premium", "vip", "leader", "top", "king", "best", "priority"],
  presentation: ["slides", "deck", "meeting", "pitch", "demo", "talk", "keynote"],
  "building-2": ["office", "company", "enterprise", "corporate", "headquarters", "org"],
  handshake: ["deal", "partnership", "agreement", "contract", "sales", "collaboration"],

  // Creative / Media
  camera: ["photo", "photography", "image", "capture", "visual", "media"],
  film: ["video", "movie", "cinema", "media", "production", "content"],
  headphones: ["audio", "music", "podcast", "listen", "support", "media"],
  mic: ["voice", "record", "podcast", "audio", "speak", "interview", "media"],
  "pen-tool": ["design", "vector", "illustrate", "creative", "draw", "bezier"],
  brush: ["design", "paint", "art", "creative", "illustration", "style"],

  // Education / Writing
  "graduation-cap": ["education", "learn", "school", "training", "course", "academic", "onboard"],
  pencil: ["edit", "write", "draft", "compose", "note", "sketch"],
  "book-marked": ["reference", "saved", "bookmark", "documentation", "library", "study"],

  // Tech / Devices
  laptop: ["computer", "device", "work", "remote", "tech", "desktop"],
  monitor: ["screen", "display", "desktop", "device", "tech", "workstation"],
  smartphone: ["mobile", "phone", "device", "app", "ios", "android"],
  link: ["url", "connect", "chain", "integration", "reference", "web", "api"],
  "qr-code": ["scan", "code", "barcode", "mobile", "link"],

  // Essentials
  home: ["house", "main", "dashboard", "start", "base", "landing"],
  search: ["find", "look", "query", "discover", "explore", "magnify"],
  eye: ["view", "watch", "visible", "preview", "review", "observe", "qa"],
  coffee: ["break", "cafe", "morning", "energy", "drink", "casual"],
  hammer: ["build", "construct", "tools", "work", "create", "forge"],
  "refresh-cw": ["reload", "sync", "update", "retry", "cycle", "recurring", "repeat"],

  // Transport
  plane: ["flight", "travel", "airplane", "trip", "international", "remote"],
  car: ["drive", "vehicle", "transport", "commute", "travel", "auto"],

  // Healthcare / Medical
  stethoscope: ["doctor", "medical", "health", "checkup", "diagnosis", "clinic"],
  "heart-pulse": ["health", "medical", "heartbeat", "vitals", "cardio", "monitor"],
  syringe: ["injection", "vaccine", "medical", "health", "dose"],
  pill: ["medicine", "drug", "pharmacy", "health", "prescription", "tablet"],
  hospital: ["medical", "clinic", "health", "emergency", "care", "building"],

  // Legal / Compliance
  scale: ["legal", "justice", "balance", "law", "court", "compliance", "weigh"],
  gavel: ["legal", "judge", "court", "law", "ruling", "decision", "verdict"],
  "file-check": ["audit", "approved", "verified", "document", "compliance", "review"],

  // HR / People Ops
  "user-round": ["person", "profile", "avatar", "account", "member", "individual"],
  contact: ["address", "people", "directory", "crm", "rolodex", "outreach"],
  "badge-check": ["verified", "certified", "credential", "approved", "trust", "identity"],
  "id-card": ["badge", "identity", "employee", "access", "credential", "pass"],

  // Construction / Physical Ops
  "hard-hat": ["construction", "safety", "building", "site", "worker", "engineering"],
  ruler: ["measure", "dimension", "size", "design", "layout", "precision"],
  warehouse: ["storage", "inventory", "logistics", "supply", "depot", "fulfillment"],
  fence: ["boundary", "perimeter", "property", "barrier", "enclosure"],

  // Food / Hospitality
  utensils: ["food", "restaurant", "dining", "kitchen", "meal", "culinary"],
  "chef-hat": ["cooking", "kitchen", "restaurant", "food", "recipe", "culinary"],
  store: ["shop", "retail", "business", "storefront", "market", "commerce"],
  receipt: ["invoice", "billing", "purchase", "transaction", "expense", "record"],

  // Sustainability / Environment
  recycle: ["sustainability", "reuse", "green", "eco", "environment", "circular"],
  wind: ["energy", "renewable", "weather", "turbine", "air", "breeze"],
  droplets: ["water", "rain", "hydration", "liquid", "clean", "resource"],
  earth: ["planet", "world", "global", "environment", "geography", "climate"],

  // Security / Infosec
  scan: ["detect", "search", "analyze", "barcode", "security", "inspect"],
  "fingerprint-pattern": ["biometric", "identity", "auth", "security", "unique", "forensic"],
  "shield-alert": ["warning", "security", "threat", "vulnerability", "risk", "breach"],
  radar: ["detect", "monitor", "surveillance", "signal", "sweep", "threat"],

  // Accessibility / Inclusion
  accessibility: ["a11y", "inclusive", "disability", "universal", "ada", "wcag"],
  ear: ["hearing", "listen", "audio", "sound", "accessibility", "feedback"],
  hand: ["gesture", "touch", "interact", "grab", "wave", "manual"],

  // Workflow / Process
  workflow: ["process", "automation", "pipeline", "flow", "sequence", "orchestrate"],
  "git-pull-request": ["pr", "review", "code", "merge", "contribution", "dev"],
  kanban: ["board", "agile", "cards", "columns", "project", "scrum", "sprint"],
  repeat: ["loop", "recurring", "cycle", "iterate", "again", "retry"],
  split: ["divide", "branch", "fork", "separate", "parallel", "diverge"],
  merge: ["combine", "join", "unify", "consolidate", "converge", "integrate"],
};
