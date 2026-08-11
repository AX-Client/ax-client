import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Check, Layers } from "lucide-react";
import { useApp } from "../lib/store";
import { api, toast } from "../lib/api";
import type { Profile, VersionEntryMeta } from "../lib/types";
import { Badge, Button, Card, Field, Modal, RefreshButton, SelectInput, TextInput, cx, EmptyState } from "../components/ui";
import { useT } from "../lib/i18n";

interface Draft {
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: string;
  javaTag: string;
  extraJvmArgs: string;
  width: string;
  height: string;
  customGameDir: string;
}

const LOADERS = [
  { id: "vanilla", labelKey: "versions.vanilla" },
  { id: "fabric", labelKey: "versions.fabric" },
  { id: "forge", labelKey: "versions.forge" },
  { id: "neoforge", labelKey: "versions.neoforge" },
  { id: "quilt", labelKey: "versions.quilt" },
] as const;

const JAVA_ANY = "_any";

export default function VersionsPage() {
  const t = useT();
  const { profiles, refreshProfiles, accountCount } = useApp();
  const [versions, setVersions] = useState<VersionEntryMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "release" | "snapshot" | "old">("all");
  const [open, setOpen] = useState(false);
  const [javaTags, setJavaTags] = useState<string[]>([JAVA_ANY]);
  const [defaultDraft, setDefaultDraft] = useState<Draft | null>(null);

  const load = (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setRefreshing(!!quiet);
    api
      .versionManifest()
      .then(setVersions)
      .catch((e) => toast(e))
      .then(() => api.javaList().then((js) => setJavaTags([JAVA_ANY, ...js.map((j) => j.tag)])).catch(() => {}))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => load(), []);
  useEffect(() => {
    api.javaList().then((js) => setJavaTags([JAVA_ANY, ...js.map((j) => j.tag)])).catch(() => {});
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return versions.filter((v) => {
      if (q && !v.id.toLowerCase().includes(q)) return false;
      if (kind === "release" && v.versionType !== "release") return false;
      if (kind === "snapshot" && v.versionType !== "snapshot") return false;
      if (kind === "old" && !["old_beta", "old_alpha"].includes(v.versionType)) return false;
      return true;
    });
  }, [versions, query, kind]);

  const isInstalled = (id: string) => profiles.some((p) => p.gameVersion === id && p.installStatus === "installed");

  const createProfile = async (draft: Draft) => {
    const base: Profile = {
      id: crypto.randomUUID(),
      name: draft.name,
      icon: "⚡",
      gameVersion: draft.gameVersion,
      loader: draft.loader,
      loaderVersion: draft.loaderVersion || null,
      installStatus: "not-installed",
      memoryMb: draft.memoryMb ? parseInt(draft.memoryMb) : null,
      extraJvmArgs: draft.extraJvmArgs,
      javaTag: draft.javaTag === JAVA_ANY ? "auto" : draft.javaTag,
      resolution: draft.width && draft.height ? { width: parseInt(draft.width), height: parseInt(draft.height) } : null,
      customGameDir: draft.customGameDir || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastPlayed: null,
      playCount: 0,
      playSeconds: 0,
      packages: [],
      server: null,
      latestVersion: "",
    };
    try {
      await api.saveProfile(base);
      await refreshProfiles();
      setOpen(false);
      toast(t("versions.created", { name: base.name }));
      try {
        await api.installProfile(base.id);
        await refreshProfiles();
        toast(t("versions.installDone"));
      } catch (e) {
        toast(t("versions.installFailed", { err: String(e) }));
      }
    } catch (e) {
      toast(String(e));
    }
  };

  const startCreate = (v: VersionEntryMeta) => {
    if (accountCount === 0) {
      toast(t("versions.loginToCreate"));
      return;
    }
    setDefaultDraft({
      name: t("versions.myProfile", { v: v.id }),
      gameVersion: v.id,
      loader: "fabric" as const,
      loaderVersion: "",
      memoryMb: "4096",
      javaTag: JAVA_ANY,
      extraJvmArgs: "",
      width: "854",
      height: "480",
      customGameDir: "",
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">{t("versions.title")}</h1>
          <p className="text-sm text-white/45 mt-0.5">
            {t("versions.sub")}
          </p>
        </div>
        <RefreshButton onClick={() => load(true)} loading={refreshing} title={t("common.refresh")} />
      </div>

      {accountCount === 0 && (
        <button
          onClick={() => useApp.getState().setPage("accounts")}
          className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-left text-[13px] text-amber-100/80 hover:bg-amber-500/10 transition"
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/15 text-amber-300">
            <Layers className="w-4 h-4" />
          </span>
          <span>
            <span className="font-medium text-white/90">{t("versions.loginToCreate")}</span>
            <span className="text-white/45"> {t("versions.accountsHint")}</span>
          </span>
        </button>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <TextInput
            className="pl-9"
            placeholder={t("versions.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
          {(
            [
              ["all", "versions.tabAll"],
              ["release", "versions.tabReleases"],
              ["snapshot", "versions.tabSnapshots"],
              ["old", "versions.tabOld"],
            ] as const
          ).map(([k, labelKey]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cx(
                "px-3 py-1.5 rounded-lg text-[12px] font-medium transition",
                kind === k ? "bg-accent text-white" : "text-white/50 hover:text-white"
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <EmptyState icon={<Layers className="w-5 h-5" />} title={t("versions.loading")} body={t("versions.loadingBody")} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Search className="w-5 h-5" />} title={t("versions.noMatch")} body={t("versions.noMatchBody")} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          <AnimatePresence>
            {list.slice(0, 60).map((v) => (
              <motion.button
                key={v.id}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                layout
                onClick={() => startCreate(v)}
                className="group text-left"
              >
                <Card className="p-4 h-full flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[14px] font-semibold text-white group-hover:text-accent transition-colors">
                        {v.id}
                      </div>
                      <div className="text-[10px] text-white/40 mt-0.5 uppercase tracking-wide">
                        {v.versionType.replace("_", " ")}
                      </div>
                    </div>
                    {isInstalled(v.id) ? (
                      <Badge tone="green">
                        <Check className="w-3 h-3" /> {t("versions.installed")}
                      </Badge>
                    ) : v.isLatest ? (
                      <Badge tone="blue">{t("versions.latest")}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 text-[10px] text-white/30">
                    {new Date(v.releaseTime).toLocaleDateString()}
                  </div>
                </Card>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {open && (
        <CreateProfileModal
          key={defaultDraft?.gameVersion}
          draft={defaultDraft!}
          loaderVersions={async (loader, mc) => api.loaderVersions(loader, mc)}
          javaTags={javaTags}
          onClose={() => setOpen(false)}
          onCreate={createProfile}
        />
      )}
    </div>
  );

}

function CreateProfileModal({
  draft,
  loaderVersions,
  javaTags,
  onClose,
  onCreate,
}: {
  draft: Draft;
  loaderVersions: (loader: string, mc: string) => Promise<string[]>;
  javaTags: string[];
  onClose: () => void;
  onCreate: (d: Draft) => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(draft ?? emptyDraft());
  const [loaderVers, setLoaderVers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => {
    if (d.loader !== "vanilla" && d.gameVersion) {
      loaderVersions(d.loader, d.gameVersion)
        .then(setLoaderVers)
        .catch((e) => toast(e));
    } else {
      setLoaderVers([]);
    }
  }, [d.loader, d.gameVersion]);

  const set = (k: keyof Draft, v: string) => setD((prev) => ({ ...prev, [k]: v }));

  return (
    <Modal open onClose={onClose} title={t("versions.creator")} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("versions.name")}>
          <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("versions.mc")} hint={t("versions.mcHint")}>
          <TextInput value={d.gameVersion} onChange={() => {}} />
        </Field>
        <Field label={t("versions.loader")}>
          <SelectInput value={d.loader} onChange={(e) => set("loader", e.target.value)}>
            {LOADERS.map((l) => (
              <option key={l.id} value={l.id}>
                {t(l.labelKey)}
              </option>
            ))}
          </SelectInput>
        </Field>
        {d.loader !== "vanilla" && (
          <Field label={t("versions.loaderVersion")}>
            <SelectInput value={d.loaderVersion ?? ""} onChange={(e) => set("loaderVersion", e.target.value)}>
              {loaderVers.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label={t("versions.memory")} hint={t("versions.memoryHint")}>
          <TextInput
            type="number"
            value={d.memoryMb}
            onChange={(e) => set("memoryMb", e.target.value)}
            placeholder="4096"
          />
        </Field>
        <Field label={t("versions.java")}>
          <SelectInput value={d.javaTag} onChange={(e) => set("javaTag", e.target.value)}>
            {javaTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag === JAVA_ANY ? t("versions.auto") : tag}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t("versions.resolution")} hint={t("versions.resolutionHint")}>
          <div className="flex gap-2">
            <TextInput value={d.width} onChange={(e) => set("width", e.target.value)} placeholder="854" />
            <TextInput value={d.height} onChange={(e) => set("height", e.target.value)} placeholder="480" />
          </div>
        </Field>
        <Field label={t("versions.customDir")} hint={t("versions.customDirHint")}>
          <TextInput value={d.customGameDir} onChange={(e) => set("customGameDir", e.target.value)} placeholder="~/minecraft-instance" />
        </Field>
      </div>
      <div className="mt-5">
        <Field label={t("versions.extraJvm")} hint={t("versions.extraJvmHint")}>
          <TextInput value={d.extraJvmArgs} onChange={(e) => set("extraJvmArgs", e.target.value)} placeholder="-XX:+UseG1GC" />
        </Field>
      </div>
      <div className="mt-6 flex items-center gap-3 flex-wrap">
        <Button variant="primary" size="lg" loading={busy} disabled={!d.name.trim()} onClick={async () => {
          setBusy(true);
          try {
            await onCreate(d);
          } finally {
            setBusy(false);
          }
        }}>
          {t("versions.createInstall")}
        </Button>
        <Button size="lg" onClick={onClose}>
          {t("versions.cancel")}
        </Button>
      </div>
    </Modal>
  );
}

function emptyDraft(): Draft {
  return {
    name: "",
    gameVersion: "",
    loader: "fabric",
    loaderVersion: null,
    memoryMb: "4096",
    javaTag: JAVA_ANY,
    extraJvmArgs: "",
    width: "",
    height: "",
    customGameDir: "",
  };
}