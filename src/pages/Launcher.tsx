import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Square,
  Clock,
  HardDrive,
  Cpu,
  Trash2,
  FolderOpen,
  CircleUser,
  ArrowRight,
  Flame,
  History,
  ChevronRight,
  Sparkles,
  RotateCcw,
  Monitor,
  Server,
} from "lucide-react";
import { useApp } from "../lib/store";
import { launchTimeout } from "../lib/install";
import { api, fmtDuration, timeAgo } from "../lib/api";
import { toast } from "../lib/store";
import type { PlaytimeStats, Profile } from "../lib/types";
import { Badge, Button, Card, Modal, ProgressBar, RefreshButton, StatCard, Tag, cx } from "../components/ui";
import { useT } from "../lib/i18n";

const LOADER_META: Record<
  string,
  { label: string; tile: string; chip: string; glow: string }
> = {
  vanilla: { label: "Vanilla", tile: "from-white/25 to-white/10 text-white", chip: "bg-white/[0.06] text-white/60 border-white/10", glow: "shadow-[0_6px_20px_rgba(255,255,255,0.14)]" },
  fabric: { label: "Fabric", tile: "from-emerald-500/45 to-emerald-500/10 text-emerald-300", chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25", glow: "shadow-[0_6px_20px_rgba(16,185,129,0.3)]" },
  forge: { label: "Forge", tile: "from-amber-500/45 to-amber-500/10 text-amber-300", chip: "bg-amber-500/10 text-amber-300 border-amber-500/25", glow: "shadow-[0_6px_20px_rgba(245,158,11,0.3)]" },
  neoforge: { label: "NeoForge", tile: "from-orange-500/45 to-orange-500/10 text-orange-300", chip: "bg-orange-500/10 text-orange-300 border-orange-500/25", glow: "shadow-[0_6px_20px_rgba(249,115,22,0.3)]" },
  quilt: { label: "Quilt", tile: "from-pink-500/45 to-pink-500/10 text-pink-300", chip: "bg-pink-500/10 text-pink-300 border-pink-500/25", glow: "shadow-[0_6px_20px_rgba(236,72,153,0.3)]" },
};

type MobHead = { pal: Record<string, string>; g: string[] };

const HEADS: Record<string, MobHead> = {
  A: { pal: {"k0":"#e58d3f", "k1":"#f3a858", "k2":"#eb983f", "k3":"#dfc4a2", "k4":"#ebd0b0", "k5":"#efdabf", "k6":"#ffffff", "k7":"#236224", "k8":"#efbbb1"}, g: ["k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3"] },
  B: { pal: {"k0":"#ffff84", "k1":"#fff847", "k2":"#ffd528", "k3":"#fc9600", "k4":"#ffffff", "k5":"#310e0b", "k6":"#d17800", "k7":"#ab7501", "k8":"#8b3401", "k9":"#6c3100", "ka":"#5f0201"}, g: ["k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "kakak9k9kakak9k9kakak9k9kakakaka", "kakak9k9kakak9k9kakak9k9kakakaka"] },
  C: { pal: {"k0":"#a5cd9f", "k1":"#13a90f", "k2":"#4cb341", "k3":"#9dc79d", "k4":"#d2d2d2", "k5":"#85dc74", "k6":"#7dcc6e", "k7":"#4d904a", "k8":"#299326", "k9":"#5fc559", "ka":"#41b736", "kb":"#6ec965", "kc":"#4c9148", "kd":"#70dc5d", "ke":"#65bc55", "kf":"#47c536", "kg":"#1f5417", "kh":"#385831", "ki":"#93d78c", "kj":"#579856", "kk":"#1e4e18", "kl":"#dcdcdc", "km":"#4ccb3d", "kn":"#000000", "ko":"#67cf55", "kp":"#47b239", "kq":"#173a14", "kr":"#78ce67", "ks":"#89d282", "kt":"#65b757", "ku":"#94d78e", "kv":"#1c4f14", "kw":"#1d4c16", "kx":"#c3d2c0", "ky":"#488c45", "kz":"#5ed04c", "kA":"#a4d29a", "kB":"#51974e", "kC":"#1f5518", "kD":"#67d755", "kE":"#bfd2bb", "kF":"#c2e2bb", "kG":"#67a166", "kH":"#5fbc50", "kI":"#51984d", "kJ":"#82de70", "kK":"#93d284", "kL":"#aed0a8", "kM":"#3b8e37", "kN":"#68cf57"}, g: ["k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "ksksktktkukukvkvkwkwkxkxkykykzkz", "ksksktktkukukvkvkwkwkxkxkykykzkz", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kFkFkGkGknknknknknknknknkHkHkIkI", "kFkFkGkGknknknknknknknknkHkHkIkI", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN"] },
  D: { pal: {"k0":"#e58d3f", "k1":"#f3a858", "k2":"#eb983f", "k3":"#dfc4a2", "k4":"#ebd0b0", "k5":"#efdabf", "k6":"#ffffff", "k7":"#236224", "k8":"#efbbb1"}, g: ["k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3"] },
  E: { pal: {"k0":"#000000", "k1":"#161616", "k2":"#e0d0f0", "k3":"#9664d2"}, g: ["k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "................................", "................................", "................................", "................................"] },
  F: { pal: {"k0":"#ffff84", "k1":"#fff847", "k2":"#ffd528", "k3":"#fc9600", "k4":"#ffffff", "k5":"#310e0b", "k6":"#d17800", "k7":"#ab7501", "k8":"#8b3401", "k9":"#6c3100", "ka":"#5f0201"}, g: ["k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "kakak9k9kakak9k9kakak9k9kakakaka", "kakak9k9kakak9k9kakak9k9kakakaka"] },
  G: { pal: {"k0":"#a5cd9f", "k1":"#13a90f", "k2":"#4cb341", "k3":"#9dc79d", "k4":"#d2d2d2", "k5":"#85dc74", "k6":"#7dcc6e", "k7":"#4d904a", "k8":"#299326", "k9":"#5fc559", "ka":"#41b736", "kb":"#6ec965", "kc":"#4c9148", "kd":"#70dc5d", "ke":"#65bc55", "kf":"#47c536", "kg":"#1f5417", "kh":"#385831", "ki":"#93d78c", "kj":"#579856", "kk":"#1e4e18", "kl":"#dcdcdc", "km":"#4ccb3d", "kn":"#000000", "ko":"#67cf55", "kp":"#47b239", "kq":"#173a14", "kr":"#78ce67", "ks":"#89d282", "kt":"#65b757", "ku":"#94d78e", "kv":"#1c4f14", "kw":"#1d4c16", "kx":"#c3d2c0", "ky":"#488c45", "kz":"#5ed04c", "kA":"#a4d29a", "kB":"#51974e", "kC":"#1f5518", "kD":"#67d755", "kE":"#bfd2bb", "kF":"#c2e2bb", "kG":"#67a166", "kH":"#5fbc50", "kI":"#51984d", "kJ":"#82de70", "kK":"#93d284", "kL":"#aed0a8", "kM":"#3b8e37", "kN":"#68cf57"}, g: ["k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "ksksktktkukukvkvkwkwkxkxkykykzkz", "ksksktktkukukvkvkwkwkxkxkykykzkz", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kFkFkGkGknknknknknknknknkHkHkIkI", "kFkFkGkGknknknknknknknknkHkHkIkI", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN"] },
  H: { pal: {"k0":"#332411", "k1":"#3f2a15", "k2":"#2b1e0d", "k3":"#241808", "k4":"#9b6349", "k5":"#b3795e", "k6":"#b7836b", "k7":"#aa7259", "k8":"#342512", "k9":"#ffffff", "ka":"#523d89", "kb":"#6a4030", "kc":"#90593f", "kd":"#8f5e3e", "ke":"#492510", "kf":"#774235", "kg":"#421d0a", "kh":"#815339", "ki":"#94603e"}, g: ["k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kikikhkhkgkgkekekgkgkekekhkhkdkd", "kikikhkhkgkgkekekgkgkekekhkhkdkd"] },
  I: { pal: {"k0":"#000000", "k1":"#161616", "k2":"#e0d0f0", "k3":"#9664d2"}, g: ["k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "................................", "................................", "................................", "................................"] },
  J: { pal: {"k0":"#c47614", "k1":"#a46312", "k2":"#a05a0b", "k3":"#e3901d", "k4":"#e3a64b", "k5":"#ffc264", "k6":"#ffe156", "k7":"#feffa1", "k8":"#d4aa37", "k9":"#7e3d0e"}, g: ["k0k0k0k1k0k0k0k2k1k0k0k0k1k2k0k2", "k3k3k3k0k0k3k3k0k1k3k3k0k1k3k3k2", "k0k4k4k0k5k5k0k4k0k3k5k3k0k3k4k2", "k2k3k4k0k5k6k5k4k0k5k5k5k3k0k4k0", "k2k3k3k5k6k6k6k3k0k5k6k6k5k0k3k0", "k2k3k3k5k6k7k7k3k0k5k7k7k6k0k3k3", "k2k3k3k5k6k7k7k0k1k5k7k7k6k8k3k3", "k2k3k3k4k7k7k3k0k1k4k6k7k7k6k4k3", "k2k3k3k3k4k3k0k4k0k3k4k4k3k4k3k3", "k2k3k3k5k3k5k0k3k5k0k0k5k3k5k3k3", "k2k3k5k5k5k5k7k5k5k7k5k5k6k5k3k3", "k2k3k5k6k6k7k7k7k7k7k7k7k6k6k6k3", "k2k0k3k5k6k3k6k7k0k7k6k6k0k6k8k0", "k2k0k3k4k3k3k8k3k2k3k3k8k9k3k3k2", "k9k2k0k9k0k0k2k2k2k0k2k2k9k2k0k9", "k9k2k2k9k2k0k2k2k9k2k2k9k9k2k2k9"] },
  K: { pal: {"k0":"#bcbcbc", "k1":"#adabad", "k2":"#cbc9c9", "k3":"#d3d3d3", "k4":"#e3e3e3", "k5":"#494949", "k6":"#828282", "k7":"#8e8d8e"}, g: ["k0k0k0k0k1k1k0k0k0k0k0k0k0k0k0k0", "k0k0k0k0k1k1k0k0k0k0k0k0k0k0k0k0", "k0k0k2k2k3k3k1k1k3k3k3k3k2k2k0k0", "k0k0k2k2k3k3k1k1k3k3k3k3k2k2k0k0", "k3k3k3k3k4k4k0k0k3k3k3k3k3k3k3k3", "k3k3k3k3k4k4k0k0k3k3k3k3k3k3k3k3", "k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3", "k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3", "k2k2k5k5k5k5k2k2k0k0k5k5k5k5k2k2", "k2k2k5k5k5k5k2k2k0k0k5k5k5k5k2k2", "k1k1k1k1k0k0k6k6k6k6k1k1k1k1k1k1", "k1k1k1k1k0k0k6k6k6k6k1k1k1k1k1k1", "k7k7k5k5k5k5k5k5k5k5k5k5k5k5k7k7", "k7k7k5k5k5k5k5k5k5k5k5k5k5k5k7k7", "k0k0k0k0k3k3k3k3k3k3k3k3k0k0k0k0", "k0k0k0k0k3k3k3k3k3k3k3k3k0k0k0k0"] },
  L: { pal: {"k0":"#332411", "k1":"#3f2a15", "k2":"#2b1e0d", "k3":"#241808", "k4":"#9b6349", "k5":"#b3795e", "k6":"#b7836b", "k7":"#aa7259", "k8":"#342512", "k9":"#ffffff", "ka":"#523d89", "kb":"#6a4030", "kc":"#90593f", "kd":"#8f5e3e", "ke":"#492510", "kf":"#774235", "kg":"#421d0a", "kh":"#815339", "ki":"#94603e"}, g: ["k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kikikhkhkgkgkekekgkgkekekhkhkdkd", "kikikhkhkgkgkekekgkgkekekhkhkdkd"] },
  M: { pal: {"k0":"#c47614", "k1":"#a46312", "k2":"#a05a0b", "k3":"#e3901d", "k4":"#e3a64b", "k5":"#ffc264", "k6":"#ffe156", "k7":"#feffa1", "k8":"#d4aa37", "k9":"#7e3d0e"}, g: ["k0k0k0k1k0k0k0k2k1k0k0k0k1k2k0k2", "k3k3k3k0k0k3k3k0k1k3k3k0k1k3k3k2", "k0k4k4k0k5k5k0k4k0k3k5k3k0k3k4k2", "k2k3k4k0k5k6k5k4k0k5k5k5k3k0k4k0", "k2k3k3k5k6k6k6k3k0k5k6k6k5k0k3k0", "k2k3k3k5k6k7k7k3k0k5k7k7k6k0k3k3", "k2k3k3k5k6k7k7k0k1k5k7k7k6k8k3k3", "k2k3k3k4k7k7k3k0k1k4k6k7k7k6k4k3", "k2k3k3k3k4k3k0k4k0k3k4k4k3k4k3k3", "k2k3k3k5k3k5k0k3k5k0k0k5k3k5k3k3", "k2k3k5k5k5k5k7k5k5k7k5k5k6k5k3k3", "k2k3k5k6k6k7k7k7k7k7k7k7k6k6k6k3", "k2k0k3k5k6k3k6k7k0k7k6k6k0k6k8k0", "k2k0k3k4k3k3k8k3k2k3k3k8k9k3k3k2", "k9k2k0k9k0k0k2k2k2k0k2k2k9k2k0k9", "k9k2k2k9k2k0k2k2k9k2k2k9k9k2k2k9"] },
  N: { pal: {"k0":"#bcbcbc", "k1":"#adabad", "k2":"#cbc9c9", "k3":"#d3d3d3", "k4":"#e3e3e3", "k5":"#494949", "k6":"#828282", "k7":"#8e8d8e"}, g: ["k0k0k0k0k1k1k0k0k0k0k0k0k0k0k0k0", "k0k0k0k0k1k1k0k0k0k0k0k0k0k0k0k0", "k0k0k2k2k3k3k1k1k3k3k3k3k2k2k0k0", "k0k0k2k2k3k3k1k1k3k3k3k3k2k2k0k0", "k3k3k3k3k4k4k0k0k3k3k3k3k3k3k3k3", "k3k3k3k3k4k4k0k0k3k3k3k3k3k3k3k3", "k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3", "k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3k3", "k2k2k5k5k5k5k2k2k0k0k5k5k5k5k2k2", "k2k2k5k5k5k5k2k2k0k0k5k5k5k5k2k2", "k1k1k1k1k0k0k6k6k6k6k1k1k1k1k1k1", "k1k1k1k1k0k0k6k6k6k6k1k1k1k1k1k1", "k7k7k5k5k5k5k5k5k5k5k5k5k5k5k7k7", "k7k7k5k5k5k5k5k5k5k5k5k5k5k5k7k7", "k0k0k0k0k3k3k3k3k3k3k3k3k0k0k0k0", "k0k0k0k0k3k3k3k3k3k3k3k3k0k0k0k0"] },
  O: { pal: {"k0":"#343434", "k1":"#1f1f1f", "k2":"#292929", "k3":"#3c4141", "k4":"#515353", "k5":"#151515", "k6":"#a5a5a5", "k7":"#1b1b1b"}, g: ["k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k2k2k2k2k0k0k1k1k0k0k0k0k0k0k0k0", "k2k2k2k2k0k0k1k1k0k0k0k0k0k0k0k0", "k2k2k3k3k4k4k0k0k4k4k4k4k3k3k2k2", "k2k2k3k3k4k4k0k0k4k4k4k4k3k3k2k2", "k5k5k5k5k5k5k4k4k3k3k5k5k5k5k5k5", "k5k5k5k5k5k5k4k4k3k3k5k5k5k5k5k5", "k4k4k6k6k6k6k3k3k4k4k6k6k6k6k0k0", "k4k4k6k6k6k6k3k3k4k4k6k6k6k6k0k0", "k3k3k3k3k4k4k4k4k4k4k4k4k3k3k3k3", "k3k3k3k3k4k4k4k4k4k4k4k4k3k3k3k3", "k5k5k7k7k6k6k6k6k6k6k6k6k7k7k5k5", "k5k5k7k7k6k6k6k6k6k6k6k6k7k7k5k5", "k1k1k5k5k5k5k7k7k7k7k7k7k1k1k7k7", "k1k1k5k5k5k5k7k7k7k7k7k7k1k1k7k7"] },
  P: { pal: {"k0":"#343434", "k1":"#1f1f1f", "k2":"#292929", "k3":"#515353", "k4":"#3c4141", "k5":"#4b4d4d", "k6":"#000000"}, g: ["k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k3k3k4k4k0k0k1k1k0k0k0k0k0k0k4k4", "k3k3k4k4k0k0k1k1k0k0k0k0k0k0k4k4", "k2k2k0k0k2k2k0k0k2k2k2k2k0k0k2k2", "k2k2k0k0k2k2k0k0k2k2k2k2k0k0k2k2", "k0k0k2k2k0k0k0k0k0k0k4k4k4k4k5k5", "k0k0k2k2k0k0k0k0k0k0k4k4k4k4k5k5", "k0k0k6k6k6k6k0k0k0k0k6k6k6k6k0k0", "k0k0k6k6k6k6k0k0k0k0k6k6k6k6k0k0", "k5k5k5k5k0k0k2k2k0k0k0k0k2k2k4k4", "k5k5k5k5k0k0k2k2k0k0k0k0k2k2k4k4", "k2k2k1k1k6k6k6k6k6k6k6k6k1k1k2k2", "k2k2k1k1k6k6k6k6k6k6k6k6k1k1k2k2", "k4k4k0k0k2k2k2k2k0k0k4k4k3k3k3k3", "k4k4k0k0k2k2k2k2k0k0k4k4k3k3k3k3"] },
  Q: { pal: {"k0":"#3e692d", "k1":"#3b622f", "k2":"#497135", "k3":"#698756", "k4":"#4e7b36", "k5":"#679056", "k6":"#6d955b", "k7":"#799c65", "k8":"#71955b", "k9":"#6f955c", "ka":"#5a7b48", "kb":"#1a1a1a", "kc":"#487532", "kd":"#4a692d", "ke":"#385226"}, g: ["k0k0k0k0k1k1k1k1k1k1k1k1k1k1k2k2", "k0k0k0k0k1k1k1k1k1k1k1k1k1k1k2k2", "k0k0k1k1k2k2k3k3k3k3k2k2k1k1k0k0", "k0k0k1k1k2k2k3k3k3k3k2k2k1k1k0k0", "k4k4k5k5k6k6k7k7k8k8k9k9k5k5k2k2", "k4k4k5k5k6k6k7k7k8k8k9k9k5k5k2k2", "k3k3kakak8k8k8k8k8k8k3k3kakak3k3", "k3k3kakak8k8k8k8k8k8k3k3kakak3k3", "kakakbkbkbkbk8k8k3k3kbkbkbkbkaka", "kakakbkbkbkbk8k8k3k3kbkbkbkbkaka", "k4k4k3k3k3k3k1k1k1k1k3k3k3k3k4k4", "k4k4k3k3k3k3k1k1k1k1k3k3k3k3k4k4", "k0k0kckck1k1kdkdkdkdk1k1kckck0k0", "k0k0kckck1k1kdkdkdkdk1k1kckck0k0", "k1k1k1k1kekekekek1k1kekek0k0k0k0", "k1k1k1k1kekekekek1k1kekek0k0k0k0"] },
  R: { pal: {"k0":"#e58d3f", "k1":"#f3a858", "k2":"#eb983f", "k3":"#dfc4a2", "k4":"#ebd0b0", "k5":"#efdabf", "k6":"#ffffff", "k7":"#236224", "k8":"#efbbb1"}, g: ["k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k0k0k1k1k2k2k1k1k0k0k2k2k1k1k0k0", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k1k1k0k0k2k2k0k0k0k0k2k2k1k1", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k0k0k2k2k0k0k3k3k3k3k0k0k2k2", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k2k2k2k2k0k0k4k4k5k5k4k4k4k4k0k0", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k4k4k6k6k7k7k5k5k5k5k7k7k6k6k4k4", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5k5", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k5k5k5k5k5k5k8k8k8k8k5k5k5k5k4k4", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3", "k4k4k5k5k5k5k5k5k5k5k5k5k4k4k3k3"] },
  S: { pal: {"k0":"#ffff84", "k1":"#fff847", "k2":"#ffd528", "k3":"#fc9600", "k4":"#ffffff", "k5":"#310e0b", "k6":"#d17800", "k7":"#ab7501", "k8":"#8b3401", "k9":"#6c3100", "ka":"#5f0201"}, g: ["k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k0k0k1k1k1k1k1k1k1k1k1k1k1k1k0k0", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k1k1k0k0k0k0k0k0k0k0k1k1k0k0k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k2k2k1k1k0k0k0k0k1k1k1k1k1k1k2k2", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k3k3k4k4k5k5k1k1k2k2k5k5k4k4k3k3", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k6k6k7k7k6k6k6k6k7k7k3k3k6k6k7k7", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k7k7k8k8k9k9k8k8k8k8k7k7k9k9k8k8", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "k8k8k9k9k9k9k8k8k9k9k8k8k9k9k9k9", "kakak9k9kakak9k9kakak9k9kakakaka", "kakak9k9kakak9k9kakak9k9kakakaka"] },
  T: { pal: {"k0":"#a5cd9f", "k1":"#13a90f", "k2":"#4cb341", "k3":"#9dc79d", "k4":"#d2d2d2", "k5":"#85dc74", "k6":"#7dcc6e", "k7":"#4d904a", "k8":"#299326", "k9":"#5fc559", "ka":"#41b736", "kb":"#6ec965", "kc":"#4c9148", "kd":"#70dc5d", "ke":"#65bc55", "kf":"#47c536", "kg":"#1f5417", "kh":"#385831", "ki":"#93d78c", "kj":"#579856", "kk":"#1e4e18", "kl":"#dcdcdc", "km":"#4ccb3d", "kn":"#000000", "ko":"#67cf55", "kp":"#47b239", "kq":"#173a14", "kr":"#78ce67", "ks":"#89d282", "kt":"#65b757", "ku":"#94d78e", "kv":"#1c4f14", "kw":"#1d4c16", "kx":"#c3d2c0", "ky":"#488c45", "kz":"#5ed04c", "kA":"#a4d29a", "kB":"#51974e", "kC":"#1f5518", "kD":"#67d755", "kE":"#bfd2bb", "kF":"#c2e2bb", "kG":"#67a166", "kH":"#5fbc50", "kI":"#51984d", "kJ":"#82de70", "kK":"#93d284", "kL":"#aed0a8", "kM":"#3b8e37", "kN":"#68cf57"}, g: ["k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k0k0k1k1k2k2k3k3k4k4k5k5k6k6k7k7", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "k8k8k9k9kakakbkbkckckdkdkekek4k4", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kfkfkgkgkhkhkikikjkjkkkkkhkhklkl", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "kmkmkkkkknknkokokpkpknknkqkqkrkr", "ksksktktkukukvkvkwkwkxkxkykykzkz", "ksksktktkukukvkvkwkwkxkxkykykzkz", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kAkAkBkBkhkhknknknknkCkCkDkDkEkE", "kFkFkGkGknknknknknknknknkHkHkIkI", "kFkFkGkGknknknknknknknknkHkHkIkI", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN", "kDkDkJkJkqkqkKkKkLkLkwkwkMkMkNkN"] },
  U: { pal: {"k0":"#000000", "k1":"#161616", "k2":"#e0d0f0", "k3":"#9664d2"}, g: ["k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k0k0k0k0k0k0k0k0k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k0k0k1k1k1k1k0k0k0k0k1k1k1k1k0k0", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k1k1k0k0k1k1k1k1k1k1k1k1k0k0k1k1", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k0k0", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k2k2k3k3k2k2k1k1k1k1k2k2k3k3k2k2", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "k1k1k0k0k0k0k1k1k1k1k0k0k0k0k1k1", "................................", "................................", "................................", "................................"] },
  V: { pal: {"k0":"#332411", "k1":"#3f2a15", "k2":"#2b1e0d", "k3":"#241808", "k4":"#9b6349", "k5":"#b3795e", "k6":"#b7836b", "k7":"#aa7259", "k8":"#342512", "k9":"#ffffff", "ka":"#523d89", "kb":"#6a4030", "kc":"#90593f", "kd":"#8f5e3e", "ke":"#492510", "kf":"#774235", "kg":"#421d0a", "kh":"#815339", "ki":"#94603e"}, g: ["k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k0k0k0k0k1k1k1k1k1k1k1k1k0k0k2k2", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k3k3k0k0k0k0k1k1k1k1k0k0k1k1k0k0", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k2k2k4k4k5k5k6k6k5k5k7k7k4k4k8k8", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k4k4k7k7k5k5k5k5k7k7k7k7k7k7k4k4", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k7k7k9k9kakak7k7k4k4kakak9k9k7k7", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "k4k4k7k7k7k7kbkbkbkbk7k7k7k7k4k4", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kckckdkdkekekfkfkfkfkgkgkdkdkhkh", "kikikhkhkgkgkekekgkgkekekhkhkdkd", "kikikhkhkgkgkekekgkgkekekhkhkdkd"] },
  W: { pal: {"k0":"#343434", "k1":"#1f1f1f", "k2":"#292929", "k3":"#3c4141", "k4":"#515353", "k5":"#151515", "k6":"#a5a5a5", "k7":"#1b1b1b"}, g: ["k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k2k2k2k2k0k0k1k1k0k0k0k0k0k0k0k0", "k2k2k2k2k0k0k1k1k0k0k0k0k0k0k0k0", "k2k2k3k3k4k4k0k0k4k4k4k4k3k3k2k2", "k2k2k3k3k4k4k0k0k4k4k4k4k3k3k2k2", "k5k5k5k5k5k5k4k4k3k3k5k5k5k5k5k5", "k5k5k5k5k5k5k4k4k3k3k5k5k5k5k5k5", "k4k4k6k6k6k6k3k3k4k4k6k6k6k6k0k0", "k4k4k6k6k6k6k3k3k4k4k6k6k6k6k0k0", "k3k3k3k3k4k4k4k4k4k4k4k4k3k3k3k3", "k3k3k3k3k4k4k4k4k4k4k4k4k3k3k3k3", "k5k5k7k7k6k6k6k6k6k6k6k6k7k7k5k5", "k5k5k7k7k6k6k6k6k6k6k6k6k7k7k5k5", "k1k1k5k5k5k5k7k7k7k7k7k7k1k1k7k7", "k1k1k5k5k5k5k7k7k7k7k7k7k1k1k7k7"] },
  X: { pal: {"k0":"#343434", "k1":"#1f1f1f", "k2":"#292929", "k3":"#515353", "k4":"#3c4141", "k5":"#4b4d4d", "k6":"#000000"}, g: ["k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k0k0k0k0k1k1k0k0k0k0k2k2k1k1k0k0", "k3k3k4k4k0k0k1k1k0k0k0k0k0k0k4k4", "k3k3k4k4k0k0k1k1k0k0k0k0k0k0k4k4", "k2k2k0k0k2k2k0k0k2k2k2k2k0k0k2k2", "k2k2k0k0k2k2k0k0k2k2k2k2k0k0k2k2", "k0k0k2k2k0k0k0k0k0k0k4k4k4k4k5k5", "k0k0k2k2k0k0k0k0k0k0k4k4k4k4k5k5", "k0k0k6k6k6k6k0k0k0k0k6k6k6k6k0k0", "k0k0k6k6k6k6k0k0k0k0k6k6k6k6k0k0", "k5k5k5k5k0k0k2k2k0k0k0k0k2k2k4k4", "k5k5k5k5k0k0k2k2k0k0k0k0k2k2k4k4", "k2k2k1k1k6k6k6k6k6k6k6k6k1k1k2k2", "k2k2k1k1k6k6k6k6k6k6k6k6k1k1k2k2", "k4k4k0k0k2k2k2k2k0k0k4k4k3k3k3k3", "k4k4k0k0k2k2k2k2k0k0k4k4k3k3k3k3"] },
  Y: { pal: {"k0":"#c47614", "k1":"#a46312", "k2":"#a05a0b", "k3":"#e3901d", "k4":"#e3a64b", "k5":"#ffc264", "k6":"#ffe156", "k7":"#feffa1", "k8":"#d4aa37", "k9":"#7e3d0e"}, g: ["k0k0k0k1k0k0k0k2k1k0k0k0k1k2k0k2", "k3k3k3k0k0k3k3k0k1k3k3k0k1k3k3k2", "k0k4k4k0k5k5k0k4k0k3k5k3k0k3k4k2", "k2k3k4k0k5k6k5k4k0k5k5k5k3k0k4k0", "k2k3k3k5k6k6k6k3k0k5k6k6k5k0k3k0", "k2k3k3k5k6k7k7k3k0k5k7k7k6k0k3k3", "k2k3k3k5k6k7k7k0k1k5k7k7k6k8k3k3", "k2k3k3k4k7k7k3k0k1k4k6k7k7k6k4k3", "k2k3k3k3k4k3k0k4k0k3k4k4k3k4k3k3", "k2k3k3k5k3k5k0k3k5k0k0k5k3k5k3k3", "k2k3k5k5k5k5k7k5k5k7k5k5k6k5k3k3", "k2k3k5k6k6k7k7k7k7k7k7k7k6k6k6k3", "k2k0k3k5k6k3k6k7k0k7k6k6k0k6k8k0", "k2k0k3k4k3k3k8k3k2k3k3k8k9k3k3k2", "k9k2k0k9k0k0k2k2k2k0k2k2k9k2k0k9", "k9k2k2k9k2k0k2k2k9k2k2k9k9k2k2k9"] },
  Z: { pal: {"k0":"#3e692d", "k1":"#3b622f", "k2":"#497135", "k3":"#698756", "k4":"#4e7b36", "k5":"#679056", "k6":"#6d955b", "k7":"#799c65", "k8":"#71955b", "k9":"#6f955c", "ka":"#5a7b48", "kb":"#1a1a1a", "kc":"#487532", "kd":"#4a692d", "ke":"#385226"}, g: ["k0k0k0k0k1k1k1k1k1k1k1k1k1k1k2k2", "k0k0k0k0k1k1k1k1k1k1k1k1k1k1k2k2", "k0k0k1k1k2k2k3k3k3k3k2k2k1k1k0k0", "k0k0k1k1k2k2k3k3k3k3k2k2k1k1k0k0", "k4k4k5k5k6k6k7k7k8k8k9k9k5k5k2k2", "k4k4k5k5k6k6k7k7k8k8k9k9k5k5k2k2", "k3k3kakak8k8k8k8k8k8k3k3kakak3k3", "k3k3kakak8k8k8k8k8k8k3k3kakak3k3", "kakakbkbkbkbk8k8k3k3kbkbkbkbkaka", "kakakbkbkbkbk8k8k3k3kbkbkbkbkaka", "k4k4k3k3k3k3k1k1k1k1k3k3k3k3k4k4", "k4k4k3k3k3k3k1k1k1k1k3k3k3k3k4k4", "k0k0kckck1k1kdkdkdkdk1k1kckck0k0", "k0k0kckck1k1kdkdkdkdk1k1kckck0k0", "k1k1k1k1kekekekek1k1kekek0k0k0k0", "k1k1k1k1kekekekek1k1kekek0k0k0k0"] },};

function McHead({ name, className }: { name: string; className?: string }) {
  const letter = (name.trim().charAt(0) ?? "S").toUpperCase();
  const head = HEADS[letter] ?? HEADS.S;
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {head.g.map((row, y) =>
        (row.match(/.{2}/g) ?? []).map((c, x) => {
          if (c === "..") return null;
          return <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={head.pal[c] ?? "#f0f"} />;
        })
      )}
    </svg>
  );
}

function ProfileCard({ profile, onPlay, onStop, onRestart, onOverview }: { profile: Profile; onPlay: (p: Profile) => void; onStop: (p: Profile) => void; onRestart: (p: Profile) => void; onOverview: (p: Profile) => void }) {
  const t = useT();
  const installs = useApp((s) => s.installs);
  const install = installs[profile.id];
  const active = install?.status === "progress" || install?.status === "pending";
  const running = useApp((s) => s.runningProfileId) === profile.id;
  const starting = useApp((s) => s.startingProfileId) === profile.id;
  const meta = LOADER_META[profile.loader] ?? LOADER_META.vanilla;

  return (
    <Card
      onClick={() => onOverview(profile)}
      className={cx(
        "group relative overflow-hidden p-5 flex flex-col h-full",
        running && "ring-1 ring-green-500/50 shadow-[0_0_24px_rgba(34,197,94,0.12)]"
      )}
    >
      <div
        className={cx(
          "absolute inset-x-0 top-0 h-[2px] transition-opacity",
          running ? "opacity-100 bg-gradient-to-r from-transparent via-green-400 to-transparent" : "opacity-0"
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cx(
              "w-11 h-11 rounded-[13px] bg-gradient-to-br flex items-center justify-center border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-transform duration-300 group-hover:scale-105",
              meta.tile,
              meta.glow
            )}
          >
            <McHead name={profile.name} className="w-8 h-8 drop-shadow-[0_2px_5px_rgba(0,0,0,0.45)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-white leading-tight">{profile.name}</h3>
              {running && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
            </div>
            <div className="text-[11px] text-white/45 mt-0.5">
              Minecraft {profile.gameVersion} · {meta.label}
              {profile.loaderVersion ? ` ${profile.loaderVersion}` : ""}
            </div>
          </div>
        </div>
        {profile.installStatus !== "installed" && (
          <Badge tone={profile.installStatus === "error" ? "red" : "amber"}>
            {profile.installStatus}
          </Badge>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-white/45">
        {profile.playCount > 0 && (
          <span className="flex items-center gap-1">
            <Play className="w-3 h-3" /> {profile.playCount}×
          </span>
        )}
        {profile.lastPlayed && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {timeAgo(profile.lastPlayed)}
          </span>
        )}
        {profile.memoryMb ? (
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" /> {Math.round(profile.memoryMb / 1024)} GB
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1 text-white/30">
          <HardDrive className="w-3 h-3" /> {profile.customGameDir ? "custom" : "default"}
        </span>
      </div>

      {active && (
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-white/50 mb-1">
            <span className="truncate pr-3">{install?.message || t("launcher.installing")}</span>
            <span>{Math.round(install?.percent ?? 0)}%</span>
          </div>
          <ProgressBar percent={install?.percent ?? 0} />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 pt-1">
        {running ? (
          <>
            <Button
              variant="danger"
              size="sm"
              className="flex-[3]"
              onClick={(e) => {
                e.stopPropagation();
                onStop(profile);
              }}
            >
              <Square className="w-3.5 h-3.5" /> {t("launcher.stop")}
            </Button>
            <Button
              size="sm"
              className="flex-1"
              title={t("launcher.restart")}
              onClick={(e) => {
                e.stopPropagation();
                onRestart(profile);
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              loading={active || starting}
              disabled={active || starting}
              onClick={(e) => {
                e.stopPropagation();
                onPlay(profile);
              }}
            >
          {profile.installStatus === "installed" ? (
            <>
              <Play className="w-3.5 h-3.5" /> {t("launcher.play")}
            </>
          ) : profile.installStatus === "error" ? (
            <>
              <ArrowRight className="w-3.5 h-3.5" /> {t("launcher.retryInstall")}
            </>
          ) : (
            <>
              <ArrowRight className="w-3.5 h-3.5" /> {t("launcher.install")}
            </>
          )}
          </Button>
            <Button
              size="sm"
              title={t("launcher.openDir")}
              onClick={(e) => {
                e.stopPropagation();
                api.openGameDir(profile.id).catch((e) => toast(e));
              }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-white/40 hover:text-red-400"
              title={t("launcher.deleteProfile")}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(t("launcher.deleteQ", { name: profile.name }))) {
                  api.deleteProfile(profile.id).then(() => useApp.getState().refreshProfiles()).catch((e) => toast(e));
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function ProfileOverview({
  profile,
  onClose,
  onPlay,
  onStop,
  onRestart,
}: {
  profile: Profile;
  onClose: () => void;
  onPlay: (p: Profile) => void;
  onStop: (p: Profile) => void;
  onRestart: (p: Profile) => void;
}) {
  const t = useT();
  const running = useApp((s) => s.runningProfileId) === profile.id;
  const installs = useApp((s) => s.installs);
  const active = installs[profile.id]?.status === "progress" || installs[profile.id]?.status === "pending";
  const meta = LOADER_META[profile.loader] ?? LOADER_META.vanilla;
  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";
  const mods = profile.packages.filter((p) => p.kind === "mod");
  const resources = profile.packages.filter((p) => p.kind !== "mod");

  return (
    <Modal open onClose={onClose} title={t("profile.overview")} wide>
      <div className="flex items-start gap-4">
        <div
          className={cx(
            "w-16 h-16 rounded-[18px] bg-gradient-to-br flex items-center justify-center border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] shrink-0",
            meta.tile,
            meta.glow
          )}
        >
          <McHead name={profile.name} className="w-12 h-12 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-xl font-bold tracking-tight text-white truncate">{profile.name}</h3>
            {running ? (
              <Badge tone="green">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> {t("launcher.gameRunning")}
              </Badge>
            ) : profile.installStatus !== "installed" ? (
              <Badge tone={profile.installStatus === "error" ? "red" : "amber"}>{profile.installStatus}</Badge>
            ) : null}
          </div>
          <div className="text-[13px] text-white/45 mt-1">
            Minecraft {profile.gameVersion} · {meta.label}
            {profile.loaderVersion ? ` ${profile.loaderVersion}` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Tag>
              <Cpu className="w-3 h-3" /> {Math.round((profile.memoryMb ?? 0) / 1024)} GB
            </Tag>
            <Tag>
              <Play className="w-3 h-3" /> {profile.playCount}×
            </Tag>
            {profile.resolution && (
              <Tag>
                <Monitor className="w-3 h-3" /> {profile.resolution.width}×{profile.resolution.height}
              </Tag>
            )}
            {profile.server && (
              <Tag>
                <Server className="w-3 h-3" /> {profile.server.name}
              </Tag>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("profile.dir")}</span>
          <span className="text-white/85 truncate uppercase" style={{ maxWidth: "65%" }}>
            {profile.customGameDir ? "custom" : "default"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">Java</span>
          <span className="text-white/85">{profile.javaTag === "_any" ? t("versions.javaAny") : profile.javaTag}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("profile.created")}</span>
          <span className="text-white/85">{fmtDate(profile.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("profile.updated")}</span>
          <span className="text-white/85">{fmtDate(profile.updatedAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("profile.plays")}</span>
          <span className="text-white/85">{profile.playCount}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("profile.playtime")}</span>
          <span className="text-white/85">{profile.playSeconds ? fmtDuration(profile.playSeconds) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 pb-2">
          <span className="text-[12px] text-white/40 uppercase tracking-wider">{t("launcher.lastPlayed")}</span>
          <span className="text-white/85">{profile.lastPlayed ? timeAgo(profile.lastPlayed) : "—"}</span>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[12px] text-white/40 uppercase tracking-wider mb-2">
          {t("profile.mods")}
          <span className="text-white/25 ml-1.5">
            {mods.length} + {resources.length}
          </span>
        </div>
        {profile.packages.length === 0 ? (
          <p className="text-[13px] text-white/35">{t("profile.none")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {profile.packages.map((p) => (
              <Tag key={p.id} className={p.enabled ? "" : "opacity-45 line-through"}>
                {p.name}
                {p.version ? <span className="text-white/35">{p.version}</span> : null}
              </Tag>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2.5 border-t border-white/[0.06] pt-5">
        {running ? (
          <>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              onClick={() => {
                onStop(profile);
                onClose();
              }}
            >
              <Square className="w-4 h-4" /> {t("launcher.stop")}
            </Button>
            <Button
              size="lg"
              title={t("launcher.restart")}
              onClick={() => {
                onRestart(profile);
                onClose();
              }}
            >
              <RotateCcw className="w-4 h-4" /> {t("launcher.restart")}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            loading={active}
            disabled={active}
            onClick={() => {
              onPlay(profile);
              onClose();
            }}
          >
            {profile.installStatus === "installed" ? (
              <>
                <Play className="w-4 h-4" /> {t("launcher.play")}
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" /> {t("launcher.install")}
              </>
            )}
          </Button>
        )}
        <Button
          size="lg"
          title={t("launcher.openDir")}
          onClick={() => api.openGameDir(profile.id).catch((e) => toast(e))}
        >
          <FolderOpen className="w-4 h-4" />
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="text-white/40 hover:text-red-400"
          title={t("launcher.deleteProfile")}
          onClick={() => {
            if (confirm(t("launcher.deleteQ", { name: profile.name }))) {
              api.deleteProfile(profile.id).then(() => {
                useApp.getState().refreshProfiles();
                onClose();
              }).catch((e) => toast(e));
            }
          }}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </Modal>
  );
}

function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function AnimatedNumber({ value, fmt }: { value: number; fmt: (s: number) => string }) {
  const t = useCountUp(value);
  return <>{fmt(t)}</>;
}

function MiniPlaytimeChart({ days }: { days: Array<[string, number]> }) {
  const t = useT();
  const week = days.slice(-7);
  const max = Math.max(1, ...week.map(([, s]) => s));
  const shortDay = (d: string) => {
    const t = new Date(d + "T00:00:00");
    return t.toLocaleDateString(undefined, { weekday: "narrow" });
  };
  const fmt = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`);

  return (
    <div className="mt-3 flex items-end justify-between gap-1.5 h-14">
      {week.length === 0 ? (
        <span className="text-[11px] text-white/30 pt-2">{t("launcher.weekHint")}</span>
      ) : (
        week.map(([d, s], i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group/chart">
            <div className="w-full flex justify-center">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(4, (s / max) * 40)}px` }}
                transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 180, damping: 22 }}
                className={cx(
                  "w-[70%] max-w-[26px] rounded-t-[6px] bg-gradient-to-t from-[#0a84ff]/45 to-[#64d2ff] transition-colors duration-300",
                  s > 0 && "group-hover/chart:from-[#0a84ff]/80 group-hover/chart:to-[#a5e3ff]"
                )}
                title={`${d}: ${fmt(s)}`}
              />
            </div>
            <span className="text-[9px] text-white/30">{shortDay(d)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function LauncherPage() {
  const t = useT();
  const { profiles, accountCount, gameRunning } = useApp();
  const startingId = useApp((s) => s.startingProfileId);
  const [, setRunning] = useState<Profile | null>(null);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [gameLog, setGameLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [overviewId, setOverviewId] = useState<string | null>(null);
  const [stats, setStats] = useState<PlaytimeStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const lastProfile = useMemo(() => {
    const sorted = [...profiles].sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""));
    return sorted[0] ?? null;
  }, [profiles]);

  useEffect(() => {
    api.playtimeStats().then(setStats).catch(() => {});
  }, []);

  const refreshStats = async () => {
    setRefreshing(true);
    try {
      api.playtimeStats().then(setStats).catch(() => {});
      await useApp.getState().refreshProfiles();
    } finally {
      setRefreshing(false);
    }
  };

  const play = async (p: Profile) => {
    if (accountCount === 0) {
      toast(t("versions.loginToCreate"));
      return;
    }
    useApp.getState().setStartingProfileId(p.id);
    useApp.getState().setLaunchingProfileId(p.id);
    try {
      if (p.installStatus !== "installed") {
        await api.installProfile(p.id);
        await useApp.getState().refreshProfiles();
      }
      const res = await Promise.race([
        api.launchProfile(p.id),
        launchTimeout(p.id, p.installStatus === "installed", t),
      ]);
      if (res === "launched") {
        toast(t("common.launching", { name: p.name }));
        useApp.getState().setGameRunning(true);
        useApp.getState().setRunningProfileId(p.id);
        useApp.getState().setInstall(p.id, null);
        setRunning(p);
      }
    } catch (e) {
      toast(String(e));
      useApp.getState().setGameRunning(false);
      useApp.getState().setRunningProfileId(null);
      useApp.getState().setInstall(p.id, null);
    } finally {
      useApp.getState().setStartingProfileId(null);
      useApp.getState().setLaunchingProfileId(null);
    }
  };

  const stop = async () => {
    setStopping(true);
    const ok = await useApp.getState().stop();
    setRunning(null);
    setStopping(false);
    if (ok) toast(t("launcher.stopped"));
  };

  const restart = async (p: Profile) => {
    useApp.getState().setStartingProfileId(p.id);
    setRestarting(true);
    await useApp.getState().stop();
    setRestarting(false);
    await play(p);
  };

  useEffect(() => {
    if (!gameRunning) return;
    const t = setInterval(async () => {
      const gs = await api.gameStatus().catch(() => null);
      if (!gs) return;
      if (gs.profileId) {
        useApp.getState().setRunningProfileId(gs.profileId);
        if (gs.logPath) {
          api.gameLogs(gs.profileId).then(setGameLog).catch(() => {});
        }
        setRunning(profiles.find((p) => p.id === gs.profileId) ?? null);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [gameRunning, profiles]);

  return (
    <div className="space-y-7">
      {/* Hero */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="relative overflow-hidden rounded-[26px] glass p-8 md:p-10">
          <div className="orb w-72 h-72 -top-24 -right-16 bg-accent/30" />
          <div className="orb w-56 h-56 -bottom-28 -left-14 bg-[#5e5ce6]/25" style={{ animationDelay: "-4s" }} />
          <div className="absolute top-1/2 right-8 -translate-y-1/2 w-[260px] h-[260px] pointer-events-none hidden lg:block">
            <div
              className="arc-slow absolute inset-0 rounded-full opacity-40"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, rgba(0,113,227,0.5) 60deg, transparent 130deg)",
                maskImage: "radial-gradient(farthest-side, transparent 62%, black 66%)",
                WebkitMaskImage: "radial-gradient(farthest-side, transparent 62%, black 66%)",
              }}
            />
            <div
              className="arc-slow absolute inset-4 rounded-full opacity-25"
              style={{
                background:
                  "conic-gradient(from 180deg, transparent 0deg, rgba(148,190,255,0.6) 70deg, transparent 150deg)",
                maskImage: "radial-gradient(farthest-side, transparent 62%, black 66%)",
                WebkitMaskImage: "radial-gradient(farthest-side, transparent 62%, black 66%)",
                animationDelay: "-6s",
              }}
            />
          </div>
          <div className="absolute inset-0 dot-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top_left,black_30%,transparent_75%)]" />
          <div
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty("--hx", `${e.clientX - r.left}px`);
              e.currentTarget.style.setProperty("--hy", `${e.clientY - r.top}px`);
            }}
            className="hero-spotlight absolute inset-0"
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="inline-flex items-center gap-2 text-[11px] font-medium text-white/55 uppercase tracking-[0.16em] glass-soft px-3 py-1.5 rounded-full">
              <Sparkles className="w-3.5 h-3.5 text-accent" /> {t("launcher.welcome")}
            </div>
            {lastProfile ? (
              <>
                <h1 className="mt-5 text-[32px] md:text-[38px] font-bold tracking-[-0.025em] leading-[1.08]">
                  {accountCount > 0 ? (
                    <span className="text-shine">{t("launcher.readyToPlay")}</span>
                  ) : (
                    <span className="text-shine">{t("launcher.signInToPlay")}</span>
                  )}
                </h1>
                <p className="mt-2.5 text-sm text-white/50 max-w-md">
                  {lastProfile.name} · Minecraft {lastProfile.gameVersion}
                  {lastProfile.loader !== "vanilla" && ` · ${lastProfile.loader}`}
                  {lastProfile.lastPlayed && (
                    <span className="text-white/30"> · {t("launcher.lastPlayed")} {timeAgo(lastProfile.lastPlayed)}</span>
                  )}
                </p>
                <div className="mt-8 flex items-center gap-3 flex-wrap">
                  {gameRunning ? (
                    <>
                      <Button
                        variant="danger"
                        size="lg"
                        className="flex-[3]"
                        loading={stopping}
                        onClick={stop}
                      >
                        <Square className="w-4 h-4" /> {t("launcher.stop")}
                      </Button>
                      <Button
                        size="lg"
                        className="flex-1"
                        title={t("launcher.restart")}
                        loading={restarting}
                        onClick={() => restart(lastProfile)}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      loading={startingId === lastProfile.id}
                      disabled={startingId !== null}
                      onClick={() => play(lastProfile)}
                    >
                      {gameRunning ? (
                        <>
                          <Square className="w-4 h-4" /> {t("launcher.gameRunning")}
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" /> {t("launcher.playName", { name: lastProfile.name })}
                        </>
                      )}
                    </Button>
                  )}
                  <Button size="lg" onClick={() => setShowLog(true)}>
                    <HardDrive className="w-4 h-4" /> {t("launcher.gameLog")}
                  </Button>
                  <Button size="lg" variant="ghost" className="group" onClick={() => useApp.getState().setPage("versions")}>
                    <ChevronRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" /> {t("launcher.newProfile")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 className="mt-5 text-[32px] md:text-[40px] font-bold tracking-[-0.025em] leading-[1.08]">
                  <span className="text-shine">{t("launcher.createFirst")}</span>
                </h1>
                <p className="mt-2.5 text-sm text-white/50 max-w-md">
                  {t("launcher.createHint")}
                </p>
                <div className="mt-8 flex items-center gap-3 flex-wrap">
                  <Button variant="primary" size="lg" onClick={() => useApp.getState().setPage("versions")}>
                    <ArrowRight className="w-4 h-4" /> {t("launcher.createProfile")}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* Playtime panel */}
        <div className="flex flex-col gap-3">
          <StatCard
            icon={<Flame className="w-[18px] h-[18px]" />}
            label={t("launcher.playedToday")}
            value={stats ? <AnimatedNumber value={stats.todaySeconds} fmt={fmtDuration} /> : "—"}
            sub={t("launcher.todaySub")}
            accent="text-orange-400"
          />
          <StatCard
            icon={<History className="w-[18px] h-[18px]" />}
            label={t("launcher.thisWeek")}
            value={stats ? <AnimatedNumber value={stats.weekSeconds} fmt={fmtDuration} /> : "—"}
            sub={stats ? t("launcher.weekSubs", { n: String(stats.days?.length ?? 0) }) : "…"}
            accent="text-accent"
          />
          <Card className="p-4 flex-1 min-h-[124px] hover:border-white/[0.12]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/40 font-medium uppercase tracking-wider">{t("launcher.allTime")}</span>
              <span className="text-[15px] font-semibold text-white tracking-tight">
                {stats ? <AnimatedNumber value={stats.totalSeconds} fmt={fmtDuration} /> : "—"}
              </span>
            </div>
            <MiniPlaytimeChart days={stats?.days ?? []} />
          </Card>
        </div>
      </section>

      {/* Profiles grid */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-white/90">{t("launcher.profiles")}</h2>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-white/35">{t("launcher.totalProfiles", { n: String(profiles.length) })}</span>
            <RefreshButton onClick={refreshStats} loading={refreshing} title={t("common.refresh")} />
          </div>
        </div>
        {profiles.length === 0 ? (
          <Card className="p-10 flex flex-col items-center gap-4 text-center hover:border-white/[0.12]">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <CircleUser className="w-6 h-6 text-white/25" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/70">{t("launcher.noProfilesTitle")}</p>
              <p className="text-xs text-white/40 mt-1 max-w-[320px]">
                {t("launcher.noProfilesBody")}
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            <AnimatePresence>
              {profiles.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94, y: 6 }}
                  transition={{
                    delay: i * 0.05,
                    type: "spring",
                    stiffness: 240,
                    damping: 26,
                  }}
                  className="h-full"
                >
                  <ProfileCard profile={p} onPlay={play} onStop={stop} onRestart={restart} onOverview={(p) => setOverviewId(p.id)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Profile overview modal */}
      {overviewId && (() => {
        const selected = profiles.find((p) => p.id === overviewId);
        return selected ? (
          <ProfileOverview
            profile={selected}
            onClose={() => setOverviewId(null)}
            onPlay={play}
            onStop={stop}
            onRestart={restart}
          />
        ) : null;
      })()}

      {/* Log modal */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowLog(false)} />
          <div className="relative w-[640px] max-h-[480px] rounded-[22px] glass shadow-lifted flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <span className="text-sm font-semibold tracking-tight text-white">{t("launcher.gameLog")}</span>
              <Button size="sm" onClick={() => setShowLog(false)}>
                {t("launcher.close")}
              </Button>
            </div>
            <pre className="p-4 overflow-auto text-[11px] leading-relaxed font-mono text-white/60 whitespace-pre-wrap">
              {gameLog.length === 0 ? t("launcher.logNoOutput") : gameLog.join("\n")}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}